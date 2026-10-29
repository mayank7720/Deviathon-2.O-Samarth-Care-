import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSupabaseAuthRoute} from '../lib/supabase-auth.mjs';
const env={SUPABASE_URL:'https://care-db.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
const user={id:'11111111-1111-4111-8111-111111111111',email:'own@example.test',email_confirmed_at:'2026-10-29',user_metadata:{display_name:'Own account'}};
const currentPassword='Current secure password 47!',newPassword='New secure password 83!';
function fixture({role='senior',wrongCurrent=false,swappedIdentity=false,weak=false,outage=false,cutoffFails=false}={}){
 const calls=[];
 const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
 const fetchImpl=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,body,method:options.method||'GET',authorization:options.headers?.Authorization});
  if(outage)return json({message:'Do not leak provider internals'},503);
  if(url.includes('/rest/v1/care_memberships?'))return json([{role,status:'active',is_admin:role==='operations'?1:0}]);
  if(url.endsWith('/care_account_self_state'))return json({enabled:true,reauthenticationRequired:false});
  if(url.endsWith('/token?grant_type=password'))return wrongCurrent?json({message:'Wrong password'},400):json({access_token:'fresh-access',refresh_token:'fresh-refresh',expires_in:3600});
  if(url.endsWith('/user')&&options.method==='PUT')return weak?json({code:'weak_password'},422):json(user);
  if(url.endsWith('/user'))return json(swappedIdentity&&options.headers?.Authorization==='Bearer fresh-access'?{...user,id:'22222222-2222-4222-8222-222222222222'}:user);
  if(url.endsWith('/care_password_changed'))return json(cutoffFails?{error:'failed'}:{ok:true},cutoffFails?503:200);
  if(url.includes('/logout?scope='))return json({});
  throw Error('Unexpected provider route');
 };
 const call=(body={currentPassword,newPassword},authenticated=true)=>handleSupabaseAuthRoute('auth/password',new Request('https://care.example/api/auth/password',{method:'POST',headers:{origin:'https://care.example','content-type':'application/json',...(authenticated?{cookie:'samarth_sb_access=existing-access; samarth_sb_refresh=existing-refresh'}:{})}}),body,env,{fetchImpl});
 return {calls,call};
}
test('all four roles can change only their own password, invalidate sessions and clear cookies',async()=>{
 for(const role of ['operations','coordinator','family','senior']){
  const f=fixture({role}),response=await f.call();assert.equal(response.status,200,role);const result=await response.json();
  assert.equal(result.passwordChanged,true);assert.equal(result.signInRequired,true);assert.ok(response.headers.getSetCookie().every(cookie=>cookie.includes('Max-Age=0')));
  const verify=f.calls.find(c=>c.url.endsWith('/token?grant_type=password'));assert.deepEqual(verify.body,{email:user.email,password:currentPassword});
  const update=f.calls.find(c=>c.method==='PUT');assert.equal(update.authorization,'Bearer fresh-access');assert.deepEqual(update.body,{password:newPassword,current_password:currentPassword});
  assert.ok(f.calls.some(c=>c.url.endsWith('/logout?scope=global')));
  assert.ok(f.calls.filter(c=>c.url.includes('/rest/v1/')).every(c=>!JSON.stringify(c.body).includes(currentPassword)&&!JSON.stringify(c.body).includes(newPassword)));
  assert.ok(!JSON.stringify(result).includes(currentPassword)&&!JSON.stringify(result).includes(newPassword));
 }
});
test('wrong current password never reaches a password update or care cutoff',async()=>{
 const f=fixture({wrongCurrent:true}),response=await f.call();assert.equal(response.status,401);assert.ok(!f.calls.some(c=>c.method==='PUT'||c.url.endsWith('/care_password_changed')));
});
test('another identity returned by reauthentication cannot be used to change its password',async()=>{
 const f=fixture({swappedIdentity:true}),response=await f.call();assert.equal(response.status,401);assert.ok(!f.calls.some(c=>c.method==='PUT'));assert.ok(f.calls.some(c=>c.url.endsWith('/logout?scope=local')));
});
test('caller-selected account IDs never select a password target',async()=>{
 const f=fixture();const response=await f.call({currentPassword,newPassword,targetUserId:'other-user',email:'other@example.test'});assert.equal(response.status,200);
 const update=f.calls.find(c=>c.method==='PUT');assert.equal(update.authorization,'Bearer fresh-access');assert.ok(!JSON.stringify(f.calls).includes('other-user'));assert.ok(!JSON.stringify(f.calls).includes('other@example.test'));
});
test('weak, oversized, unchanged passwords and anonymous callers are rejected',async()=>{
 for(const value of ['short','x'.repeat(129),currentPassword]){const f=fixture();assert.equal((await f.call({currentPassword,newPassword:value})).status,400);assert.equal(f.calls.length,0);}
 const f=fixture();assert.equal((await f.call({currentPassword,newPassword},false)).status,401);assert.equal(f.calls.length,0);
 const weak=fixture({weak:true});assert.equal((await weak.call()).status,400);assert.ok(!weak.calls.some(c=>c.url.endsWith('/care_password_changed')));
});
test('provider outages retain a retryable service status without leaking provider messages',async()=>{
 const f=fixture({outage:true}),response=await f.call();assert.equal(response.status,503);assert.doesNotMatch(JSON.stringify(await response.json()),/provider internals/);assert.ok(!f.calls.some(c=>c.method==='PUT'));
});
test('successful password change with unavailable care cutoff warns and still signs out globally',async()=>{
 const f=fixture({cutoffFails:true}),response=await f.call();assert.equal(response.status,200);const result=await response.json();assert.equal(result.passwordChanged,true);assert.ok(result.warning);assert.ok(f.calls.some(c=>c.url.endsWith('/logout?scope=global')));assert.ok(response.headers.getSetCookie().every(cookie=>cookie.includes('Max-Age=0')));
});
