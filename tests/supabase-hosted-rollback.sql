-- Run as the trusted database administrator, never as a browser RPC.
-- Every fixture and change is rolled back. pg_net sends only after commit,
-- so the scheduler triggers below cannot dispatch an external request.
begin;
create temporary table care_rls_fixture(admin_id uuid,family_id uuid,scoped_id uuid,operations_id uuid,senior_id uuid,prefix text) on commit drop;
grant select on care_rls_fixture to authenticated;
create function pg_temp.care_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'RLS regression failed: %',label;end if;end$$;

do $setup$
declare a uuid:=gen_random_uuid();f uuid:=gen_random_uuid();c uuid:=gen_random_uuid();o uuid:=gen_random_uuid();s uuid:=gen_random_uuid();p text:='rollback-'||gen_random_uuid()::text;stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 insert into care_rls_fixture values(a,f,c,o,s,p);
 -- Synthetic accounts have no usable password and cause no email delivery.
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 select id,p||'-'||label||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from (values(a,'admin'),(f,'family'),(c,'scoped'),(o,'operations'),(s,'senior')) x(id,label);
 insert into public.care_workspaces(id,owner_user_id,created_at) values('primary',a::text,stamp) on conflict(id) do nothing;
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values
 (p||'-admin','primary',a::text,p||'-admin@example.invalid','Synthetic test admin','coordinator','','["*"]',1,'active',stamp),
 (p||'-family','primary',f::text,p||'-family@example.invalid','Synthetic test family','family','S999998','["S999998"]',0,'active',stamp),
 (p||'-scoped','primary',c::text,p||'-scoped@example.invalid','Synthetic test coordinator','coordinator','','["S999999"]',0,'active',stamp),
 (p||'-operations','primary',o::text,p||'-operations@example.invalid','Synthetic test operations','operations','','["S999999"]',0,'active',stamp),
 (p||'-senior','primary',s::text,p||'-senior@example.invalid','Synthetic test senior','senior','S999998','["S999998"]',0,'active',stamp);
end $setup$;

set local role authenticated;
select set_config('request.jwt.claim.sub',admin_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true) from care_rls_fixture;
select public.care_workflow('consents_seed','{"owner":"workspace:primary","consents":[{"seniorId":"S999998","allowed":true},{"seniorId":"S999999","allowed":true}],"updatedAt":"2026-10-29T00:00:00Z"}');
select public.care_workflow('scores_put','{"owner":"workspace:primary","date":"2026-10-29","revision":"hosted-rls-regression","computedAt":"2026-10-29T00:00:00Z","scores":[{"seniorId":"S999998","payload":{"secret":"synthetic raw detail","familySafe":{"id":"S999998","message":"Safe family update"},"seniorSafe":{"id":"S999998","message":"Safe senior update"}}},{"seniorId":"S999999","payload":{"secret":"synthetic second detail","familySafe":{"id":"S999999"},"seniorSafe":{"id":"S999999"}}}]}');
select public.care_store_batch(jsonb_build_array(
 jsonb_build_object('op','event_insert','args',jsonb_build_array(prefix||'-vital1','workspace:primary','signal','S999998','{"type":"vitals","record":{"date":"2026-10-29","vitals":{"systolic":125,"glucose":98,"spo2":97}}}','2026-10-29T00:00:00Z')),
 jsonb_build_object('op','event_insert','args',jsonb_build_array(prefix||'-vital2','workspace:primary','signal','S999999','{"type":"vitals","record":{"date":"2026-10-29","vitals":{"systolic":130}}}','2026-10-29T00:00:00Z'))
)) from care_rls_fixture;
select public.care_workflow('delivery_put',jsonb_build_object('owner','workspace:primary','id',prefix||'-draft','seniorId','S999998','recipientRole','family','userId',family_id,'kind','weekly_summary','channel','in_app','status','pending_review','payload','{"body":"Synthetic private draft"}'::jsonb,'sourceId',prefix,'createdAt','2026-10-29T00:00:00Z')) from care_rls_fixture;
select public.care_workflow('delivery_put',jsonb_build_object('owner','workspace:primary','id',prefix||'-delivered','seniorId','S999998','recipientRole','family','userId',family_id,'kind','weekly_summary','channel','in_app','status','delivered','payload','{"body":"Synthetic approved update"}'::jsonb,'sourceId',prefix,'createdAt','2026-10-29T00:00:00Z')) from care_rls_fixture;

select set_config('request.jwt.claim.sub',family_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',family_id,'role','authenticated','user_metadata',jsonb_build_object('role','coordinator','is_admin',true))::text,true) from care_rls_fixture;
select pg_temp.care_assert((select count(*)=0 from public.care_events where senior_id in ('S999998','S999999')),'family raw event denial');
select pg_temp.care_assert((select count(*)=0 from public.care_vitals where senior_id in ('S999998','S999999')),'family typed vitals denial');
select pg_temp.care_assert((select count(*)=0 from public.care_daily_scores where senior_id in ('S999998','S999999')),'family full score denial');
select pg_temp.care_assert(public.care_workflow('score_get','{"owner":"workspace:primary","seniorId":"S999998","date":"2026-10-29"}')#>>'{payload,message}'='Safe family update','family safe cache');
select pg_temp.care_assert(public.care_workflow('score_get','{"owner":"workspace:primary","seniorId":"S999999","date":"2026-10-29"}') is null,'family other senior denial');
select pg_temp.care_assert((select count(*)=1 from public.care_deliveries where id in (prefix||'-draft',prefix||'-delivered')),'family draft hidden') from care_rls_fixture;
select public.care_workflow('delivery_read',jsonb_build_object('owner','workspace:primary','id',prefix||'-delivered','userId',family_id,'recipientRole','family','readAt','2026-10-29T00:05:00Z')) from care_rls_fixture;
select pg_temp.care_assert((select status='read' from public.care_deliveries where id=prefix||'-delivered'),'own receipt') from care_rls_fixture;
do $denials$ begin
 begin perform public.care_validate_job_secret(repeat('a',64));raise exception 'Family called service secret validator';exception when insufficient_privilege then null;end;
 begin perform public.care_job_configuration();raise exception 'Family read server configuration';exception when insufficient_privilege then null;end;
 begin perform public.care_workflow('consent_put','{"owner":"workspace:primary","seniorId":"S999998","allowed":false,"updatedAt":"test"}');raise exception 'Family changed consent';exception when insufficient_privilege then null;end;
end $denials$;

select set_config('request.jwt.claim.sub',scoped_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',scoped_id,'role','authenticated')::text,true) from care_rls_fixture;
select pg_temp.care_assert((select count(*)=1 from public.care_events where senior_id in ('S999998','S999999')),'coordinator scoped event count');
select pg_temp.care_assert(public.care_workflow('score_get','{"owner":"workspace:primary","seniorId":"S999998","date":"2026-10-29"}') is null,'coordinator other scope denial');
select pg_temp.care_assert(public.care_workflow('score_get','{"owner":"workspace:primary","seniorId":"S999999","date":"2026-10-29"}')#>>'{payload,secret}'='synthetic second detail','coordinator own clinical detail');
select set_config('request.jwt.claim.sub',operations_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',operations_id,'role','authenticated')::text,true) from care_rls_fixture;
select pg_temp.care_assert(public.care_workflow('score_get','{"owner":"workspace:primary","seniorId":"S999999","date":"2026-10-29"}')#>>'{payload,secret}'='synthetic second detail','operations assigned scope');
do $operations$ begin
 begin perform public.care_workflow('consent_put','{"owner":"workspace:primary","seniorId":"S999999","allowed":false,"updatedAt":"test"}');raise exception 'Operations modified care';exception when insufficient_privilege then null;end;
end $operations$;
select set_config('request.jwt.claim.sub',senior_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',senior_id,'role','authenticated')::text,true) from care_rls_fixture;
select pg_temp.care_assert(public.care_workflow('score_get','{"owner":"workspace:primary","seniorId":"S999998","date":"2026-10-29"}')#>>'{payload,message}'='Safe senior update','senior safe cache');

select set_config('request.jwt.claim.sub',admin_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true) from care_rls_fixture;
select public.care_workflow('consent_put','{"owner":"workspace:primary","seniorId":"S999998","allowed":false,"updatedAt":"2026-10-29T00:06:00Z"}');
select set_config('request.jwt.claim.sub',family_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',family_id,'role','authenticated')::text,true) from care_rls_fixture;
select pg_temp.care_assert(public.care_workflow('score_get','{"owner":"workspace:primary","seniorId":"S999998","date":"2026-10-29"}') is null,'consent withdrawal immediately blocks family');
select pg_temp.care_assert((select count(*)=0 from public.care_deliveries where senior_id='S999998'),'withdrawn family delivery denial');
select set_config('request.jwt.claim.sub',admin_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true) from care_rls_fixture;
update public.care_memberships set status='revoked' where user_id=(select scoped_id::text from care_rls_fixture);
select set_config('request.jwt.claim.sub',scoped_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',scoped_id,'role','authenticated')::text,true) from care_rls_fixture;
select pg_temp.care_assert(public.care_workflow('score_get','{"owner":"workspace:primary","seniorId":"S999999","date":"2026-10-29"}') is null,'revocation immediately blocks coordinator');

reset role;
select 'PASS: four roles, scope, raw-data denial, safe cache, private draft, receipt, consent, revocation; all fixtures rolled back' as regression_result;
rollback;
