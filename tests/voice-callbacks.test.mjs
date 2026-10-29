import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceCallbackHandler} from '../lib/telephony-voice.mjs';
import {sha256} from '../lib/telephony.mjs';
const secret='synthetic-twilio-provider-auth-secret',token='a'.repeat(64),id='11111111-1111-1111-1111-111111111111',callId='CA'+'b'.repeat(32);
async function fixture(){
 let job={id,seniorId:'S001',channel:'voice_bot',status:'accepted',language:'hi',asOfDate:'2026-10-29',createdAt:new Date().toISOString(),providerId:callId,callbackTokenHash:await sha256(token),callbackOrigin:'https://care.example',voiceState:{language:'hi',step:0,answers:{}},state:{step:0}};
 const signals=[];
 const handler=createVoiceCallbackHandler({loadConfig:async()=>({SAMARTH_TWILIO_TRIAL_ENABLED:'true',TWILIO_AUTH_TOKEN:secret}),getJob:async()=>structuredClone(job),advance:async(previous,next,signal)=>{if(previous.state.step!==job.state.step)return false;job={...next,state:{step:job.state.step+1}};if(signal)signals.push(signal);return true;}});
 async function call(phase='prompt',step=0,digit,extra={}){
  const url=`https://care.example/api/telephony/twilio/checkin/${id}/${token}?phase=${phase}&step=${step}`;
  const values={CallSid:callId,...(digit?{Digits:digit}:{}),...extra},form=new URLSearchParams(values).toString();
  let message=url;for(const k of Object.keys(values).sort())message+=k+values[k];
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
  const sig=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message)))));
  return handler(new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':sig},body:form}));
 }
 return {call,signals,handler};
}
test('signed real-provider callback asks Hindi questions and commits completed answers once',async()=>{
 const f=await fixture();assert.match(await(await f.call()).text(),/Gather/);
 for(let step=0;step<4;step++){const r=await f.call('answer',step,step===0?'3':'1');assert.equal(r.status,200);if(step===3)assert.match(await r.text(),/Hangup/);}
 assert.equal(f.signals.length,1);assert.equal(f.signals[0].helpRequested,true);assert.equal(f.signals[0].date,'2026-10-29');
 const repeated=await f.call('answer',3,'1');assert.equal(repeated.status,200);assert.equal(f.signals.length,1);
});
test('unsigned callbacks and another call identity cannot change a saved call',async()=>{
 const f=await fixture();const url=`https://care.example/api/telephony/twilio/checkin/${id}/${token}?phase=answer&step=0`;
 assert.equal((await f.handler(new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'Digits=3'}))).status,401);
 assert.equal((await f.call('answer',0,'3',{CallSid:'CA'+'c'.repeat(32)})).status,403);assert.equal(f.signals.length,0);
});
