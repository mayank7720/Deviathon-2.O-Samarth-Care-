import test from 'node:test';
import assert from 'node:assert/strict';
import {checkinReply,handleSmsCheckinRoute} from '../lib/sms-checkins.mjs';
import {verifyGatewayEnvelope,handlePhoneIntakeRoute} from '../lib/phone-intake.mjs';
import {signBridgeRequest} from '../lib/telephony.mjs';
import {createHmac} from 'node:crypto';
const now=Date.parse('2026-10-30T06:00:00Z'),secret='fixture-only-checkin-bridge-secret-1234567';
test('questionnaire choices are strict, case insensitive, support Hindi digits and both code positions',()=>{
 for(const [text,choice,code] of [['1','1',null],[' २ ','2',null],['abc123 3','3','ABC123'],['3:ABC123','3','ABC123'],['ABC123-१!','1','ABC123']])assert.deepEqual({choice:checkinReply(text)?.choice,code:checkinReply(text)?.code},{choice,code});
 for(const text of ['OTP 123456','12','4','I am 1','ABC123 4','HELP','1\n2','ABC123 1 EXTRA',{},null])assert.equal(checkinReply(text),null);
 for(const text of ['stop','UNSUBSCRIBE','बंद'])assert.equal(checkinReply(text)?.choice,'stop');
});
async function route(path,body={},options={}){
 const raw=JSON.stringify(body),headers=new Headers({'content-type':'application/json'});
 if(options.signed)for(const [k,v] of Object.entries(await signBridgeRequest({method:'POST',path:'/api/'+path,body:raw,secret,timestamp:Math.floor(now/1000)})))headers.set(k,v);
 const calls=[],db={smsCheckins:async(action,payload)=>{calls.push({action,payload});return {ok:true,id:'fixture',checkins:[]};},phoneIntake:async()=>{throw Error('A choice must not become an unsolicited HELP request');}};
 const context={authenticated:true,authorized:true,session:{userId:'fixture',role:options.role||'coordinator'}};
 const args={path,body,rawBody:raw,request:new Request('https://care.example/api/'+path,{method:options.method||'POST',headers,...(options.method==='GET'?{}:{body:raw})}),db,context,env:{SAMARTH_PHONE_INTAKE_ENABLED:'true',SAMARTH_ANDROID_BRIDGE_SECRET:secret},now};
 const result=await (path.startsWith('phone-intake')?handlePhoneIntakeRoute(args):handleSmsCheckinRoute(args));
 return {status:result.status,data:await result.json(),calls};
}
const create={seniorId:'S001',language:'en',sendAt:new Date(now+60000).toISOString(),windowHours:4,consentConfirmed:true,idempotencyKey:'fixture-key-123456789'};
test('staff can schedule only by saved senior binding; household roles and recipient overrides are rejected',async()=>{
 assert.equal((await route('sms-checkins',create)).status,201);
 for(const role of ['family','senior'])assert.equal((await route('sms-checkins',create,{role})).status,403);
 for(const extra of [{phone:'+19990000001'},{text:'custom'},{recipientId:'forged'}])assert.equal((await route('sms-checkins',{...create,...extra})).status,400);
 assert.equal((await route('sms-checkins',{...create,consentConfirmed:false})).status,400);
});
test('outbound, claims and receipts require bridge HMAC in addition to a staff login',async()=>{
 assert.equal((await route('sms-checkins/bridge/outbound')).status,401);
 assert.equal((await route('sms-checkins/bridge/outbound',{}, {signed:true})).status,200);
 assert.equal((await route('sms-checkins/bridge/claim',{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',phone:'forged'},{signed:true})).status,400);
 assert.equal((await route('sms-checkins/bridge/receipt',{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',leaseToken:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',providerId:'wrong',status:'delivered'},{signed:true})).status,400);
});
test('signed questionnaire replies are re-parsed on the server and cannot select their senior or answer',async()=>{
 const body={eventId:'a'.repeat(64),channel:'sms',sender:'+19990000001',kind:'checkin',message:'ABC123 2',receivedAt:new Date(now).toISOString()};
 const result=await route('phone-intake/receive',body,{signed:true});assert.equal(result.status,201);assert.equal(result.calls[0].action,'receive');assert.equal(result.calls[0].payload.code,'ABC123');assert.equal(result.calls[0].payload.choice,'2');
 assert.equal((await route('phone-intake/receive',{...body,seniorId:'S002'},{signed:true})).status,400);
 assert.equal((await route('phone-intake/receive',{...body,choice:'3'},{signed:true})).status,400);
 assert.equal((await route('phone-intake/receive',{...body,message:'anything else'},{signed:true})).status,400);
});
test('gateway forwards only the enabled bounded choice protocol after verifying its signature',async()=>{
 const gatewaySecret='fixture-gateway-no-real-access';
 const value={event:'sms:received',id:'fixture',deviceId:'fixture',payload:{messageId:'fixture',message:'ABC123 2',sender:'+19990000001',simNumber:2,receivedAt:new Date(now).toISOString()}};
 const raw=JSON.stringify(value),timestamp=String(now/1000),headers=new Headers({'x-timestamp':timestamp,'x-signature':createHmac('sha256',gatewaySecret).update(raw+timestamp).digest('hex')});
 assert.equal((await verifyGatewayEnvelope(raw,headers,gatewaySecret,{now})).ignored,true);
 const event=await verifyGatewayEnvelope(raw,headers,gatewaySecret,{now,allowCheckins:true});assert.equal(event.kind,'checkin');assert.equal(event.message,'ABC123 2');assert.equal('code' in event,false);
});
