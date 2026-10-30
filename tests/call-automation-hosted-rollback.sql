begin;
update private.care_call_auto_control set enabled=false,revision=1,budget_minutes=0,reserved_minutes=0,checked_at=null,calls_enabled=true,restrict_hours=true,window_start='08:00',window_end='20:00',help_outside_hours=false;
-- No carrier calls. Synthetic users, policy, schedules and outcomes roll back.
do $setup$ declare r text;uid uuid;c uuid;stamp text:=clock_timestamp()::text;begin
 foreach r in array array['coordinator','senior','family'] loop
  uid:=gen_random_uuid();if r='coordinator' then c:=uid;end if;
  insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
   values(uid,'role-call-'||uid||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}');
  insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,status,is_admin,created_at)
   values(uid::text,'primary',uid::text,'role-call-'||uid||'@example.invalid','Role fixture '||r,r,case when r in ('senior','family') then 'S999994' else '' end,
    case when r='operations' then '["*"]' else '["S999994"]' end,'active',case when r='operations' then 1 else 0 end,stamp);
  insert into public.care_account_contacts(user_id,phone,sms_consent,call_consent,recipient_confirmed)
   values(uid,case r when 'senior' then '+19990000031' when 'family' then '+19990000032' when 'coordinator' then '+19990000033' else '+19990000034' end,true,true,true);
  perform set_config('test.role.'||r,uid::text,true);
 end loop;
 -- Operations remains the existing sole workspace owner. Its temporary fixture
 -- contact is transaction-local and is restored by the final rollback.
 select user_id::uuid into uid from public.care_memberships where workspace_id='primary' and role='operations' and is_admin=1 and status='active' limit 1;
 if uid is null then raise exception 'Operations owner missing';end if;
 insert into public.care_account_contacts(user_id,phone,sms_consent,call_consent,recipient_confirmed) values(uid,'+19990000034',true,true,true)
 on conflict(user_id) do update set phone=excluded.phone,sms_consent=true,call_consent=true,recipient_confirmed=true,revision=care_account_contacts.revision+1;
 perform set_config('test.role.operations',uid::text,true);
 insert into public.care_profiles(owner,senior_id,name,profile,updated_at) values('workspace:primary','S999994','Role call subject','{"id":"S999994","name":"Role call subject"}',stamp);
 insert into public.care_consents(owner,senior_id,family_allowed,actor_id,updated_at) values('workspace:primary','S999994',true,c::text,stamp);
end $setup$;
select set_config('test.auto.clock',(date_trunc('day',clock_timestamp() at time zone 'Asia/Kolkata')+interval '10 hours')::text||'+05:30',true);
create or replace function private.care_auto_time() returns timestamptz language sql volatile set search_path='' as $$select current_setting('test.auto.clock')::timestamptz$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.role.coordinator'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$declare v jsonb;begin
 v:=public.care_call_automation('list');
 if v#>>'{control,enabled}'<>'false' then raise exception 'New automation must start paused';end if;
 perform public.care_call_automation('save','{"seniorId":"S999994","revision":0,"dailyEnabled":false,"helpEnabled":true,"dailyTime":"10:05","language":"en","trialVerified":true,"consentConfirmed":true}');
 begin perform public.care_call_automation('control','{"revision":1,"enabled":true,"remainingMinutes":75,"allowanceConfirmed":true}');raise exception 'Coordinator armed global controls';exception when insufficient_privilege then null;end;
 begin perform public.care_call_automation('save','{"seniorId":"S999994","revision":0,"dailyEnabled":true,"helpEnabled":false,"dailyTime":"10:05","language":"en","trialVerified":true,"consentConfirmed":true}');raise exception 'Stale settings saved';exception when raise_exception then if sqlerrm not like '%settings changed%' then raise;end if;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.role.operations'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
select public.care_call_automation('control','{"revision":1,"enabled":true,"remainingMinutes":75,"allowanceConfirmed":true}');
reset role;
-- The source message is synthetic. A family report must not trigger a senior bot.
insert into public.care_phone_requests(event_id,sender,message,kind,language,senior_id,assigned_to,received_at,created_at,analysis)
 values(repeat('1',64),'+19990000031','HELP old message','help','en','S999994',current_setting('test.role.coordinator')::uuid,private.care_auto_time()-interval '1 minute',private.care_auto_time()+interval '1 second','{"version":"sms-understanding-v2","intent":"help","cues":[],"urgency":"prompt"}');
insert into public.care_phone_requests(event_id,sender,message,kind,language,senior_id,assigned_to,received_at,created_at,analysis)
 values(repeat('2',64),'+19990000031','HELP delayed message','help','en','S999994',current_setting('test.role.coordinator')::uuid,private.care_auto_time()+interval '1 minute',private.care_auto_time()+interval '10 minutes','{"version":"sms-understanding-v2","intent":"help","cues":[],"urgency":"prompt"}');
insert into public.care_phone_requests(event_id,sender,message,kind,language,senior_id,assigned_to,received_at,created_at,analysis)
 values(repeat('e',64),'+19990000032','HELP','help','en','S999994',current_setting('test.role.coordinator')::uuid,private.care_auto_time()+interval '1 second',private.care_auto_time()+interval '1 second','{"version":"sms-understanding-v2","intent":"help","cues":[],"urgency":"prompt"}');
do $$begin if exists(select 1 from private.care_call_auto_runs where senior_id='S999994') then raise exception 'Historical, delayed or family SMS triggered a senior call';end if;end $$;
insert into public.care_phone_requests(event_id,sender,message,kind,language,senior_id,assigned_to,received_at,created_at,analysis)
 values(repeat('f',64),'+19990000031','HELP','help','en','S999994',current_setting('test.role.coordinator')::uuid,private.care_auto_time()+interval '1 second',private.care_auto_time()+interval '1 second','{"version":"sms-understanding-v2","intent":"help","cues":[],"urgency":"prompt"}');
select set_config('test.auto.run',(select id::text from private.care_call_auto_runs where senior_id='S999994'),true);
set local role service_role;
do $$declare v jsonb;c jsonb;v2 jsonb;begin
 v:=public.care_call_automation_worker('tick');
 if v->>'jobId' is null then raise exception 'No senior call planned: %',v;end if;
 perform set_config('test.auto.senior_job',v->>'jobId',true);
 c:=public.care_voice_contact(v->>'jobId');
 if c->>'phone'<>'+19990000031' or c->>'role'<>'senior' then raise exception 'Wrong senior destination';end if;
 v2:=public.care_call_automation_worker('tick');if v2 ? 'jobId' then raise exception 'Duplicate tick created/returned a second call';end if;
end $$;
-- Stale contact versions block the already saved job before dispatch.
reset role;
update public.care_account_contacts set revision=revision+1 where user_id=current_setting('test.role.senior')::uuid;
set local role service_role;
do $$begin if public.care_voice_contact(current_setting('test.auto.senior_job')) is not null then raise exception 'Stale mobile version accepted';end if;end $$;
reset role;
update public.care_account_contacts set revision=revision-1 where user_id=current_setting('test.role.senior')::uuid;
-- A synthetic terminal provider outcome exercises the following briefing plan.
set local role service_role;
update public.care_events set payload=payload||jsonb_build_object('status','completed','voiceState',jsonb_build_object('version',2,'consent','granted','complete',true,'completionReason','complete','answers',jsonb_build_object('wellbeing','changed','medicines','missed'),'reportedCues','[]'::jsonb)) where id=current_setting('test.auto.senior_job');
do $$declare v jsonb;c jsonb;begin
 v:=public.care_call_automation_worker('tick');if v->>'jobId' is null then raise exception 'No coordinator briefing planned: %',v;end if;
 perform set_config('test.auto.brief_job',v->>'jobId',true);c:=public.care_voice_contact(v->>'jobId');
 if c->>'phone'<>'+19990000033' or c->>'role'<>'coordinator' or c#>>'{voiceNotice,checkin,answers,medicines}'<>'missed' then raise exception 'Briefing lost exact recipient or saved senior answers';end if;
end $$;
-- Family/staff acknowledgements do not produce a senior clinical observation.
update public.care_events set payload=payload||jsonb_build_object('status','completed','voiceState',jsonb_build_object('version',2,'recipientRole','coordinator','purpose','care-notice','consent','granted','complete',true,'completionReason','complete','answers',jsonb_build_object('noticeResponse','acknowledged'))) where id=current_setting('test.auto.brief_job');
select public.care_call_automation_worker('tick');
reset role;
do $$begin
 if (select status from private.care_call_auto_runs where id=current_setting('test.auto.run')::uuid)<>'completed' then raise exception 'Sequence did not settle';end if;
 if (select reserved_minutes from private.care_call_auto_control where id)<>8 then raise exception 'Allowance not reserved once per call';end if;
 if exists(select 1 from public.care_events where id='call-signal:'||current_setting('test.auto.brief_job')) then raise exception 'Staff reply polluted clinical history';end if;
 if (select status from public.care_phone_requests where event_id=repeat('f',64))<>'received' then raise exception 'Call acknowledgement silently resolved original care request';end if;
end $$;
-- Close synthetic help sources before exercising routine scheduling.
update public.care_phone_requests set status='closed',closed_at=clock_timestamp(),outcome='Fixture ends the synthetic source' where senior_id='S999994';
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.role.coordinator'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
select public.care_call_automation('save','{"seniorId":"S999994","revision":1,"dailyEnabled":true,"helpEnabled":false,"dailyTime":"10:05","language":"hi","trialVerified":true,"consentConfirmed":true}');
select set_config('test.auto.clock',(current_setting('test.auto.clock')::timestamptz+interval '6 minutes')::text,true);
set local role service_role;
do $$declare v jsonb;begin v:=public.care_call_automation_worker('tick');if v->>'jobId' is null then raise exception 'Daily slot not planned';end if;perform set_config('test.auto.daily_job',v->>'jobId',true);end $$;
select public.care_call_automation_worker('tick');
reset role;
do $$begin
 if (select count(*) from private.care_call_auto_runs where senior_id='S999994' and origin='daily')<>1 then raise exception 'Repeated tick duplicated daily run';end if;
 if (select count(*) from public.care_events where kind='telephony_job' and payload->>'automationRunId' in (select id::text from private.care_call_auto_runs where senior_id='S999994' and origin='daily'))<>1 then raise exception 'Repeated daily tick duplicated call job';end if;
end $$;
-- Changed consent is checked again at dispatch; no number substitutions.
savepoint failed_senior;
set local role service_role;
update public.care_events set payload=payload||jsonb_build_object('status','failed','voiceState',jsonb_build_object('version',2,'complete',true,'consent','pending','completionReason','not_started','answers','{}'::jsonb)) where id=current_setting('test.auto.daily_job');
do $$declare v jsonb;c jsonb;begin
 v:=public.care_call_automation_worker('tick');if v->>'jobId' is null then raise exception 'Failed senior call suppressed coordinator briefing';end if;
 perform set_config('test.auto.failed_brief',v->>'jobId',true);c:=public.care_voice_contact(v->>'jobId');
 if c#>>'{voiceNotice,checkin,completionReason}'<>'not_started' or c#>'{voiceNotice,checkin,answers}'<>'{}'::jsonb then raise exception 'Failed call fabricated senior answers';end if;
end $$;
update public.care_events set payload=payload||jsonb_build_object('status','completed','voiceState',jsonb_build_object('version',2,'recipientRole','coordinator','purpose','care-notice','consent','granted','complete',true,'completionReason','no_response','answers','{}'::jsonb)) where id=current_setting('test.auto.failed_brief');
select public.care_call_automation_worker('tick');
reset role;
do $$begin if not exists(select 1 from private.care_call_auto_runs where senior_job_id=current_setting('test.auto.daily_job') and needs_attention and reason='notice_unacknowledged') then raise exception 'Missed briefing did not require human review';end if;end $$;
rollback to savepoint failed_senior;

savepoint unknown_allowance;
select set_config('test.auto.clock',(current_setting('test.auto.clock')::timestamptz+interval '3 minutes')::text,true);
update private.care_call_auto_control set checked_at=null where id;
set local role service_role;
do $$declare v jsonb;begin v:=public.care_call_automation_worker('tick');if v ? 'jobId' then raise exception 'Missing trial balance did not block dispatch';end if;end $$;
reset role;
do $$begin if (select reason from private.care_call_auto_runs where senior_job_id=current_setting('test.auto.daily_job'))<>'quota_unknown' then raise exception 'Missing allowance reason not saved';end if;end $$;
rollback to savepoint unknown_allowance;

savepoint uncertain_submission;
set local role service_role;
update public.care_events set payload=payload||jsonb_build_object('status','submission_unknown','updatedAt',(current_setting('test.auto.clock')::timestamptz-interval '6 minutes')) where id=current_setting('test.auto.daily_job');
do $$declare v jsonb;begin v:=public.care_call_automation_worker('tick');if v ? 'jobId' then raise exception 'Uncertain submission was redialled';end if;end $$;
reset role;
do $$begin if not exists(select 1 from private.care_call_auto_runs where senior_job_id=current_setting('test.auto.daily_job') and needs_attention and reason='active_call') then raise exception 'Uncertain submission did not require Operations review';end if;end $$;
rollback to savepoint uncertain_submission;

savepoint quiet_hours;
select set_config('test.auto.clock',(date_trunc('day',current_setting('test.auto.clock')::timestamptz at time zone 'Asia/Kolkata')+interval '20 hours 2 minutes')::text||'+05:30',true);
update private.care_call_auto_runs set expires_at=current_setting('test.auto.clock')::timestamptz+interval '20 minutes' where senior_job_id=current_setting('test.auto.daily_job');
set local role service_role;
do $$declare v jsonb;begin v:=public.care_call_automation_worker('tick');if v ? 'jobId' then raise exception 'Quiet hours bypassed';end if;end $$;
reset role;
do $$begin if (select reason from private.care_call_auto_runs where senior_job_id=current_setting('test.auto.daily_job'))<>'outside_hours' then raise exception 'Quiet-hour hold not recorded';end if;end $$;
rollback to savepoint quiet_hours;

savepoint global_pause;
-- This branch changes only fictional expiry times to isolate the demo clock.
savepoint configured_window;
select set_config('test.auto.clock',(date_trunc('day',current_setting('test.auto.clock')::timestamptz at time zone 'Asia/Kolkata')+interval '20 hours 2 minutes')::text||'+05:30',true);
update private.care_call_auto_runs set expires_at=current_setting('test.auto.clock')::timestamptz+interval '20 minutes' where senior_job_id=current_setting('test.auto.daily_job');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.role.operations'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
select public.care_call_automation('policy','{"revision":2,"callsEnabled":true,"restrictHours":false,"start":"08:00","end":"20:00","helpOutsideHours":false}');
set local role service_role;
do $$declare v jsonb;begin
 v:=public.care_call_automation_worker('tick');if v->>'jobId' is distinct from current_setting('test.auto.daily_job') then raise exception 'Configured all-day window did not permit the existing eligible automatic job';end if;
 if public.care_voice_dispatch_configuration()#>>'{SAMARTH_CALL_POLICY,restrictHours}'<>'false' then raise exception 'Configured policy did not reach dispatcher';end if;
end $$;
reset role;
select set_config('test.auto.clock',(current_setting('test.auto.clock')::timestamptz+interval '1 minute')::text,true);
update private.care_call_auto_runs set expires_at=current_setting('test.auto.clock')::timestamptz+interval '20 minutes' where senior_job_id=current_setting('test.auto.daily_job');
update private.care_call_auto_control set restrict_hours=true;
set local role service_role;
do $$declare v jsonb;begin v:=public.care_call_automation_worker('tick');if v ? 'jobId' then raise exception 'Configured quiet hours still dispatched';end if;end $$;
reset role;
do $$begin if (select reason from private.care_call_auto_runs where senior_job_id=current_setting('test.auto.daily_job'))<>'outside_hours' then raise exception 'Configured hours did not restore the hold';end if;end $$;
rollback to savepoint configured_window;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.role.operations'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
select public.care_call_automation('control','{"revision":2,"enabled":false,"remainingMinutes":63,"allowanceConfirmed":false}');
set local role service_role;
do $$begin if public.care_voice_contact(current_setting('test.auto.daily_job')) is not null then raise exception 'Paused job still eligible';end if;end $$;
reset role;
do $$begin if (select status from private.care_call_auto_runs where senior_job_id=current_setting('test.auto.daily_job'))<>'cancelled' then raise exception 'Pause did not cancel undispatched sequence';end if;end $$;
rollback to savepoint global_pause;

update public.care_account_contacts set call_consent=false where user_id=current_setting('test.role.coordinator')::uuid;
set local role service_role;
do $$begin if public.care_voice_contact(current_setting('test.auto.daily_job')) is not null then raise exception 'Withdrawn care-owner consent ignored';end if;end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.role.family'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$begin begin perform public.care_call_automation('list');raise exception 'Family read staff call automation';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'PASS: separate controls, exact recipients, senior-to-coordinator briefing, failed-call follow-up, daily deduplication, consent/revision rejection, paused cancellation, missing allowance, quiet hours, uncertain submission and historical/delayed/family exclusions; all fixtures roll back' as result;
rollback;
