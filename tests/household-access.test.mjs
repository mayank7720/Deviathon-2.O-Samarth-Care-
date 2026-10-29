import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleHouseholdRoute} from '../lib/household-routes.mjs';
import {handleAccessRoute} from '../lib/access.mjs';
const id='00000000-0000-0000-0000-000000000001';
const context=(role='family')=>({authenticated:true,authorized:true,userId:id,session:{role,scope:['S001'],seniorId:'S001'},identity:{name:'Test person'}});
const request=(path,method='POST')=>new Request('https://care.example/api/'+path,{method});
test('household invitations derive their role from the current verified session and store only a token hash',async()=>{
 let saved;const db={household:async(action,payload)=>{saved={action,payload};return {ok:true};}};
 const response=await handleHouseholdRoute('household/invitations',request('household/invitations'),db,{email:'Relative@Example.test',seniorId:'S001'},context('senior'));
 assert.equal(response.status,201);const result=await response.json();assert.equal(result.emailSent,false);assert.match(result.inviteUrl,/#invite=[a-f0-9]{64}$/);
 assert.equal(saved.action,'invite');assert.equal(saved.payload.role,'senior');assert.equal(saved.payload.email,'relative@example.test');assert.match(saved.payload.tokenHash,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(saved).includes(result.inviteUrl.split('#invite=')[1]));
});
test('household routes refuse staff portals, arbitrary senior records and role injection before database mutations',async()=>{
 const db={household:async()=>{throw Error('Unauthorized mutation reached database');}};
 for(const role of ['operations','coordinator'])await assert.rejects(()=>handleHouseholdRoute('household',request('household','GET'),db,{},context(role)),error=>error.status===403);
 await assert.rejects(()=>handleHouseholdRoute('household/invitations',request('household/invitations'),db,{email:'relative@example.test',seniorId:'S002'},context()),error=>error.status===403);
 await assert.rejects(()=>handleHouseholdRoute('household/invitations',request('household/invitations'),db,{email:'relative@example.test',seniorId:'S001',role:'coordinator'},context()),error=>error.status===400);
});
test('removing a household link requires confirmation and never invokes account deletion',async()=>{
 const calls=[],db={household:async(action,payload)=>{calls.push({action,payload});return {ok:true};}};
 const path='household/links/invite-'+id;
 await assert.rejects(()=>handleHouseholdRoute(path,request(path,'DELETE'),db,{},context()),error=>error.status===400);
 assert.equal((await handleHouseholdRoute(path,request(path,'DELETE'),db,{confirmRemove:true},context())).status,200);
 assert.deepEqual(calls,[{action:'remove_link',payload:{role:'family',id:'invite-'+id}}]);
});
test('admin invitation history updates are delegated to audited transactions and replace the old secret',async()=>{
 const changes=[],admin={...context('operations'),session:{role:'operations',isAdmin:true}},db={manageInvitation:async input=>{changes.push(input);return {ok:true};}};
 const path='access/invites/'+id;
 const edited=await handleAccessRoute(path,request(path,'PATCH'),db,{email:'family@example.test',role:'family',seniorId:'S001'},admin);
 assert.equal(edited.status,200);assert.equal(changes[0].action,'update');assert.match(changes[0].details.tokenHash,/^[a-f0-9]{64}$/);
 assert.match((await edited.json()).inviteUrl,/#invite=[a-f0-9]{64}$/);
 await handleAccessRoute(path,request(path,'PATCH'),db,{action:'revoke'},admin);
 await handleAccessRoute(path,request(path,'DELETE'),db,{},admin);
 assert.deepEqual(changes.map(c=>c.action),['update','revoke','delete']);
 await assert.rejects(()=>handleAccessRoute(path,request(path,'DELETE'),db,{},context('coordinator')),error=>error.status===403);
});
