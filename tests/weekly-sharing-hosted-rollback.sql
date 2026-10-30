begin;
-- Fictional users and reviewed inbox data stay inside this rollback. No message,
-- report inference, carrier request or real-family approval is produced.
do $$declare f uuid:=gen_random_uuid();a text;stamp text:=clock_timestamp()::text;begin
 select user_id into a from public.care_memberships where role='operations' and is_admin=1 and status='active' limit 1;
 perform set_config('test.weekly.admin',a,true);perform set_config('test.weekly.family',f::text,true);
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values(f,'weekly-fixture-'||f||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}');
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,status,is_admin,created_at)
 values(f::text,'primary',f::text,'weekly-fixture-'||f||'@example.invalid','Fictional family','family','S999995','["S999995"]','active',0,stamp);
 insert into public.care_profiles(owner,senior_id,name,profile,updated_at) values('workspace:primary','S999995','Fictional summary subject','{"id":"S999995","name":"Fictional summary subject"}',stamp);
 insert into public.care_consents(owner,senior_id,family_allowed,actor_id,updated_at) values('workspace:primary','S999995',true,a,stamp);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.weekly.admin'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
select public.care_workflow('delivery_put',jsonb_build_object('id','weekly-review-fixture','owner','workspace:primary','seniorId','S999995','recipientRole','family','userId',current_setting('test.weekly.family'),'kind','weekly_summary','channel','in_app','status','pending_review','sourceId','fictional-saved-report','createdAt',clock_timestamp()::text,'payload',jsonb_build_object('body','Fictional supported report.','summary',jsonb_build_object('text','Fictional supported report.','period',jsonb_build_object('from','2026-10-24','to','2026-10-30'),'method','Fictional reviewed report'))));
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.weekly.family'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$begin if public.care_family_summary('S999995','2026-10-31')->'summary'<>'null'::jsonb then raise exception 'Pending draft leaked';end if;end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.weekly.admin'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
select public.care_workflow('delivery_update','{"owner":"workspace:primary","id":"weekly-review-fixture","status":"queued","attempts":0}');
select public.care_workflow('delivery_update',jsonb_build_object('owner','workspace:primary','id','weekly-review-fixture','status','delivered','attempts',1,'deliveredAt',clock_timestamp()::text));
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.weekly.family'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$declare v jsonb;begin
 v:=public.care_family_summary('S999995','2026-10-31');
 if v#>>'{summary,text}'<>'Fictional supported report.' then raise exception 'Reviewed report not visible to linked family';end if;
 begin perform public.care_family_summary('S001','2026-10-31');raise exception 'Unrelated senior summary accessible';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.care_consents set family_allowed=false where senior_id='S999995';
set local role authenticated;
do $$begin begin perform public.care_family_summary('S999995','2026-10-31');raise exception 'Withdrawn sharing ignored';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'PASS: pending draft hidden, reviewed inbox visible, other senior denied, withdrawn sharing denied; all fictional data rolls back' as result;
rollback;
