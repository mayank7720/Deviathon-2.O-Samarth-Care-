import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH,randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { LocalD1 } from './helpers/d1.mjs';
import { runDaily,loadScores,revisionFor,queueDeliveries } from '../lib/daily-workflow.mjs';
import { handleDeliveryRoute,processDeliveries,validateSubscription } from '../lib/delivery-routes.mjs';
import { workflow } from '../lib/workflow-store.mjs';
import { careState,operationsSummary,safeFamily,safeSenior } from '../lib/care-state.mjs';
import { indiaDate,readRuntime,setRuntime,validDate } from '../lib/runtime.mjs';

const date='2026-10-27',owner='workspace:primary';
async function fixture() {
  const db=new LocalD1();
  const context={owner,workspaceId:'primary',identity:{userId:'staff'},session:{role:'coordinator',userId:'staff',scope:['*'],isAdmin:true}};
  for(const [id,userId,role,seniorId,scope] of [['staff1','staff','coordinator','',['*']],['family1','family','family','S001',['S001']],['other','other','family','S002',['S002']]]) {
    await db.prepare('INSERT INTO care_memberships VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(id,'primary',userId,`${userId}@example.test`,userId,role,seniorId,JSON.stringify(scope),role==='coordinator'?1:0,'active',date).run();
  }
  const seniors=[{id:'S001',score:72,level:'high',urgency:'today',urgencyRank:1},{id:'S002',score:null,level:'unknown',urgency:'unknown',urgencyRank:2},{id:'S003',score:8,level:'low',urgency:'routine',urgencyRank:3}].map(s=>({...s,name:`Fictional ${s.id}`,age:72,city:'Pune',language:'en',familyConsent:true,cues:[],latest:{date,vitals:{systolic:120,diastolic:80,spo2:98,glucose:110},note:'No pain.'},baseline:{systolic:120,diastolic:80,spo2:98,glucose:110,weight:65,activity:4000,sleep:7},trend:[],reasons:[],action:'Call to verify wellbeing.',confidence:s.score===null?0:90}));
  const cohort={seniors,records:seniors.flatMap(s=>Array.from({length:7},(_,i)=>({seniorId:s.id,date:`2026-10-${21+i}`,medication:{taken:3,prescribed:3},activity:4000,sleep:7,note:'No pain.'})))};
  const engine={calls:0,scoreSenior(id){this.calls++;return {...seniors.find(s=>s.id===id)};}};
  const consents=seniors.map(s=>({senior_id:s.id,allowed:true}));
  for(const consent of consents)await workflow(db,'consent_put',{owner,seniorId:consent.senior_id,allowed:true,updatedAt:date});
  // Real callers receive the authoritative timestamps too.
  const stored=await workflow(db,'consents_get',{owner});
  const rows=[],runtime={date,mode:'replay'};
  return {db,context,cohort,engine,consents:stored,rows,runtime};
}
async function call(f,path,{role='family',userId='family',method='GET',body={}}={}) {
  const context={...f.context,identity:{userId},session:{userId,role,seniorId:role==='family'?'S001':null,scope:role==='coordinator'?['*']:['S001']}};
  const response=await handleDeliveryRoute({...f,context,path:path.split('?')[0],request:new Request(`http://localhost/api/${path}`,{method}),body});
  return {status:response.status,data:await response.json()};
}

test('daily computation is repeatable, uses the cache, preserves unknown, and emits only high immediate family alerts',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const first=await runDaily(f);
  assert.equal(first.scores.find(s=>s.id==='S002').score,null);
  assert.equal(first.scores.find(s=>s.id==='S002').level,'unknown');
  assert.equal(first.scores.find(s=>s.id==='S003').familySafe.seriousAlert,null);
  assert.equal(first.scores.find(s=>s.id==='S003').familySafe.careAlert,null);
  assert.ok(first.scores.find(s=>s.id==='S001').familySafe.careAlert.createdAt);
  assert.equal(first.scores.find(s=>s.id==='S002').seniorSafe.careAlert.id,`A-S002-${date}`);
  const calls=f.engine.calls;
  const repeated=await runDaily(f);
  assert.equal(repeated.job.status,'already_completed');
  assert.equal(repeated.deliveriesQueued,0);
  assert.equal(f.engine.calls,calls);
  // Stale caller rows still cannot duplicate first-seen or delivery records.
  await queueDeliveries({...f,scores:first.scores,rows:[]});
  const all=await workflow(f.db,'deliveries_get',{owner,limit:100});
  const family=all.filter(d=>d.user_id==='family');
  assert.equal(family.filter(d=>d.kind==='serious_alert').length,1);
  assert.equal(all.filter(d=>d.senior_id==='S002'&&d.kind==='serious_alert').length,0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM care_events WHERE kind='alert_seen'").first()).n,2);
});

test('consent changes invalidate cached family payloads even if the event window is unchanged',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  await loadScores(f);
  const before=await revisionFor(f.rows,date,f.consents);
  const revoked=f.consents.map(c=>c.senior_id==='S001'?{...c,allowed:false,updated_at:'later'}:c);
  assert.notEqual(before,await revisionFor(f.rows,date,revoked));
  const scores=await loadScores({...f,consents:revoked});
  assert.equal(scores.find(s=>s.id==='S001').familySafe.familyConsent,false);
});

test('bulk default consent seeding never overwrites a withdrawal',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  await workflow(f.db,'consent_put',{owner,seniorId:'S001',allowed:false,updatedAt:'2026-10-28'});
  await workflow(f.db,'consents_seed',{owner,consents:[{seniorId:'S001',allowed:true},{seniorId:'S004',allowed:true}],updatedAt:'2026-10-29'});
  const rows=await workflow(f.db,'consents_get',{owner});
  assert.equal(rows.find(c=>c.senior_id==='S001').allowed,0);
  assert.equal(rows.find(c=>c.senior_id==='S001').updated_at,'2026-10-28');
  assert.equal(rows.find(c=>c.senior_id==='S004').allowed,1);
});

test('processing is idempotent and read receipts belong only to the intended recipient',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  await runDaily(f);
  const processed=await processDeliveries(f);
  assert.ok(processed.delivered>0);
  assert.deepEqual(await processDeliveries(f),{delivered:0,failed:0,blocked:0});
  const inbox=await call(f,'deliveries');
  assert.equal(inbox.status,200);
  const message=inbox.data.deliveries[0];
  assert.ok(message);
  assert.equal((await call(f,`deliveries/${encodeURIComponent(message.id)}`,{method:'PATCH',body:{read:true},userId:'other'})).status,404);
  assert.equal((await call(f,`deliveries/${encodeURIComponent(message.id)}`,{method:'PATCH',body:{read:true}})).status,200);
  const read=await workflow(f.db,'delivery_get',{owner,id:message.id});
  assert.equal(read.status,'read');
  assert.ok(read.read_at);
  assert.ok(read.delivered_at);
});

test('fresh consent withdrawal blocks queued family deliveries and hides old inbox messages',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  await runDaily(f);
  await workflow(f.db,'consent_put',{owner,seniorId:'S001',allowed:false,updatedAt:'2026-10-28'});
  const result=await processDeliveries(f);
  assert.ok(result.blocked>0);
  const inbox=await call(f,'deliveries');
  assert.deepEqual(inbox.data.deliveries,[]);
  assert.equal((await workflow(f.db,'deliveries_get',{owner,userId:'family',limit:100})).every(d=>['blocked_consent','pending_review'].includes(d.status)),true);
});

test('weekly drafts require explicit coordinator approval before family visibility or delivery',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const result=await runDaily(f);
  assert.match(result.scores[0].familySafe.weeklySummary,/awaiting care-team review/);
  assert.equal(result.scores[0].familySafe.summary.method,'pending care-team review');
  const draft=(await workflow(f.db,'deliveries_get',{owner,userId:'family',limit:100})).find(d=>d.kind==='weekly_summary');
  assert.equal(draft.status,'pending_review');
  assert.match(draft.payload.body,/recorded check-in/);
  await processDeliveries(f);
  assert.equal((await call(f,'deliveries')).data.deliveries.some(d=>d.kind==='weekly_summary'),false);
  assert.equal((await call(f,`deliveries/${encodeURIComponent(draft.id)}`,{method:'PATCH',body:{approve:true}})).status,403);
  assert.equal((await call(f,`deliveries/${encodeURIComponent(draft.id)}`,{role:'coordinator',userId:'staff',method:'PATCH',body:{approve:true}})).status,200);
  assert.equal((await workflow(f.db,'delivery_get',{owner,id:draft.id})).status,'delivered');
  assert.equal((await call(f,'deliveries')).data.deliveries.some(d=>d.id===draft.id&&d.status==='delivered'),true);
});

test('delivery pagination never loses messages with an identical creation timestamp',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  for(let i=0;i<7;i++)await workflow(f.db,'delivery_put',{id:`page-${i}`,owner,seniorId:'S001',recipientRole:'family',userId:'family',kind:'weekly_summary',channel:'in_app',status:'delivered',payload:{body:'Synthetic update'},sourceId:`source-${i}`,createdAt:'2026-10-27T09:00:00Z'});
  let cursor=null,seen=[];
  do {const page=await call(f,`deliveries?limit=2${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);assert.equal(page.status,200);seen.push(...page.data.deliveries.map(d=>d.id));cursor=page.data.nextCursor;}while(cursor);
  assert.equal(seen.length,7);
  assert.equal(new Set(seen).size,7);
});

test('push subscription endpoints reject local networks, spoofed providers and malformed keys',()=>{
  const keys={p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')};
  assert.equal(validateSubscription({endpoint:'https://fcm.googleapis.com/send/synthetic',keys}).endpoint,'https://fcm.googleapis.com/send/synthetic');
  for(const endpoint of ['https://127.0.0.1/','http://fcm.googleapis.com/x','https://fcm.googleapis.com.attacker.test/','https://attacker.test@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x','https://fcm.googleapis.com/x#secret'])assert.throws(()=>validateSubscription({endpoint,keys}),{status:400});
  assert.throws(()=>validateSubscription({endpoint:'https://fcm.googleapis.com/x',keys:{...keys,p256dh:'a'.repeat(87)}}),{status:400});
});

test('browser push uses an encrypted generic payload, no redirects, and no second send after success',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const client=createECDH('prime256v1');client.generateKeys();
  const subscription={endpoint:'https://fcm.googleapis.com/send/synthetic',keys:{p256dh:client.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
  await workflow(f.db,'push_put',{id:'push1',owner,userId:'family',subscription,createdAt:new Date().toISOString()});
  const keys=webpush.generateVAPIDKeys(),env={VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'mailto:test@example.test'};
  await runDaily(f);
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return new Response(null,{status:201});};
  const result=await processDeliveries({...f,env,fetchImpl});
  assert.ok(result.delivered>0);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,subscription.endpoint);
  assert.equal(calls[0].options.redirect,'manual');
  assert.equal(calls[0].options.headers['Content-Encoding'],'aes128gcm');
  const wire=Buffer.from(calls[0].options.body).toString('utf8');
  assert.equal(wire.includes('Fictional'),false);
  assert.equal(wire.includes('S001'),false);
  assert.equal(wire.includes('glucose'),false);
  await processDeliveries({...f,env,fetchImpl});
  assert.equal(calls.length,1);
});

test('concurrent processors claim each push once and an expired lease can be recovered',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const client=createECDH('prime256v1');client.generateKeys();
  const subscription={endpoint:'https://fcm.googleapis.com/send/concurrent-synthetic',keys:{p256dh:client.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
  await workflow(f.db,'push_put',{id:'pushlease',owner,userId:'family',subscription,createdAt:new Date().toISOString()});
  const keys=webpush.generateVAPIDKeys(),env={VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'mailto:test@example.test'};
  const createDelivery=id=>workflow(f.db,'delivery_put',{id,owner,seniorId:'S001',recipientRole:'family',userId:'family',kind:'serious_alert',channel:'web_push',payload:{body:'Generic update'},sourceId:id,createdAt:new Date().toISOString()});
  await createDelivery('concurrent');
  let sends=0;
  const fetchImpl=async()=>{sends++;await new Promise(resolve=>setTimeout(resolve,5));return new Response(null,{status:201});};
  const outcomes=await Promise.all([processDeliveries({...f,env,fetchImpl}),processDeliveries({...f,env,fetchImpl})]);
  assert.equal(sends,1);
  assert.equal(outcomes.reduce((sum,result)=>sum+result.delivered,0),1);
  const delivered=await workflow(f.db,'delivery_get',{owner,id:'concurrent'});
  assert.equal(delivered.attempts,1);
  assert.equal(delivered.claimed_at,null);
  await createDelivery('recovered');
  const old=new Date(Date.now()-6*60000).toISOString(),cutoff=new Date(Date.now()-5*60000).toISOString();
  assert.equal((await workflow(f.db,'delivery_claim',{owner,id:'recovered',attempts:0,claimedAt:old,expiredBefore:cutoff})).claimed,true);
  await processDeliveries({...f,env,fetchImpl});
  const recovered=await workflow(f.db,'delivery_get',{owner,id:'recovered'});
  assert.equal(recovered.status,'delivered');assert.equal(recovered.attempts,2);assert.equal(sends,2);
  await createDelivery('activelease');
  assert.equal((await workflow(f.db,'delivery_claim',{owner,id:'activelease',attempts:0,claimedAt:new Date().toISOString(),expiredBefore:cutoff})).claimed,true);
  await processDeliveries({...f,env,fetchImpl});
  assert.equal(sends,2);
  assert.equal((await workflow(f.db,'delivery_get',{owner,id:'activelease'})).status,'processing');
});

test('runtime uses India date rollover, validates real calendar dates and keeps replay deterministic',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  assert.equal(indiaDate(new Date('2026-10-27T18:45:00Z')),'2026-10-28');
  assert.equal(validDate('2026-02-30'),false);
  assert.equal((await readRuntime(f.db,owner,{now:new Date('2030-01-01')})).date,date);
  await assert.rejects(()=>setRuntime(f.db,owner,{mode:'replay',date:'2026-10-99'}),{status:400});
  assert.equal((await setRuntime(f.db,owner,{mode:'replay',date:'2026-09-01'})).date,'2026-09-01');
  await setRuntime(f.db,owner,{mode:'live'});
  assert.equal((await readRuntime(f.db,owner,{now:new Date('2026-10-27T18:45:00Z')})).date,'2026-10-28');
});

test('operations separate first acknowledgement from completion and do not invent a response',()=>{
  const seniors=[{id:'S001',city:'Pune',level:'high'},{id:'S002',city:'Delhi',level:'unknown'}];
  const rows=[{kind:'alert_seen',alertId:'a',seniorId:'S001',firstSeenAt:'2026-10-27T09:00:00Z'},{kind:'alert_state',alertId:'a',seniorId:'S001',firstAcknowledgedAt:'2026-10-27T09:10:00Z',status:'acknowledged'},{kind:'alert_seen',alertId:'b',seniorId:'S002',firstSeenAt:'2026-10-27T09:00:00Z'}];
  const tasks=[{seniorId:'S001',status:'completed',createdAt:'2026-10-27T09:00:00Z',completedAt:'2026-10-27T10:00:00Z'}];
  const result=operationsSummary(seniors,tasks,rows,date);
  assert.equal(result.meanFirstResponseMinutes,10);
  assert.equal(result.meanCompletionMinutes,60);
  assert.equal(result.byCity.find(g=>g.city==='Delhi').meanFirstResponseMinutes,null);
  assert.equal(careState('S001',[],date).status,'unreviewed');
  assert.equal(careState('S001',[{kind:'task',seniorId:'S001',status:'completed',createdAt:'2026-10-27T09:00:00Z',completedAt:'2026-10-27T10:00:00Z'}],date).status,'resolved');
  assert.equal(careState('S001',[{kind:'task',seniorId:'S001',status:'completed',createdAt:'2026-10-27T09:00:00Z',completedAt:'2026-10-27T10:00:00Z'},{kind:'task',seniorId:'S001',status:'open',createdByRole:'coordinator',createdAt:'2026-10-27T10:05:00Z'}],date).status,'in_progress');
  assert.equal(careState('S001',[{kind:'task',seniorId:'S001',status:'open',createdAt:'2026-10-27T10:05:00Z',note:'Automatic help request'}],date).status,'unreviewed');
  assert.equal(careState('S001',[{kind:'task',seniorId:'S001',status:'open',createdByRole:'coordinator',asOfDate:date,createdAt:'2026-10-28T10:05:00Z'}],date).status,'in_progress');
  assert.equal(careState('S001',[{kind:'task',seniorId:'S001',status:'open',createdByRole:'coordinator',asOfDate:'2026-10-28',createdAt:'2026-10-27T10:05:00Z'}],date).status,'unreviewed');
  assert.equal(careState('S001',[{kind:'task',seniorId:'S001',status:'open',createdByRole:'coordinator',createdAt:'2026-10-27T19:00:00Z'}],'2026-10-28').status,'in_progress');
  assert.match(safeFamily({id:'S002',name:'Synthetic',level:'unknown',score:null,trend:[]},date).action,/incomplete/);
  assert.equal(safeFamily({id:'S002',name:'Synthetic',level:'low',score:10},date).careAlert,null);
  assert.equal(safeSenior({id:'S002',level:'low'},date).careAlert,null);
  assert.equal(safeSenior({id:'S002',level:'unknown'},date).careAlert.status,'open');
});
