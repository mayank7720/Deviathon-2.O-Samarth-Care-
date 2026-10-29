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
