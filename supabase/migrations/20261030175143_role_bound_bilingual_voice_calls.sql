-- Resolve exactly the saved account role, assignment, contact revision and
-- channel permission. A trial's verified helpline is never a substitute To.
create or replace function private.care_voice_dispatch_config() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select coalesce(jsonb_object_agg(case name
  when 'samarth_twilio_auth_token' then 'TWILIO_AUTH_TOKEN'
  when 'samarth_twilio_trial_enabled' then 'SAMARTH_TWILIO_TRIAL_ENABLED'
  when 'samarth_twilio_account_sid' then 'TWILIO_ACCOUNT_SID'
  when 'samarth_twilio_from_number' then 'TWILIO_FROM_NUMBER'
  when 'samarth_public_url' then 'SAMARTH_PUBLIC_URL'
  when 'samarth_n8n_hmac_secret' then 'SAMARTH_N8N_HMAC_SECRET'
  when 'samarth_call_bot_spoken_choices' then 'SAMARTH_CALL_BOT_SPOKEN_CHOICES'
 end,decrypted_secret),'{}') into result from vault.decrypted_secrets
 where name in ('samarth_twilio_auth_token','samarth_twilio_trial_enabled','samarth_twilio_account_sid','samarth_twilio_from_number','samarth_public_url','samarth_n8n_hmac_secret','samarth_call_bot_spoken_choices');
 return result;
end $$;
do $speech$ declare flag_id uuid;begin
 select id into flag_id from vault.secrets where name='samarth_call_bot_spoken_choices';
 if flag_id is null then perform vault.create_secret('true','samarth_call_bot_spoken_choices','Enable consented English/Hindi speech choices for the trial call bot');
 else perform vault.update_secret(flag_id,'true');end if;
end $speech$;

create or replace function private.care_voice_recipient(job_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job jsonb;contact jsonb;sid text;source public.care_phone_requests%rowtype;cue_ids jsonb:='[]';
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select e.payload into job from public.care_events e where e.id=job_id and e.owner='workspace:primary' and e.kind='telephony_job';sid:=job->>'seniorId';
 if job is null or job->>'channel'<>'voice_bot' or not exists(select 1 from public.care_memberships m
  where m.user_id=job->>'requestedBy' and m.workspace_id='primary' and m.role in ('coordinator','operations')
   and private.care_route_member(m.user_id,sid,m.role)) then return null;end if;
 select v into contact from jsonb_array_elements(private.care_live_contacts(sid)) v where v->>'id'=job->>'contactId'
  and v->>'role'=coalesce(job->>'recipientRole','senior') and v->>'verified'='true' and v->>'callConsent'='true' limit 1;
 if contact is null then return null;end if;
 if job ? 'sourceRequestId' then
  select * into source from public.care_phone_requests p where p.id::text=job->>'sourceRequestId' and p.senior_id=sid and p.status<>'closed';
  if source.id is null or contact->>'role'='coordinator' and source.assigned_to::text is distinct from contact->>'userId' then return null;end if;
  select coalesce(jsonb_agg(cue),'[]') into cue_ids from (
   select distinct c->>'cue' as cue from jsonb_array_elements(case when jsonb_typeof(source.analysis->'cues')='array' then source.analysis->'cues' else '[]'::jsonb end)c
   where c->>'cue' ~ '^[a-z_]{2,40}$' order by cue limit 8
  ) q;
 end if;
 return contact||jsonb_build_object('voiceNotice',jsonb_build_object('reference',sid,'cues',cue_ids,'kind',coalesce(source.kind,'care_update'),'urgent',coalesce(source.analysis->>'urgency'='immediate',false)));
end $$;

-- Expand creation to the role's own purpose, without opening arbitrary numbers,
-- call content, role switching, source replacement or client-written outcomes.
do $roles$
declare source text;old_text text;new_text text;
begin
 source:=pg_get_functiondef('private.care_call_request_guard()'::regprocedure);
 old_text:='and c->>''role''=''senior'' and c->>''callConsent''=''true''';
 if strpos(source,old_text)=0 then raise exception 'Review changed call contact guard';end if;
 source:=replace(source,old_text,'and c->>''role''=new.payload->>''recipientRole'' and c->>''callConsent''=''true''');
 old_text:='new.payload->>''template''<>''checkin''';
 new_text:='new.payload->>''template'' is distinct from (case new.payload->>''recipientRole'' when ''senior'' then ''checkin'' when ''family'' then ''followup'' when ''coordinator'' then ''staff_alert'' when ''operations'' then ''escalation'' end)';
 if strpos(source,old_text)=0 then raise exception 'Review changed call purpose guard';end if;
 source:=replace(source,old_text,new_text);
 source:=replace(source,'''humanRead''])','''humanRead'',''sourceRequestId''])');
 source:=replace(source,'new.payload->>''recipientRole''<>''senior''','new.payload->>''recipientRole'' not in (''senior'',''family'',''coordinator'',''operations'')');
 old_text:='  if extract(hour from clock_timestamp()';
 new_text:=$context$
  if new.payload ? 'sourceRequestId' and not exists(select 1 from public.care_phone_requests p
   where p.id::text=new.payload->>'sourceRequestId' and p.senior_id=new.senior_id and p.status<>'closed'
    and (new.payload->>'recipientRole'<>'coordinator' or p.assigned_to::text=contact->>'userId')) then raise insufficient_privilege;end if;
  if new.payload->>'text' is distinct from private.care_sms_text(new.payload->>'template',new.payload->>'language',new.payload->>'recipientRole') then raise invalid_parameter_value;end if;
  if extract(hour from clock_timestamp()
$context$;
 if strpos(source,old_text)=0 then raise exception 'Review changed call hours guard';end if;
 source:=replace(source,old_text,trim(trailing E'\n' from new_text));
 execute source;
end $roles$;

-- Non-senior responses are operational outcomes, never patient observations.
-- Requests for backup/unavailable staff go to the sole Operations administrator.
create function private.care_voice_notice_followup(job_id text) returns void
language plpgsql security definer set search_path='' as $$
declare job public.care_events%rowtype;s jsonb;person jsonb;ident uuid;topic text;
 stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select * into job from public.care_events where id=job_id and owner='workspace:primary' and kind='telephony_job';s:=job.payload->'voiceState';
 if job.id is null or job.payload->>'recipientRole'='senior' or s->>'complete'<>'true'
  or not(s->>'callRequested'='true' or s->>'completionReason' in ('no_response','disconnected','not_started','wrong_person','declined')) then return;end if;
 if job.payload ? 'sourceRequestId' and not exists(select 1 from public.care_phone_requests p where p.id::text=job.payload->>'sourceRequestId' and p.senior_id=job.senior_id and p.status<>'closed') then return;end if;
 if job.payload->>'recipientRole' in ('coordinator','operations') or s->>'completionReason'='not_started' then
  select jsonb_build_object('userId',m.user_id,'role',m.role) into person from public.care_memberships m
   where m.workspace_id='primary' and m.role='operations' and m.is_admin=1 and private.care_route_member(m.user_id,job.senior_id,m.role) limit 1;
 else person:=private.care_route_owner(job.senior_id);end if;
 if person is null then return;end if;
 ident:=gen_random_uuid();
 insert into private.care_call_bot_followups(job_id,request_id,senior_id) values(job_id,ident,job.senior_id) on conflict do nothing;
 if not found then return;end if;
 topic:=case when s->>'completionReason'='not_started' then 'Operations review: automated call could not be started' when job.payload->>'recipientRole'='family' then 'Contact family: automated care update needs a response' else 'Operations review: care-call recipient needs backup or is unavailable' end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(ident::text,job.owner,'care_request',job.senior_id,
  jsonb_build_object('requestId',ident,'seniorId',job.senior_id,'action',topic,'details','Review the saved recipient response and the linked care request. No senior health answer was obtained from this contact.',
   'source','call-bot','callJobId',job_id,'dueDate',to_char(clock_timestamp() at time zone 'Asia/Kolkata','YYYY-MM-DD'),
   'priority',case when s#>>'{notice,urgent}'='true' then 'prompt' else 'today' end,'status','requested','revision',1,
   'createdBy',person->>'userId','createdByRole',person->>'role','createdByName','AI Call Bot','assignedTo',person->>'userId',
   'assignedToName','Assigned care team','actorId',person->>'userId','actorName','AI Call Bot','createdAt',stamp,'updatedAt',stamp),stamp);
end $$;
revoke all on function private.care_voice_notice_followup(text) from public,anon,authenticated,service_role;

do $outcomes$
declare source text;old_text text;new_text text;
begin
 source:=pg_get_functiondef('private.care_voice_apply(text,integer,jsonb,jsonb)'::regprocedure);
 old_text:=' update public.care_events set payload=care_voice_apply.payload';
 new_text:=$identity$
 if payload->>'recipientRole' is distinct from previous.payload->>'recipientRole'
  or payload->'sourceRequestId' is distinct from previous.payload->'sourceRequestId'
  or payload->>'language' is distinct from previous.payload->>'language'
  or coalesce(payload#>>'{voiceState,recipientRole}','senior') is distinct from coalesce(previous.payload->>'recipientRole','senior')
  or (coalesce(previous.payload->>'recipientRole','senior')<>'senior' and signal is not null) then raise invalid_parameter_value;end if;
 update public.care_events set payload=care_voice_apply.payload
$identity$;
 if strpos(source,old_text)=0 then raise exception 'Review changed voice persistence';end if;
 source:=replace(source,old_text,trim(trailing E'\n' from new_text));
 source:=replace(source,'if state->>''version''=''2'' then','if state->>''version''=''2'' and coalesce(previous.payload->>''recipientRole'',''senior'')=''senior'' then');
 source:=replace(source,'(summary->>''answeredQuestions'')::integer<1','((summary->>''answeredQuestions'')::integer<1 and coalesce((summary->>''reportedCueCount'')::integer,0)<1)');
 old_text:=' if signal is not null then';
 if strpos(source,old_text)=0 then raise exception 'Review changed voice observation boundary';end if;
 source:=replace(source,old_text,E' if coalesce(previous.payload->>''recipientRole'',''senior'')<>''senior'' then perform private.care_voice_notice_followup(job_id);end if;\n'||old_text);
 execute source;
end $outcomes$;
