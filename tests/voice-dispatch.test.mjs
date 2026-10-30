import test from 'node:test';
import assert from 'node:assert/strict';
import {createN8nVoiceDispatchHandler,requestSavedVoiceDispatch} from '../lib/voice-dispatch.mjs';
import {signN8nEnvelope} from '../lib/n8n-integration.mjs';
import {sha256,startTrialVoiceCall} from '../lib/telephony.mjs';

const id='46f3c632-d605-411f-88d4-cb6979562201';
const secret='synthetic-n8n-voice-signing-credential-32plus';
const callId='CA'+'2'.repeat(32);
const baseEnv={SAMARTH_N8N_HMAC_SECRET:secret,SAMARTH_TWILIO_TRIAL_ENABLED:'true',SAMARTH_PUBLIC_URL:'https://care.example',TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_AUTH_TOKEN:'synthetic-private-trial-credential',TWILIO_FROM_NUMBER:'+19990000004'};

function setup(options={}) {
  let job={id,seniorId:'S001',contactId:'verified-senior',requestedBy:'coordinator-for-test',channel:'voice_bot',language:'hi',status:'queued',asOfDate:'2026-10-29',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+1800000).toISOString(),state:{step:0}};
  const nonces=new Set(),transitions=[],requests=[];
  let destination={phone:'+19990000001'},calls=0;
  const env={...baseEnv,...options.env};
  const fetchImpl=async(url,request={})=>{requests.push({url,request});if(request.method==='POST')return Response.json({sid:callId});return Response.json({type:options.accountType||'Trial'});};
  const startCall=async(pending,settings)=>{calls++;if(options.beforeStart)await options.beforeStart({pending,get:()=>job,set:value=>{job=value;}});return options.startCall?options.startCall(pending,settings):startTrialVoiceCall(pending,settings,{fetchImpl});};
  const handler=createN8nVoiceDispatchHandler({now:()=>options.now??Date.parse('2026-10-30T08:00:00Z'),loadConfig:async()=>env,claimNonce:async({nonceHash})=>{if(nonces.has(nonceHash))return false;nonces.add(nonceHash);return true;},getJob:async()=>structuredClone(job),getContact:async()=>destination,advance:async(previous,next)=>{if(options.rejectAdvance||previous.state.step!==job.state.step)return false;job={...structuredClone(next),state:{step:job.state.step+1}};transitions.push(structuredClone(job));return true;},startCall});
  async function dispatch({envelope={version:1,kind:'voice_checkin.request',jobId:id,language:'hi'},nonce=crypto.randomUUID(),tampered=false,method='POST'}={}) {
    const signed=await signN8nEnvelope(envelope,secret,{nonce});
    const response=await handler(new Request('https://care.example/api/integrations/n8n/voice-dispatch',{method,headers:{...signed.headers,...(tampered?{'x-samarth-signature':'0'.repeat(64)}:{})},...(method==='POST'?{body:signed.body}:{})}));
    return {status:response.status,data:await response.json()};
  }
  return {dispatch,handler,transitions,requests,get job(){return job;},set job(value){job=value;},set contact(value){destination=value;},get calls(){return calls;}};
}

test('voice dispatch rejects forged signatures and unavailable trial transport without a provider request',async()=>{
  const forged=setup();assert.equal((await forged.dispatch({tampered:true})).status,401);assert.equal(forged.calls,0);assert.equal(forged.transitions.length,0);
  const disabled=setup({env:{SAMARTH_TWILIO_TRIAL_ENABLED:'false'}});assert.equal((await disabled.dispatch()).status,503);assert.equal(disabled.calls,0);
  const wrongKind=setup();assert.equal((await wrongKind.dispatch({envelope:{version:1,kind:'weekly_report.request',jobId:id,language:'hi'}})).status,400);assert.equal(wrongKind.calls,0);
});
test('current consent, assignment, expiry and matching language are required before calling',async()=>{
  const denied=setup();denied.contact=null;assert.equal((await denied.dispatch()).status,403);assert.equal(denied.calls,0);
  const expired=setup();expired.job={...expired.job,expiresAt:new Date(Date.now()-1000).toISOString()};assert.equal((await expired.dispatch()).status,409);assert.equal(expired.calls,0);
  const mismatch=setup();assert.equal((await mismatch.dispatch({envelope:{version:1,kind:'voice_checkin.request',jobId:id,language:'en'}})).status,409);assert.equal(mismatch.calls,0);
  const arbitraryPhone=setup();assert.equal((await arbitraryPhone.dispatch({envelope:{version:1,kind:'voice_checkin.request',jobId:id,language:'hi',phone:'+19990000099'}})).status,400);assert.equal(arbitraryPhone.calls,0);
});

test('every recipient role uses its current account destination and never substitutes a helpline',async()=>{
 for(const [recipientRole,phone]of [['senior','+19990000001'],['family','+19990000002'],['coordinator','+19990000003'],['operations','+19990000005']]){
  const f=setup({startCall:async pending=>{assert.equal(pending.phone,phone);assert.equal(pending.recipientRole,recipientRole);return {providerId:callId,status:'accepted'};}});
  f.job={...f.job,recipientRole};f.contact={role:recipientRole,seniorId:'S001',phone,voiceNotice:{reference:'S001',cues:['missed_medication'],kind:'help'}};
  assert.equal((await f.dispatch()).status,202);assert.equal(f.calls,1);
  assert.equal(f.job.voiceState.purpose,recipientRole==='senior'?undefined:'care-notice');
  if(recipientRole!=='senior')assert.equal(f.job.voiceState.recipientRole,recipientRole);
 }
 const wrongRole=setup();wrongRole.job={...wrongRole.job,recipientRole:'family'};wrongRole.contact={phone:'+19990000002',role:'coordinator',seniorId:'S001'};assert.equal((await wrongRole.dispatch()).status,403);assert.equal(wrongRole.calls,0);
 const wrongSenior=setup();wrongSenior.contact={phone:'+19990000002',role:'senior',seniorId:'S002'};assert.equal((await wrongSenior.dispatch()).status,403);assert.equal(wrongSenior.calls,0);
});
test('trial dispatch persists protected callback state before one actual provider acceptance',async()=>{
  const f=setup(),response=await f.dispatch();
  assert.equal(response.status,202);assert.equal(response.data.accepted,true);assert.equal(response.data.providerId,callId);
  assert.equal(f.transitions.length,2);assert.equal(f.transitions[0].status,'submitting');assert.equal(f.transitions[1].status,'accepted');assert.equal(f.job.externalDelivery,false);
  assert.equal(f.requests.length,2);assert.equal(f.requests[0].request.method,undefined);assert.equal(f.requests[1].request.method,'POST');
  const body=new URLSearchParams(f.requests[1].request.body),callback=new URL(body.get('Url'));
  assert.equal(callback.origin,'https://care.example');assert.equal(body.get('To'),'+19990000001');assert.equal(callback.searchParams.get('phase'),'prompt');assert.equal(callback.searchParams.get('step'),'0');
  const token=callback.pathname.split('/').at(-1);assert.equal(token.length,64);assert.equal(await sha256(token),f.transitions[0].callbackTokenHash);assert.equal(JSON.stringify(f.job).includes(token),false);assert.equal(JSON.stringify(response.data).includes('+1999'),false);assert.equal(JSON.stringify(response.data).includes('synthetic-private'),false);
  assert.equal(body.get('Record'),'false');assert.equal(body.get('TimeLimit'),'240');assert.ok(f.requests.every(request=>request.request.redirect==='manual'));
});
test('durable replay and atomic submission state stop both retries and concurrent duplicate calls',async()=>{
  const f=setup(),nonce='voice_dispatch_nonce_0001';assert.equal((await f.dispatch({nonce})).status,202);assert.equal((await f.dispatch({nonce})).status,409);assert.equal((await f.dispatch()).status,409);assert.equal(f.calls,1);
  const concurrent=setup();const responses=await Promise.all([concurrent.dispatch(),concurrent.dispatch()]);assert.deepEqual(responses.map(r=>r.status).sort(),[202,409]);assert.equal(concurrent.calls,1);
  const refused=setup({rejectAdvance:true});assert.equal((await refused.dispatch()).status,409);assert.equal(refused.calls,0);
});
test('a paid account is refused after inspection without posting a carrier call',async()=>{
  const f=setup({accountType:'Full'}),response=await f.dispatch();assert.equal(response.status,409);assert.equal(f.requests.length,1);assert.equal(f.requests[0].request.method,undefined);assert.equal(f.job.status,'failed');assert.equal(f.job.voiceState.summary.answeredQuestions,0);
  assert.equal((await f.dispatch()).status,409);assert.equal(f.requests.length,1);
});
test('an ambiguous provider failure retains submission state and does not automatically retry a call',async()=>{
  const f=setup({startCall:async()=>{throw new Error('private provider details');}}),response=await f.dispatch();assert.equal(response.status,503);assert.equal(response.data.error.includes('private provider'),false);assert.equal(f.job.status,'submission_unknown');assert.equal((await f.dispatch()).status,409);assert.equal(f.calls,1);
});

test('dispatch rechecks quiet hours before changing state or contacting the carrier',async()=>{
 for(const now of ['2026-10-30T02:29:59Z','2026-10-30T14:30:00Z']){
  const f=setup({now:Date.parse(now)}),r=await f.dispatch();assert.equal(r.status,409);assert.match(r.data.error,/08:00 and 20:00 IST/);assert.equal(f.calls,0);assert.equal(f.job.status,'queued');
 }
});

test('a rejected trial recipient becomes a failed call with a grounded incomplete outcome',async()=>{
 const f=setup({startCall:async(job,env)=>startTrialVoiceCall(job,env,{fetchImpl:async(_url,options={})=>options.method==='POST'?Response.json({code:21219,message:'private recipient +19990000001'},{status:400}):Response.json({type:'Trial'})})});
 const response=await f.dispatch();assert.equal(response.status,409);assert.match(response.data.error,/21219/);assert.doesNotMatch(response.data.error,/19990000001/);assert.equal(f.job.status,'failed');assert.equal(f.job.voiceState.completionReason,'not_started');assert.equal(f.job.voiceState.summary.answeredQuestions,0);assert.equal(f.job.voiceState.summary.llmUsed,false);assert.equal((await f.dispatch()).status,409);assert.equal(f.calls,1);
});

test('server errors and call-post timeouts remain uncertain and never trigger a retry',async()=>{
 for(const outcome of ['server_error','timeout']){
  const f=setup({startCall:async(job,env)=>startTrialVoiceCall(job,env,{fetchImpl:async(_url,options={})=>{if(options.method!=='POST')return Response.json({type:'Trial'});if(outcome==='timeout')throw new Error('private timeout');return Response.json({message:'private provider state'},{status:503});}})});
  const response=await f.dispatch();assert.equal(response.status,503);assert.doesNotMatch(response.data.error,/private/);assert.equal(f.job.status,'submission_unknown');assert.equal(f.job.voiceState.complete,false);assert.equal((await f.dispatch()).status,409);assert.equal(f.calls,1);
 }
});

test('the website sends only a signed saved-job reference to the protected worker',async()=>{
 let attempts=0;
 const value=await requestSavedVoiceDispatch({id,language:'hi'}, {...baseEnv,SUPABASE_URL:'https://project.supabase.co',SUPABASE_LEGACY_ANON_KEY:'synthetic-anon-jwt'}, {fetchImpl:async(url,options)=>{
  attempts++;assert.equal(url.href,'https://project.supabase.co/functions/v1/n8n-hooks/voice-dispatch');assert.equal(options.redirect,'error');
  const envelope=JSON.parse(options.body);assert.deepEqual(Object.keys(envelope).sort(),['jobId','kind','language','version']);assert.equal(envelope.jobId,id);assert.equal(options.headers.Authorization,'Bearer synthetic-anon-jwt');
  await import('../lib/n8n-integration.mjs').then(({verifyN8nEnvelope})=>verifyN8nEnvelope(new Request(url,{method:'POST',headers:options.headers,body:options.body}),options.body,baseEnv,{claimNonce:async()=>true,expectedKind:'voice_checkin.request'}));
  return Response.json({accepted:true,jobId:id,status:'accepted',providerId:callId},{status:202});
 }});assert.equal(value.providerId,callId);assert.equal(attempts,1);
 await assert.rejects(requestSavedVoiceDispatch({id,language:'hi'},{...baseEnv,SUPABASE_URL:'https://project.supabase.co',SUPABASE_LEGACY_ANON_KEY:'synthetic'}, {fetchImpl:async()=>{throw Error('private connection details');}}),e=>e.status===503&&!e.message.includes('private connection'));
});
test('provider acceptance cannot overwrite a newer completed callback',async()=>{
  const f=setup({beforeStart:async({get,set})=>{const current=get();set({...current,state:{step:current.state.step+1},status:'completed',providerId:callId,botCompleted:true,externalDelivery:true,providerStatus:'completed'});}});
  const response=await f.dispatch();assert.equal(response.status,202);assert.equal(f.job.status,'completed');assert.equal(f.job.botCompleted,true);assert.equal(f.job.externalDelivery,true);
});
test('oversized declared or streamed bodies stop before loading private configuration or contacting the provider',async()=>{
  let configurationReads=0,calls=0;
  const handler=createN8nVoiceDispatchHandler({loadConfig:async()=>{configurationReads++;return baseEnv;},claimNonce:async()=>true,getJob:async()=>null,getContact:async()=>null,advance:async()=>true,startCall:async()=>{calls++;}});
  const declared=await handler(new Request('https://care.example/api/integrations/n8n/voice-dispatch',{method:'POST',headers:{'content-type':'application/json','content-length':'16385'},body:'{}'}));assert.equal(declared.status,413);
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(10000));controller.enqueue(new Uint8Array(10000));controller.close();}});
  const streamed=await handler(new Request('https://care.example/api/integrations/n8n/voice-dispatch',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'}));assert.equal(streamed.status,413);assert.equal(configurationReads,0);assert.equal(calls,0);
});
