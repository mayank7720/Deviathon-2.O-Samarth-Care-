/** Optional real Postgres/WASM regression: see docs/SUPABASE.md. No cloud data. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const modulePath=process.env.PGLITE_MODULE;
if(!modulePath)throw Error('Set PGLITE_MODULE to a separately installed @electric-sql/pglite module.');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;`);
await db.exec(readFileSync('supabase/migrations/20261027183015_care_backend.sql','utf8'));
// pg_cron/pg_net run only on hosted Supabase. Stub the scheduler's private
// throttle table to verify the subsequent policy-only migration in PostgreSQL.
await db.exec('create table private.care_job_dispatch(singleton boolean primary key,last_dispatched_at timestamptz);alter table private.care_job_dispatch enable row level security;');
await db.exec(readFileSync('supabase/migrations/20261028182927_care_policy_cleanup.sql','utf8'));
const ids={owner:'00000000-0000-0000-0000-000000000001',family:'00000000-0000-0000-0000-000000000002',scoped:'00000000-0000-0000-0000-000000000003',stranger:'00000000-0000-0000-0000-000000000004',unverified:'00000000-0000-0000-0000-000000000005',senior:'00000000-0000-0000-0000-000000000006'};
await db.query("insert into private.care_settings values('bootstrap_owner_email','owner@example.test')");
for(const [name,id] of Object.entries(ids))await db.query('insert into auth.users values($1,$2,$3)',[id,`${name}@example.test`,name==='unverified'?null:'2026-10-27']);
async function as(name,fn){await db.exec(`reset role;set role authenticated;`);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids[name],email:`${name}@example.test`,role:'authenticated',user_metadata:{role:'coordinator',is_admin:true}})]);try{return await fn();}finally{await db.exec('reset role');}}
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const rpc=async(op,payload={})=>(await one('select public.care_workflow($1,$2::jsonb) as result',[op,JSON.stringify({owner:'workspace:primary',...payload})])).result;
const command=async(op,args)=>(await one('select public.care_store_batch($1::jsonb) as result',[JSON.stringify([{op,args}])])).result;
assert.equal((await as('stranger',()=>one('select public.care_bootstrap_owner() as ok'))).ok,false);
assert.equal((await as('owner',()=>one('select public.care_bootstrap_owner() as ok'))).ok,true);
await as('owner',async()=>{
 await rpc('runtime_set',{mode:'replay',date:'2026-10-27',timezone:'Asia/Kolkata',updatedAt:'2026-10-27T00:00:00Z'});
 for(const id of ['S001','S002'])await rpc('consent_put',{seniorId:id,allowed:true,updatedAt:'2026-10-27T00:00:00Z'});
 await rpc('scores_put',{date:'2026-10-27',revision:'v1',computedAt:'2026-10-27',scores:['S001','S002'].map(seniorId=>({seniorId,payload:{secret:'raw clinical note',familySafe:{id:seniorId,message:'Your coordinator is checking in.'},seniorSafe:{id:seniorId,message:'Thank you for checking in.'}}}))});
 for(const [id,role,senior,scope,email] of [['invite-family','family','S001','["S001"]','family@example.test'],['invite-scoped','coordinator','','["S002"]','scoped@example.test'],['invite-unverified','family','S002','["S002"]','unverified@example.test'],['invite-senior','senior','S001','["S001"]','senior@example.test']])await command('invites_insert',[id,'primary',id==='invite-family'?'a'.repeat(64):id==='invite-scoped'?'b'.repeat(64):id==='invite-unverified'?'c'.repeat(64):'d'.repeat(64),email,role,senior,scope,ids.owner,'pending',Date.now()+86400000,'2026-10-27']);
 await command('event_insert',['vital1','workspace:primary','signal','S001',JSON.stringify({type:'vitals',record:{date:'2026-10-27',vitals:{systolic:125,diastolic:80,glucose:98,spo2:97,weight:60}}}),'2026-10-27']);
 assert.equal((await one("select systolic from public.care_vitals where event_id='vital1'")).systolic,'125');
 await command('event_insert',['med1','workspace:primary','signal','S001',JSON.stringify({type:'medication',record:{date:'2026-10-27',medication:{prescribed:3,taken:2,doses:[{name:'Demonstration medicine',scheduledTime:'09:00',status:'missed'}]}}}),'2026-10-27']);
 assert.equal((await one("select taken_count from public.care_medication_logs where event_id='med1'")).taken_count,2);
 await command('event_insert',['vital2','workspace:primary','signal','S002',JSON.stringify({type:'note',record:{date:'2026-10-27',note:'I feel okay',source:'call'}}),'2026-10-27']);
});
await assert.rejects(()=>as('stranger',()=>one('select public.care_accept_invitation($1,$2)',['a'.repeat(64),'Fake'])),/Invited email/);
await assert.rejects(()=>as('unverified',()=>one('select public.care_accept_invitation($1,$2)',['c'.repeat(64),'Unverified'])),/Verified email/);
for(const [name,token] of [['family','a'],['scoped','b'],['senior','d']])assert.equal((await as(name,()=>one('select public.care_accept_invitation($1,$2) as result',[token.repeat(64),name]))).result.ok,true);
assert.equal((await as('family',()=>one('select public.care_accept_invitation($1,$2) as result',['a'.repeat(64),'Family']))).result.ok,false);
await as('family',async()=>{
 assert.equal((await db.query('select * from public.care_events')).rows.length,0);
 assert.equal((await db.query('select * from public.care_vitals')).rows.length,0);
 assert.equal((await db.query('select * from public.care_daily_scores')).rows.length,0);
 const allowed=await rpc('score_get',{seniorId:'S001',date:'2026-10-27'});assert.deepEqual(allowed.payload,{id:'S001',message:'Your coordinator is checking in.'});
 assert.equal(await rpc('score_get',{seniorId:'S002',date:'2026-10-27'}),null);
 assert.equal((await rpc('scores_get',{date:'2026-10-27',revision:'v1'})).length,1);
 await assert.rejects(()=>db.query("update public.care_memberships set is_admin=1"),/permission denied/);
 await assert.rejects(()=>rpc('consent_put',{seniorId:'S001',allowed:true,updatedAt:'today'}),/row-level security/);
 await assert.rejects(()=>command('event_insert',['evil','workspace:primary','signal','S002','{"type":"note","record":{"note":"hijack"}}','today']),/row-level security/);
});
await as('scoped',async()=>{
 const rows=(await db.query('select * from public.care_events')).rows;assert.equal(rows.length,1);assert.equal(rows[0].senior_id,'S002');
 assert.equal(await rpc('score_get',{seniorId:'S001',date:'2026-10-27'}),null);
 assert.equal((await rpc('score_get',{seniorId:'S002',date:'2026-10-27'})).payload.secret,'raw clinical note');
 await assert.rejects(()=>rpc('runtime_set',{mode:'live',date:'2026-10-27',timezone:'UTC',updatedAt:'today'}),/row-level security/);
});
await as('senior',async()=>{assert.equal((await rpc('score_get',{seniorId:'S001',date:'2026-10-27'})).payload.message,'Thank you for checking in.');assert.equal((await db.query('select * from public.care_notes')).rows.length,0);});
// Dispatch parity: drafts stay private, cursor ties preserve records, receipts
// cannot mutate delivery content, and only one competing sender gets a lease.
await as('owner',async()=>{
 await rpc('consents_seed',{consents:[{seniorId:'S001',allowed:false},{seniorId:'S003',allowed:false}],updatedAt:'seed'});
 assert.equal((await rpc('consents_get')).find(c=>c.senior_id==='S001').allowed,1);
 for(const [id,status] of [['draft','pending_review'],['notice1','queued'],['notice2','delivered']])await rpc('delivery_put',{id,seniorId:'S001',recipientRole:'family',userId:ids.family,kind:'weekly_summary',channel:'in_app',status,payload:{body:id},sourceId:id,createdAt:'2026-10-27T12:00:00Z'});
 const first=await rpc('deliveries_get',{limit:1,statuses:['queued','delivered'],userId:ids.family});assert.equal(first[0].id,'notice1');
 const second=await rpc('deliveries_get',{limit:1,statuses:['queued','delivered'],userId:ids.family,cursor:first[0].created_at,cursorId:first[0].id});assert.equal(second[0].id,'notice2');
 assert.deepEqual(await rpc('delivery_claim',{id:'notice1',attempts:0,claimedAt:'2026-10-27T12:01:00Z',expiredBefore:'2026-10-27T11:56:00Z'}),{claimed:true});
 assert.deepEqual(await rpc('delivery_claim',{id:'notice1',attempts:0,claimedAt:'2026-10-27T12:01:00Z',expiredBefore:'2026-10-27T11:56:00Z'}),{claimed:false});
 const seen={id:'seen:unique',seniorId:'S001',alertId:'alert1',firstSeenAt:'2026-10-27T12:00:00Z'};
 assert.equal((await rpc('alert_seen_put',seen)).firstSeenAt,seen.firstSeenAt);
 assert.equal((await rpc('alert_seen_put',{...seen,firstSeenAt:'later'})).firstSeenAt,seen.firstSeenAt);
});
await as('family',async()=>{
 assert.deepEqual((await db.query('select id from public.care_deliveries order by id')).rows,[{id:'notice2'}]);
 await rpc('delivery_read',{id:'notice2',userId:ids.family,recipientRole:'family',readAt:'2026-10-27T12:05:00Z'});
 assert.equal((await rpc('delivery_get',{id:'notice2'})).status,'read');
 await assert.rejects(()=>rpc('delivery_read',{id:'notice2',userId:ids.owner,recipientRole:'family',readAt:'evil'}),/permission denied|insufficient_privilege/);
 assert.equal((await rpc('members_get')).every(m=>m.user_id===ids.family),true);
 await assert.rejects(()=>db.query('select public.care_validate_job_secret($1)',['a'.repeat(64)]),/permission denied/);
 await assert.rejects(()=>db.query('select public.care_job_configuration()'),/permission denied/);
});
// Service capability is separate from normal user authorization and does not
// depend on a made-up auth.uid. No user can call the secret/config RPCs.
await db.exec("create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);insert into vault.decrypted_secrets values('samarth_vapid_public_key','public'),('samarth_vapid_private_key','private'),('samarth_vapid_subject','mailto:example@example.test');");
await db.query("insert into private.care_settings values('job_secret_hash',encode(sha256(convert_to($1,'UTF8')),'hex'))",['s'.repeat(64)]);
await db.exec('set role service_role');
await db.query("select set_config('request.jwt.claims','{}',false)");
assert.equal((await one('select public.care_validate_job_secret($1) as ok',['s'.repeat(64)])).ok,true);
assert.equal((await one('select public.care_validate_job_secret($1) as ok',['x'.repeat(64)])).ok,false);
assert.equal((await one('select public.care_job_configuration() as config')).config.VAPID_PRIVATE_KEY,'private');
assert.equal((await rpc('score_get',{seniorId:'S001',date:'2026-10-27'})).payload.secret,'raw clinical note');
await rpc('consents_seed',{consents:[{seniorId:'S004',allowed:false}],updatedAt:'background'});
await command('event_insert',['background-seen','workspace:primary','alert_seen','S001','{"alertId":"background","firstSeenAt":"now"}','now']);
await db.exec('reset role');
await as('owner',()=>rpc('consent_put',{seniorId:'S001',allowed:false,updatedAt:'later'}));
await as('family',async()=>{assert.equal(await rpc('score_get',{seniorId:'S001',date:'2026-10-27'}),null);assert.equal((await db.query('select * from public.care_deliveries')).rows.length,0);});
await as('owner',()=>command('members_revoke',['revoked','primary',ids.scoped,'coordinator','']));
await as('scoped',async()=>{assert.equal((await db.query('select * from public.care_events')).rows.length,0);assert.equal(await rpc('score_get',{seniorId:'S002',date:'2026-10-27'}),null);});
await db.exec('set role anon');await assert.rejects(()=>db.query('select * from public.care_events'),/permission denied/);await assert.rejects(()=>db.query("select public.care_store_batch('[]')"),/permission denied/);
await db.close();
console.log('Postgres schema + verified invitations + RLS + consent + scope + revocation passed.');
