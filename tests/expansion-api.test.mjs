import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../lib/api.mjs';
import {LocalD1} from './helpers/d1.mjs';
import {createMotionMonitor,validateMotionSummary} from '../lib/motion-monitor.mjs';

async function local(db,path,{role='coordinator',method='GET',body,env={}}={}){
 const headers={cookie:`samarth_local=${role}`,...(body?{'content-type':'application/json'}:{})};
 const r=await handleApi(new Request('http://localhost/api/'+path,{method,headers,body:body?JSON.stringify(body):undefined}),db,{local:true,env});return {status:r.status,data:await r.json()};
}
test('actual reports API creates reproducible grounded drafts and keeps family raw evidence private',async()=>{
 const db=new LocalD1();try{
  const body={seniorId:'S001',language:'en',mode:'local',idempotencyKey:crypto.randomUUID()};
  const first=await local(db,'reports',{method:'POST',body});assert.equal(first.status,201);assert.match(first.data.report.method,/no LLM/);assert.ok(first.data.report.evidence.length);assert.equal(first.data.report.requiresHumanReview,true);
  const retry=await local(db,'reports',{method:'POST',body});assert.equal(retry.status,200);assert.equal(retry.data.report.id,first.data.report.id);
  assert.equal((await local(db,'reports?seniorId=S001')).data.reports.length,1);
  assert.equal((await local(db,'reports',{role:'family'})).status,403);
  const denied=await local(db,'reports',{method:'POST',body:{...body,idempotencyKey:crypto.randomUUID(),mode:'n8n'}});assert.equal(denied.status,503);
 }finally{db.close();}
});
test('reference-informed backend does not reuse legacy cache or claim clinical precision',async()=>{
 const db=new LocalD1();try{
  await local(db,'bootstrap');
  const value=await local(db,'bootstrap',{env:{SAMARTH_DATA_MODE:'reference-informed',SAMARTH_COHORT_END:'2026-10-29'}});
  assert.equal(value.status,200);assert.equal(value.data.date,'2026-10-29');assert.equal(value.data.dataProvenance.generator,'reference-informed-v1');assert.equal(value.data.metrics.precision,null);assert.equal(value.data.metrics.f1,null);assert.ok(value.data.metrics.scenarioReviewCoverage);
 }finally{db.close();}
});
test('device aggregates require support and cannot be submitted by family',async()=>{
 const db=new LocalD1();try{
  const observation={durationSeconds:12,sampleCount:240,peakImpactG:3.2,maxTiltDegrees:75,longestQuietSeconds:11,possibleFall:true};
  assert.equal((await local(db,'sensors/checkin',{role:'family',method:'POST',body:{seniorId:'S001',observation}})).status,403);
  const saved=await local(db,'sensors/checkin',{role:'senior',method:'POST',body:{seniorId:'S099',observation}});assert.equal(saved.status,201);
  const row=await db.prepare("SELECT senior_id,payload FROM care_events WHERE kind='signal'").first();assert.equal(row.senior_id,'S001');assert.equal(JSON.parse(row.payload).record.sensor.confirmation,'unconfirmed');
  assert.throws(()=>validateMotionSummary({...observation,longestQuietSeconds:20}));
 }finally{db.close();}
});
test('live motion rule rejects ordinary motion and requires impact, tilt and sustained quiet together',()=>{
 const ordinary=createMotionMonitor();for(let t=0;t<15000;t+=50)ordinary.ingest({timestamp:t,x:0,y:0,z:9.80665});assert.equal(ordinary.summary().possibleFall,false);
 const candidate=createMotionMonitor();for(let t=0;t<2000;t+=50)candidate.ingest({timestamp:t,x:0,y:0,z:9.80665});candidate.ingest({timestamp:2000,x:35,y:0,z:10});for(let t=2050;t<19000;t+=50)candidate.ingest({timestamp:t,x:9.80665,y:0,z:0});assert.equal(candidate.summary().possibleFall,true);
});

test('public integration boundaries reject oversized streams before transport or authentication',async()=>{
 for(const [path,type,limit] of [['integrations/n8n/callback','application/json',131072],['telephony/twilio/checkin/46f3c632-d605-411f-88d4-cb6979562201/'+'a'.repeat(64),'application/x-www-form-urlencoded',12000]]){
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(limit+1));},cancel(){cancelled=true;}});
  const response=await handleApi(new Request('https://care.example/api/'+path,{method:'POST',headers:{'content-type':type},body:stream,duplex:'half'}),null);
  assert.equal(response.status,413);assert.equal(cancelled,true);
 }
});
