import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './helpers/d1.mjs';
import {handlePortalCareRoute} from '../lib/portal-care-routes.mjs';

const COORDINATOR={userId:'care-1',name:'Care Coordinator',role:'coordinator',scope:['*']};
const ADMIN={userId:'admin-1',name:'Operations manager',role:'operations',isAdmin:true,scope:['*']};
const FAMILY={userId:'family-1',name:'Family',role:'family',seniorId:'S001',scope:['S001','S002']};
const SENIOR={userId:'senior-1',name:'Senior',role:'senior',seniorId:'S001',scope:['S001']};
function fixture(){
 const db=new LocalD1(),profiles=new Map(['S001','S002'].map(id=>[id,{id,name:id,familyConsent:true}]));
 for(const member of [COORDINATOR,ADMIN])db.db.prepare('INSERT INTO care_memberships (id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,status,is_admin,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),'primary',member.userId,member.userId+'@example.test',member.name,member.role,'',JSON.stringify(member.scope),'active',member.isAdmin?1:0,new Date().toISOString());
 const rows=()=>db.db.prepare('SELECT *,rowid as sequence FROM care_events ORDER BY rowid').all().map(row=>({...row,...JSON.parse(row.payload),seniorId:row.senior_id,createdAt:row.created_at}));
 const event=(db,owner,kind,sid,payload,id=crypto.randomUUID())=>db.prepare('INSERT INTO care_events (id,owner,kind,senior_id,payload,created_at) VALUES (?,?,?,?,?,?)').bind(id,owner,kind,sid,JSON.stringify(payload),new Date().toISOString());
 async function call(path,{session=COORDINATOR,method='GET',body,onMutation}={}){const request=new Request('https://example.test/api/'+path,{method});const result=await handlePortalCareRoute({path:path.split('?')[0],request,body,db,context:{owner:'workspace:primary',session,authenticated:true,authorized:true},rows:rows(),asOfDate:'2026-10-29',event,onMutation,getSenior(id){assert.ok(profiles.has(id));if(!session.scope.includes('*')&&!session.scope.includes(id))throw Object.assign(new Error('Outside your assignment'),{status:403});return profiles.get(id);}});return {status:result.status,data:await result.json()};}
 return {db,call,rows,profiles,event};
}

test('shared follow-up persists family request, acknowledgement, reported completion and staff outcome',async t=>{
 const f=fixture();t.after(()=>f.db.close());const id=crypto.randomUUID();
 const created=await f.call('portal-care/requests',{session:FAMILY,method:'POST',body:{idempotencyKey:id,seniorId:'S002',action:'Please arrange a medicine-plan review',details:'A dose was missed.',priority:'today'}});assert.equal(created.status,201);
 assert.equal((await f.call('portal-care?seniorId=S002',{session:FAMILY})).data.requests.length,1);
 assert.equal((await f.call('portal-care/requests/'+id,{session:FAMILY,method:'PATCH',body:{revision:1,status:'completed',outcome:'I am done'}})).status,403);
 assert.equal((await f.call('portal-care/requests/'+id,{session:COORDINATOR,method:'PATCH',body:{revision:1,status:'in_progress',assignedTo:COORDINATOR.userId,reply:'Calling to review the agreed plan.'}})).status,200);
 assert.equal((await f.call('portal-care/requests/'+id,{session:FAMILY,method:'PATCH',body:{revision:2,status:'reported_done',reply:'Shared the medicine log with the care team.'}})).status,200);
 assert.equal((await f.call('portal-care/requests/'+id,{session:ADMIN,method:'PATCH',body:{revision:3,status:'completed'}})).status,400);
 const final=await f.call('portal-care/requests/'+id,{session:ADMIN,method:'PATCH',body:{revision:3,status:'completed',outcome:'Coordinator confirmed the next agreed contact with the family.'}});assert.equal(final.status,200);
 const history=(await f.call('portal-care?seniorId=S002',{session:FAMILY})).data.requests[0];assert.equal(history.status,'completed');assert.equal(history.history.length,4);assert.equal(history.revision,4);
 assert.equal((await f.call('portal-care/requests/'+id,{session:ADMIN,method:'PATCH',body:{revision:4,status:'in_progress'}})).status,409);
});

test('bilingual wellbeing check-in atomically creates note, shared help follow-up and audit and safely retries',async t=>{
 const f=fixture();t.after(()=>f.db.close());const body={idempotencyKey:crypto.randomUUID(),seniorId:'S001',language:'hi',answers:{wellbeing:'help',medicines:'taken',daily_routine:'usual',support:'routine'}};
 let refreshed=0;const first=await f.call('checkins',{session:SENIOR,method:'POST',body,onMutation:()=>{refreshed++;}});assert.equal(first.status,201);assert.equal(first.data.followupCreated,true);assert.match(first.data.checkin.summary,/मदद/u);
 assert.equal(f.rows().filter(row=>row.kind==='checkin').length,1);assert.equal(f.rows().filter(row=>row.kind==='signal').length,1);assert.equal(f.rows().filter(row=>row.kind==='care_request').length,1);assert.equal(refreshed,1);
 const retry=await f.call('checkins',{session:SENIOR,method:'POST',body});assert.equal(retry.data.replayed,true);assert.equal(f.rows().length,4);
 const state=await f.call('portal-care?seniorId=S001',{session:FAMILY});assert.equal(state.data.checkins[0].reportedByRole,'senior');assert.equal(state.data.requests[0].priority,'prompt');
});

test('check-in validation, household scope and withdrawn consent never save partial data',async t=>{
 const f=fixture();t.after(()=>f.db.close());const body={idempotencyKey:crypto.randomUUID(),seniorId:'S001',answers:{wellbeing:'usual',medicines:'taken',daily_routine:'usual',support:'routine'}};
 assert.equal((await f.call('checkins',{session:FAMILY,method:'POST',body:{...body,date:'2026-10-30'}})).status,400);
 assert.equal((await f.call('checkins',{session:FAMILY,method:'POST',body:{...body,answers:{...body.answers,support:'unknown'}}})).status,400);
 assert.equal((await f.call('checkins',{session:SENIOR,method:'POST',body:{...body,seniorId:'S002'}})).status,403);assert.equal(f.rows().length,0);
 f.profiles.get('S001').familyConsent=false;assert.equal((await f.call('checkins',{session:FAMILY,method:'POST',body})).status,403);assert.equal((await f.call('portal-care?seniorId=S001',{session:FAMILY})).status,403);assert.equal(f.rows().length,0);
});

test('a failed transactional write does not leave a completed check-in without its help request',async t=>{
 const f=fixture();t.after(()=>f.db.close());const batch=f.db.batch.bind(f.db);f.db.batch=items=>batch([...items,{run:async()=>{throw new Error('storage unavailable');}}]);
 const result=await f.call('checkins',{session:SENIOR,method:'POST',body:{idempotencyKey:crypto.randomUUID(),seniorId:'S001',answers:{wellbeing:'help',medicines:'taken',daily_routine:'usual',support:'prompt'}}});assert.equal(result.status,500);assert.equal(f.rows().length,0);
});
