import test from 'node:test';
import assert from 'node:assert/strict';
import { createN8nReportRequest,signN8nEnvelope } from '../lib/n8n-integration.mjs';
import { deterministicReportPlan } from '../lib/grounded-reports.mjs';
import { createN8nHooksHandler } from '../lib/n8n-hooks.mjs';

const secret='synthetic-hook-signing-credential-long-enough';
const now=Date.parse('2026-10-29T01:00:00Z'),jobId='test_job_000000000001';
async function fixture() {
  const request=await createN8nReportRequest({jobId,senior:{id:'S001',name:'Private Name',level:'unknown',urgency:'unknown',baseline:{}},records:[{id:'private-clinical-row',seniorId:'S001',date:'2026-10-27',sleep:5,note:'Feeling lonely. Call 9876543210.'}],asOfDate:'2026-10-27',language:'en',dataKind:'synthetic'});
  const job={...request,seniorId:'S001',language:'en',status:'awaiting_n8n',expiresAt:now+86400000};
  const nonces=new Set(),saved=[];
  const hooks=createN8nHooksHandler({loadConfig:async()=>({SAMARTH_N8N_HMAC_SECRET:secret}),claimNonce:async({nonceHash})=>{if(nonces.has(nonceHash))return false;nonces.add(nonceHash);return true;},getJob:async id=>id===jobId?structuredClone(job):null,claimReport:async(id,proof)=>{if(id!==jobId||job.status!=='awaiting_n8n'||proof.factsHash!==job.factsHash||proof.language!==job.language)return false;job.status='claimed';return true;},failReport:async(id,failure)=>{if(id!==jobId||job.status!=='claimed'||failure.factsHash!==job.factsHash)return false;job.status='failed';job.failureCode=failure.failureCode;return {failed:true};},completeReport:async(id,report)=>{if(job.status!=='claimed')return false;job.status='completed';saved.push({id,report});return {completed:true,reportId:'saved-report-id'};},now:()=>now});
  async function call(path,envelope=request.envelope,{body,nonce=crypto.randomUUID(),headers={},url}={}) {
    const signed=await signN8nEnvelope(envelope,secret,{now,nonce});
    const response=await hooks(new Request(url||`https://care.example/api/integrations/n8n/${path}`,{method:'POST',headers:{...signed.headers,...headers},body:body??signed.body}));return {response,status:response.status,data:await response.json()};
  }
  return {request,job,nonces,saved,hooks,call};
}
test('server claim returns only stored masked facts, never local identity, raw notes or record IDs',async()=>{
  const f=await fixture(),result=await f.call('claim');assert.equal(result.status,200);assert.equal(result.data.claimed,true);assert.equal(result.data.factsHash,f.request.factsHash);
  const raw=JSON.stringify(result.data);for(const privateValue of ['Private Name','S001','private-clinical-row','9876543210'])assert.equal(raw.includes(privateValue),false);
  assert.equal(result.data.schema.additionalProperties,false);
  assert.equal(f.job.status,'claimed');
});
test('callback verifies saved evidence and atomically persists a review draft',async()=>{
  const f=await fixture(),plan=deterministicReportPlan(f.job.localFacts);
  assert.equal((await f.call('claim')).status,200);
  const result=await f.call('callback',{version:1,kind:'weekly_report.completed',jobId,factsHash:f.request.factsHash,plan,model:'llama3.1:8b'});
  assert.equal(result.status,202);assert.equal(result.data.status,'pending_review');assert.equal(f.saved.length,1);
  assert.equal(f.saved[0].report.generation.llmUsed,true);assert.equal(f.saved[0].report.requiresHumanReview,true);assert.equal(f.saved[0].report.evidence[0].sourceRecordId,'private-clinical-row');
  const repeated=await f.call('callback',{version:1,kind:'weekly_report.completed',jobId,factsHash:f.request.factsHash,plan});assert.equal(repeated.status,409);assert.equal(f.saved.length,1);
});
test('tampered evidence, invented claims, wrong language and stale jobs cannot complete',async()=>{
  const f=await fixture(),plan=deterministicReportPlan(f.job.localFacts);
  assert.equal((await f.call('claim',{...f.request.envelope,language:'hi'})).status,409);
  assert.equal((await f.call('claim')).status,200);
  assert.equal((await f.call('callback',{version:1,kind:'weekly_report.completed',jobId,factsHash:'0'.repeat(64),plan})).status,409);
  assert.equal((await f.call('callback',{version:1,kind:'weekly_report.completed',jobId,factsHash:f.request.factsHash,plan:{...plan,text:'No concerns. The senior is healthy.'}})).status,422);
  f.job.expiresAt=now-1;assert.equal((await f.call('claim')).status,410);assert.equal(f.saved.length,0);
});
test('invalid signatures, replay, unsupported query fields and oversized input fail closed',async()=>{
  const f=await fixture(),nonce='stable_nonce_00000001';
  assert.equal((await f.call('claim',f.request.envelope,{nonce})).status,200);
  assert.equal((await f.call('claim',f.request.envelope,{nonce})).status,409);
  assert.equal((await f.call('claim',f.request.envelope,{headers:{'x-samarth-signature':'0'.repeat(64)}})).status,401);
  assert.equal((await f.call('claim',f.request.envelope,{url:'https://care.example/api/integrations/n8n/claim?url=https://external.example'})).status,400);
  assert.equal((await f.call('claim',f.request.envelope,{body:'x'.repeat(131073)})).status,413);
});
test('unknown jobs and internal dependency failures do not expose server data',async()=>{
  const f=await fixture();assert.equal((await f.call('claim',{...f.request.envelope,jobId:'unknown_job_00000001'})).status,404);
  const hooks=createN8nHooksHandler({loadConfig:async()=>{throw new Error('super-secret-database-password');},claimNonce:async()=>true,getJob:async()=>null,claimReport:async()=>false,completeReport:async()=>true,now:()=>now});
  const signed=await signN8nEnvelope(f.request.envelope,secret,{now});const response=await hooks(new Request('https://care.example/api/integrations/n8n/claim',{method:'POST',headers:signed.headers,body:signed.body}));assert.equal(response.status,500);assert.equal((await response.text()).includes('super-secret'),false);
});

test('fresh signed nonces cannot claim the same report twice, including concurrent workflows',async()=>{
  const f=await fixture();
  const results=await Promise.all([f.call('claim'),f.call('claim'),f.call('claim')]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409,409]);
  assert.equal(f.job.status,'claimed');assert.equal(f.saved.length,0);
});

test('an unclaimed or expired job never accepts a model callback and ambiguous claims are not retried',async()=>{
  const f=await fixture(),plan=deterministicReportPlan(f.job.localFacts);
  const callback={version:1,kind:'weekly_report.completed',jobId,factsHash:f.request.factsHash,plan};
  assert.equal((await f.call('callback',callback)).status,409);assert.equal(f.saved.length,0);
  assert.equal((await f.call('claim')).status,200);
  assert.equal((await f.call('claim')).status,409);
  f.job.expiresAt=now-1;assert.equal((await f.call('callback',callback)).status,410);assert.equal(f.saved.length,0);
});


test('signed terminal failures accept only bounded codes and cannot replace a report or be replayed',async()=>{
 const f=await fixture();await f.call('claim');
 const envelope={version:1,kind:'weekly_report.failed',jobId,factsHash:f.request.factsHash,failureCode:'model_error'};
 assert.equal((await f.call('callback',{...envelope,error:'Private provider error and raw health note'})).status,400);
 assert.equal((await f.call('callback',{...envelope,failureCode:'arbitrary private error'})).status,400);
 const result=await f.call('callback',envelope);assert.equal(result.status,202);assert.equal(f.job.status,'failed');assert.equal(f.saved.length,0);
 assert.equal((await f.call('callback',envelope)).status,409);
 assert.equal((await f.call('callback',{version:1,kind:'weekly_report.completed',jobId,factsHash:f.request.factsHash,plan:deterministicReportPlan(f.job.localFacts)})).status,409);
});
