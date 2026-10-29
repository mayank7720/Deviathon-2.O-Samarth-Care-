import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../lib/api.mjs';
import { LocalD1 } from './helpers/d1.mjs';
import { indiaDate } from '../lib/runtime.mjs';

async function fixture(extraEnv={}) {
  const db=new LocalD1(),cookies={};
  async function call(path,{role='coordinator',method='GET',body,headers={},raw}={}) {
    const requestHeaders={...headers};
    if(cookies[role])requestHeaders.cookie=cookies[role];
    if(body!==undefined||raw!==undefined)requestHeaders['content-type']='application/json';
    const response=await handleApi(new Request(`http://127.0.0.1/api/${path}`,{method,headers:requestHeaders,body:raw??(body!==undefined?JSON.stringify(body):undefined)}),db,{local:true,env:extraEnv});
    return {status:response.status,data:await response.json(),response};
  }
  for(const role of ['coordinator','family','senior','operations']) {
    const result=await call('auth/local-login',{role,method:'POST',body:{role}});
    assert.equal(result.status,200,JSON.stringify(result.data));cookies[role]=result.response.headers.get('set-cookie').split(';')[0];
  }
  return {db,call,close:()=>db.close()};
}
const success=(result,status=200)=>assert.equal(result.status,status,JSON.stringify(result.data));

test('actual API runtime honors owner changes, valid dates, warm-up unknown and India live time',async()=>{
  const f=await fixture();
  try {
    const start=await f.call('runtime');success(start);assert.equal(start.data.runtime.mode,'replay');assert.equal(start.data.runtime.date,'2026-10-27');
    success(await f.call('runtime',{role:'family',method:'POST',body:{mode:'live'}}),403);
    success(await f.call('runtime',{role:'operations',method:'POST',body:{mode:'replay',date:'2026-02-30'}}),400);
    success(await f.call('runtime',{role:'operations',method:'POST',body:{mode:'replay',date:'2026-08-10'}}));
    const historical=await f.call('bootstrap');success(historical);assert.equal(historical.data.date,'2026-08-10');assert.ok(historical.data.seniors.some(s=>s.level==='unknown'&&s.score===null));
    success(await f.call('signals',{method:'POST',body:{seniorId:'S001',type:'note',date:'2026-08-11',note:'Synthetic observation from a later day'}}),400);
    const live=await f.call('runtime',{role:'operations',method:'POST',body:{mode:'live'}});success(live);assert.equal(live.data.runtime.date,indiaDate());
  }finally{f.close();}
});

test('actual daily API deduplicates jobs and withholds weekly drafts until reviewed and delivered',async()=>{
  const f=await fixture();
  try {
    const family=await f.call('bootstrap',{role:'family'});success(family);assert.match(family.data.seniors[0].weeklySummary,/awaiting care-team review/);
    success(await f.call('jobs/daily',{role:'family',method:'POST',body:{}}),403);
    const first=await f.call('jobs/daily',{method:'POST',body:{}});success(first);assert.equal(first.data.job.status,'completed');assert.ok(first.data.deliveriesQueued>0);
    const count=f.db.db.prepare('SELECT COUNT(*) AS count FROM care_deliveries').get().count;
    const again=await f.call('jobs/daily',{method:'POST',body:{}});success(again);assert.equal(again.data.job.status,'already_completed');assert.equal(f.db.db.prepare('SELECT COUNT(*) AS count FROM care_deliveries').get().count,count);
    const inbox=await f.call('deliveries');success(inbox);const draft=inbox.data.deliveries.find(d=>d.kind==='weekly_summary'&&d.seniorId==='S001'&&d.recipientRole==='family');assert.ok(draft);assert.equal(draft.status,'pending_review');
    const before=await f.call('deliveries',{role:'family'});success(before);assert.equal(before.data.deliveries.some(d=>d.id===draft.id),false);
    success(await f.call(`deliveries/${encodeURIComponent(draft.id)}`,{role:'family',method:'PATCH',body:{approve:true}}),403);
    success(await f.call(`deliveries/${encodeURIComponent(draft.id)}`,{method:'PATCH',body:{approve:true}}));
    success(await f.call('deliveries/process',{method:'POST',body:{}}));
    const delivered=await f.call('deliveries',{role:'family'});success(delivered);const item=delivered.data.deliveries.find(d=>d.id===draft.id);assert.ok(item);assert.equal(item.status,'delivered');assert.ok(item.deliveredAt);assert.equal(item.readAt,null);
    success(await f.call(`deliveries/${encodeURIComponent(item.id)}`,{role:'senior',method:'PATCH',body:{read:true}}),404);
    success(await f.call(`deliveries/${encodeURIComponent(item.id)}`,{role:'family',method:'PATCH',body:{read:true}}));
    const read=await f.call('deliveries',{role:'family'});assert.equal(read.data.deliveries.find(d=>d.id===item.id).status,'read');
    success(await f.call('consent',{method:'POST',body:{seniorId:'S001',allowed:false}}));
    const blocked=await f.call('bootstrap',{role:'family'});success(blocked);assert.equal(blocked.data.consentDenied,true);assert.deepEqual(blocked.data.seniors,[]);
    const hidden=await f.call('deliveries',{role:'family'});success(hidden);assert.deepEqual(hidden.data.deliveries,[]);
    success(await f.call(`deliveries/${encodeURIComponent(item.id)}`,{role:'family',method:'PATCH',body:{read:true}}),403);
  }finally{f.close();}
});

const gatewayEnv={SAMARTH_PHONE_GATEWAY_SECRET:'synthetic-phone-secret-at-least-32-characters',SAMARTH_PHONE_SENIORS:'S001'};
const phoneBody={version:1,callId:'synthetic_call_001',seniorId:'S001',language:'hi',observedDate:'2026-10-27',answers:{wellbeing:'help',medicines:'missed',daily_routine:'less_sleep',support:'prompt'}};
async function phoneRequest(input=phoneBody,nonce='nonce_for_api_00000001') {
  const raw=JSON.stringify(input),timestamp=String(Math.floor(Date.now()/1000));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(gatewayEnv.SAMARTH_PHONE_GATEWAY_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}\n${nonce}\n${raw}`)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  return {method:'POST',raw,role:'unsigned-gateway',headers:{'x-samarth-timestamp':timestamp,'x-samarth-nonce':nonce,'x-samarth-signature':signature}};
}
test('actual signed phone ingestion commits once per call and nonce with atomic duplicate rollback',async()=>{
  const f=await fixture(gatewayEnv);
  try {
    const first=await f.call('phone/events',await phoneRequest());success(first,201);assert.equal(first.data.externalCallPlaced,false);assert.equal(first.data.recorded,true);
    success(await f.call('phone/events',await phoneRequest()),409);
    success(await f.call('phone/events',await phoneRequest(phoneBody,'nonce_for_api_00000002')),409);
    success(await f.call('phone/events',await phoneRequest({...phoneBody,callId:'another_call_002'})),409);
    const signals=f.db.db.prepare("SELECT payload FROM care_events WHERE kind='signal'").all();assert.equal(signals.length,1);const signal=JSON.parse(signals[0].payload);assert.equal(signal.record.helpRequested,true);assert.equal(signal.record.source,'phone-gateway');
    const audits=f.db.db.prepare("SELECT payload FROM care_events WHERE kind='audit'").all();assert.equal(audits.length,1);assert.equal(JSON.parse(audits[0].payload).actor,'Signed telephone bridge');
    const tampered=await phoneRequest({...phoneBody,callId:'another_call_003'},'nonce_for_api_00000003');tampered.raw=tampered.raw.replace('S001','S002');success(await f.call('phone/events',tampered),401);
    success(await f.call('phone/events',await phoneRequest({...phoneBody,callId:'future_call_004',observedDate:'2099-01-01'},'nonce_for_api_00000004')),400);
    assert.equal(f.db.db.prepare("SELECT COUNT(*) AS count FROM care_events WHERE kind='signal'").get().count,1);
    const overview=await f.call('bootstrap');success(overview);assert.equal(overview.data.seniors.find(s=>s.id==='S001').urgency,'immediate');
  }finally{f.close();}
});
