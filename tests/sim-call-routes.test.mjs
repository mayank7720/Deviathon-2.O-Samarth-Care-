import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './helpers/d1.mjs';
import {handleSimCallRoute} from '../lib/sim-call-routes.mjs';
import {signBridgeRequest} from '../lib/telephony.mjs';
import {assertLiveCallReady,workerConfiguration,processSimCall,transcribeRecordedAnswers,main} from '../scripts/sim-call-worker.mjs';

const now=Date.parse('2026-10-29T10:00:00Z'),secret='fixture-only-sim-bridge-secret-at-least-thirty-two',phone='+19990000001';
const contacts=[{id:'owned-senior',seniorId:'S001',role:'senior',phone,verified:true,callConsent:true,smsConsent:true},{id:'owned-family',seniorId:'S001',role:'family',phone:'+19990000002',verified:true,callConsent:true,smsConsent:true}];
const env={SAMARTH_SIM_VOICE_ENABLED:'true',SAMARTH_SIM_BRIDGE_SECRET:secret,SAMARTH_TELEPHONY_CONTACTS_JSON:JSON.stringify(contacts)};
const input=()=>({contactId:'owned-senior',language:'hi',consentConfirmed:true,idempotencyKey:crypto.randomUUID()});
function fixture(){
 const db=new LocalD1();let familyConsent=true;
 const originalBatch=db.batch.bind(db);let pending=Promise.resolve();db.batch=items=>{const op=pending.then(()=>originalBatch(items));pending=op.catch(()=>{});return op;};
 const event=(db,owner,kind,seniorId,payload,id=crypto.randomUUID())=>db.prepare('INSERT INTO care_events (id,owner,kind,senior_id,payload,created_at) VALUES (?,?,?,?,?,?)').bind(id,owner,kind,seniorId,JSON.stringify(payload),new Date(now).toISOString());
 async function call(path,{body,method=body?'POST':'GET',role='coordinator',scope=['*'],signed=false,headers={},clock=now,overrides={}}={}){
  const raw=body===undefined?'':JSON.stringify(body),url='http://localhost/api/sim-calls/'+path;
  const proof=signed?await signBridgeRequest({method,path:new URL(url).pathname,body:raw,secret,timestamp:Math.floor(clock/1000)}):{};
  const allHeaders={...proof,...headers};
  const response=await handleSimCallRoute({path:'sim-calls/'+path,request:new Request(url,{method,headers:allHeaders}),body,rawBody:raw,db,context:{authenticated:true,authorized:true,owner:'workspace:primary',session:{userId:'test-coordinator',role,scope}},env:{...env,...overrides},cohort:{seniors:[{id:'S001'},{id:'S002'}]},event,now:clock,getSenior:id=>({id,familyConsent})});
  return {status:response.status,data:await response.json(),headers:allHeaders};
 }
 return {db,event,call,withdraw:()=>{familyConsent=false;},close:()=>db.close()};
}
const ok=(r,status=200)=>assert.equal(r.status,status,JSON.stringify(r.data));
async function queueClaim(f){const r=await f.call('jobs',{body:input()});ok(r,201);const c=await f.call(`jobs/${r.data.job.id}/claim`,{body:{},signed:true});ok(c);return c.data.job;}

test('SIM queue is explicitly enabled, scoped and idempotent without exposing destinations',async()=>{
 const f=fixture();try{
  ok(await f.call('jobs',{body:input(),overrides:{SAMARTH_SIM_VOICE_ENABLED:'false'}}),503);
  ok(await f.call('jobs',{body:input(),role:'operations'}),403);ok(await f.call('jobs',{body:input(),role:'family'}),403);ok(await f.call('jobs',{body:input(),scope:['S002']}),403);
  ok(await f.call('jobs',{body:{...input(),phone}}),400);ok(await f.call('jobs',{body:{...input(),consentConfirmed:false}}),400);
  const body=input(),created=await f.call('jobs',{body});ok(created,201);assert.equal(created.data.job.status,'queued');assert.equal(created.data.job.externalDelivery,false);
  const repeat=await f.call('jobs',{body});ok(repeat);assert.equal(repeat.data.job.id,created.data.job.id);assert.equal(repeat.data.repeated,true);
  assert.ok(!JSON.stringify(created.data).includes(phone));
  f.withdraw();ok(await f.call('jobs',{body:{...input(),contactId:'owned-family'}}),403);
  ok(await f.call('status',{role:'senior'}),403);
 }finally{f.close();}
});

test('SIM claims require fresh replay-resistant signatures and reserve a single caller',async()=>{
 const f=fixture();try{
  const first=await f.call('jobs',{body:input()}),second=await f.call('jobs',{body:input()});ok(first,201);ok(second,201);
  const path=`jobs/${first.data.job.id}/claim`;
  ok(await f.call(path,{body:{}}),401);ok(await f.call(path,{body:{},signed:true,role:'operations'}),403);
  const claimed=await f.call(path,{body:{},signed:true});ok(claimed);assert.equal(claimed.data.job.phone,phone);assert.ok(claimed.data.job.leaseToken);
  ok(await f.call(path,{body:{},headers:claimed.headers}),409);ok(await f.call(path,{body:{},signed:true}),409);
  ok(await f.call(`jobs/${second.data.job.id}/claim`,{body:{},signed:true}),409);
  const listed=await f.call('jobs');ok(listed);assert.ok(!JSON.stringify(listed.data).includes(phone));assert.ok(!JSON.stringify(listed.data).includes(claimed.data.job.leaseToken));
 }finally{f.close();}
});

test('factual receipt states reject fabricated answer/consent and unknown submissions never unlock',async()=>{
 const f=fixture();try{
  const job=await queueClaim(f),path=`jobs/${job.id}/receipt`,leaseToken=job.leaseToken;
  ok(await f.call(path,{body:{leaseToken,status:'originated',callAnswered:true},signed:true}),400);
  ok(await f.call(path,{body:{leaseToken,status:'answers_recorded',callAnswered:true,consentGranted:false,audioCount:4},signed:true}),400);
  ok(await f.call(path,{body:{leaseToken,status:'failed',callAnswered:false,consentGranted:true,audioCount:0},signed:true}),400);
  ok(await f.call(path,{body:{leaseToken,status:'failed',audioCount:'0'},signed:true}),400);
  ok(await f.call(path,{body:{leaseToken,status:'originated'},signed:true}));
  const unknown=await f.call(path,{body:{leaseToken,status:'submission_unknown'},signed:true});ok(unknown);assert.equal(unknown.data.job.humanRead,false);assert.equal(unknown.data.job.externalDelivery,false);
  ok(await f.call(path,{body:{leaseToken,status:'failed'},signed:true}),409);
  const next=await f.call('jobs',{body:input()});ok(next,201);
  ok(await f.call(`jobs/${next.data.job.id}/claim`,{body:{},signed:true,clock:now+11*60000}),409);
 }finally{f.close();}
});

test('a saved contact cannot change recipient identity between queue and claim',async()=>{
 const f=fixture();try{
  const created=await f.call('jobs',{body:input()});ok(created,201);
  await f.event(f.db,'workspace:primary','telephony_contact','S001',{contact:{...contacts[0],role:'family'}}).run();
  ok(await f.call(`jobs/${created.data.job.id}/claim`,{body:{},signed:true}),409);
  assert.equal(f.db.db.prepare("SELECT count(*) n FROM care_events WHERE id='sim-call-caller-lock'").get().n,0);
 }finally{f.close();}
});

test('recorded answers release caller only after terminal evidence, drafts do not auto-approve',async()=>{
 const f=fixture();try{
  const job=await queueClaim(f),leaseToken=job.leaseToken;
  const finished=await f.call(`jobs/${job.id}/receipt`,{body:{leaseToken,status:'answers_recorded',callAnswered:true,consentGranted:true,audioCount:4},signed:true});ok(finished);assert.equal(finished.data.job.transcriptStatus,'not_started');
  const ids=Array.from({length:4},()=>crypto.randomUUID());
  for(const id of ids)await f.event(f.db,'workspace:primary','speech_draft','S001',{transcription:{ticketId:id,actorId:'test-coordinator',externalServiceUsed:false}},'speech-draft:'+id).run();
  const body={leaseToken,draftIds:ids},path=`jobs/${job.id}/transcripts`;
  ok(await f.call(path,{body:{...body,draftIds:ids.slice(0,3)},signed:true}),400);
  const saved=await f.call(path,{body,signed:true});ok(saved);assert.equal(saved.data.job.transcriptStatus,'drafts_saved');assert.equal(saved.data.job.status,'answers_recorded');assert.equal(saved.data.job.humanRead,false);
  const repeat=await f.call(path,{body,signed:true});ok(repeat);assert.equal(repeat.data.repeated,true);
  const wrong=await f.call(path,{body:{...body,draftIds:[...ids].reverse()},signed:true});ok(wrong,409);
  assert.equal(f.db.db.prepare("SELECT count(*) n FROM care_events WHERE kind='signal' OR kind='speech_review'").get().n,0);
  const next=await queueClaim(f);assert.notEqual(next.id,job.id);
 }finally{f.close();}
});

test('rate guard caps requests and stale heartbeat cannot claim online status',async()=>{
 const f=fixture();try{
  for(let i=0;i<10;i++)ok(await f.call('jobs',{body:input()}),201);
  ok(await f.call('jobs',{body:input()}),429);
  const heartbeat=await f.call('bridge/heartbeat',{body:{deviceReady:true},signed:true});ok(heartbeat);
  assert.equal((await f.call('status')).data.bridgeOnline,true);
  assert.equal((await f.call('status',{clock:now+121000})).data.bridgeOnline,false);
 }finally{f.close();}
});

test('worker readiness never treats Windows or missing audio verification as call permission',async()=>{
 const preflight={ready:true,readOnly:true,callsStarted:0};
 assert.throws(()=>assertLiveCallReady({platform:'linux',preflight,env:{SAMARTH_SIM_AUDIO_VERIFIED:'true'}}));
 assert.throws(()=>assertLiveCallReady({allowCalls:true,platform:'win32',preflight,env:{SAMARTH_SIM_AUDIO_VERIFIED:'true'}}));
 assert.throws(()=>assertLiveCallReady({allowCalls:true,platform:'linux',preflight,env:{}}));
 assert.doesNotThrow(()=>assertLiveCallReady({allowCalls:true,platform:'linux',preflight,env:{SAMARTH_SIM_AUDIO_VERIFIED:'true'}}));
 assert.throws(()=>workerConfiguration({SAMARTH_APP_URL:'http://care.example'}));
 await assert.rejects(()=>main(['--bad'],{}));
});

const jobId='33333333-3333-4333-8333-333333333333';
const claimedJob={id:jobId,seniorId:'S001',phone,leaseToken:'fixture-lease',language:'hi',expiresAt:new Date(now+60000).toISOString(),leaseExpiresAt:new Date(now+600000).toISOString()};
function workerFixture(result){
 const requests=[],commands=[],records=[],draftIds=[];
 const api=async(path,method,body)=>{requests.push({path,method,body});if(path.endsWith('/claim'))return {job:claimedJob};if(path==='speech/ticket'){const ticketId=crypto.randomUUID();draftIds.push(ticketId);return {ticketId,ticket:'fixture-ticket',serviceUrl:'http://127.0.0.1:8766'};}if(path==='speech/drafts')return {draft:{id:draftIds.at(-1)}};return {ok:true};};
 const spool={stage:async m=>records.push({phase:'manifest',m}),markSubmitting:async()=>records.push({phase:'submission'}),waitResult:async()=>result,audio:async()=>Buffer.from('fixture-wave-audio'),record:async(id,phase,value)=>records.push({id,phase,value})};
 const executeImpl=async(...args)=>{commands.push(args);return {stdout:'',stderr:''};};
 return {api,spool,executeImpl,requests,commands,records};
}
test('worker issues one validated shell-free command and unknown command result never redials',async()=>{
 const f=workerFixture(null);f.executeImpl=async(...args)=>{f.commands.push(args);throw new Error('Lost response after submission');};
 await assert.rejects(()=>processSimCall({id:jobId},{...f,env:{SAMARTH_ASTERISK_DEVICE:'samarthphone'},origin:'http://localhost:5173',now:()=>now}),/No redial/);
 assert.equal(f.commands.length,1);assert.equal(f.commands[0][2].shell,false);assert.equal(f.records[1].phase,'submission');
 assert.equal(f.requests.at(-1).body.status,'submission_unknown');assert.equal(f.requests.at(-1).body.callAnswered,false);
});

test('consented audio is transcribed into signed drafts and never approved by the worker',async()=>{
 const result={status:'answers_recorded',consentGranted:true,callAnswered:true,answers:['wellbeing','medication','appetite','support'].map(questionId=>({questionId}))},f=workerFixture(result),outgoing=[];
 const fetchImpl=async(url,options)=>{outgoing.push({url,options});return new Response(JSON.stringify({receipt:{payload:'fixture signed payload',signature:'a'.repeat(64)}}));};
 const completed=await processSimCall({id:jobId},{...f,env:{SAMARTH_ASTERISK_DEVICE:'samarthphone'},origin:'http://localhost:5173',now:()=>now,fetchImpl});
 assert.equal(completed.transcription,'drafts_saved');assert.equal(f.commands.length,1);assert.equal(outgoing.length,4);assert.ok(outgoing.every(r=>r.url==='http://127.0.0.1:8766/transcribe'&&r.options.headers.Origin==='http://localhost:5173'));
 assert.equal(f.requests.filter(r=>r.path==='speech/drafts').length,4);assert.equal(f.requests.at(-1).path,`sim-calls/jobs/${jobId}/transcripts`);assert.ok(f.requests.every(r=>!r.path.includes('/review')));
 const declined=workerFixture({status:'declined',consentGranted:false,callAnswered:true,answers:[]});await processSimCall({id:jobId},{...declined,env:{SAMARTH_ASTERISK_DEVICE:'samarthphone'},origin:'http://localhost:5173',now:()=>now,fetchImpl:()=>{throw new Error('No audio may be sent without consent.');}});
 assert.ok(declined.requests.every(r=>!r.path.startsWith('speech/')));
});

test('speech transport rejects a non-loopback service before sending audio',async()=>{
 const result={consentGranted:true,answers:[{questionId:'wellbeing'}]};let sent=false;
 await assert.rejects(()=>transcribeRecordedAnswers({job:claimedJob,result,spool:{audio:async()=>Buffer.from('wave')},api:async()=>({ticketId:crypto.randomUUID(),ticket:'x',serviceUrl:'https://example.invalid'}),origin:'http://localhost:5173',fetchImpl:async()=>{sent=true;}}));assert.equal(sent,false);
});

test('a wellbeing bot cannot be addressed to a family account',async()=>{
 const f=fixture();try{const result=await f.call('jobs',{body:{...input(),contactId:'owned-family'}});ok(result,400);assert.match(result.data.error,/senior account/);assert.equal(f.db.db.prepare("SELECT count(*) n FROM care_events WHERE kind='sim_call_job'").get().n,0);}finally{f.close();}
});
