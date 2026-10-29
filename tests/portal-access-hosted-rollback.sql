-- Run as the database administrator after the portal access migration.
-- Synthetic identities have no password. No Auth API, email, call or SMS is used.
begin;
create temporary table portal_access_fixture(a uuid,f uuid,s uuid,r uuid,w uuid,c uuid,d uuid,p text,t1 text,t2 text,t3 text,t4 text,request_id uuid) on commit drop;
grant select on portal_access_fixture to authenticated,service_role;
create function pg_temp.portal_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'Portal access regression: %',label;end if;end$$;
do $$declare a uuid;f uuid:=gen_random_uuid();s uuid:=gen_random_uuid();r uuid:=gen_random_uuid();w uuid:=gen_random_uuid();c uuid:=gen_random_uuid();d uuid:=gen_random_uuid();p text:='portal-rollback-'||gen_random_uuid();stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');begin
 select owner_user_id::uuid into a from public.care_workspaces where id='primary';
 if a is null then raise exception 'An existing Operations owner is required for this rollback test';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','iat',extract(epoch from now())::bigint+10)::text,true);
 insert into portal_access_fixture values(a,f,s,r,w,c,d,p,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),gen_random_uuid());
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) select id,p||'-'||label||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from(values(f,'family'),(s,'senior'),(r,'recipient'),(w,'wrong'),(c,'coordinator'),(d,'deleted'))x(id,label);
 insert into public.care_workspaces values('primary',a::text,stamp) on conflict do nothing;
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values
 (p||'-f','primary',f::text,p||'-family@example.invalid','Rollback family','family','S900001','["S900001"]',0,'active',stamp),
 (p||'-s','primary',s::text,p||'-senior@example.invalid','Rollback senior','senior','S900001','["S900001"]',0,'active',stamp),
 (p||'-c','primary',c::text,p||'-coordinator@example.invalid','Rollback coordinator','coordinator','','["S900001"]',0,'active',stamp),
 (p||'-d','primary',d::text,p||'-deleted@example.invalid','Rollback deletion','family','S900001','["S900001"]',0,'active',stamp);
 insert into public.care_consents values('workspace:primary','S900001',true,s::text,stamp);
 insert into public.care_daily_scores values('workspace:primary','S900001','2026-10-29','portal-rollback','{}',stamp);
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(p||'-history','workspace:primary','signal','S900001','{"type":"note","record":{"date":"2026-10-29","note":"Synthetic retained history"}}',stamp);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',s,'role','authenticated','iat',extract(epoch from now())::bigint+10)::text,true) from portal_access_fixture;
select pg_temp.portal_assert(public.care_household('list','{"role":"senior"}')#>>'{role}'='senior','senior household list');
select public.care_household('invite',jsonb_build_object('role','senior','id',p||'-invite','email',p||'-recipient@example.invalid','seniorId','S900001','tokenHash',t1,'expiresAt',(extract(epoch from now())*1000)::bigint+3600000)) from portal_access_fixture;
do $$begin
 begin perform public.care_manage_invitation('delete','anything','{}');raise exception 'Senior managed admin invitation history';exception when insufficient_privilege then null;end;
 begin perform public.care_household('invite',jsonb_build_object('role','senior','id','bad','email','other@example.invalid','seniorId','S900002','tokenHash',repeat('b',64),'expiresAt',(extract(epoch from now())*1000)::bigint+3600000));raise exception 'Senior claimed arbitrary record';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',w,'role','authenticated','iat',extract(epoch from now())::bigint+10)::text,true) from portal_access_fixture;
do $$begin begin perform public.care_accept_invitation((select t1 from portal_access_fixture),'Wrong recipient');raise exception 'Wrong email accepted invitation';exception when insufficient_privilege then null;end;end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',r,'role','authenticated','iat',extract(epoch from now())::bigint+10)::text,true) from portal_access_fixture;
select pg_temp.portal_assert(public.care_accept_invitation(t1,'Invited family')->>'ok'='true','matching recipient accepts') from portal_access_fixture;
select pg_temp.portal_assert(public.care_accept_invitation(t1,'Invited family')->>'ok'='false','accepted token cannot replay') from portal_access_fixture;
select pg_temp.portal_assert(private.care_has('S900001',array['family']) and not private.care_has('S900001',array['coordinator','operations']),'accepted role cannot promote');
select set_config('request.jwt.claims',jsonb_build_object('sub',s,'role','authenticated','iat',extract(epoch from now())::bigint+10)::text,true) from portal_access_fixture;
select public.care_household('invite',jsonb_build_object('role','senior','id',p||'-consent-invite','email',p||'-wrong@example.invalid','seniorId','S900001','tokenHash',t4,'expiresAt',(extract(epoch from now())*1000)::bigint+3600000)) from portal_access_fixture;
reset role;
update public.care_consents set family_allowed=false where senior_id='S900001' and owner='workspace:primary';
set local role authenticated;
do $$begin begin perform public.care_household('invite',jsonb_build_object('role','senior','id','withdrawn','email','relative@example.invalid','seniorId','S900001','tokenHash',repeat('f',64),'expiresAt',(extract(epoch from now())*1000)::bigint+3600000));raise exception 'Invitation bypassed senior sharing consent';exception when insufficient_privilege then null;end;end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',w,'role','authenticated','iat',extract(epoch from now())::bigint+10)::text,true) from portal_access_fixture;
select pg_temp.portal_assert(public.care_accept_invitation(t4,'Wrong')->>'ok'='false','consent withdrawal blocks pending household invitation') from portal_access_fixture;
reset role;
update public.care_consents set family_allowed=true where senior_id='S900001' and owner='workspace:primary';
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',f,'role','authenticated','iat',extract(epoch from now())::bigint+10)::text,true) from portal_access_fixture;
do $$begin
 begin perform public.care_household('invite',jsonb_build_object('role','family','id','bad','email','other@example.invalid','seniorId','S900002','tokenHash',repeat('c',64),'expiresAt',(extract(epoch from now())*1000)::bigint+3600000));raise exception 'Family claimed arbitrary senior';exception when insufficient_privilege then null;end;
 begin perform public.care_household('remove_link',jsonb_build_object('role','family','id',(select p||'-c' from portal_access_fixture)));raise exception 'Family changed coordinator';exception when insufficient_privilege then null;end;
 begin perform public.care_household('invite',jsonb_build_object('role','family','id','bad','email','replacement@example.invalid','seniorId','S900001','tokenHash',repeat('d',64),'expiresAt',(extract(epoch from now())*1000)::bigint+3600000));raise exception 'Family replaced existing senior identity';exception when unique_violation then null;end;
end $$;
select public.care_household('remove_link',jsonb_build_object('role','family','id',p||'-f')) from portal_access_fixture;
select pg_temp.portal_assert(not private.care_has('S900001',array['family']),'family unlink immediately revokes scope');
reset role;
select pg_temp.portal_assert(exists(select 1 from auth.users where id=(select s from portal_access_fixture)) and exists(select 1 from public.care_memberships where id=(select p||'-c' from portal_access_fixture) and status='active'),'unlink retains senior identity and care team');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','iat',extract(epoch from now())::bigint+10)::text,true) from portal_access_fixture;
select public.care_manage_invitation('create',p||'-admin-invite',jsonb_build_object('email',p||'-wrong@example.invalid','role','family','seniorId','S900001','scope',jsonb_build_array('S900001'),'tokenHash',t2,'expiresAt',(extract(epoch from now())*1000)::bigint+3600000)) from portal_access_fixture;
select public.care_manage_invitation('update',p||'-admin-invite',jsonb_build_object('email',p||'-wrong@example.invalid','role','family','seniorId','S900001','scope',jsonb_build_array('S900001'),'tokenHash',t3,'expiresAt',(extract(epoch from now())*1000)::bigint+3600000)) from portal_access_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',w,'role','authenticated','iat',extract(epoch from now())::bigint+10)::text,true) from portal_access_fixture;
select pg_temp.portal_assert(public.care_accept_invitation(t2,'Wrong')->>'ok'='false','edited invitation invalidates old link') from portal_access_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','iat',extract(epoch from now())::bigint+10)::text,true) from portal_access_fixture;
select public.care_manage_invitation('delete',p||'-admin-invite','{}') from portal_access_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',w,'role','authenticated','iat',extract(epoch from now())::bigint+10)::text,true) from portal_access_fixture;
select pg_temp.portal_assert(public.care_accept_invitation(t3,'Wrong')->>'ok'='false','history removal revokes unused link') from portal_access_fixture;
reset role;
select pg_temp.portal_assert(exists(select 1 from public.care_invitations where id=(select p||'-admin-invite' from portal_access_fixture) and deleted_at is not null and status='revoked'),'history removal retains row');
select pg_temp.portal_assert((select count(*)>=3 from public.care_events where kind='audit' and payload->>'invitationId'=(select p||'-admin-invite' from portal_access_fixture)),'invitation edits retain audit');
-- No provider call: test the two database phases around simulated Auth soft deletion.
set local role service_role;
select public.care_admin_request(a,request_id,'delete',repeat('e',64)) from portal_access_fixture;
select public.care_admin_delete_access(a,d,request_id) from portal_access_fixture;
do $$begin begin perform public.care_admin_delete_access((select a from portal_access_fixture),(select a from portal_access_fixture),(select request_id from portal_access_fixture));raise exception 'Owner deletion was allowed';exception when insufficient_privilege then null;end;end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated','iat',extract(epoch from now())::bigint+10)::text,true) from portal_access_fixture;
set local role authenticated;
select pg_temp.portal_assert(not private.care_has('S900001',array['family']),'deleted account JWT loses access immediately');
select pg_temp.portal_assert(public.care_account_self_state()->>'enabled'='false','deleted account sign-in disabled');
reset role;
update auth.users set deleted_at=now() where id=(select d from portal_access_fixture);
set local role service_role;
select pg_temp.portal_assert(public.care_admin_delete_complete(a,d,request_id)->>'deleted'='true','delete completion requires Auth deletion') from portal_access_fixture;
do $$begin begin perform public.care_admin_apply((select a from portal_access_fixture),(select d from portal_access_fixture),'restore','{}');raise exception 'Deleted identity restored';exception when insufficient_privilege then null;end;end $$;
reset role;
select pg_temp.portal_assert(exists(select 1 from public.care_events where id=(select p||'-history' from portal_access_fixture)),'care history retained after identity removal');
select 'PASS: household scope, verified recipients, role limits, unlink, invitation edit/revoke/history audit, owner protection and deletion RLS; all fixtures rolled back' as result;
rollback;
