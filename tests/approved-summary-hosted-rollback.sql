-- Approved recipient summaries only. No real account or delivery is changed.
begin;
do $$declare f uuid:=gen_random_uuid();s uuid:=gen_random_uuid();o uuid:=gen_random_uuid();c uuid:=gen_random_uuid();stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');result jsonb;
begin
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 select id,'summary-test-'||id||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from (values(f),(s),(o),(c))v(id);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values
 (gen_random_uuid()::text,'primary',f::text,'summary-test-'||f||'@example.invalid','Synthetic Family','family','S900301','["S900301"]',0,'active',stamp),
 (gen_random_uuid()::text,'primary',f::text,'summary-test-'||f||'@example.invalid','Synthetic Family','family','S900302','["S900302"]',0,'active',stamp),
 (s::text,'primary',s::text,'summary-test-'||s||'@example.invalid','Synthetic Senior','senior','S900301','["S900301"]',0,'active',stamp),
 (o::text,'primary',o::text,'summary-test-'||o||'@example.invalid','Other Family','family','S900303','["S900303"]',0,'active',stamp),
 (c::text,'primary',c::text,'summary-test-'||c||'@example.invalid','Care staff','coordinator','','["S900301"]',0,'active',stamp);
 insert into public.care_consents(owner,senior_id,family_allowed,actor_id,updated_at) values('workspace:primary','S900301',true,f::text,stamp),('workspace:primary','S900302',true,f::text,stamp),('workspace:primary','S900303',true,o::text,stamp);
 insert into public.care_deliveries(id,owner,senior_id,recipient_role,user_id,kind,channel,status,payload,source_id,created_at,delivered_at) values
 ('summary-fixture-pending-'||f,'workspace:primary','S900301','family',f::text,'weekly_summary','in_app','pending_review','{"summary":{"text":"UNAPPROVED DRAFT MUST NOT LEAK","period":{"from":"2026-10-23","to":"2026-10-29","days":7},"method":"LLM draft","privateRaw":"PRIVATE"}}','fixture',stamp,null),
 ('summary-fixture-safe-'||f,'workspace:primary','S900301','family',f::text,'weekly_summary','in_app','delivered','{"summary":{"text":"Reviewed family update","period":{"from":"2026-10-22","to":"2026-10-28","days":7},"method":"Reviewed report","privateRaw":"PRIVATE"}}','fixture',stamp,stamp),
 ('summary-fixture-second-'||f,'workspace:primary','S900302','family',f::text,'weekly_summary','in_app','read','{"summary":{"text":"Reviewed second senior update","period":{"from":"2026-10-22","to":"2026-10-28","days":7},"method":"Reviewed report"}}','fixture',stamp,stamp),
 ('summary-fixture-senior-'||s,'workspace:primary','S900301','senior',s::text,'weekly_summary','in_app','delivered','{"summary":{"text":"Reviewed senior update","period":{"from":"2026-10-22","to":"2026-10-28","days":7},"method":"Reviewed report"}}','fixture',stamp,stamp);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f,'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
 result:=public.care_family_summary('S900301','2026-10-29');
 if result#>>'{summary,text}' is distinct from 'Reviewed family update' or result::text like '%PRIVATE%' or result::text like '%UNAPPROVED%' then raise exception 'Family received a draft or private source fields';end if;
 if result#>>'{summary,requiresHumanReview}' is distinct from 'false' then raise exception 'Delivered update was not labelled reviewed';end if;
 result:=public.care_family_summary('S900302','2026-10-29');if result#>>'{summary,text}' is distinct from 'Reviewed second senior update' then raise exception 'Second household senior not handled';end if;
 result:=public.care_family_summary('S900301','2026-10-27');if result->'summary'<>'null'::jsonb then raise exception 'Future report leaked into an earlier date';end if;
 update public.care_consents set family_allowed=false where owner='workspace:primary' and senior_id='S900301';
 begin perform public.care_family_summary('S900301','2026-10-29');raise exception 'Withdrawn consent ignored';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',s,'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
 result:=public.care_family_summary('S900301','2026-10-29');if result#>>'{summary,text}' is distinct from 'Reviewed senior update' then raise exception 'Senior received another recipient summary';end if;
 begin perform public.care_family_summary('S900302','2026-10-29');raise exception 'Senior accessed another identity';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',o,'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
 begin perform public.care_family_summary('S900302','2026-10-29');raise exception 'Unlinked family accessed summary';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',c,'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
 begin perform public.care_family_summary('S900302','2026-10-29');raise exception 'Staff used recipient-only summary RPC';exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'PASS: only approved own-recipient summaries, both household seniors, date cutoff and consent; fixtures rolled back' as result;
