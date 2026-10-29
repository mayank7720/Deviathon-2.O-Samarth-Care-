import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceJobStore,createDailyCareHandler } from '../lib/service-job-store.mjs';

const jwt=role=>`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({role})).toString('base64url')}.synthetic_signature`;
const env={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_ANON_KEY:jwt('anon'),SUPABASE_SERVICE_ROLE_KEY:jwt('service_role')};
const secret='synthetic-only-private-job-secret-32plus';
function provider({valid=true,status=200,jobConfiguration={}}={}) {const calls=[];return {calls,fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,options,body});const validation=url.endsWith('/care_validate_job_secret');return new Response(JSON.stringify(validation?valid:url.endsWith('/care_job_configuration')?jobConfiguration:body.operation==='members_get'?[]:{ok:true}),{status:validation?status:200});}};}
test('service store remains locked until service-only job credential validation succeeds',async()=>{
  const p=provider(),db=createServiceJobStore(env,p);
  await assert.rejects(db.workflow('members_get',{workspaceId:'primary'}),e=>e.status===403);assert.equal(p.calls.length,0);
  await db.validateJobSecret(secret);const result=await db.workflow('members_get',{workspaceId:'primary'});assert.deepEqual(result,[]);
  assert.equal(p.calls[0].url,'https://synthetic.supabase.co/rest/v1/rpc/care_validate_job_secret');assert.deepEqual(p.calls[0].body,{secret});
  for(const call of p.calls){assert.equal(call.options.headers.apikey,env.SUPABASE_ANON_KEY);assert.equal(call.options.headers.Authorization,`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);assert.equal(call.options.redirect,'manual');}
  await db.workflow('consents_seed',{owner:'workspace:primary',consents:[{seniorId:'S001',allowed:true}],updatedAt:'2026-10-28T00:00:00Z'});
  assert.equal(p.calls.at(-1).body.operation,'consents_seed');
});
test('failed validation cannot open the service store and never calls care operations',async()=>{
  const p=provider({valid:false}),db=createServiceJobStore(env,p);await assert.rejects(db.validateJobSecret(secret),e=>e.status===401);await assert.rejects(db.workflow('members_get',{}),e=>e.status===403);assert.equal(p.calls.length,1);
});
test('modern automatic key dictionaries use the secret apikey without a Bearer header',async()=>{
  const p=provider();const modern={SUPABASE_URL:env.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'sb_publishable_synthetic_public_01234567890'}),SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_synthetic_private_012345678901234567890'})};
  const db=createServiceJobStore(modern,p);await db.validateJobSecret(secret);await db.workflow('members_get',{});
  for(const call of p.calls){assert.equal(call.options.headers.apikey,'sb_secret_synthetic_private_012345678901234567890');assert.equal(call.options.headers.Authorization,undefined);}
});
test('opaque secret credentials in the legacy slot also avoid JWT parsing and Bearer forwarding',async()=>{
  const p=provider();const db=createServiceJobStore({...env,SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic_private_012345678901234567890'},p);await db.validateJobSecret(secret);
  assert.equal(p.calls[0].options.headers.apikey,'sb_secret_synthetic_private_012345678901234567890');assert.equal(p.calls[0].options.headers.Authorization,undefined);
});
test('job configuration is private and read only after the job credential is verified',async()=>{
  const p=provider(),db=createServiceJobStore(env,p);await assert.rejects(db.jobConfiguration(),e=>e.status===403);assert.equal(p.calls.length,0);
  await db.validateJobSecret(secret);await db.jobConfiguration();assert.equal(p.calls.at(-1).url,'https://synthetic.supabase.co/rest/v1/rpc/care_job_configuration');assert.deepEqual(p.calls.at(-1).body,{});
});
test('background store rejects user JWTs, insecure origins and arbitrary operations',async()=>{
  assert.throws(()=>createServiceJobStore({...env,SUPABASE_SERVICE_ROLE_KEY:jwt('authenticated')}),e=>e.status===503);
  assert.throws(()=>createServiceJobStore({...env,SUPABASE_URL:'http://synthetic.supabase.co'}),e=>e.status===503);
  assert.throws(()=>createServiceJobStore({...env,SUPABASE_URL:'https://synthetic.supabase.co/extra'}),e=>e.status===503);
  const p=provider(),db=createServiceJobStore(env,p);await db.validateJobSecret(secret);
  assert.throws(()=>db.workflow('runtime_set',{owner:'evil'}),e=>e.status===403);
  assert.throws(()=>db.prepare('DELETE FROM care_events'),e=>e.status===403);
});
test('background event compatibility accepts only one fixed named insertion',async()=>{
  const p=provider(),db=createServiceJobStore(env,p);await db.validateJobSecret(secret);
  await db.prepare('INSERT INTO care_events (id,owner,kind,senior_id,payload,created_at) VALUES (?,?,?,?,?,?)').bind('synthetic','workspace:primary','audit','S001','{}','2026-10-28').run();
  assert.deepEqual(p.calls.at(-1).body.commands,[{op:'event_insert',args:['synthetic','workspace:primary','audit','S001','{}','2026-10-28']}]);
  await assert.rejects(db.batch([{op:'members_revoke',args:[]}]),e=>e.status===403);
});
test('Edge handler rejects missing credentials and arbitrary job parameters without invoking the job',async()=>{
  const p=provider();let ran=0;const handler=createDailyCareHandler(env,async()=>{ran++;return {};},p);
  assert.equal((await handler(new Request('https://synthetic.supabase.co/functions/v1/daily-care',{method:'POST',body:'{}'}))).status,401);
  assert.equal((await handler(new Request('https://synthetic.supabase.co/functions/v1/daily-care',{method:'GET'}))).status,405);
  const response=await handler(new Request('https://synthetic.supabase.co/functions/v1/daily-care',{method:'POST',headers:{'x-samarth-job-secret':secret},body:JSON.stringify({url:'https://external.example',workspace:'other'})}));assert.equal(response.status,400);assert.equal(ran,0);assert.equal(p.calls.length,0);
});
test('Edge handler verifies private credential before care processing and returns only operational status',async()=>{
  const p=provider();let ran=0;const handler=createDailyCareHandler(env,async(db,settings)=>{ran++;assert.equal(settings.SUPABASE_URL,env.SUPABASE_URL);await db.workflow('members_get',{});return {job:{id:'daily:workspace:primary:2026-10-28',status:'completed',date:'2026-10-28'},deliveriesQueued:2,delivery:{delivered:1,failed:0,blocked:1},scores:[{name:'must not leak'}],secret:'must not leak'};},p);
  const response=await handler(new Request('https://synthetic.supabase.co/functions/v1/daily-care',{method:'POST',headers:{'x-samarth-job-secret':secret},body:'{}'}));const result=await response.json();assert.equal(response.status,200);assert.equal(result.ok,true);assert.equal(ran,1);assert.equal(result.delivery.delivered,1);assert.equal(result.scores,undefined);assert.equal(result.secret,undefined);
});
test('Edge private configuration adds only notification keys and cannot redirect database access',async()=>{
  const p=provider({jobConfiguration:{VAPID_PUBLIC_KEY:'synthetic-public',VAPID_PRIVATE_KEY:'synthetic-private',VAPID_SUBJECT:'mailto:demo@example.test',SUPABASE_URL:'https://untrusted.example'}});
  const handler=createDailyCareHandler(env,async(_db,settings)=>{assert.equal(settings.SUPABASE_URL,env.SUPABASE_URL);assert.equal(settings.VAPID_PRIVATE_KEY,'synthetic-private');return {};},p);
  const response=await handler(new Request('https://synthetic.supabase.co/functions/v1/daily-care',{method:'POST',headers:{'x-samarth-job-secret':secret},body:'{}'}));assert.equal(response.status,200);assert.ok(!JSON.stringify(await response.json()).includes('synthetic-private'));
  assert.ok(p.calls.every(call=>call.url.startsWith(env.SUPABASE_URL)));
});
test('Edge handler rejects invalid secrets, oversized streamed bodies and sanitizes failures',async()=>{
  const invalid=provider({valid:false});let ran=0;const bad=createDailyCareHandler(env,async()=>{ran++;return {};},invalid);
  assert.equal((await bad(new Request('https://synthetic.supabase.co/functions/v1/daily-care',{method:'POST',headers:{'x-samarth-job-secret':secret},body:'{}'}))).status,401);assert.equal(ran,0);
  assert.equal((await bad(new Request('https://synthetic.supabase.co/functions/v1/daily-care',{method:'POST',headers:{'x-samarth-job-secret':secret},body:' '.repeat(1025)}))).status,413);
  const failure=createDailyCareHandler(env,async()=>{throw new Error('sensitive internal details');},provider());
  const response=await failure(new Request('https://synthetic.supabase.co/functions/v1/daily-care',{method:'POST',headers:{'x-samarth-job-secret':secret},body:'{}'}));assert.equal(response.status,500);assert.ok(!JSON.stringify(await response.json()).includes('sensitive'));
});
