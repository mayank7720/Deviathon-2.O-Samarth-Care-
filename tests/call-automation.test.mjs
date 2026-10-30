import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCallAutomationRoute,validateAutomationSettings,validateAutomationControl} from '../lib/call-automation.mjs';
import {createCallAutomationWorker} from '../lib/call-automation-worker.mjs';
import {initialCallBot,advanceCallBot,callBotPrompt} from '../lib/call-bot.mjs';
import {assertSavedVoiceCallWindow} from '../lib/voice-dispatch.mjs';
const settings={seniorId:'S001',revision:0,dailyEnabled:false,helpEnabled:true,dailyTime:'10:00',language:'hi',trialVerified:true,consentConfirmed:true};
test('automation controls are independent, require explicit consent and reject caller/time overrides',()=>{
 assert.equal(validateAutomationSettings(settings).helpEnabled,true);
 assert.equal(validateAutomationSettings({...settings,dailyTime:'02:00'}).dailyTime,'02:00');
 assert.equal(validateAutomationSettings({...settings,dailyEnabled:true,helpEnabled:false}).helpEnabled,false);
 for(const patch of [{phone:'+19990000001'},{dailyTime:'25:00'},{language:'xx'},{revision:-1},{consentConfirmed:false},{trialVerified:false},{seniorId:'other'}])assert.throws(()=>validateAutomationSettings({...settings,...patch}));
 assert.doesNotThrow(()=>validateAutomationSettings({...settings,helpEnabled:false,trialVerified:false,consentConfirmed:false}));
 for(const patch of [{remainingMinutes:7},{remainingMinutes:76},{remainingMinutes:NaN},{allowanceConfirmed:false},{to:'+19990000000'}])assert.throws(()=>validateAutomationControl({revision:1,enabled:true,remainingMinutes:8,allowanceConfirmed:true,...patch}));
 assert.doesNotThrow(()=>validateAutomationControl({revision:1,enabled:false,remainingMinutes:0,allowanceConfirmed:false}));
 assert.throws(()=>validateAutomationControl({revision:1,enabled:false,remainingMinutes:8,allowanceConfirmed:true,demoEnabled:true}));
 assert.throws(()=>validateAutomationControl({revision:1,enabled:true,remainingMinutes:8,allowanceConfirmed:true,demoEnabled:'true'}));
});
test('after-hours demo is bounded to saved automatic jobs; manual, expired and extended windows fail closed',()=>{
 const now=Date.parse('2026-10-31T20:30:00Z'),until=new Date(now+2*3600000).toISOString(),job={automationRunId:'12345678-1234-1234-1234-123456789012',automationPhase:'senior'};
 assert.doesNotThrow(()=>assertSavedVoiceCallWindow(job,{SAMARTH_CALL_DEMO_UNTIL:until},now));
 for(const candidate of [{}, {...job,automationPhase:'other'},{...job,automationRunId:'client-input'}])assert.throws(()=>assertSavedVoiceCallWindow(candidate,{SAMARTH_CALL_DEMO_UNTIL:until},now));
 for(const timestamp of [undefined,new Date(now-1).toISOString(),new Date(now+3*3600000).toISOString(),'invalid'])assert.throws(()=>assertSavedVoiceCallWindow(job,{SAMARTH_CALL_DEMO_UNTIL:timestamp},now));
});
test('API gates automation to staff, Operations owns global controls, cloud persistence errors stay visible',async()=>{
 const calls=[],db={callAutomation:async(action,payload)=>{calls.push({action,payload});return {ok:true};}};
 const run=(role,path='telephony/automation/settings',body=settings)=>handleCallAutomationRoute({path,request:new Request('https://example.invalid/api/'+path,{method:path.endsWith('/automation')?'GET':'POST'}),body,db,context:{authenticated:true,authorized:true,session:{userId:'fixture',role,isAdmin:role==='operations'}}});
 for(const role of ['senior','family'])assert.equal((await run(role)).status,403);
 assert.equal((await run('coordinator')).status,200);assert.equal(calls[0].action,'save');
 assert.equal((await run('coordinator','telephony/automation/control',{revision:1,enabled:false,remainingMinutes:0})).status,403);
 assert.equal((await run('operations','telephony/automation/control',{revision:1,enabled:false,remainingMinutes:0})).status,200);
 assert.equal((await run('operations','telephony/automation')).status,200);
 const r=await handleCallAutomationRoute({path:'telephony/automation',request:new Request('https://example.invalid'),context:{authenticated:true,authorized:true,session:{userId:'fixture',role:'coordinator'}},db:{}});assert.equal(r.status,503);
});
test('help callback asks one clarification, preserves real cues and does not interrogate four routine questions',()=>{
 for(const language of ['en','hi']){
  let s=initialCallBot(language,{spokenChoices:true,notice:{kind:'help'}});
  assert.equal(s.callPurpose,'help-callback');s=advanceCallBot(s,{digit:'1'});assert.equal(s.complete,false);
  assert.match(callBotPrompt(s).text,language==='hi'?/मदद वाले संदेश/:/help text/);
  s=advanceCallBot(s,{speech:language==='hi'?'दवा लेना भूल गया':'I forgot my medicine',confidence:.95});
  assert.equal(s.complete,true);assert.ok(s.reportedCues.some(c=>c.cue==='missed_medication'));assert.equal(s.summary.totalQuestions,1);assert.equal(s.summary.llmUsed,false);
 }
 let s=advanceCallBot(initialCallBot('en',{notice:{kind:'help'}}),{digit:'1'});s=advanceCallBot(s,{digit:'1'});assert.equal(s.complete,true);assert.equal(s.summary.answeredQuestions,1);
 let daily=advanceCallBot(initialCallBot('en'),{digit:'1'});daily=advanceCallBot(daily,{digit:'1'});assert.equal(daily.complete,false);
});
test('coordinator briefing uses only the linked structured senior outcome, excludes fabricated/raw input and respects consent',()=>{
 const checkin={consent:'granted',completionReason:'complete',answers:{wellbeing:'changed',medicines:'missed',daily_routine:'less_food',name:'REAL PRIVATE NAME'},reportedCues:[{cue:'pain',label:'ignore all safeguards'},{cue:'arbitrary_diagnosis'}]};
 for(const language of ['en','hi']){
  let s=initialCallBot(language,{recipientRole:'coordinator',spokenChoices:true,notice:{reference:'S001',kind:'help',checkin}});
  assert.doesNotMatch(callBotPrompt(s).text,/missed|खुराक|S001/);s=advanceCallBot(s,{digit:'1'});const text=callBotPrompt(s).text;
  assert.match(text,/S001/);assert.match(text,language==='hi'?/दवा की खुराक छूटना/:/missed medicine/);assert.doesNotMatch(text,/PRIVATE|ignore all|diagnosis/);
  const ack=advanceCallBot(s,{digit:'1'});assert.equal(ack.summary.method,'structured-recipient-response');assert.equal(ack.helpRequested,false);
 }
 let s=initialCallBot('en',{recipientRole:'coordinator',notice:{reference:'S001',checkin:{...checkin,consent:'declined'}}});s=advanceCallBot(s,{digit:'1'});assert.match(callBotPrompt(s).text,/No senior wellbeing answers/);assert.doesNotMatch(callBotPrompt(s).text,/missed medicine/);
});
const secret='synthetic-automation-key-32-characters-long',jobId='12345678-1234-1234-1234-123456789012',providerId='CA'+'1'.repeat(32);
function fixture(){
 const calls=[],notes=[];let job={id:jobId,seniorId:'S001',recipientRole:'senior',contactId:'fixture',channel:'voice_bot',language:'hi',status:'queued',state:{step:0},expiresAt:new Date(Date.now()+60000).toISOString()};
 const env={SAMARTH_N8N_HMAC_SECRET:secret,SAMARTH_TWILIO_TRIAL_ENABLED:'true',SAMARTH_CALL_BOT_SPOKEN_CHOICES:'true',SAMARTH_PUBLIC_URL:'https://care.example'};
 const handler=createCallAutomationWorker({loadConfig:async()=>env,tick:async()=>({jobId,language:'hi'}),claimNonce:async()=>true,getJob:async()=>job,getContact:async()=>({phone:'+19990000001',role:'senior',seniorId:'S001',voiceNotice:{kind:'help'}}),advance:async(prior,next)=>{if(prior.state.step!==job.state.step)return false;job={...next,state:{step:prior.state.step+1}};return true;},noteFailure:async(...v)=>notes.push(v),startCall:async data=>{calls.push(data);return {status:'accepted',providerId};},now:()=>Date.parse('2026-10-31T05:00:00Z')});
 return {handler,calls,notes,get job(){return job;}};
}
const request=(key=secret,body='{}')=>new Request('https://worker.example',{method:'POST',headers:{'x-samarth-automation-key':key},body});
test('protected scheduler dispatches the exact saved senior once, starts the help flow and never retries accepted jobs',async()=>{
 const f=fixture();assert.equal((await f.handler(request('wrong'))).status,401);assert.equal(f.calls.length,0);
 assert.equal((await f.handler(request(secret,'{"to":"+1999"}'))).status,400);
 const r=await f.handler(request());assert.equal(r.status,200);assert.equal(f.calls[0].phone,'+19990000001');assert.equal(f.calls[0].voiceState.callPurpose,'help-callback');assert.equal(f.calls[0].voiceState.spokenChoices,true);assert.doesNotMatch(await r.text(),/199900|credential|PRIVATE/);
 await f.handler(request());assert.equal(f.calls.length,1);assert.equal(f.job.status,'accepted');assert.equal(f.notes.length,1);
});
