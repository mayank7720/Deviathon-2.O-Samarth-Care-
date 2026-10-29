import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePhoneEvent } from '../lib/phone-gateway.mjs';
import { LocalD1 } from './helpers/d1.mjs';

const env={SAMARTH_PHONE_GATEWAY_SECRET:'synthetic-operator-key-32-characters-minimum',SAMARTH_PHONE_SENIORS:'S001,S002'};
const now=Date.parse('2026-10-28T04:00:00Z');
const defaults={version:1,callId:'synthetic_call_001',seniorId:'S001',language:'hi',observedDate:'2026-10-28',answers:{wellbeing:'help',medicines:'missed',daily_routine:'less_sleep',support:'prompt'}};
async function signed(input=defaults,options={}) {
  const raw=options.raw??JSON.stringify(input),timestamp=options.timestamp??String(now/1000),nonce=options.nonce??'nonce_test_0000000001';
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SAMARTH_PHONE_GATEWAY_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}\n${nonce}\n${raw}`));
  const signature=[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
  return {raw,request:new Request(options.url||'https://care.example/api/phone/events',{method:'POST',headers:{'content-type':'application/json','x-samarth-timestamp':timestamp,'x-samarth-nonce':nonce,'x-samarth-signature':signature}})};
}
const rejects=async(input,status,options={})=>{const data=await signed(input,options);await assert.rejects(validatePhoneEvent(data.request,data.raw,env,{now}),e=>e.status===status);};

test('a signed Hindi check-in derives a bounded human-review note and explicit help',async()=>{
  const data=await signed(),result=await validatePhoneEvent(data.request,data.raw,env,{now});
  assert.equal(result.seniorId,'S001');assert.equal(result.record.source,'phone-gateway');assert.equal(result.record.helpRequested,true);assert.equal(result.payload.mood,'help');assert.match(result.record.note,/नींद कम/);assert.equal(result.payload.externalDelivery,false);assert.equal(result.record.date,'2026-10-28');
});
test('structured English ordinary responses do not invent a concern',async()=>{
  const data=await signed({...defaults,language:'en',answers:{wellbeing:'usual',medicines:'taken',daily_routine:'usual',support:'routine'}}),result=await validatePhoneEvent(data.request,data.raw,env,{now});
  assert.equal(result.record.helpRequested,false);assert.equal(result.payload.mood,'good');assert.equal(result.payload.requiresHumanReview,false);
});
test('signature binds the exact body including whitespace and identity',async()=>{
  const data=await signed();await assert.rejects(validatePhoneEvent(data.request,data.raw+' ',env,{now}),e=>e.status===401);
  await assert.rejects(validatePhoneEvent(data.request,data.raw.replace('S001','S002'),env,{now}),e=>e.status===401);
});
test('expired and future timestamps are rejected with bounded clock skew',async()=>{
  await rejects(defaults,401,{timestamp:String(now/1000-301)});await rejects(defaults,401,{timestamp:String(now/1000+301)});
});
test('missing signature and unconfigured assignments fail closed',async()=>{
  const data=await signed();const headers=new Headers(data.request.headers);headers.delete('x-samarth-signature');
  await assert.rejects(validatePhoneEvent(new Request(data.request,{headers}),data.raw,env,{now}),e=>e.status===401);
  await assert.rejects(validatePhoneEvent(data.request,data.raw,{...env,SAMARTH_PHONE_SENIORS:'*'},{now}),e=>e.status===503);
  await assert.rejects(validatePhoneEvent(data.request,data.raw,{...env,SAMARTH_PHONE_GATEWAY_SECRET:'short'},{now}),e=>e.status===503);
});
test('signed events remain restricted to configured seniors',()=>rejects({...defaults,seniorId:'S003'},403));
test('arbitrary notes, contact information and unsupported answer fields are rejected',async()=>{
  await rejects({...defaults,note:'Arbitrary clinical text'},400);await rejects({...defaults,callId:'+919876543210'},400);await rejects({...defaults,answers:{...defaults.answers,extra:'Anything'}},400);await rejects({...defaults,answers:{...defaults.answers,medicines:'Stop medicine'}},400);
});
test('invalid calendar dates, malformed JSON and oversized payloads are rejected',async()=>{
  await rejects({...defaults,observedDate:'2026-02-30'},400);await rejects(defaults,400,{raw:'{broken'});await rejects(defaults,413,{raw:' '.repeat(8001)});
});
test('non-loopback unencrypted ingestion is rejected',()=>rejects(defaults,400,{url:'http://care.example/api/phone/events'}));
test('durable event identity rejects the same nonce even with a fresh signed timestamp',async()=>{
  const first=await signed(),second=await signed({...defaults,callId:'other_signed_call'},{timestamp:String(now/1000+30)});
  const a=await validatePhoneEvent(first.request,first.raw,env,{now}),b=await validatePhoneEvent(second.request,second.raw,env,{now});
  assert.equal(a.eventId,b.eventId);const db=new LocalD1();
  try {for(const [item,expected] of [[a,1],[b,0]]){const result=await db.prepare('INSERT OR IGNORE INTO care_events (id,owner,kind,senior_id,payload,created_at) VALUES (?,?,?,?,?,?)').bind(item.eventId,'workspace:primary','signal',item.seniorId,JSON.stringify(item.payload),new Date(now).toISOString()).run();assert.equal(result.meta.changes,expected);}}finally{db.close();}
});
test('call identity remains stable across nonce retries for optional call-level idempotency',async()=>{
  const a=await signed(),b=await signed(defaults,{nonce:'nonce_test_0000000002'});const first=await validatePhoneEvent(a.request,a.raw,env,{now}),second=await validatePhoneEvent(b.request,b.raw,env,{now});assert.equal(first.callEventId,second.callEventId);assert.notEqual(first.eventId,second.eventId);
});
