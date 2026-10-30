import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleAccountRoute} from '../lib/account-routes.mjs';
const userId='00000000-0000-0000-0000-000000000001';
const invoke=(session,body,db={accountDirectory:async()=>[]})=>handleAccountRoute({path:body?`accounts/${userId}/phone`:'accounts',request:new Request('https://care.example/api/accounts',{method:body?'PUT':'GET'}),body,db,context:{session}});
test('account mobile management belongs only to the operations administrator',async()=>{
 for(const session of [{role:'coordinator',isAdmin:true},{role:'family',isAdmin:true},{role:'senior',isAdmin:true},{role:'operations',isAdmin:false}])assert.equal((await invoke(session)).status,403);
 assert.equal((await invoke({role:'operations',isAdmin:true})).status,200);
});
test('phone binding requires a valid number, recipient confirmation and separate channel choices',async()=>{
 let saved;const db={accountDirectory:async()=>[],setAccountPhone:async input=>{saved=input;return {ok:true};}},admin={role:'operations',isAdmin:true};
 assert.equal((await invoke(admin,{phone:'123',smsConsent:true,callConsent:false,recipientConfirmed:true},db)).status,400);
 assert.equal((await invoke(admin,{phone:'+19990000001',smsConsent:true,callConsent:false},db)).status,400);
 assert.equal((await invoke(admin,{phone:'+19990000001',smsConsent:true,callConsent:false,recipientConfirmed:true},db)).status,200);
 assert.deepEqual(saved,{userId,phone:'+19990000001',smsConsent:true,callConsent:false,confirmed:true});
 assert.equal((await invoke(admin,{phone:'',smsConsent:true,callConsent:true},db)).status,200);
 assert.equal(saved.phone,null);assert.equal(saved.smsConsent,false);assert.equal(saved.callConsent,false);
});
test('channel permissions can change without exposing or replacing the saved number',async()=>{
 let saved;const admin={role:'operations',isAdmin:true},db={accountDirectory:async()=>[],setAccountChannels:async input=>{saved=input;return {ok:true};}};
 assert.equal((await invoke(admin,{action:'permissions',smsConsent:false,callConsent:true,recipientConfirmed:false},db)).status,400);
 assert.equal((await invoke(admin,{action:'permissions',smsConsent:false,callConsent:true,recipientConfirmed:true},db)).status,200);
 assert.deepEqual(saved,{userId,smsConsent:false,callConsent:true,confirmed:true});assert.equal(saved.phone,undefined);
});

test('the password endpoint refuses every nonadministrator portal before invoking the administrator service',async()=>{
 let calls=0;const db={accountDirectory:async()=>[],adminAccount:async()=>{calls++;return {ok:true};}};
 const body={password:'A private new password 24!',confirmReset:true,idempotencyKey:'00000000-0000-0000-0000-000000000002'};
 for(const session of [{role:'coordinator',isAdmin:true},{role:'family',isAdmin:true},{role:'senior',isAdmin:true},{role:'operations',isAdmin:false}]){
  const response=await handleAccountRoute({path:`accounts/${userId}/password`,request:new Request('https://care.example/api/accounts/'+userId+'/password',{method:'POST'}),body,db,context:{session}});
  assert.equal(response.status,403);
 }
 assert.equal(calls,0);
});

test('the Operations password endpoint validates confirmation and strength and binds the target to the URL',async()=>{
 const calls=[],admin={role:'operations',isAdmin:true},body={password:'A private new password 24!',confirmReset:true,idempotencyKey:'00000000-0000-0000-0000-000000000002'};
 const db={accountDirectory:async()=>[],adminAccount:async(action,details)=>{calls.push({action,details});return {ok:true,passwordChosen:true};}};
 const invokePassword=change=>handleAccountRoute({path:`accounts/${userId}/password`,request:new Request('https://care.example/api/accounts/'+userId+'/password',{method:'POST'}),body:{...body,...change},db,context:{session:admin}});
 for(const change of [{confirmReset:false},{password:'short'},{password:'x'.repeat(129)},{idempotencyKey:''}])assert.equal((await invokePassword(change)).status,400);
 assert.equal(calls.length,0);
 const response=await invokePassword({targetUserId:'00000000-0000-0000-0000-000000000003'});
 assert.equal(response.status,200);assert.equal(calls.length,1);assert.equal(calls[0].action,'password');assert.equal(calls[0].details.targetUserId,userId);
 assert.equal(calls[0].details.password,body.password);assert.equal((await response.json()).passwordChosen,true);
});
