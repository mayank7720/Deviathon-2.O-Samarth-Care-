begin;
do $setup$ declare c uuid:=gen_random_uuid();s uuid:=gen_random_uuid();f uuid:=gen_random_uuid();j uuid:=gen_random_uuid();stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');begin
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 select id,'call-bot-'||id||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from(values(c),(s),(f)) u(id);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,status,is_admin,created_at) values
 (c::text,'primary',c::text,'call-test-c@example.invalid','Call fixture coordinator','coordinator','','["S999993"]','active',0,stamp),
 (s::text,'primary',s::text,'call-test-s@example.invalid','Call fixture senior','senior','S999993','["S999993"]','active',0,stamp),
 (f::text,'primary',f::text,'call-test-f@example.invalid','Call fixture family','family','S999993','["S999993"]','active',0,stamp);
 insert into public.care_profiles(owner,senior_id,name,profile,updated_at) values('workspace:primary','S999993','Call fixture senior','{"id":"S999993","name":"Call fixture senior"}',stamp);
 insert into public.care_account_contacts(user_id,phone,sms_consent,call_consent,recipient_confirmed) values(c,'+19990000023',true,true,true),(s,'+19990000021',true,true,true),(f,'+19990000022',true,true,true);
 insert into public.care_consents(owner,senior_id,family_allowed,actor_id,updated_at) values('workspace:primary','S999993',true,c::text,stamp);
 perform set_config('test.call.c',c::text,true);perform set_config('test.call.s',s::text,true);perform set_config('test.call.id',j::text,true);
end $setup$;
-- Fixture injection uses the trusted test role so this rollback suite also
-- works after quiet hours. The browser cannot create provider evidence.
set local role service_role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.call.c'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $job$ declare contact jsonb;stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');begin
 select v into contact from jsonb_array_elements(public.care_account_phone_contacts()) v where v->>'seniorId'='S999993' and v->>'role'='senior';
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(current_setting('test.call.id'),'workspace:primary','telephony_job','S999993',
  jsonb_build_object('id',current_setting('test.call.id'),'seniorId','S999993','contactId',contact->>'id','recipientRole','senior','channel','voice_bot','language','hi','template','checkin',
   'text','Fixed generic check-in','status','queued','requestHash',repeat('a',64),'state',jsonb_build_object('step',0),'createdAt',stamp,'expiresAt',clock_timestamp()+interval '20 minutes',
   'requestedBy',auth.uid(),'externalDelivery',false,'humanRead',false),stamp);
end $job$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role service_role;
do $callback$ declare previous jsonb;next jsonb;signal jsonb;r boolean;date text:=to_char(clock_timestamp() at time zone 'Asia/Kolkata','YYYY-MM-DD');begin
 if public.care_voice_contact(current_setting('test.call.id'))->>'phone'<>'+19990000021' then raise exception 'Live account recipient failed';end if;
 previous:=public.care_voice_job(current_setting('test.call.id'));
 next:=previous||jsonb_build_object('status','answered','voiceState',jsonb_build_object('version',2,'language','hi','step',1,'cursor',2,'consent','granted','complete',true,'helpRequested',true,'callRequested',true,'completionReason','help',
  'answers',jsonb_build_object('wellbeing','help'),'summary',jsonb_build_object('answeredQuestions',1,'priority','prompt','text','Requests help.','llmUsed',false)));
 signal:=jsonb_build_object('seniorId','S999993','date',date,'observedAt',clock_timestamp(),'source','guided-call-bot','note','Requests help.','helpRequested',true);
 r:=public.care_voice_advance(current_setting('test.call.id'),0,next,signal);if not r then raise exception 'Signed call state not applied';end if;
 r:=public.care_voice_advance(current_setting('test.call.id'),0,next,signal);if r then raise exception 'Stale call callback applied';end if;
 previous:=public.care_voice_job(current_setting('test.call.id'));
 r:=public.care_voice_advance(current_setting('test.call.id'),1,previous||'{"status":"completed"}',signal);if not r then raise exception 'Carrier completion not saved';end if;
end $callback$;
reset role;
do $saved$ declare ident uuid;begin
 select request_id into ident from private.care_call_bot_followups where job_id=current_setting('test.call.id');
 if ident is null then raise exception 'No shared follow-up created';end if;
 if (select count(*) from public.care_events where kind='care_request' and payload->>'callJobId'=current_setting('test.call.id'))<>1 then raise exception 'Callback follow-up duplicated';end if;
 if (select count(*) from public.care_events where id='call-signal:'||current_setting('test.call.id'))<>1 then raise exception 'Call note missing or duplicated';end if;
 if not exists(select 1 from public.care_notification_routes where source_id=ident::text and recipient_role='coordinator') then raise exception 'Assigned coordinator not notified';end if;
 if not exists(select 1 from public.care_notification_routes where source_id=ident::text and recipient_role='family') then raise exception 'Consented family not notified';end if;
end $saved$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.call.c'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $review$ declare stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');begin
 perform public.care_phone_support('outbound','{}');
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('call-review:'||current_setting('test.call.id'),'workspace:primary','call_bot_review','S999993',jsonb_build_object('jobId',current_setting('test.call.id'),'actorId',auth.uid(),'outcome','Human checked the synthetic test answers.','createdAt',stamp),stamp);
 begin update public.care_events set payload=payload||'{"outcome":"rewritten"}' where id='call-review:'||current_setting('test.call.id');if found then raise exception 'Review was mutable';end if;exception when insufficient_privilege then null;end;
end $review$;
reset role;
update public.care_account_contacts set call_consent=false where user_id=current_setting('test.call.s')::uuid;
set local role service_role;
do $revoke$ begin if public.care_voice_contact(current_setting('test.call.id')) is not null then raise exception 'Withdrawn call consent ignored';end if;end $revoke$;
reset role;
select 'Call bot hosted rollback checks passed' as result;
rollback;
