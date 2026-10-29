import test from 'node:test';
import assert from 'node:assert/strict';
import {invitationDetails,canEnterPortal,careRequest,CareRequestError} from '../lib/portal-entry.mjs';
const token='a'.repeat(64);
test('invitation links accept fragment and legacy query links without treating role hints as authority',()=>{
 assert.deepEqual(invitationDetails(`https://care.test/#invite=${token}&role=senior`),{token,role:'senior',present:true,valid:true});
 assert.deepEqual(invitationDetails(`https://care.test/?invite=${token}&role=family`),{token,role:'family',present:true,valid:true});
 assert.equal(invitationDetails(token.toUpperCase()).token,token);
 assert.equal(invitationDetails(`https://care.test/#invite=${token}&role=administrator`).role,'');
 assert.equal(invitationDetails('https://care.test/#invite=invalid').valid,false);
 assert.equal(invitationDetails('https://care.test/').present,false);
});
test('a stale entry flag cannot admit anonymous, unassigned or disabled authentication',()=>{
 const state={authenticated:true,authorized:true,session:{role:'family'},memberships:[{role:'family',status:'active'}]};
 assert.equal(canEnterPortal(state),true);
 for(const patch of [{authenticated:false},{session:null},{accountStatus:{enabled:false}},{accountStatus:{reauthenticationRequired:true}},{authorized:false,memberships:[]}])assert.equal(!!canEnterPortal({...state,...patch}),false);
});
test('structured role correction and rate limits remain available without raw provider content',async()=>{
 await assert.rejects(careRequest('/auth/login','POST',{email:'member@example.invalid'},{fetchImpl:async()=>new Response(JSON.stringify({error:'Choose your assigned portal.',code:'PORTAL_ROLE_MISMATCH',availableRoles:['family','administrator']}),{status:403})}),error=>error instanceof CareRequestError&&error.status===403&&error.availableRoles.join(',')==='family');
 await assert.rejects(careRequest('/auth/login','POST',{}, {fetchImpl:async()=>new Response('<html>gateway private details</html>',{status:502})}),error=>error.status===502&&!error.message.includes('html')&&!error.message.includes('private'));
});
test('care request sends same-origin credentials and a bounded abort signal',async()=>{
 let request;const result=await careRequest('/auth','GET',undefined,{fetchImpl:async(url,options)=>{request={url,...options};return new Response('{"authenticated":false}');}});
 assert.equal(result.authenticated,false);assert.equal(request.url,'/api/auth');assert.equal(request.credentials,'same-origin');assert.equal(request.cache,'no-store');assert.ok(request.signal instanceof AbortSignal);
});
