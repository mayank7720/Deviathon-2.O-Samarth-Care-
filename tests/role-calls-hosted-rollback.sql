begin;
-- This fixture creates no carrier call. Only this transaction suppresses the
-- clock condition so role guards can be exercised at any hour; it rolls back.
do $clock$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.care_call_request_guard()'::regprocedure);
 needle:='if not private.care_call_window_open(clock_timestamp(),new.payload ? ''sourceRequestId'') then';
 if strpos(definition,needle)=0 then raise exception 'Review call-hours fixture';end if;
 execute replace(definition,needle,'if false then');
end $clock$;
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
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.role.coordinator'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $queue$ declare r text;contact jsonb;jid text;p jsonb;request jsonb;stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');template text;begin
 request:=public.care_phone_support('receive',jsonb_build_object('eventId',repeat('9',64),'sender','+19990000031','kind','help','language','en','message','I have chest pain.','receivedAt',clock_timestamp(),'nonce','role-call-source-00000001',
  'analysis',jsonb_build_object('version','sms-understanding-v2','method','local-rules-and-intent-ml','intent','help','urgency','immediate','externalServiceUsed',false,'cues',jsonb_build_array(jsonb_build_object('cue','chest_pain','label','Chest discomfort','evidence','I have chest pain.')),'reasons',jsonb_build_array('Chest discomfort'))));
 perform set_config('test.role.source',request->>'id',true);
 foreach r in array array['senior','family','coordinator','operations'] loop
  select c into contact from jsonb_array_elements(public.care_account_phone_contacts()) c where c->>'seniorId'='S999994' and c->>'userId'=current_setting('test.role.'||r) and c->>'role'=r;
  if contact is null then raise exception 'Fixture role recipient missing';end if;
  jid:=gen_random_uuid()::text;template:=case r when 'senior' then 'checkin' when 'family' then 'followup' when 'coordinator' then 'staff_alert' else 'escalation' end;
  p:=jsonb_build_object('id',jid,'seniorId','S999994','contactId',contact->>'id','recipientRole',r,'channel','voice_bot','template',template,'language','hi',
   'text',private.care_sms_text(template,'hi',r),'sourceRequestId',request->>'id','status','queued','requestHash',repeat('b',64),'state',jsonb_build_object('step',0),
   'createdAt',stamp,'expiresAt',clock_timestamp()+interval '20 minutes','asOfDate',to_char(clock_timestamp() at time zone 'Asia/Kolkata','YYYY-MM-DD'),'requestedBy',auth.uid(),'externalDelivery',false,'deliveredToHandset',false,'humanRead',false);
  insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(jid,'workspace:primary','telephony_job','S999994',p,stamp);
  perform set_config('test.role.'||r||'_job',jid,true);
  begin
   insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','telephony_job','S999994',p||jsonb_build_object('recipientRole',case when r='senior' then 'family' else 'senior' end),stamp);
   raise exception 'Wrong role/contact permutation accepted';exception when insufficient_privilege or invalid_parameter_value then null;
  end;
  begin
   update public.care_events set payload=payload||jsonb_build_object('sourceRequestId',gen_random_uuid(),'state',jsonb_build_object('step',1)) where id=jid;
   if found then raise exception 'Queued source identity was mutable';end if;exception when insufficient_privilege or invalid_parameter_value then null;
  end;
  if (select payload->>'sourceRequestId' from public.care_events where id=jid) is distinct from request->>'id' then raise exception 'Queued source identity changed or disappeared';end if;
 end loop;
end $queue$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role service_role;
do $resolve$ declare r text;c jsonb;expected text;begin
 foreach r in array array['senior','family','coordinator','operations'] loop
  c:=public.care_voice_contact(current_setting('test.role.'||r||'_job'));
  expected:=case r when 'senior' then '+19990000031' when 'family' then '+19990000032' when 'coordinator' then '+19990000033' else '+19990000034' end;
  if c->>'phone' is distinct from expected or c->>'role' is distinct from r or c->>'seniorId'<>'S999994' then raise exception 'Call reached wrong account role or number';end if;
  if c#>>'{voiceNotice,reference}'<>'S999994' or not(c#>'{voiceNotice,cues}' ? 'chest_pain') then raise exception 'Saved briefing source was not resolved';end if;
 end loop;
end $resolve$;
do $outcomes$ declare r text;job jsonb;v jsonb;signal jsonb;begin
 foreach r in array array['family','coordinator','operations'] loop
  job:=public.care_voice_job(current_setting('test.role.'||r||'_job'));
  v:=jsonb_build_object('version',2,'recipientRole',r,'purpose','care-notice','language','hi','consent','granted','complete',true,'completionReason','complete','cursor',2,'step',1,
   'answers',jsonb_build_object('noticeResponse',case when r='coordinator' then 'unavailable' else 'acknowledged' end),'helpRequested',false,'callRequested',r='coordinator',
   'summary',jsonb_build_object('answeredQuestions',1,'priority',case when r='coordinator' then 'today' else 'routine' end,'text','Recipient responded to the care notice.','llmUsed',false));
  signal:=jsonb_build_object('seniorId','S999994','date',to_char(clock_timestamp() at time zone 'Asia/Kolkata','YYYY-MM-DD'),'note','Must not become patient data');
  begin
   perform public.care_voice_advance(job->>'id',0,job||jsonb_build_object('voiceState',v,'status','answered'),signal);
   raise exception 'Recipient reply became a senior health observation';exception when invalid_parameter_value then null;
  end;
  if not public.care_voice_advance(job->>'id',0,job||jsonb_build_object('voiceState',v,'status','answered'),null) then raise exception 'Role outcome was not stored';end if;
 end loop;
end $outcomes$;
reset role;
do $verify$ begin
 if exists(select 1 from public.care_events where senior_id='S999994' and id in ('call-signal:'||current_setting('test.role.family_job'),'call-signal:'||current_setting('test.role.coordinator_job'),'call-signal:'||current_setting('test.role.operations_job'))) then raise exception 'Non-senior call polluted health history';end if;
 if not exists(select 1 from public.care_events e join public.care_memberships m on m.user_id=e.payload->>'assignedTo' where e.kind='care_request' and e.payload->>'callJobId'=current_setting('test.role.coordinator_job') and m.role='operations' and m.is_admin=1) then raise exception 'Unavailable coordinator did not escalate to Operations';end if;
 update public.care_account_contacts set call_consent=false where user_id=current_setting('test.role.family')::uuid;
end $verify$;
set local role service_role;
do $revoked$ begin
 if public.care_voice_contact(current_setting('test.role.family_job')) is not null then raise exception 'Revoked call consent was ignored';end if;
end $revoked$;
reset role;
update public.care_account_contacts set phone='+19990000039',revision=revision+1 where user_id=current_setting('test.role.senior')::uuid;
set local role service_role;
do $changed$ begin
 if public.care_voice_contact(current_setting('test.role.senior_job')) is not null then raise exception 'Changed phone silently replaced a saved recipient';end if;
end $changed$;
rollback;
select 'PASS: four exact role destinations, linked briefing, immutable source, no non-senior health data, Operations escalation, consent withdrawal, phone change; all fixtures rolled back' as result;
