import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './helpers/d1.mjs';
import {handleReportRoute} from '../lib/report-routes.mjs';

const owner='workspace:primary',senior={id:'S001',name:'Fictional senior',familyConsent:false,baseline:{},level:'unknown'};
const env={SAMARTH_N8N_ENABLED:'true',SAMARTH_N8N_REPORT_WEBHOOK_URL:'https://fixture.app.n8n.cloud/webhook/samarth-weekly-report',SAMARTH_N8N_HMAC_SECRET:'fixture-only-report-signing-secret-of-sufficient-length'};
function fixture(){
 const db=new LocalD1(),event=(store,eventOwner,kind,seniorId,payload,id)=>store.prepare('INSERT INTO care_events (id,owner,kind,senior_id,payload,created_at) VALUES (?,?,?,?,?,?)').bind(id,eventOwner,kind,seniorId,JSON.stringify(payload),'2026-10-29T09:00:00Z');
 const getRows=()=>db.db.prepare('SELECT * FROM care_events ORDER BY created_at,id').all().map(row=>({...JSON.parse(row.payload),id:row.id,kind:row.kind,seniorId:row.senior_id,createdAt:row.created_at}));
 const call=async({method='GET',body={},role='coordinator'}={})=>{
  const response=await handleReportRoute({path:'reports',request:new Request('https://care.example/api/reports?seniorId=S001',{method}),body,db,context:{owner,userId:'fixture-coordinator',session:{role,userId:'fixture-coordinator',scope:['S001']}},rows:getRows(),cohort:{seniors:[senior],records:[],metadata:{synthetic:true}},getSenior:async id=>{assert.equal(id,'S001');return senior;},event,asOfDate:'2026-10-29',env});
  return {status:response.status,data:await response.json()};
 };
 return {db,event,call,getRows,close:()=>db.close()};
}

test('early accepted report remains processing until a saved completion exists, and retries never dispatch twice',async()=>{
 const f=fixture(),priorFetch=globalThis.fetch,key=crypto.randomUUID();let dispatches=0;
 try{
  globalThis.fetch=async(url,options)=>{
   dispatches++;assert.equal(url,env.SAMARTH_N8N_REPORT_WEBHOOK_URL);
   const job=JSON.parse(options.body),saved=f.db.db.prepare("SELECT id,payload FROM care_events WHERE kind='report_job'").get();
   assert.ok(saved,'the job must be durable before external dispatch');
   f.db.db.prepare('UPDATE care_events SET payload=? WHERE id=?').run(JSON.stringify({...JSON.parse(saved.payload),status:'claimed'}),saved.id);
   return new Response(JSON.stringify({accepted:true,jobId:job.jobId,status:'processing',generationCompleted:false,executionId:'synthetic-run'}));
  };
  const body={seniorId:'S001',language:'en',mode:'n8n',idempotencyKey:key};
  const first=await f.call({method:'POST',body});assert.equal(first.status,202);assert.equal(first.data.job.status,'processing');assert.equal(first.data.report.status,'awaiting_n8n');assert.equal(first.data.report.text,undefined);
  assert.equal((await f.call()).data.reports[0].status,'processing');
  const repeated=await f.call({method:'POST',body});assert.equal(repeated.status,200);assert.equal(repeated.data.repeated,true);assert.equal(repeated.data.report.status,'processing');assert.equal(dispatches,1);
  const changed=await f.call({method:'POST',body:{...body,language:'hi'}});assert.equal(changed.status,409);assert.equal(dispatches,1);
  const saved=f.getRows().find(row=>row.kind==='report_job'),report={language:'en',status:'pending_review',text:'A checked fixture report.',requiresHumanReview:true,method:'LLM-guided evidence-locked weekly report'};
  await f.event(f.db,owner,'generated_report','S001',{status:'pending_review',report},'n8n-report:'+key).run();
  f.db.db.prepare('UPDATE care_events SET payload=? WHERE id=?').run(JSON.stringify({...saved,status:'completed',reportId:'n8n-report:'+key}),saved.id);
  const completed=await f.call();assert.equal(completed.data.reports.length,1);assert.equal(completed.data.reports[0].status,'pending_review');assert.equal(completed.data.reports[0].text,report.text);
  const completedRetry=await f.call({method:'POST',body});assert.equal(completedRetry.data.report.id,'n8n-report:'+key);assert.equal(completedRetry.data.report.text,report.text);assert.equal(dispatches,1);
 }finally{globalThis.fetch=priorFetch;f.close();}
});

test('an ambiguous submission retains its saved job without automatic redispatch or a fabricated report',async()=>{
 const f=fixture(),priorFetch=globalThis.fetch;let dispatches=0;
 try{
  globalThis.fetch=async()=>{dispatches++;throw new Error('fixture connection interrupted');};
  const body={seniorId:'S001',language:'en',mode:'n8n',idempotencyKey:crypto.randomUUID()};
  const failed=await f.call({method:'POST',body});assert.equal(failed.status,503);assert.match(failed.data.error,/unconfirmed/);
  const retry=await f.call({method:'POST',body});assert.equal(retry.status,200);assert.equal(retry.data.repeated,true);assert.equal(retry.data.report.status,'awaiting_n8n');assert.equal(retry.data.report.text,undefined);assert.equal(dispatches,1);
  const saved=f.getRows().find(row=>row.kind==='report_job');f.db.db.prepare('UPDATE care_events SET payload=? WHERE id=?').run(JSON.stringify({...saved,status:'claimed',expiresAt:Date.now()-1}),saved.id);
  assert.equal((await f.call()).data.reports[0].status,'timed_out');assert.equal(dispatches,1);
 }finally{globalThis.fetch=priorFetch;f.close();}
});


test('timeouts persist and an unclaimed terminal job gets only one explicit retry child',async()=>{
 const f=fixture(),priorFetch=globalThis.fetch;let dispatches=0;
 try{
  globalThis.fetch=async(_url,options)=>{dispatches++;const envelope=JSON.parse(options.body);return new Response(JSON.stringify({accepted:true,jobId:envelope.jobId,status:'processing',generationCompleted:false}));};
  const first=await f.call({method:'POST',body:{seniorId:'S001',language:'en',mode:'n8n',idempotencyKey:crypto.randomUUID()}});
  const saved=f.getRows().find(row=>row.kind==='report_job'),payload=JSON.parse(f.db.db.prepare('SELECT payload FROM care_events WHERE id=?').get(saved.id).payload);
  f.db.db.prepare('UPDATE care_events SET payload=? WHERE id=?').run(JSON.stringify({...payload,expiresAt:Date.now()-1}),saved.id);
  const list=await f.call();assert.equal(list.data.reports[0].status,'timed_out');assert.equal(list.data.reports[0].retryAllowed,true);
  assert.equal(JSON.parse(f.db.db.prepare('SELECT payload FROM care_events WHERE id=?').get(saved.id).payload).status,'timed_out');
  const retry=await f.call({method:'POST',body:{action:'retry',reportId:saved.id,idempotencyKey:crypto.randomUUID()}});
  assert.equal(retry.status,202);assert.equal(dispatches,2);assert.notEqual(retry.data.report.jobId,first.data.job.jobId);
  const repeated=await f.call({method:'POST',body:{action:'retry',reportId:saved.id,idempotencyKey:crypto.randomUUID()}});
  assert.equal(repeated.status,200);assert.equal(repeated.data.repeated,true);assert.equal(dispatches,2);assert.equal(f.getRows().filter(row=>row.kind==='report_job').length,2);
 }finally{globalThis.fetch=priorFetch;f.close();}
});

test('a claimed timeout requires execution inspection and never starts another inference',async()=>{
 const f=fixture(),priorFetch=globalThis.fetch;let dispatches=0;
 try{
  globalThis.fetch=async(_url,options)=>{dispatches++;const envelope=JSON.parse(options.body);return new Response(JSON.stringify({accepted:true,jobId:envelope.jobId,status:'processing',generationCompleted:false}));};
  await f.call({method:'POST',body:{seniorId:'S001',language:'en',mode:'n8n',idempotencyKey:crypto.randomUUID()}});
  const saved=f.getRows().find(row=>row.kind==='report_job'),payload=JSON.parse(f.db.db.prepare('SELECT payload FROM care_events WHERE id=?').get(saved.id).payload);
  f.db.db.prepare('UPDATE care_events SET payload=? WHERE id=?').run(JSON.stringify({...payload,status:'claimed',claimedAt:new Date().toISOString(),expiresAt:Date.now()-1}),saved.id);
  const list=await f.call();assert.equal(list.data.reports[0].inspectionRequired,true);assert.equal(list.data.reports[0].retryAllowed,false);
  const retry=await f.call({method:'POST',body:{action:'retry',reportId:saved.id,idempotencyKey:crypto.randomUUID()}});assert.equal(retry.status,409);assert.equal(dispatches,1);
 }finally{globalThis.fetch=priorFetch;f.close();}
});


test('disabled n8n configuration cannot allocate a retry job',async()=>{
 const f=fixture(),priorFetch=globalThis.fetch;let dispatches=0;
 try{
  globalThis.fetch=async(_url,options)=>{dispatches++;const envelope=JSON.parse(options.body);return new Response(JSON.stringify({accepted:true,jobId:envelope.jobId,status:'processing',generationCompleted:false}));};
  await f.call({method:'POST',body:{seniorId:'S001',language:'en',mode:'n8n',idempotencyKey:crypto.randomUUID()}});
  const saved=f.getRows().find(row=>row.kind==='report_job'),payload=JSON.parse(f.db.db.prepare('SELECT payload FROM care_events WHERE id=?').get(saved.id).payload);
  f.db.db.prepare('UPDATE care_events SET payload=? WHERE id=?').run(JSON.stringify({...payload,status:'failed',failureCode:'invalid_output'}),saved.id);
  env.SAMARTH_N8N_ENABLED='false';
  const retry=await f.call({method:'POST',body:{action:'retry',reportId:saved.id,idempotencyKey:crypto.randomUUID()}});assert.equal(retry.status,503);assert.equal(dispatches,1);assert.equal(f.getRows().filter(row=>row.kind==='report_job').length,1);
 }finally{env.SAMARTH_N8N_ENABLED='true';globalThis.fetch=priorFetch;f.close();}
});
