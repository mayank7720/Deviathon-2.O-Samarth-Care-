import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateAccountAction} from '../lib/account-management.mjs';
import {createAccountAdminHandler} from '../lib/account-admin-service.mjs';
const id='00000000-0000-0000-0000-000000000001',key='00000000-0000-0000-0000-000000000002';
const input={email:'New@Example.test',name:'New Senior',role:'senior',seniorIds:['S003'],allSeniors:false,idempotencyKey:key};
test('provisioning binds roles only to existing seniors and rejects privilege fields',()=>{
 assert.equal(validateAccountAction('create',input).email,'new@example.test');
 for(const changed of [{isAdmin:true},{seniorIds:['not-a-senior']},{role:'owner'},{role:'operations'},{seniorIds:[]},{role:'senior',seniorIds:['S001','S002']},{role:'family',allSeniors:true,seniorIds:[]}])assert.throws(()=>validateAccountAction('create',{...input,...changed}));
 assert.deepEqual(validateAccountAction('assign',{email:'family@example.test',role:'family',seniorIds:['S002','S001','S002'],allSeniors:false,idempotencyKey:key}).seniorIds,['S001','S002']);
 assert.throws(()=>validateAccountAction('password',{targetUserId:id,confirmReset:false,idempotencyKey:key}));
});
function fixture({admin=true,existing=false,replay=false,accounts=[]}={}){
 const calls=[];const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_server_only'};
 const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
 const handler=createAccountAdminHandler(env,{fetchImpl:async(url,options)=>{const body=options.body?JSON.parse(options.body):null;calls.push({url,body,headers:options.headers});
  if(url.endsWith('/auth/v1/user'))return json({id});
  if(url.endsWith('/rpc/care_account_directory'))return admin?json([{userId:id,isAdmin:true,status:'active'},...accounts]):json({error:'forbidden'},403);
  if(url.endsWith('/rpc/care_admin_validate_identity'))return json({valid:true});
  if(url.endsWith('/rpc/care_admin_request'))return json(replay?{fresh:false,status:'completed',result:{ok:true,account:{email:input.email}}}:{fresh:true});
  if(url.endsWith('/rpc/care_admin_find_user'))return json(existing?{userId:id,email:input.email,confirmed:true}:null);
  if(url.includes('/auth/v1/admin/users/')&&options.method==='PUT')return json({id:url.split('/').at(-1)});
  if(url.endsWith('/auth/v1/admin/users'))return json({id:'00000000-0000-0000-0000-000000000003'});
  if(url.endsWith('/rpc/care_admin_onboard_senior'))return json({ok:true,account:{userId:body.target_user_id,email:input.email},senior:{id:'S100001'}});
  if(url.endsWith('/rpc/care_admin_apply'))return json({ok:true,account:{userId:body.target_user_id,email:input.email}});
  throw Error('Unexpected provider operation');
 }});
 const call=(payload=input,action='create')=>handler(new Request('https://project.supabase.co/functions/v1/account-admin',{method:'POST',headers:{'content-type':'application/json','x-samarth-user-token':'verified-user-token'},body:JSON.stringify({action,payload})}));return {call,calls};
}
test('only a live administrator can reach privileged provisioning',async()=>{const f=fixture({admin:false});assert.equal((await f.call()).status,403);assert.ok(f.calls.every(c=>!c.url.includes('/admin/')&&!c.url.includes('care_admin_')));});

test('email changes bind the account identity and invalidate access through the audited apply path',async()=>{
 const target='00000000-0000-0000-0000-000000000003';const f=fixture({accounts:[{userId:target,email:'old@example.test',roles:['family'],isAdmin:false,status:'active'}]});
 const payload={targetUserId:target,email:'NEW@example.test',currentEmail:'old@example.test',confirmEmailChange:true,idempotencyKey:key};
 assert.equal((await f.call(payload,'email')).status,200);
 assert.deepEqual(f.calls.find(c=>c.url.endsWith('/admin/users/'+target)).body,{email:'new@example.test',email_confirm:true});
 const apply=f.calls.find(c=>c.url.endsWith('/care_admin_apply'));assert.equal(apply.body.operation,'email');assert.equal(apply.body.target_user_id,target);assert.ok(!Object.hasOwn(apply.body.details,'password'));
 const stale=fixture({accounts:[{userId:target,email:'changed@example.test',roles:['family'],isAdmin:false,status:'active'}]});assert.equal((await stale.call(payload,'email')).status,409);assert.ok(!stale.calls.some(c=>c.url.includes('/admin/users/')));
});
test('email changes reject unconfirmed ownership, protected owner and foreign fields',async()=>{
 const payload={targetUserId:id,email:'new@example.test',currentEmail:'old@example.test',confirmEmailChange:true,idempotencyKey:key};
 for(const change of [{confirmEmailChange:false},{email:'invalid'},{email:'old@example.test'},{password:'should never go here'},{role:'operations'}])assert.throws(()=>validateAccountAction('email',{...payload,...change}));
 assert.equal((await fixture().call(payload,'email')).status,403);
 const f=fixture({replay:true,accounts:[{userId:'00000000-0000-0000-0000-000000000003',email:'old@example.test',isAdmin:false,status:'active'}]});
 assert.equal((await f.call({...payload,targetUserId:'00000000-0000-0000-0000-000000000003'},'email')).status,200);assert.ok(!f.calls.some(c=>c.url.includes('/admin/users/')));
});
test('creation returns a strong initial password once without storing it in administration records',async()=>{const f=fixture();const response=await f.call();assert.equal(response.status,200);const result=await response.json();assert.ok(result.initialPassword.length>=40);assert.equal(result.emailSent,false);const create=f.calls.find(c=>c.url.endsWith('/admin/users'));assert.equal(create.body.password,result.initialPassword);assert.ok(f.calls.filter(c=>c.url.includes('/rpc/')).every(c=>!JSON.stringify(c.body).includes(result.initialPassword)));assert.equal(response.headers.get('cache-control'),'no-store');});
test('replay does not create a second user or disclose an initial password',async()=>{const f=fixture({replay:true});const response=await f.call();assert.equal(response.status,200);assert.equal((await response.json()).initialPassword,null);assert.ok(!f.calls.some(c=>c.url.includes('/admin/users')));});
test('an existing email is never silently overwritten or assigned a new password',async()=>{const f=fixture({existing:true});assert.equal((await f.call()).status,409);assert.ok(!f.calls.some(c=>c.url.includes('/admin/users')));});
test('the sole administrator cannot be reset through account provisioning',async()=>{const f=fixture();const response=await f.call({targetUserId:id,confirmReset:true,idempotencyKey:key},'password');assert.equal(response.status,403);assert.ok(!f.calls.some(c=>c.url.includes('/admin/users')));});

test('account deletion requires explicit confirmation, a request key and no privilege fields',()=>{
 assert.throws(()=>validateAccountAction('delete',{targetUserId:id,confirmDelete:false,idempotencyKey:key}));
 assert.throws(()=>validateAccountAction('delete',{targetUserId:id,confirmDelete:true}));
 assert.throws(()=>validateAccountAction('delete',{targetUserId:id,confirmDelete:true,idempotencyKey:key,deleteHealthRecords:true}));
 assert.equal(validateAccountAction('delete',{targetUserId:id,confirmDelete:true,idempotencyKey:key}).confirmDelete,true);
});
test('deletion disables access before Auth soft deletion, preserves provenance and completes the audit transaction',async()=>{
 const target='00000000-0000-0000-0000-000000000003',calls=[];
 const handler=createAccountAdminHandler({SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_private'},{fetchImpl:async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,body,method:options.method});
  const value=url.endsWith('/auth/v1/user')?{id}:url.endsWith('/care_account_directory')?[{userId:id,isAdmin:true,status:'active'},{userId:target,isAdmin:false,status:'active'}]:url.endsWith('/care_admin_request')?{fresh:true}:url.endsWith('/care_admin_delete_access')?{ok:true,email:'removed@example.test'}:url.endsWith('/care_admin_delete_complete')?{ok:true,deleted:true}:{id:target};
  return new Response(JSON.stringify(value),{status:200});
 }});
 const result=await handler(new Request('https://project.supabase.co/functions/v1/account-admin',{method:'POST',headers:{'content-type':'application/json','x-samarth-user-token':'test-token'},body:JSON.stringify({action:'delete',payload:{targetUserId:target,confirmDelete:true,idempotencyKey:key}})}));
 assert.equal(result.status,200);assert.equal((await result.json()).recordsRetained,true);
 const access=calls.findIndex(c=>c.url.endsWith('/care_admin_delete_access')),auth=calls.findIndex(c=>c.method==='DELETE'),complete=calls.findIndex(c=>c.url.endsWith('/care_admin_delete_complete'));
 assert.ok(access<auth&&auth<complete);assert.deepEqual(calls[auth].body,{should_soft_delete:true});
 assert.ok(calls.every(c=>!c.url.includes('care_events')&&!c.url.includes('care_vitals')));
});
test('the Operations owner cannot be deleted through the console',async()=>{
 const f=fixture();const response=await f.call({targetUserId:id,confirmDelete:true,idempotencyKey:key},'delete');assert.equal(response.status,403);assert.ok(!f.calls.some(c=>c.url.includes('/admin/users')));
});


test('new senior onboarding never accepts another person’s care record or role',()=>{
 const good={email:'new@example.test',name:'New Senior',age:72,city:'Pune',language:'Hindi',idempotencyKey:key};
 assert.equal(validateAccountAction('onboard',good).age,72);
 for(const change of [{seniorId:'S001'},{seniorIds:['S001']},{role:'senior'},{age:59},{age:121},{city:''},{language:'other'}])assert.throws(()=>validateAccountAction('onboard',{...good,...change}));
 assert.equal(validateAccountAction('create',{...input,seniorIds:['S100001']}).seniorIds[0],'S100001');
});
test('chosen initial passwords reach only Auth, never care storage or response credentials',async()=>{
 const f=fixture(),chosen='A chosen secure password 47!';
 const response=await f.call({...input,password:chosen});assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.initialPassword,null);assert.equal(result.passwordChosen,true);
 const created=f.calls.find(c=>c.url.endsWith('/admin/users'));assert.equal(created.body.password,chosen);
 assert.ok(f.calls.filter(c=>c.url.includes('/rpc/')).every(c=>!JSON.stringify(c.body).includes(chosen)&&!Object.hasOwn(c.body.details||{},'password')));
});
test('new senior account calls its own-record onboarding RPC and returns generated credentials once',async()=>{
 const f=fixture();const response=await f.call({email:'new@example.test',name:'New Senior',age:74,city:'Pune',language:'English',idempotencyKey:key},'onboard');
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.senior.id,'S100001');assert.ok(result.initialPassword.length>=40);
 assert.ok(f.calls.some(c=>c.url.endsWith('/care_admin_onboard_senior')));assert.ok(!f.calls.some(c=>c.url.endsWith('/care_admin_apply')));
});
test('chosen passwords require 12–128 characters and cannot be assignment fields',()=>{
 for(const password of ['short','x'.repeat(129),123])assert.throws(()=>validateAccountAction('create',{...input,password}));
 assert.throws(()=>validateAccountAction('assign',{email:input.email,role:'family',seniorIds:['S001'],allSeniors:false,idempotencyKey:key,password:'long enough password'}));
 assert.equal(validateAccountAction('password',{targetUserId:id,confirmReset:true,idempotencyKey:key,password:'A secure password 47!'}).password,'A secure password 47!');
});


test('Operations can set a subordinate password without persisting or returning the chosen value',async()=>{
 const target='00000000-0000-0000-0000-000000000003',chosen='A manually chosen password 83!';
 const f=fixture({accounts:[{userId:target,email:'family@example.test',roles:['family'],isAdmin:false,status:'active',seniorIds:['S001']}]});
 const response=await f.call({targetUserId:target,password:chosen,confirmReset:true,idempotencyKey:key},'password');assert.equal(response.status,200);const result=await response.json();assert.equal(result.initialPassword,null);assert.equal(result.passwordChosen,true);
 const update=f.calls.find(c=>c.url.endsWith('/admin/users/'+target));assert.deepEqual(update.body,{password:chosen});
 assert.ok(f.calls.filter(c=>c.url.includes('/rpc/')).every(c=>!JSON.stringify(c.body).includes(chosen)));
 assert.ok(!JSON.stringify(result).includes(chosen));
});

test('password changes support each subordinate identity without changing care assignments',async()=>{
 const target='00000000-0000-0000-0000-000000000003',chosen='A new private password 59!';
 for(const role of ['senior','family','coordinator']){
  const f=fixture({accounts:[{userId:target,email:role+'@example.test',roles:[role],isAdmin:false,status:'active',seniorIds:['S001']}]});
  const response=await f.call({targetUserId:target,password:chosen,confirmReset:true,idempotencyKey:key},'password');
  assert.equal(response.status,200,role);const result=await response.json();assert.equal(result.passwordChosen,true);
  const applied=f.calls.find(c=>c.url.endsWith('/care_admin_apply'));
  assert.equal(applied.body.operation,'password');assert.equal(applied.body.target_user_id,target);
  assert.ok(!Object.hasOwn(applied.body.details,'role'));assert.ok(!Object.hasOwn(applied.body.details,'seniorIds'));
  assert.ok(!f.calls.some(c=>c.url.endsWith('/care_admin_validate_identity')||c.url.endsWith('/care_admin_find_user')));
 }
});

test('a completed password reset replay neither changes Auth again nor confirms a newly typed password',async()=>{
 const target='00000000-0000-0000-0000-000000000003',chosen='A different typed password 86!';
 const f=fixture({replay:true,accounts:[{userId:target,email:'family@example.test',roles:['family'],isAdmin:false,status:'active',seniorIds:['S001']}]});
 const response=await f.call({targetUserId:target,password:chosen,confirmReset:true,idempotencyKey:key},'password');
 assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.credentialsAlreadyShown,true);assert.equal(result.initialPassword,null);assert.notEqual(result.passwordChosen,true);
 assert.ok(!JSON.stringify(result).includes(chosen));assert.ok(!f.calls.some(c=>c.url.includes('/auth/v1/admin/users/')));
 assert.ok(!f.calls.some(c=>c.url.endsWith('/care_admin_apply')));
});

test('a generated subordinate password is returned once and excluded from all care RPCs',async()=>{
 const target='00000000-0000-0000-0000-000000000003';
 const f=fixture({accounts:[{userId:target,email:'senior@example.test',roles:['senior'],isAdmin:false,status:'active',seniorIds:['S001']}]});
 const response=await f.call({targetUserId:target,confirmReset:true,idempotencyKey:key},'password');
 assert.equal(response.status,200);const result=await response.json();assert.ok(result.initialPassword.length>=40);assert.equal(result.passwordChosen,false);
 assert.equal(f.calls.find(c=>c.url.endsWith('/auth/v1/admin/users/'+target)).body.password,result.initialPassword);
 assert.ok(f.calls.filter(c=>c.url.includes('/rpc/')).every(c=>!JSON.stringify(c.body).includes(result.initialPassword)));
 assert.equal(response.headers.get('cache-control'),'no-store');
});
