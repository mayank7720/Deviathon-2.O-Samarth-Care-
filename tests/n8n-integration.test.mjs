import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJson,signN8nEnvelope,verifyN8nEnvelope,createN8nReportRequest,dispatchN8nReport,n8nConfiguration } from '../lib/n8n-integration.mjs';
import { deterministicReportPlan } from '../lib/grounded-reports.mjs';
import { weeklyReportWorkflow,voiceCheckinWorkflow,PREPARE_INGRESS,VERIFY_INGRESS,VERIFY_VOICE_INGRESS,VERIFY_REPORT_CLAIM,PREPARE_MODEL,VERIFY_PLAN,PREPARE_CALLBACK } from '../n8n/build-workflows.mjs';

const secret='synthetic-signing-secret-long-enough-for-tests';
const env={SAMARTH_N8N_ENABLED:'true',SAMARTH_N8N_REPORT_WEBHOOK_URL:'https://synthetic.app.n8n.cloud/webhook/samarth-weekly-report',SAMARTH_N8N_HMAC_SECRET:secret};
const senior={id:'S001',name:'Private Name',level:'unknown',urgency:'unknown',baseline:{}};
const jobId='job_test_000000000001',nonce='nonce_test_000000001';
const now=Date.now();
async function example(){return createN8nReportRequest({jobId,senior,records:[{id:'private-record',seniorId:'S001',date:'2026-10-27',sleep:6}],asOfDate:'2026-10-27',language:'en',dataKind:'synthetic'});}
function request(signed,options={}){return new Request('https://care.example/api/integrations/n8n/callback',{method:'POST',headers:signed.headers,...options});}
const runCode=(code,item,lookup={},variables={})=>new Function('$input','$','$vars','Buffer',code)({first:()=>item},name=>({first:()=>({json:lookup[name]})}),variables,Buffer);
const runAsyncCode=(code,item,helpers)=>new (Object.getPrototypeOf(async function(){}).constructor)('$input','Buffer',code).call({helpers},{first:()=>item},Buffer);

test('signed envelopes bind the exact body and require durable replay protection',async()=>{
  const {envelope}=await example(),signed=await signN8nEnvelope(envelope,secret,{now,nonce}),seen=new Set();
  const claimNonce=async({nonceHash})=>{if(seen.has(nonceHash))return false;seen.add(nonceHash);return true;};
  const result=await verifyN8nEnvelope(request(signed),signed.body,env,{now,expectedKind:'weekly_report.request',claimNonce});assert.equal(result.envelope.jobId,jobId);
  await assert.rejects(verifyN8nEnvelope(request(signed),signed.body,env,{now,claimNonce}),e=>e.status===409);
  await assert.rejects(verifyN8nEnvelope(request(signed),signed.body+' ',env,{now,claimNonce}),e=>e.status===401);
  await assert.rejects(verifyN8nEnvelope(request(signed),signed.body,env,{now:now+301000,claimNonce}),e=>e.status===401);
  await assert.rejects(verifyN8nEnvelope(request(signed),signed.body,env,{now}),e=>e.status===503);
});
test('job requests contain only masked facts and are bound to an evidence hash',async()=>{
  const first=await example(),second=await example();assert.equal(first.factsHash,second.factsHash);assert.equal(first.envelope.factsHash.length,64);
  const raw=JSON.stringify(first.envelope);assert.equal(raw.includes('Private Name'),false);assert.equal(raw.includes('S001'),false);assert.equal(raw.includes('private-record'),false);
  assert.notEqual(canonicalJson({a:1,b:2}),canonicalJson({a:2,b:1}));assert.equal(canonicalJson({b:2,a:1}),canonicalJson({a:1,b:2}));assert.throws(()=>canonicalJson({a:NaN}),/Non-finite/);
});
test('configured dispatch is signed, bounded, redirect-free and checks the acknowledged job',async()=>{
  const {envelope}=await example();let called=0;
  const result=await dispatchN8nReport(envelope,env,{now,nonce,fetchImpl:async(url,options)=>{called++;assert.equal(url,env.SAMARTH_N8N_REPORT_WEBHOOK_URL);assert.equal(options.redirect,'manual');assert.ok(options.signal);await verifyN8nEnvelope(new Request(url,{method:'POST',headers:options.headers}),options.body,env,{now,claimNonce:async()=>true});return new Response(JSON.stringify({accepted:true,jobId,status:'processing',generationCompleted:false,executionId:'n8n-test-run'}));}});
  assert.equal(called,1);assert.equal(result.status,'processing');assert.equal(result.generationCompleted,false);
  await assert.rejects(dispatchN8nReport(envelope,env,{fetchImpl:async()=>new Response(JSON.stringify({accepted:true,jobId:'wrong'}))}),e=>e.status===502);
  await assert.rejects(dispatchN8nReport(envelope,env,{fetchImpl:async()=>new Response(JSON.stringify({accepted:true,jobId,status:'pending_review'}))}),e=>e.status===502);
});
test('unconfigured integrations, insecure URLs and untrusted hosts fail before dispatch',()=>{
  for(const settings of [{},{...env,SAMARTH_N8N_ENABLED:'false'},{...env,SAMARTH_N8N_REPORT_WEBHOOK_URL:'http://127.0.0.1/webhook/x'},{...env,SAMARTH_N8N_REPORT_WEBHOOK_URL:'https://evil.example/webhook/x'},{...env,SAMARTH_N8N_REPORT_WEBHOOK_URL:'https://synthetic.app.n8n.cloud/webhook-test/x'},{...env,SAMARTH_N8N_REPORT_WEBHOOK_URL:'https://key:secret@synthetic.app.n8n.cloud/webhook/x'}])assert.throws(()=>n8nConfiguration(settings));
});
test('n8n raw-body Code and Crypto HMAC contract match application signatures byte-for-byte',async()=>{
  const {envelope}=await example(),signed=await signN8nEnvelope(envelope,secret,{nonce});
  // Cloud binary data can be a storage reference, never the raw Base64 itself.
  const item={json:{headers:signed.headers},binary:{data:{data:'filesystem-v2',id:'fixture-storage-reference'}}};
  const prepared=(await runAsyncCode(PREPARE_INGRESS,item,{getBinaryDataBuffer:async(index,key)=>{assert.equal(index,0);assert.equal(key,'data');return Buffer.from(signed.body);}}))[0].json;
  assert.equal(prepared.signedText,`${prepared.timestamp}\n${nonce}\n${signed.body}`);
  const verified=runCode(VERIFY_INGRESS,{json:{...prepared,computedSignature:signed.headers['x-samarth-signature']}})[0].json;
  assert.equal(verified.envelope.jobId,jobId);
  assert.throws(()=>runCode(VERIFY_INGRESS,{json:{...prepared,computedSignature:'0'.repeat(64)}}),/Invalid/);
  await assert.rejects(runAsyncCode(PREPARE_INGRESS,item,{}),/binary helper/);
  await assert.rejects(runAsyncCode(PREPARE_INGRESS,item,{getBinaryDataBuffer:async()=>Buffer.alloc(131073)}),/too large/);
});
test('n8n model/validation/callback nodes preserve evidence IDs and reject invented report text',async()=>{
  const {envelope}=await example(),job={...envelope,claimed:true};
  const configured=runCode(PREPARE_MODEL,{json:job},{},{SAMARTH_REPORT_MODEL:'model-test',SAMARTH_REPORT_PROTOCOL:'ollama'})[0].json;
  assert.equal(configured.requestBody.stream,false);assert.equal(configured.requestBody.format.additionalProperties,false);
  const plan=deterministicReportPlan(envelope.facts);
  const checked=runCode(VERIFY_PLAN,{json:{message:{content:JSON.stringify(plan)}}},{'Prepare model request':configured})[0].json;
  const callback=runCode(PREPARE_CALLBACK,{json:{callbackNonce:nonce}},{'Validate model evidence':checked})[0].json;
  const body=JSON.parse(callback.raw);assert.equal(body.kind,'weekly_report.completed');assert.equal(body.factsHash,envelope.factsHash);assert.equal(callback.signedText,`${callback.timestamp}\n${nonce}\n${callback.raw}`);
  assert.throws(()=>runCode(VERIFY_PLAN,{json:{message:{content:JSON.stringify({...plan,text:'The senior has dementia.'})}}},{'Prepare model request':configured}),/validation/);
});

test('report webhook acknowledges a verified one-time claim before any model request and continues to the signed callback',async()=>{
  const workflow=weeklyReportWorkflow(),ordered=[];
  let name='Signed report webhook';
  while(name){assert.ok(!ordered.includes(name),'workflow must not loop through another inference');ordered.push(name);name=workflow.connections[name]?.main?.[0]?.[0]?.node;}
  const index=name=>ordered.indexOf(name);
  assert.ok(index('Claim durable report job')<index('Verify durable report claim'));
  assert.ok(index('Verify durable report claim')<index('Acknowledge claimed report job'));
  assert.ok(index('Acknowledge claimed report job')<index('Prepare model request'));
  assert.ok(index('Prepare model request')<index('Generate report plan'));
  assert.ok(index('Generate report plan')<index('Save pending review report'));
  const ack=workflow.nodes.find(n=>n.name==='Acknowledge claimed report job');
  assert.equal(ack.parameters.options.responseCode,202);assert.equal(ack.parameters.enableResponseOutput,false);
  const {envelope}=await example(),claim={...envelope,claimed:true};
  const accepted=runCode(VERIFY_REPORT_CLAIM,{json:claim})[0].json;
  const response=new Function('$json','$execution','return '+ack.parameters.responseBody.slice(3,-3))(accepted,{id:'synthetic-run-1'});
  assert.deepEqual(JSON.parse(response),{accepted:true,jobId,status:'processing',generationCompleted:false,executionId:'synthetic-run-1'});
  for(const invalid of [{...claim,claimed:false},{...claim,jobId:'wrong'},{...claim,factsHash:'bad'}])assert.throws(()=>runCode(VERIFY_REPORT_CLAIM,{json:invalid}),/durably claim/);
});
test('workflow JSON is importable, inactive, credential-safe and contains connected signed paths',()=>{
  for(const [file,workflow] of [['weekly-grounded-report.json',weeklyReportWorkflow()],['hindi-voice-checkin.json',voiceCheckinWorkflow()]]) {
    assert.deepEqual(JSON.parse(readFileSync(`n8n/workflows/${file}`,'utf8')),workflow);
    assert.equal(workflow.active,false);assert.equal(workflow.settings.saveDataSuccessExecution,'none');
    const names=new Set(workflow.nodes.map(n=>n.name));assert.equal(names.size,workflow.nodes.length);
    for(const edges of Object.values(workflow.connections))for(const output of edges.main)for(const edge of output)assert.ok(names.has(edge.node));
    const hmac=workflow.nodes.filter(n=>n.type==='n8n-nodes-base.crypto'&&n.parameters.action==='hmac');assert.ok(hmac.length);for(const node of hmac){assert.equal(node.typeVersion,2);assert.ok(node.credentials.crypto);assert.equal('secret' in node.parameters,false);}
    assert.equal(JSON.stringify(workflow).includes(secret),false);assert.equal(JSON.stringify(workflow).includes('SUPABASE_SERVICE_ROLE_KEY'),false);
  }
});
test('voice orchestration accepts only a stored job reference and never a contact number',()=>{
  const envelope={version:1,kind:'voice_checkin.request',jobId,language:'hi'};
  const input={raw:JSON.stringify(envelope),signature:'a'.repeat(64),computedSignature:'a'.repeat(64)};
  assert.equal(runCode(VERIFY_VOICE_INGRESS,{json:input})[0].json.envelope.language,'hi');
  assert.throws(()=>runCode(VERIFY_VOICE_INGRESS,{json:{...input,raw:JSON.stringify({...envelope,phone:'+919876543210'})}}),/contact details/);
  assert.throws(()=>runCode(VERIFY_VOICE_INGRESS,{json:{...input,raw:JSON.stringify({...envelope,kind:'weekly_report.request'})}}),/Voice dispatch/);
  const response=voiceCheckinWorkflow().nodes.find(node=>node.name==='Return provider acceptance').parameters.responseBody;
  assert.match(response,/providerReference:\$json\.providerId\|\|\$json\.providerReference/);
});
