import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {normalizeCaller,phoneCommand,verifyGatewayEnvelope,handlePhoneIntakeRoute} from '../lib/phone-intake.mjs';
import {signBridgeRequest} from '../lib/telephony.mjs';
const now=Date.parse('2026-10-30T06:00:00Z'),secret='test-only-gateway-signing-key-12345',bridge='test-only-android-bridge-key-1234567890';
const envelope=()=>({event:'sms:received',id:'event-1',deviceId:'test-device',payload:{messageId:'message-1',message:'HELP',sender:'+19990000001',simNumber:2,receivedAt:new Date(now-10000).toISOString()}});
async function receive(value=envelope(),{key=secret,clock=now,timestamp=Math.floor(now/1000),sim=2}={}){
 const raw=JSON.stringify(value),headers=new Headers({'x-timestamp':String(timestamp),'x-signature':createHmac('sha256',key).update(raw+timestamp).digest('hex')});
 return verifyGatewayEnvelope(raw,headers,secret,{now:clock,expectedSim:sim});
}
test('care commands are simple and bounded without treating ordinary SMS as care intake',()=>{
 for(const message of ['HELP','help please','मदद','सहायता चाहिए','MADAD!','SOS'])assert.equal(phoneCommand(message)?.kind,'help');
 for(const message of ['CALL','call me','कॉल करें','फोन'])assert.equal(phoneCommand(message)?.kind,'callback');
 for(const message of ['OTP 123456','I do not need help','HELPFUL advice','Your bank sent a notice','1','', 'HELP\u0000'])assert.equal(phoneCommand(message),null);
 assert.equal(phoneCommand('HELP '+'a'.repeat(1600)),null);
});
test('caller normalization supports Indian basic-phone formats but never treats a number as a login',()=>{
 assert.equal(normalizeCaller('98765 43210'),'+919876543210');assert.equal(normalizeCaller('919876543210'),'+919876543210');
 assert.equal(normalizeCaller('+1 (999) 000-0001'),'+19990000001');
 for(const value of ['BANK-OTP','tel:+19990000001','123','+01234567890',null])assert.equal(normalizeCaller(value),null);
});
test('actual gateway HMAC is checked over raw bytes plus timestamp before parsing',async()=>{
 const value=await receive();assert.equal(value.kind,'help');assert.equal(value.sender,'+19990000001');assert.match(value.eventId,/^[a-f0-9]{64}$/);
 await assert.rejects(receive(envelope(),{key:'wrong-key'}),error=>error.status===401);
 await assert.rejects(receive(envelope(),{timestamp:Math.floor(now/1000)-301}),error=>error.status===401);
 await assert.rejects(verifyGatewayEnvelope('{}',new Headers(),'',{now}),error=>error.status===503);
});
test('batch exports, other SIMs, unknown sender formats and unrelated private SMS never leave the receiver',async()=>{
 for(const modify of [e=>{e.event='sms:batch:received';},e=>{e.payload.simNumber=1;},e=>{e.payload.simNumber=null;},e=>{e.payload.message='OTP: 654321';},e=>{e.payload.sender='BANK-OTP';}]){const value=envelope();modify(value);assert.equal((await receive(value)).ignored,true);}
});
test('duplicate physical SMS has stable identity while a later identical HELP text remains a separate request',async()=>{
 const first=await receive(),again=await receive();assert.equal(first.eventId,again.eventId);
 const later=envelope();later.payload.receivedAt=new Date(now-5000).toISOString();assert.notEqual((await receive(later)).eventId,first.eventId);
});

test('signed text-only MMS uses its body, retains transport and excludes attachments and unknown SIMs',async()=>{
 const value=envelope();value.event='mms:downloaded';delete value.payload.message;value.payload.body='help';value.payload.attachments=[];
 const parsed=await receive(value);assert.equal(parsed.kind,'help');assert.equal(parsed.transport,'mms');
 const result=await call('phone-intake/receive',parsed);assert.equal(result.status,201);assert.equal(result.calls[0].payload.analysis.transport,'mms');
 for(const modify of [e=>{e.payload.attachments=[{contentType:'image/jpeg',data:'excluded-fixture'}];},e=>{delete e.payload.attachments;},e=>{e.payload.simNumber=null;},e=>{e.event='mms:received';}]){const e=structuredClone(value);modify(e);assert.equal((await receive(e)).ignored,true);}
 assert.equal((await call('phone-intake/receive',{...parsed,transport:'voice'})).status,400);
});
test('future/old observations are rejected and delayed arrival is explicit',async()=>{
 const value=envelope();value.payload.receivedAt=new Date(now-600000).toISOString();assert.equal((await receive(value)).delayed,true);
 for(const date of [new Date(now+120000).toISOString(),new Date(now-86400001).toISOString(),'2026-10-30','not a date']){const value=envelope();value.payload.receivedAt=date;await assert.rejects(receive(value),error=>error.status===400);}
});
const context={authenticated:true,authorized:true,session:{userId:'test-care-user',role:'coordinator',scope:['*']}};
async function call(path,body={},options={}){
 const raw=JSON.stringify(body),signed=await signBridgeRequest({method:'POST',path:'/api/'+path,body:raw,secret:bridge,timestamp:Math.floor(now/1000)}),calls=[];
 const request=new Request('https://care.example/api/'+path+(options.search||''),{method:options.method||'POST',headers:{...signed,...options.headers,'content-type':'application/json'},...((options.method||'POST')==='POST'?{body:raw}:{})});
 const response=await handlePhoneIntakeRoute({path,request,body,rawBody:raw,context:options.context||context,env:{SAMARTH_ANDROID_BRIDGE_SECRET:bridge,SAMARTH_PHONE_INTAKE_ENABLED:'true',...options.env},db:options.db||{phoneIntake:async(action,payload)=>{calls.push({action,payload});return {ok:true,id:'00000000-0000-4000-8000-000000000001'};}},now});
 return {status:response.status,data:await response.json(),calls};
}
test('cloud intake requires both current care access and a valid signed bridge, then delegates identity matching to storage',async()=>{
 const payload=await receive();const result=await call('phone-intake/receive',payload);assert.equal(result.status,201);assert.equal(result.calls[0].action,'receive');assert.equal(result.calls[0].payload.sender,payload.sender);assert.ok(!('seniorId' in result.calls[0].payload));
 const denied=await call('phone-intake/receive',payload,{headers:{'x-samarth-bridge-signature':'0'.repeat(64)}});assert.equal(denied.status,401);assert.equal(denied.calls.length,0);
 for(const role of ['senior','family'])assert.equal((await call('phone-intake/receive',payload,{context:{...context,session:{...context.session,role}}})).status,403);
 assert.equal((await call('phone-intake/receive',payload,{env:{SAMARTH_PHONE_INTAKE_ENABLED:'false'}})).status,503);
});
test('sender cannot choose a senior, assigned coordinator or call destination in an incoming command',async()=>{
 const payload=await receive();for(const field of ['seniorId','assignedTo','phone','recipient','analysis']){const result=await call('phone-intake/receive',{...payload,[field]:'S999'});assert.equal(result.status,400);assert.equal(result.calls.length,0);}
});

test('prose SMS gets server-computed evidence and priority without trusting a client-supplied classification',async()=>{
 const value=envelope();value.payload.message='I fell yesterday.';const payload=await receive(value);
 assert.equal(payload.kind,'help');assert.ok(!('analysis' in payload));
 const result=await call('phone-intake/receive',payload);assert.equal(result.status,201);
 const analysis=result.calls[0].payload.analysis;assert.equal(analysis.urgency,'immediate');assert.equal(analysis.cues[0].cue,'fall');assert.equal(analysis.externalServiceUsed,false);
 const mismatched=await call('phone-intake/receive',{...payload,kind:'callback'});assert.equal(mismatched.status,400);
});

test('SMS helpline is server configured and returned only after household contact authorization',async()=>{
 const options={method:'GET',search:'?seniorId=S001',env:{SAMARTH_PHONE_INTAKE_NUMBER:'+19990000002'},context:{...context,session:{...context.session,role:'senior'}}};
 const allowed=await call('phone-intake/contact',{},options);assert.equal(allowed.status,200);assert.equal(allowed.data.smsHelpline,'+19990000002');assert.deepEqual(allowed.calls,[{action:'contact',payload:{seniorId:'S001'}}]);
 const denied=await call('phone-intake/contact',{}, {...options,db:{phoneIntake:async()=>{throw Object.assign(Error('No household access'),{status:403});}}});assert.equal(denied.status,403);assert.ok(!('smsHelpline' in denied.data));
 for(const env of [{SAMARTH_PHONE_INTAKE_NUMBER:'tel:+19990000002'},{SAMARTH_PHONE_INTAKE_NUMBER:'+19990000002',SAMARTH_PHONE_INTAKE_ENABLED:'false'},{}])assert.equal((await call('phone-intake/contact',{}, {...options,env})).data.smsHelpline,null);
 const signedOut=await call('phone-intake/contact',{}, {...options,context:{authenticated:false}});assert.equal(signedOut.status,401);assert.equal(signedOut.calls.length,0);
});
test('acknowledgement and contact attempts remain separate from resolution and caller identity',async()=>{
 const path='phone-intake/00000000-0000-4000-8000-000000000001/action';
 for(const action of ['acknowledge','called','callback']){const value=await call(path,{action});assert.equal(value.status,200);assert.equal(value.calls[0].action,action);}
 assert.equal((await call(path,{action:'close',outcome:'ok'})).status,400);
 const closed=await call(path,{action:'close',outcome:'Care coordinator confirmed that support was arranged.'});assert.equal(closed.status,200);
 assert.equal((await call(path,{action:'diagnose'})).status,400);
});
