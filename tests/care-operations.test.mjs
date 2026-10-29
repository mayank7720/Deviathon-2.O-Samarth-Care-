import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './helpers/d1.mjs';
import {handleApi} from '../lib/api.mjs';
import {handleCareOperationsRoute} from '../lib/care-operations-routes.mjs';
import {createCarePlanning,careOperationsState} from '../lib/care-operations.mjs';

const cohort={seniors:Array.from({length:6},(_,i)=>({id:`S00${i+1}`,city:'Pune',name:`Fictional senior ${i+1}`}))};
function fixture(){
 const db=new LocalD1();
 // D1 serializes a batch; the SQLite test adapter otherwise opens overlapping BEGINs.
 const batch=db.batch.bind(db);let pending=Promise.resolve();
 db.batch=items=>{const operation=pending.then(()=>batch(items));pending=operation.catch(()=>{});return operation;};
 const event=(store,owner,kind,seniorId,payload,id=crypto.randomUUID())=>store.prepare('INSERT INTO care_events (id, owner, kind, senior_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id,owner,kind,seniorId,JSON.stringify(payload),new Date().toISOString());
 const storeMutation=(store,owner,kind,seniorId,payload,actor,id)=>store.batch([event(store,owner,kind,seniorId,payload,id),event(store,owner,'audit',seniorId,{actor,action:kind})]);
 const call=async(path='',{role='operations',scope=['*'],isAdmin=true,method='GET',body={},now=Date.now()}={})=>{
  const context={authenticated:true,authorized:true,userId:`test-${role}`,owner:'workspace:primary',session:{role,scope,isAdmin,userId:`test-${role}`}};
  const response=await handleCareOperationsRoute({path:'care-operations'+path,request:new Request('http://localhost/api/care-operations'+path,{method}),body,db,context,cohort,event,storeMutation,now,getSenior:id=>{assert.ok(scope.includes('*')||scope.includes(id));return cohort.seniors.find(s=>s.id===id);}});
  return {status:response.status,data:await response.json()};
 };
 return {db,call,close:()=>db.close()};
}
const ok=(response,status=200)=>assert.equal(response.status,status,JSON.stringify(response.data));
const assignmentBody=(a,key=crypto.randomUUID())=>({seniorId:a.seniorId,counsellorId:a.counsellorId,leaderId:a.leaderId,backupId:a.backupId,idempotencyKey:key});
const caseBody=a=>({seniorId:a.seniorId,category:'companionship',action:'Arrange a friendly human check-in',note:'Fictional senior requested more social contact.',assignedTo:a.counsellorId,idempotencyKey:crypto.randomUUID()});

test('fictional planning keeps household ownership distinct from auth and never invents case activity',async()=>{
 const f=fixture();try{
  const r=await f.call();ok(r);assert.equal(r.data.assignments.length,6);assert.deepEqual(r.data.cases,[]);assert.match(r.data.notice,/Fictional/);
  const counts=new Map();for(const a of r.data.assignments){assert.equal(a.householdId,a.seniorId);assert.notEqual(a.backupId,a.counsellorId);counts.set(a.counsellorId,(counts.get(a.counsellorId)||0)+1);}assert.ok([...counts.values()].every(n=>n<=2));
  ok(await f.call('',{role:'family'}),403);ok(await f.call('',{role:'senior'}),403);
  const read=await f.call('',{role:'operations',scope:['S001']});ok(read);assert.deepEqual(read.data.assignments.map(a=>a.seniorId),['S001']);
  const before=f.db.db.prepare('SELECT count(*) n FROM care_memberships').get().n;
  const assigned=await f.call('/assignments',{method:'POST',body:assignmentBody(r.data.assignments[0])});ok(assigned,201);
  assert.equal(f.db.db.prepare('SELECT count(*) n FROM care_memberships').get().n,before);
 }finally{f.close();}
});

test('assignment validation, idempotency, scope and capacity remain authoritative',async()=>{
 const f=fixture();try{
  const initial=(await f.call()).data,a=initial.assignments[0],b=initial.assignments[2];
  ok(await f.call('/assignments',{method:'POST',body:{...assignmentBody(a),counsellorId:b.counsellorId,backupId:a.counsellorId}}),409);
  ok(await f.call('/assignments',{method:'POST',body:{...assignmentBody(a),backupId:a.counsellorId}}),400);
  ok(await f.call('/assignments',{role:'operations',isAdmin:false,method:'POST',body:assignmentBody(a)}),403);
  ok(await f.call('/assignments',{scope:['S002'],method:'POST',body:assignmentBody(a)}),403);
  const empty=initial.directory.find(p=>p.role==='counsellor'&&!initial.assignments.some(x=>x.counsellorId===p.id));
  const body={...assignmentBody(a),counsellorId:empty.id};ok(await f.call('/assignments',{method:'POST',body}),201);
  // Postgres jsonb does not preserve object-key order; retries must compare values.
  const receipt=f.db.db.prepare("SELECT id,payload FROM care_events WHERE kind='care_assignment' AND id LIKE 'care-assignment-request:%'").get();
  const payload=JSON.parse(receipt.payload);payload.assignment=Object.fromEntries(Object.entries(payload.assignment).reverse());
  f.db.db.prepare('UPDATE care_events SET payload=? WHERE id=?').run(JSON.stringify(payload),receipt.id);
  const repeat=await f.call('/assignments',{method:'POST',body});ok(repeat);assert.equal(repeat.data.repeated,true);
  ok(await f.call('/assignments',{method:'POST',body:{...body,leaderId:initial.directory.filter(p=>p.role==='leader')[1].id}}),409);
  const state=(await f.call()).data;assert.equal(state.assignments.find(x=>x.seniorId===a.seniorId).counsellorId,empty.id);assert.equal(state.summary.recordedAssignments,1);
 }finally{f.close();}
});

test('city revision conflicts prevent concurrent overbooking and hidden-scope resets',async()=>{
 const f=fixture();try{
  const initial=(await f.call()).data,empty=initial.directory.find(p=>p.role==='counsellor'&&!initial.assignments.some(x=>x.counsellorId===p.id));
  const responses=await Promise.all(initial.assignments.slice(0,2).map(a=>f.call('/assignments',{method:'POST',body:{...assignmentBody(a),counsellorId:empty.id}})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const winner=responses.find(r=>r.status===201).data.assignment.seniorId;
  const hidden=initial.assignments.find(a=>a.seniorId!==winner);
  ok(await f.call('/assignments',{scope:[hidden.seniorId],method:'POST',body:assignmentBody(hidden)}),403);
  ok(await f.call('/assignments',{isAdmin:false,method:'POST',body:assignmentBody(hidden)}),403);
  const after=(await f.call()).data.assignments;assert.equal(after.filter(a=>a.counsellorId===empty.id).length,1);
 }finally{f.close();}
});

test('follow-up records require human contact evidence, explicit escalation and resolution outcome',async()=>{
 const f=fixture();try{
  const state=(await f.call()).data,body=caseBody(state.assignments[0]);
  const created=await f.call('/cases',{method:'POST',body});ok(created,201);assert.equal(created.data.case.externalDelivery,false);
  const repeat=await f.call('/cases',{method:'POST',body});ok(repeat);assert.equal(repeat.data.repeated,true);
  const path='/cases/'+body.idempotencyKey;
  ok(await f.call(path,{method:'PATCH',body:{revision:1,status:'contact_confirmed',contactChannel:'phone',contactResult:'no_answer',note:'A phone call was attempted without answer.'}}),400);
  const attempted=await f.call(path,{method:'PATCH',body:{revision:1,status:'contact_attempted',contactChannel:'phone',contactResult:'no_answer',note:'A phone call was attempted without answer.'}});ok(attempted);
  ok(await f.call(path,{method:'PATCH',body:{revision:1,status:'resolved',note:'This is a stale change attempt.',outcome:'A hypothetical old outcome.'}}),409);
  const leader=state.directory.find(p=>p.role==='leader');
  ok(await f.call(path,{method:'PATCH',body:{revision:2,status:'escalated',escalationTarget:body.assignedTo,note:'Ask another person to review the failed contact.'}}),400);
  ok(await f.call(path,{method:'PATCH',body:{revision:2,status:'escalated',escalationTarget:leader.id,note:'Leader review requested after the unanswered call.'}}));
  ok(await f.call(path,{method:'PATCH',body:{revision:3,status:'contact_confirmed',contactChannel:'in_person',contactResult:'reached',note:'In-person check-in recorded with agreed support.'}}));
  ok(await f.call(path,{method:'PATCH',body:{revision:4,status:'resolved',note:'Support was discussed and a follow-up date agreed.'}}),400);
  ok(await f.call(path,{method:'PATCH',body:{revision:4,status:'resolved',note:'Support was discussed and a follow-up date agreed.',outcome:'A companionship visit was agreed with the senior.'}}));
  const all=(await f.call()).data.cases;assert.equal(all.length,1);assert.equal(all[0].history.length,5);assert.equal(all[0].historyComplete,true);assert.equal(all[0].status,'resolved');assert.equal(all[0].externalDelivery,false);
  ok(await f.call(path,{method:'PATCH',body:{revision:5,status:'cancelled',note:'Closed work must not be silently reopened.'}}),409);
  ok(await f.call(path,{role:'operations',isAdmin:false,method:'PATCH',body:{revision:5,status:'cancelled',note:'Operations cannot change recorded care.'}}),403);
  assert.deepEqual((await f.call('',{scope:['S002']})).data.cases,[]);
 }finally{f.close();}
});

test('racing case updates append exactly one revision and never change clinical signals',async()=>{
 const f=fixture();try{
  const body=caseBody((await f.call()).data.assignments[0]);ok(await f.call('/cases',{method:'POST',body}),201);
  const patch={revision:1,status:'contact_attempted',contactChannel:'phone',contactResult:'failed',note:'Attempt failed; a human must decide the next step.'};
  const responses=await Promise.all([f.call('/cases/'+body.idempotencyKey,{method:'PATCH',body:patch}),f.call('/cases/'+body.idempotencyKey,{method:'PATCH',body:patch})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.call()).data.cases[0].history.length,2);assert.equal(f.db.db.prepare("SELECT count(*) n FROM care_events WHERE kind='signal'").get().n,0);
 }finally{f.close();}
});

test('care operations is integrated into the authenticated API and rejects family raw access',async()=>{
 const db=new LocalD1();try{
  const call=async role=>{const response=await handleApi(new Request('http://localhost/api/care-operations',{headers:{cookie:`samarth_local=${role}`}}),db,{local:true});return {status:response.status,data:await response.json()};};
  const coordinator=await call('coordinator');ok(coordinator);assert.equal(coordinator.data.assignments.length,200);
  const operations=await call('operations');ok(operations);assert.equal(operations.data.assignments.length,200);
  ok(await call('family'),403);ok(await call('senior'),403);
 }finally{db.close();}
});

test('partial older case history stays explicit and does not reset the latest snapshot',()=>{
 const planning=createCarePlanning(cohort),a=planning.assignments[0],caseId=crypto.randomUUID();
 const state=careOperationsState(cohort,[{kind:'care_followup',senior_id:a.seniorId,payload:{caseId,revision:4,status:'resolved',assignedTo:a.counsellorId,updatedAt:'2026-10-29T10:00:00Z',outcome:'Recorded outcome remains visible.'}}]);
 assert.equal(state.cases[0].status,'resolved');assert.equal(state.cases[0].historyComplete,false);
});

test('stored JSON cannot override the database event kind or replace care ownership',()=>{
 const planning=createCarePlanning(cohort),a=planning.assignments[0],caseId=crypto.randomUUID();
 const state=careOperationsState(cohort,[{kind:'care_followup',senior_id:a.seniorId,payload:{caseId,revision:1,status:'open',kind:'care_assignment',entryType:'assignment',assignment:{...a,source:'recorded',counsellorId:'forged'},city:a.city,capacityCounts:{forged:999},updatedAt:'2026-10-29T10:00:00Z'}}]);
 assert.equal(state.assignments[0].source,'illustrative');assert.notEqual(state.assignments[0].counsellorId,'forged');assert.equal(state.cases.length,1);
 const withBadTime=careOperationsState(cohort,[1,2].map(i=>({kind:'care_followup',senior_id:a.seniorId,payload:{caseId:crypto.randomUUID(),revision:1,status:'open',updatedAt:i}})));
 assert.equal(withBadTime.cases.length,2);
});
