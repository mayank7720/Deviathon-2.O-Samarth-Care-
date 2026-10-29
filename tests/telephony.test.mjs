import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {LocalD1} from './helpers/d1.mjs';
import {handleTelephonyRoute} from '../lib/telephony-routes.mjs';
import {smsText,maskedPhone,signBridgeRequest,verifyBridgeRequest,androidSmsRequest,androidSmsStatus,normalizeAndroidState,probeAndroidGateway,startTrialVoiceCall,checkinTwiml,advanceCallAnswer,verifyTwilioSignature} from '../lib/telephony.mjs';

const phone='+19990000001',now=Date.parse('2026-10-29T08:00:00Z'),secret='synthetic-android-bridge-credential-at-least-32-chars';
const contacts=[{id:'test-senior',seniorId:'S001',role:'senior',phone,verified:true,smsConsent:true,callConsent:true},{id:'test-family',seniorId:'S001',role:'family',phone:'+19990000002',verified:true,smsConsent:true,callConsent:true},{id:'other-senior',seniorId:'S002',role:'senior',phone:'+19990000003',verified:true,smsConsent:true,callConsent:true}];
const env={SAMARTH_ANDROID_BRIDGE_SECRET:secret,SAMARTH_TELEPHONY_CONTACTS_JSON:JSON.stringify(contacts)};
const gatewayEnv={SAMARTH_ANDROID_GATEWAY_USERNAME:'synthetic',SAMARTH_ANDROID_GATEWAY_PASSWORD:'synthetic-private-password'};
const input={contactId:'test-senior',channel:'sms',template:'checkin',language:'hi',idempotencyKey:'unique_request_key_00001',consentConfirmed:true};
function setup(){
 const db=new LocalD1();let consent=true;
 const context={authenticated:true,authorized:true,owner:'workspace:primary',session:{role:'coordinator',userId:'synthetic-coordinator',scope:['*']}};
 const event=(db,owner,kind,seniorId,payload,id=crypto.randomUUID())=>db.prepare('INSERT INTO care_events (id,owner,kind,senior_id,payload,created_at) VALUES (?,?,?,?,?,?)').bind(id,owner,kind,seniorId,JSON.stringify(payload),new Date(now).toISOString());
 const rows=()=>db.db.prepare('SELECT * FROM care_events ORDER BY rowid').all().map(r=>({...r,...JSON.parse(r.payload),seniorId:r.senior_id,createdAt:r.created_at}));
 async function call(path,{body,method=body?'POST':'GET',signed=false,scope,role,overrides={},clock=now,signature,rawBody}={}){
  const raw=rawBody??(body?JSON.stringify(body):''),pathname='/api/'+path;
  const headers={...(body?{'content-type':'application/json'}:{}),...(signed?await signBridgeRequest({method,path:pathname,body:raw,secret,timestamp:Math.floor(clock/1000)}):{}),...signature};
  const request=new Request('https://care.example'+pathname,{method,headers,body:raw||undefined});
  const response=await handleTelephonyRoute({path,request,body:body||{},rawBody:raw,db,context:{...context,session:{...context.session,...(scope?{scope}:{}),...(role?{role}:{})}},env:{...env,...overrides},rows:rows(),getSenior:async id=>({id,familyConsent:consent}),event,asOfDate:'2026-10-29',now});
  return {status:response.status,data:await response.json(),headers};
 }
 return {db,call,rows,context,event,setConsent:value=>{consent=value;}};
}

test('telephone configuration reveals only assigned masked destinations and no secrets',async()=>{
 const f=setup();try{const result=await f.call('telephony/config',{scope:['S001']});assert.equal(result.status,200);assert.equal(result.data.contacts.length,2);assert.ok(!JSON.stringify(result.data).includes(phone));assert.ok(!JSON.stringify(result.data).includes(secret));assert.equal(result.data.voiceBotConfigured,false);assert.equal(result.data.androidOnline,false);assert.equal(maskedPhone(phone),'+19••••001');assert.equal((await f.call('telephony/config',{role:'family'})).status,403);}finally{f.db.close();}
});
test('SMS requests require consent, a verified assigned destination and fixed bounded copy',async()=>{
 const f=setup();try{
  assert.equal((await f.call('telephony/jobs',{body:{...input,consentConfirmed:false}})).status,400);
  assert.equal((await f.call('telephony/jobs',{body:{...input,text:'medical raw note'}})).status,400);
  assert.equal((await f.call('telephony/jobs',{body:{...input,contactId:'other-senior'},scope:['S001']})).status,403);
  assert.equal((await f.call('telephony/jobs',{body:input,overrides:{SAMARTH_TELEPHONY_CONTACTS_JSON:JSON.stringify([{...contacts[0],verified:false}])}})).status,409);
  f.setConsent(false);assert.equal((await f.call('telephony/jobs',{body:{...input,contactId:'test-family',template:'followup'}})).status,403);
  for(const language of ['en','hi'])for(const template of ['checkin','followup','serious_alert','weekly_summary'])assert.ok(smsText(template,language).length<=(language==='hi'?70:160));
  assert.equal(f.rows().length,0);
 }finally{f.db.close();}
});
test('a communication key creates one durable job even across concurrent stale reads',async()=>{
 const f=setup();try{const [a,b]=await Promise.all([f.call('telephony/jobs',{body:input}),f.call('telephony/jobs',{body:input})]);assert.equal(a.data.job.id,b.data.job.id);assert.deepEqual([a.status,b.status].sort(),[200,201]);assert.equal(f.rows().filter(r=>r.kind==='telephony_job').length,1);assert.equal(a.data.job.status,'queued');assert.equal(a.data.job.externalDelivery,false);assert.ok(!JSON.stringify(a.data).includes(phone));}finally{f.db.close();}
});
test('Android claims require both normal coordinator access and a fresh body-bound signature',async()=>{
 const f=setup();try{
  const created=await f.call('telephony/jobs',{body:input}),path=`telephony/jobs/${created.data.job.id}/claim`;
  assert.equal((await f.call(path,{body:{}})).status,401);
  assert.equal((await f.call(path,{body:{},signed:true,role:'operations'})).status,403);
  assert.equal((await f.call(path,{body:{},signed:true,clock:now-301000})).status,401);
  const claimed=await f.call(path,{body:{},signed:true});assert.equal(claimed.status,200);assert.equal(claimed.data.job.phone,phone);assert.ok(claimed.data.job.leaseToken);assert.equal(claimed.data.job.leaseHash,undefined);
  assert.equal((await f.call(path,{body:{},signature:claimed.headers})).status,409);
  assert.equal((await f.call(path,{body:{},signed:true})).status,409);
  const listed=await f.call('telephony/jobs');assert.ok(!JSON.stringify(listed.data).includes(phone));assert.ok(!JSON.stringify(listed.data).includes(claimed.data.job.leaseToken));
 }finally{f.db.close();}
});
test('device evidence distinguishes accepted, sent and delivered and cannot fabricate a human read',async()=>{
 const f=setup();try{
  const {data:{job}}=await f.call('telephony/jobs',{body:input});const claimed=await f.call(`telephony/jobs/${job.id}/claim`,{body:{},signed:true});
  const path=`telephony/jobs/${job.id}/receipt`,body={leaseToken:claimed.data.job.leaseToken,providerId:job.id,status:'accepted'};
  const accepted=await f.call(path,{body,signed:true});assert.equal(accepted.status,200);assert.equal(accepted.data.job.externalDelivery,false);
  assert.equal((await f.call(path,{body,signature:accepted.headers})).status,409);
  assert.equal((await f.call(path,{body:{...body,providerId:'different'},signed:true})).status,400);
  const sent=await f.call(path,{body:{...body,status:'sent'},signed:true});assert.equal(sent.status,200);assert.equal(sent.data.job.externalDelivery,true);assert.equal(sent.data.job.deliveredToHandset,false);assert.equal(sent.data.job.humanRead,false);
  assert.equal((await f.call(path,{body,signed:true})).status,409);
  const delivered=await f.call(path,{body:{...body,status:'delivered'},signed:true});assert.equal(delivered.status,200);assert.equal(delivered.data.job.deliveredToHandset,true);assert.equal(delivered.data.job.humanRead,false);
  assert.equal((await f.call(path,{body:{...body,status:'failed'},signed:true})).status,409);
 }finally{f.db.close();}
});
test('withdrawn family consent prevents a queued job reaching the Android device',async()=>{
 const f=setup();try{const result=await f.call('telephony/jobs',{body:{...input,contactId:'test-family',template:'followup'}});f.setConsent(false);assert.equal((await f.call(`telephony/jobs/${result.data.job.id}/claim`,{body:{},signed:true})).status,403);assert.deepEqual((await f.call('telephony/bridge/jobs',{signed:true})).data.jobs,[]);}finally{f.db.close();}
});
test('assisted calls return the approved dialer URI without claiming a connected call',async()=>{
 const f=setup();try{const result=await f.call('telephony/jobs',{body:{...input,channel:'android_dialer'}});const dial=await f.call(`telephony/jobs/${result.data.job.id}/dial`,{body:{}});assert.equal(dial.status,200);assert.equal(dial.data.dialUri,'tel:'+phone);assert.equal(dial.data.job.status,'awaiting_device_action');assert.equal(dial.data.externalDelivery,false);assert.equal((await f.call(`telephony/jobs/${result.data.job.id}/dial`,{body:{}})).status,409);}finally{f.db.close();}
});
test('authenticated heartbeats are fresh device evidence and cannot be replayed',async()=>{
 const f=setup();try{const result=await f.call('telephony/bridge/heartbeat',{body:{deviceReady:true},signed:true});assert.equal(result.status,200);assert.equal((await f.call('telephony/config')).data.androidOnline,true);assert.equal((await f.call('telephony/bridge/heartbeat',{body:{deviceReady:true},signature:result.headers})).status,409);}finally{f.db.close();}
});
test('bridge HMAC binds method, path and exact JSON bytes',async()=>{
 const timestamp=Math.floor(now/1000),path='/api/telephony/jobs',body='{}',signed=await signBridgeRequest({method:'POST',path,body,secret,timestamp});
 const request=new Request('https://care.example'+path,{method:'POST',headers:signed});assert.ok((await verifyBridgeRequest(request,body,env,now)).id);
 await assert.rejects(verifyBridgeRequest(request,'{ }',env,now),e=>e.status===401);
 await assert.rejects(verifyBridgeRequest(new Request('https://care.example/api/other',{method:'POST',headers:signed}),body,env,now),e=>e.status===401);
 await assert.rejects(verifyBridgeRequest(new Request(request,{method:'GET'}),body,env,now),e=>e.status===401);
});
test('Android SMS uses only loopback, preserves message identity and does not resend an accepted request',async()=>{
 const id=crypto.randomUUID(),job={id,channel:'sms',phone,text:smsText('checkin')},calls=[];
 const fetchImpl=async(url,options)=>{calls.push({url,options});if(options.method==='GET')return new Response('{}',{status:404});const data=JSON.parse(options.body);assert.equal(data.id,id);assert.deepEqual(data.phoneNumbers,[phone]);assert.equal(data.withDeliveryReport,true);assert.equal(Object.hasOwn(data,'simNumber'),false);return Response.json({id,state:'Pending'});};
 const result=await androidSmsRequest(job,gatewayEnv,{fetchImpl});assert.equal(result.status,'accepted');assert.equal(result.externalDelivery,false);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.url.startsWith('http://127.0.0.1:8080/')));assert.ok(calls.every(c=>c.options.redirect==='manual'));
 let readCalls=0;const existing=await androidSmsRequest(job,gatewayEnv,{fetchImpl:async(_url,options)=>{readCalls++;assert.equal(options.method,'GET');return Response.json({id,state:'Sent'});}});assert.equal(readCalls,1);assert.equal(existing.status,'sent');
 await assert.rejects(androidSmsRequest(job,{...gatewayEnv,SAMARTH_ANDROID_GATEWAY_URL:'http://192.168.1.1:8080'},{fetchImpl}),e=>e.status===503);
 await assert.rejects(androidSmsRequest({...job,text:'x'.repeat(161)},gatewayEnv,{fetchImpl}),e=>e.status===400);
 assert.equal(normalizeAndroidState({id,state:'Delivered'},id).humanRead,false);
 await assert.rejects(androidSmsStatus(job,gatewayEnv,{fetchImpl:async()=>Response.json({id:'other',state:'Delivered'})}),e=>e.status===502);
 assert.equal((await probeAndroidGateway(gatewayEnv,{fetchImpl:async()=>new Response('{}',{status:404})})).ready,true);
});
test('Android SMS pins the configured SIM and rejects invalid slots before contacting the gateway',async()=>{
 const id=crypto.randomUUID(),job={id,channel:'sms',phone,text:smsText('checkin')};
 for(const slot of ['1','2']){
  const calls=[];
  const result=await androidSmsRequest(job,{...gatewayEnv,SAMARTH_ANDROID_SIM_SLOT:slot},{fetchImpl:async(_url,options)=>{
   calls.push(options.method);
   if(options.method==='GET')return new Response('{}',{status:404});
   const payload=JSON.parse(options.body);assert.equal(payload.simNumber,Number(slot));assert.equal(payload.id,id);assert.deepEqual(payload.phoneNumbers,[phone]);return Response.json({id,state:'Pending'});
  }});
  assert.equal(result.status,'accepted');assert.deepEqual(calls,['GET','POST']);
 }
 let attempted=0;
 const noRequest=async()=>{attempted++;throw new Error('Invalid SIM configuration must fail before any gateway request.');};
 for(const slot of ['', '0', '3', '01', '2.0', '2 ', null, 2]){
  const config={...gatewayEnv,SAMARTH_ANDROID_SIM_SLOT:slot};
  for(const action of [()=>androidSmsRequest(job,config,{fetchImpl:noRequest}),()=>androidSmsStatus(job,config,{fetchImpl:noRequest}),()=>probeAndroidGateway(config,{fetchImpl:noRequest})])await assert.rejects(action,e=>e.status===503&&/SIM slot/.test(e.message));
 }
 assert.equal(attempted,0);
 let reads=0;
 const existing=await androidSmsRequest(job,{...gatewayEnv,SAMARTH_ANDROID_SIM_SLOT:'2'},{fetchImpl:async(_url,options)=>{reads++;assert.equal(options.method,'GET');return Response.json({id,state:'Sent'});}});
 assert.equal(reads,1);assert.equal(existing.status,'sent');
});
test('credited voice refuses paid accounts and reports provider acceptance rather than call delivery',async()=>{
 const account='AC'+'1'.repeat(32),voiceEnv={SAMARTH_TWILIO_TRIAL_ENABLED:'true',TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:'synthetic-private-twilio-token',TWILIO_FROM_NUMBER:'+19990000004'},job={phone,channel:'voice_bot',callbackUrl:'https://care.example/voice/start',statusCallbackUrl:'https://care.example/voice/status'};
 let posted=0;const result=await startTrialVoiceCall(job,voiceEnv,{fetchImpl:async(url,options={})=>{if(options.method==='POST'){posted++;const body=new URLSearchParams(options.body);assert.equal(body.get('To'),phone);assert.equal(body.get('Url'),job.callbackUrl);assert.equal(body.has('Record'),false);return Response.json({sid:'CA'+'2'.repeat(32)});}return Response.json({type:'Trial'});}});
 assert.equal(result.status,'accepted');assert.equal(result.externalDelivery,false);assert.equal(posted,1);
 await assert.rejects(startTrialVoiceCall(job,voiceEnv,{fetchImpl:async()=>Response.json({type:'Full'})}),e=>e.status===409);
 await assert.rejects(startTrialVoiceCall(job,{...voiceEnv,SAMARTH_TWILIO_TRIAL_ENABLED:'false'}),e=>e.status===503);
});
test('the Hindi voice bot asks four DTMF questions and preserves a help answer through completion',()=>{
 let state={language:'hi',step:0,answers:{}};for(const digit of ['3','1','1','1']){const xml=checkinTwiml(state,'https://care.example/voice/answer?step='+state.step);assert.match(xml,/<Gather input="dtmf"/);assert.match(xml,/hi-IN/);assert.match(xml,/Google.hi-IN-Standard-C/);state=advanceCallAnswer(state,digit).state;}
 assert.equal(state.step,4);assert.equal(state.answers.wellbeing,'help');assert.match(checkinTwiml(state,'https://care.example/voice/done'),/<Hangup/);assert.throws(()=>checkinTwiml(state,'http://care.example/voice/done'));
});
test('voice callbacks use Twilio HMAC over the public URL and every form field',async()=>{
 const token='synthetic-private-twilio-auth-token',url='https://care.example/voice/answer?step=0',raw='Digits=3&CallSid=CA111&To=%2B19990000001',values=new URLSearchParams(raw);
 let input=url;for(const name of [...values.keys()].sort())input+=name+values.get(name);
 const signature=createHmac('sha1',token).update(input).digest('base64'),request=new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature}});
 assert.equal((await verifyTwilioSignature(request,raw,token)).Digits,'3');await assert.rejects(verifyTwilioSignature(request,raw.replace('Digits=3','Digits=1'),token),e=>e.status===401);await assert.rejects(verifyTwilioSignature(new Request('https://care.example/voice/other',{method:'POST',headers:request.headers}),raw,token),e=>e.status===401);
});

test('staff and household prompts match the destination role',async()=>{
 const f=setup();try{
  const staff={id:'staff-contact',seniorId:'S001',role:'coordinator',phone:'+19990000004',verified:true,smsConsent:true,callConsent:true};
  const overrides={SAMARTH_TELEPHONY_CONTACTS_JSON:JSON.stringify([...contacts,staff])};
  const wrong=await f.call('telephony/jobs',{body:{...input,contactId:staff.id,template:'checkin'},overrides});assert.equal(wrong.status,400);
  const good=await f.call('telephony/jobs',{body:{...input,contactId:staff.id,template:'support_request',language:'en'},overrides});assert.equal(good.status,201);assert.match(good.data.job.text,/household has requested support/);assert.doesNotMatch(good.data.job.text,/contact your coordinator/i);
  const family=await f.call('telephony/jobs',{body:{...input,contactId:'test-family',template:'checkin'}});assert.equal(family.status,400);
 }finally{f.db.close();}
});
test('wellbeing call bots refuse family and staff destinations',async()=>{
 const f=setup();try{const result=await f.call('telephony/jobs',{body:{...input,channel:'voice_bot',contactId:'test-family',template:'followup'},overrides:{SAMARTH_TWILIO_TRIAL_ENABLED:'true'}});assert.equal(result.status,400);assert.match(result.data.error,/senior account/);}finally{f.db.close();}
});
test('routing status never requests external delivery and is staff scoped',async()=>{
 const f=setup();try{const result=await f.call('telephony/routing');assert.equal(result.status,200);assert.deepEqual(result.data.routes,[]);assert.equal(result.data.automaticSms,false);assert.equal((await f.call('telephony/routing',{role:'family'})).status,403);}finally{f.db.close();}
});
