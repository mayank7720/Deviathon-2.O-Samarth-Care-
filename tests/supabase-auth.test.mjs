import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleSupabaseAuthRoute,resolveSupabaseRequest,supabaseConfiguration} from '../lib/supabase-auth.mjs';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
const user={id:'verified-user',email:'MEMBER@example.test',email_confirmed_at:'2026-10-27',user_metadata:{full_name:'Member',role:'coordinator',is_admin:true}};
const req=(path='login',cookie)=>new Request('https://care.example/api/auth/'+path,{method:'POST',headers:{'content-type':'application/json',origin:'https://care.example',...(cookie?{cookie}:{})}});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
function authFixture({roles=['coordinator'],enabled=true,reauthenticationRequired=false,verifiedUser=user,accessFailure=false}={}){
 const calls=[];
 const fetchImpl=async(url,options={})=>{calls.push({url,options});
  if(url.endsWith('/user'))return response(verifiedUser);
  if(url.includes('/rest/v1/care_memberships?'))return response(roles.map(role=>({role,status:'active',is_admin:role==='operations'?1:0})),accessFailure?503:200);
  if(url.endsWith('/rpc/care_account_self_state'))return response({enabled,reauthenticationRequired});
  if(url.includes('/logout?scope=local'))return response({});
  return response({access_token:'access.token',refresh_token:'refresh-token',expires_in:3600});
 };
 return {calls,fetchImpl};
}
const details=role=>({email:'member@example.test',password:'long-password',role});
const allRoles=['operations','coordinator','family','senior'];

test('Supabase public configuration rejects secret keys and insecure remote origins',()=>{
 assert.throws(()=>supabaseConfiguration({...env,SUPABASE_PUBLISHABLE_KEY:'sb_secret_private'}),/publishable/);
 assert.throws(()=>supabaseConfiguration({...env,SUPABASE_URL:'http://remote.test'}),/HTTPS/);
 assert.throws(()=>supabaseConfiguration({...env,SUPABASE_URL:'https://example.test/?secret=x'}),/origin/);
});
test('login verifies assigned portal and stores session only in secure HttpOnly cookies',async()=>{
 const {calls,fetchImpl}=authFixture();
 const result=await handleSupabaseAuthRoute('auth/login',req(),details('coordinator'),env,{fetchImpl});
 assert.equal(result.status,200);const body=await result.json();assert.equal(body.access_token,undefined);assert.equal(body.role,undefined);
 const cookies=result.headers.getSetCookie();assert.equal(cookies.length,2);assert.ok(cookies.every(x=>/HttpOnly/.test(x)&&/Secure/.test(x)&&/SameSite=Strict/.test(x)));
 assert.deepEqual(JSON.parse(calls[0].options.body),{email:'member@example.test',password:'long-password'});
 assert.ok(calls[1].url.endsWith('/user'));assert.equal(calls[1].options.headers.Authorization,'Bearer access.token');
 assert.equal(calls.filter(c=>c.url.includes('/rest/v1/')).length,2);
});

test('all four portal types reject every other assigned role and revoke only the new local session',async()=>{
 for(const assigned of allRoles)for(const requested of allRoles){
  const {calls,fetchImpl}=authFixture({roles:[assigned]});
  const result=await handleSupabaseAuthRoute('auth/login',req('login','samarth_sb_access=previous-session'),details(requested),env,{fetchImpl});
  assert.equal(result.status,assigned===requested?200:403,`${assigned} credentials at ${requested} portal`);
  const logouts=calls.filter(c=>c.url.includes('/logout'));
  if(assigned===requested){assert.equal(logouts.length,0);continue;}
  const body=await result.json();assert.equal(body.code,'PORTAL_ROLE_MISMATCH');assert.deepEqual(body.availableRoles,[assigned]);
  assert.ok(result.headers.getSetCookie().every(cookie=>cookie.includes('Max-Age=0')));
  assert.equal(logouts.length,1);assert.ok(logouts[0].url.endsWith('?scope=local'));
  assert.equal(logouts[0].options.headers.Authorization,'Bearer access.token');
  assert.ok(!JSON.stringify(logouts).includes('previous-session'));
 }
});

test('password rate limits retain a safe code and Retry-After without blaming credentials',async()=>{
 const calls=[];
 const result=await handleSupabaseAuthRoute('auth/login',req(),details('family'),env,{fetchImpl:async(url)=>{
  calls.push(url);return new Response('<html>provider limit</html>',{status:429,headers:{'retry-after':'120','content-type':'text/html'}});
 }});
 const body=await result.json();assert.equal(result.status,429);assert.equal(body.code,'AUTH_RATE_LIMITED');assert.equal(body.retryAfter,120);assert.equal(result.headers.get('retry-after'),'120');
 assert.equal(body.availableRoles,undefined);assert.doesNotMatch(body.error,/invalid email|invalid password/i);assert.equal(calls.length,1);
 assert.ok(result.headers.getSetCookie().every(cookie=>cookie.includes('Max-Age=0')));
});

test('provider outages are reported as unavailable for JSON and non-JSON responses',async()=>{
 for(const status of [500,502,503,504])for(const json of [true,false]){
  const result=await handleSupabaseAuthRoute('auth/login',req(),details('family'),env,{fetchImpl:async()=>json?response({error:'internal provider details'},status):new Response('<html>private upstream error</html>',{status})});
  const body=await result.json();assert.equal(result.status,503);assert.equal(body.code,'AUTH_SERVICE_UNAVAILABLE');assert.equal(body.availableRoles,undefined);assert.doesNotMatch(JSON.stringify(body),/private upstream|internal provider|invalid email|invalid password/i);
 }
});

test('unreadable provider replies are not labelled as invalid passwords',async()=>{
 for(const status of [200,400,401]){
  const result=await handleSupabaseAuthRoute('auth/login',req(),details('coordinator'),env,{fetchImpl:async()=>new Response('<html>gateway page</html>',{status,headers:{'content-type':'text/html'}})});
  const body=await result.json();assert.equal(result.status,502);assert.equal(body.code,'AUTH_INVALID_RESPONSE');assert.equal(body.availableRoles,undefined);assert.doesNotMatch(JSON.stringify(body),/gateway page|invalid email|invalid password/i);
 }
});

test('invalid credentials never disclose assigned roles or query memberships',async()=>{
 const calls=[];
 const result=await handleSupabaseAuthRoute('auth/login',req(),details('operations'),env,{fetchImpl:async url=>{calls.push(url);return response({code:'invalid_credentials',availableRoles:['operations'],user_metadata:{role:'operations'}},400);}});
 const body=await result.json();assert.equal(result.status,401);assert.equal(body.code,'AUTH_INVALID_CREDENTIALS');assert.equal(body.availableRoles,undefined);assert.equal(calls.length,1);
});

test('rate limit retry timing is bounded even with missing or invalid provider headers',async()=>{
 for(const [header,expected] of [[null,60],['invalid',60],['0',1],['900000000',86400]]){
  const result=await handleSupabaseAuthRoute('auth/login',req(),details('family'),env,{fetchImpl:async()=>new Response('{}',{status:429,headers:header?{'retry-after':header}:{}})});
  assert.equal(result.status,429);assert.equal((await result.json()).retryAfter,expected);assert.equal(result.headers.get('retry-after'),String(expected));
 }
});

test('portal suggestions use only verified active stored memberships',async()=>{
 const fixture=authFixture({roles:['family','family','senior']});
 const result=await handleSupabaseAuthRoute('auth/login',req(),details('operations'),env,fixture);
 const body=await result.json();assert.equal(result.status,403);assert.equal(body.code,'PORTAL_ROLE_MISMATCH');assert.deepEqual(body.availableRoles,['family','senior']);
 assert.equal(body.access_token,undefined);assert.equal(body.email,undefined);assert.ok(!JSON.stringify(body).includes('coordinator'));
 assert.ok(fixture.calls.findIndex(call=>call.url.includes('/rest/v1/'))>fixture.calls.findIndex(call=>call.url.endsWith('/user')));
});

test('a provider outage during user verification still revokes only the newly issued session',async()=>{
 const calls=[];
 const result=await handleSupabaseAuthRoute('auth/login',req('login','samarth_sb_access=previous-session'),details('coordinator'),env,{fetchImpl:async(url,options)=>{
  calls.push({url,options});if(url.includes('/token?'))return response({access_token:'new-access.token',refresh_token:'new-refresh'});
  if(url.endsWith('/user'))return response({error:'service down'},503);return response({});
 }});
 const body=await result.json();assert.equal(result.status,503);assert.equal(body.code,'AUTH_SERVICE_UNAVAILABLE');assert.equal(body.availableRoles,undefined);
 const logout=calls.find(call=>call.url.includes('/logout?'));assert.ok(logout.url.endsWith('/logout?scope=local'));assert.equal(logout.options.headers.Authorization,'Bearer new-access.token');assert.equal(calls.filter(call=>call.url.includes('/rest/v1/')).length,0);
});

test('a role is mandatory and metadata cannot turn family credentials into staff access',async()=>{
 const fixture=authFixture({roles:['family']});
 assert.equal((await handleSupabaseAuthRoute('auth/login',req(),details(undefined),env,fixture)).status,400);
 assert.equal(fixture.calls.length,0);
 assert.equal((await handleSupabaseAuthRoute('auth/login',req(),details('operations'),env,fixture)).status,403);
});

test('unassigned verified people can sign in only to public portals to accept an invitation',async()=>{
 for(const role of allRoles){const fixture=authFixture({roles:[]});const result=await handleSupabaseAuthRoute('auth/login',req(),details(role),env,fixture);assert.equal(result.status,['family','senior'].includes(role)?200:403);}
});

test('disabled, stale or unverified account access fails closed and clears cookies',async()=>{
 for(const setting of [{enabled:false},{reauthenticationRequired:true},{accessFailure:true}]){
  const fixture=authFixture(setting);const result=await handleSupabaseAuthRoute('auth/login',req(),details('coordinator'),env,fixture);
  assert.equal(result.status,setting.accessFailure?503:403);assert.equal((await result.json()).availableRoles,undefined);assert.ok(result.headers.getSetCookie().every(c=>c.includes('Max-Age=0')));assert.ok(fixture.calls.some(c=>c.url.includes('/logout?scope=local')));
 }
});

test('unconfirmed email and invalid tokens never produce an identity',async()=>{
 const login=await handleSupabaseAuthRoute('auth/login',req(),{email:'member@example.test',password:'long-password',role:'family'},env,{fetchImpl:async url=>response(url.endsWith('/user')?{...user,email_confirmed_at:null}:{access_token:'x',refresh_token:'y'})});assert.equal(login.status,401);
 const invalid=await resolveSupabaseRequest(req('status','samarth_sb_access=forged.token'),env,{fetchImpl:async()=>response({},401)});assert.equal(invalid.identity,null);assert.equal(invalid.accessToken,null);
});
test('role metadata is excluded and caller identity is authoritative server Auth response',async()=>{
 const resolved=await resolveSupabaseRequest(req('status','samarth_sb_access=untrusted.token'),env,{fetchImpl:async()=>response(user)});
 assert.equal(resolved.identity.userId,'verified-user');assert.equal(resolved.identity.email,'member@example.test');assert.equal(resolved.identity.role,undefined);assert.equal(resolved.identity.is_admin,undefined);
});
test('expired sessions refresh, revalidate Auth user, and rotate cookies',async()=>{
 const calls=[];const resolved=await resolveSupabaseRequest(req('status','samarth_sb_access=old; samarth_sb_refresh=refresh'),env,{fetchImpl:async(url,opts)=>{calls.push(url);if(url.includes('grant_type=refresh'))return response({access_token:'new-token',refresh_token:'new-refresh',expires_in:3600});return opts.headers.Authorization==='Bearer old'?response({},401):response(user);}});
 assert.equal(resolved.identity.userId,user.id);assert.equal(resolved.accessToken,'new-token');assert.equal(resolved.cookies.length,2);assert.equal(calls.length,3);
});
test('Auth outages fail closed and cross-origin mutations are rejected',async()=>{
 await assert.rejects(()=>resolveSupabaseRequest(req('status','samarth_sb_access=x'),env,{fetchImpl:async()=>{throw Error('offline');}}),error=>error.status===503);
 const request=new Request('https://care.example/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.test'}});
 const result=await handleSupabaseAuthRoute('auth/login',request,{email:user.email,password:'long-password'},env,{fetchImpl:async()=>{throw Error('must not call');}});assert.equal(result.status,403);
});
test('registration is disabled by default and never grants roles',async()=>{
 const disabled=await handleSupabaseAuthRoute('auth/register',req('register'),{email:user.email,password:'long-password'},env,{fetchImpl:async()=>{throw Error('must not call');}});assert.equal(disabled.status,403);
 const allowed=await handleSupabaseAuthRoute('auth/register',req('register'),{email:user.email,password:'long-password',role:'family'},{...env,SAMARTH_ALLOW_SIGNUP:'true'},{fetchImpl:async()=>response({})});const body=await allowed.json();assert.equal(allowed.status,201);assert.equal(body.confirmationRequired,true);assert.deepEqual(allowed.headers.getSetCookie(),[]);
});
test('logout clears local cookies even if provider is offline',async()=>{
 const result=await handleSupabaseAuthRoute('auth/logout',req('logout','samarth_sb_access=x'),{},env,{fetchImpl:async()=>{throw Error('offline');}});assert.equal(result.status,200);assert.ok(result.headers.getSetCookie().every(cookie=>cookie.includes('Max-Age=0')));
});

test('public registration rejects staff and owner roles before contacting Auth',async()=>{
 for(const role of ['coordinator','operations','admin',undefined]){
  const result=await handleSupabaseAuthRoute('auth/register',req('register'),details(role),{...env,SAMARTH_ALLOW_SIGNUP:'true'},{fetchImpl:async()=>{throw Error('Staff self-registration reached Auth');}});
  assert.equal(result.status,403);
 }
});
test('registration records public role intent and display name without granting membership',async()=>{
 let sent;const result=await handleSupabaseAuthRoute('auth/register',req('register'),{...details('senior'),displayName:'Asha Rao'},{...env,SAMARTH_ALLOW_SIGNUP:'true'},{fetchImpl:async(url,opts)=>{sent=JSON.parse(opts.body);assert.ok(url.endsWith('/signup'));return response({});}});
 assert.equal(result.status,201);assert.deepEqual(sent.data,{display_name:'Asha Rao',requested_role:'senior'});assert.equal(sent.role,undefined);assert.deepEqual(result.headers.getSetCookie(),[]);
});
