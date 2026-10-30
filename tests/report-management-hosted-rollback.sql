begin;

select set_config('test.report.admin',(select user_id from public.care_memberships where role='operations' and is_admin=1 and status='active' limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.report.admin'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$declare f uuid;stamp text:=clock_timestamp()::text;begin
 for i in 1..2 loop
  f:=gen_random_uuid();perform set_config('test.report.family'||i,f::text,true);
  insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values(f,'report-controls-'||f||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}');
  insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,status,is_admin,created_at) values(f::text,'primary',f::text,'report-controls-'||f||'@example.invalid','Fictional family '||i,'family','S999993','["S999993"]','active',0,stamp);
 end loop;
 insert into public.care_profiles(owner,senior_id,name,profile,updated_at) values('workspace:primary','S999993','Report control fixture','{"id":"S999993","name":"Report control fixture"}',stamp);
 insert into public.care_consents(owner,senior_id,family_allowed,actor_id,updated_at) values('workspace:primary','S999993',true,current_setting('test.report.admin'),stamp);
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('report:management-fixture','workspace:primary','generated_report','S999993','{"status":"pending_review","report":{"text":"Fictional supported weekly summary. No diagnosis.","language":"en","period":{"from":"2026-10-24","to":"2026-10-30"},"evidence":[{"id":"E001","date":"2026-10-30"}],"generation":{"llmUsed":false}}}',stamp);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.report.admin'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$declare v jsonb;begin
 v:=public.care_report_management('list','{"seniorId":"S999993"}');
 if jsonb_array_length(v->'families')<>2 or jsonb_array_length(v->'reviews')<>1 then raise exception 'Named family/review list missing';end if;
 begin perform public.care_report_management('share',jsonb_build_object('reportId','report:management-fixture','revision',0,'idempotencyKey',gen_random_uuid(),'recipientIds',jsonb_build_array(current_setting('test.report.family1'))));raise exception 'Unreviewed summary shared';exception when raise_exception then if sqlerrm not like '%reviewed before sharing%' then raise;end if;end;
 begin perform public.care_report_management('review',jsonb_build_object('reportId','report:management-fixture','revision',0,'idempotencyKey',gen_random_uuid(),'checks','{}'::jsonb));raise exception 'Review checklist bypass';exception when raise_exception then if sqlerrm not like '%review checks%' then raise;end if;end;
 perform public.care_report_management('review',jsonb_build_object('reportId','report:management-fixture','revision',0,'idempotencyKey',gen_random_uuid(),'checks','{"evidence":true,"uncertainty":true,"noDiagnosis":true}'::jsonb,'note','Checked fictional sources.'));
 begin perform public.care_report_management('note',jsonb_build_object('reportId','report:management-fixture','revision',0,'idempotencyKey',gen_random_uuid(),'note','Old revision'));raise exception 'Stale review overwrite';exception when raise_exception then if sqlerrm not like '%report changed%' then raise;end if;end;
 perform set_config('test.report.share_key',gen_random_uuid()::text,true);
 perform public.care_report_management('share',jsonb_build_object('reportId','report:management-fixture','revision',1,'idempotencyKey',current_setting('test.report.share_key'),'recipientIds',jsonb_build_array(current_setting('test.report.family1'))));
 v:=public.care_report_management('share',jsonb_build_object('reportId','report:management-fixture','revision',1,'idempotencyKey',current_setting('test.report.share_key'),'recipientIds',jsonb_build_array(current_setting('test.report.family1'))));if v->>'repeated'<>'true' then raise exception 'Share retry not idempotent';end if;
 begin perform public.care_report_management('share',jsonb_build_object('reportId','report:management-fixture','revision',2,'idempotencyKey',gen_random_uuid(),'recipientIds',jsonb_build_array(current_setting('test.report.family2'),gen_random_uuid()::text)));raise exception 'Unrelated family allowed';exception when raise_exception then if sqlerrm not like '%no longer eligible%' then raise;end if;end;
 v:=public.care_report_management('list','{"seniorId":"S999993"}');if jsonb_array_length(v#>'{reviews,0,recipients}')<>1 then raise exception 'Partial recipient publish survived rollback';end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.report.family1'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$declare v jsonb;begin
 v:=public.care_family_summary('S999993','2026-10-31');if v#>>'{summary,text}'<>'Fictional supported weekly summary. No diagnosis.' then raise exception 'Reviewed summary not visible';end if;
 begin perform public.care_report_management('list','{"seniorId":"S999993"}');raise exception 'Family read staff controls';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.report.admin'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
select public.care_report_management('archive',jsonb_build_object('reportId','report:management-fixture','revision',2,'idempotencyKey',gen_random_uuid()));
do $$begin begin perform public.care_report_management('share',jsonb_build_object('reportId','report:management-fixture','revision',3,'idempotencyKey',gen_random_uuid(),'recipientIds',jsonb_build_array(current_setting('test.report.family2'))));raise exception 'Archived report shared';exception when raise_exception then if sqlerrm not like '%active draft%' then raise;end if;end;end $$;
select public.care_report_management('restore',jsonb_build_object('reportId','report:management-fixture','revision',3,'idempotencyKey',gen_random_uuid()));
select public.care_report_management('withdraw',jsonb_build_object('reportId','report:management-fixture','revision',4,'idempotencyKey',gen_random_uuid(),'note','Fictional withdrawal check.'));
do $$begin begin perform public.care_workflow('delivery_update',jsonb_build_object('owner','workspace:primary','id','report-delivery:report:management-fixture:'||current_setting('test.report.family1'),'status','delivered','attempts',1));raise exception 'Withdrawn copy republished through old route';exception when raise_exception then if sqlerrm not like '%weekly summary controls%' then raise;end if;end;end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.report.family1'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$begin if public.care_family_summary('S999993','2026-10-31')->'summary'<>'null'::jsonb then raise exception 'Withdrawn report still visible';end if;end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.report.admin'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
select public.care_report_management('reject',jsonb_build_object('reportId','report:management-fixture','revision',5,'idempotencyKey',gen_random_uuid(),'note','Fictional rejection check.'));
do $$declare v jsonb;begin v:=public.care_report_management('list','{"seniorId":"S999993"}');if v#>>'{reviews,0,state}'<>'rejected' or jsonb_array_length(v#>'{reviews,0,history}')<5 then raise exception 'Review/audit state missing';end if;end $$;
reset role;
select 'PASS: checklist, named recipients, atomic sharing, idempotency, role/revision gates, archive/restore, withdrawal and rejection; fictional records roll back' as result;
rollback;
