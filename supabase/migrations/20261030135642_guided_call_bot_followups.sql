-- Service callbacks resolve current account bindings rather than legacy contact events.
-- Background callbacks have no browser uid; the explicit service role can read
-- consent, while anonymous callers still cannot pass this helper.
create or replace function private.care_family_allowed(sid text) returns boolean
language sql stable security definer set search_path='' as $$
 select (auth.uid() is not null or private.care_service()) and exists(select 1 from public.care_consents c
  where c.owner='workspace:primary' and c.senior_id=sid and c.family_allowed)
$$;
create or replace function private.care_voice_recipient(job_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job jsonb;contact jsonb;sid text;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select e.payload into job from public.care_events e where e.id=job_id and e.owner='workspace:primary' and e.kind='telephony_job';sid:=job->>'seniorId';
 if job is null or job->>'channel'<>'voice_bot' or not exists(select 1 from public.care_memberships m
  where m.user_id=job->>'requestedBy' and m.workspace_id='primary' and m.role in ('coordinator','operations')
   and private.care_route_member(m.user_id,sid,m.role)) then return null;end if;
 select v into contact from jsonb_array_elements(private.care_live_contacts(sid)) v where v->>'id'=job->>'contactId'
  and v->>'role'='senior' and v->>'verified'='true' and v->>'callConsent'='true' limit 1;
 return contact;
end $$;

create table private.care_call_bot_followups (
 job_id text primary key references public.care_events(id),request_id uuid not null unique,
 senior_id text not null,created_at timestamptz not null default clock_timestamp()
);
alter table private.care_call_bot_followups enable row level security;
create policy call_bot_no_direct_access on private.care_call_bot_followups as restrictive for all to anon,authenticated using(false) with check(false);
revoke all on private.care_call_bot_followups from public,anon,authenticated;
grant all on private.care_call_bot_followups to service_role;

-- Register only a callback-created task. Browser clients cannot claim to be
-- this background caller, and normal shared-care checks remain unchanged.
do $guard$ declare source text;needle text;begin
 source:=pg_get_functiondef('private.care_shared_event_guard()'::regprocedure);
 needle:=' p:=new.payload;sid:=new.senior_id;staff:=private.care_has(sid,array[''coordinator'',''operations'']);';
 if strpos(source,needle)=0 then raise exception 'Review shared event guard before adding call tasks';end if;
 execute replace(source,needle,$body$
 if auth.uid() is null and private.care_service() and new.kind='care_request' and new.owner='workspace:primary'
  and new.payload->>'source'='call-bot' and exists(select 1 from private.care_call_bot_followups f
   where f.request_id::text=new.id and f.senior_id=new.senior_id and new.payload->>'callJobId'=f.job_id
    and new.payload->>'requestId'=new.id) then return new;end if;
 p:=new.payload;sid:=new.senior_id;staff:=private.care_has(sid,array['coordinator','operations']);
 $body$);
end $guard$;

create or replace function private.care_voice_apply(job_id text,expected_revision integer,payload jsonb,signal jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare previous public.care_events%rowtype;stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 state jsonb;summary jsonb;person jsonb;ident uuid;reason text;member record;topic text;known_date text;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select * into previous from public.care_events e where e.id=job_id and e.kind='telephony_job' and e.owner='workspace:primary' for update;
 if previous.id is null or (previous.payload#>>'{state,step}')::integer<>expected_revision then return false;end if;
 if previous.payload->>'channel'<>'voice_bot' or payload->>'id' is distinct from previous.payload->>'id'
  or payload->>'seniorId' is distinct from previous.senior_id or payload->>'contactId' is distinct from previous.payload->>'contactId'
  or payload->>'requestedBy' is distinct from previous.payload->>'requestedBy' then raise invalid_parameter_value;end if;
 if previous.payload->>'status'='queued' and payload->>'status'='submitting' then
  perform pg_advisory_xact_lock(hashtextextended('call-bot-single-caller',0));
  if private.care_voice_recipient(job_id) is null or (previous.payload->>'expiresAt')::timestamptz<=clock_timestamp()
   or exists(select 1 from public.care_events e where e.id<>job_id and e.kind='telephony_job' and e.payload->>'channel'='voice_bot'
    and e.payload->>'status' in ('submitting','accepted','ringing','answered','submission_unknown')) then raise insufficient_privilege;end if;
 end if;
 update public.care_events set payload=care_voice_apply.payload||jsonb_build_object('state',jsonb_build_object('step',expected_revision+1)) where id=job_id;
 state:=payload->'voiceState';summary:=state->'summary';known_date:=to_char(clock_timestamp() at time zone 'Asia/Kolkata','YYYY-MM-DD');
 if state->>'version'='2' then
  if signal is not null and (signal->>'seniorId' is distinct from previous.senior_id or signal->>'date' is distinct from known_date
   or state->>'consent'<>'granted' or (summary->>'answeredQuestions')::integer<1) then raise invalid_parameter_value;end if;
  if state->>'complete'='true' and summary is not null then
   if (summary->>'priority' in ('prompt','today') or state->>'callRequested'='true' or state->>'completionReason' in ('no_response','disconnected','not_started','wrong_person')) then
    person:=private.care_route_owner(previous.senior_id);ident:=gen_random_uuid();
    if person is not null then
     insert into private.care_call_bot_followups(job_id,request_id,senior_id) values(job_id,ident,previous.senior_id) on conflict do nothing;
     if found then
      topic:=case when state->>'helpRequested'='true' then 'Call promptly: help requested during automated check-in'
       when state->>'callRequested'='true' then 'Return the automated check-in callback request'
       when state->>'completionReason' in ('no_response','disconnected','not_started','wrong_person') then 'Arrange contact: automated check-in is incomplete'
       else 'Review the changes reported during the automated check-in' end;
      insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(ident::text,previous.owner,'care_request',previous.senior_id,
       jsonb_build_object('requestId',ident,'seniorId',previous.senior_id,'action',topic,'details','Verify identity and the reported answers with the senior. Unanswered questions remain unknown.',
        'source','call-bot','callJobId',job_id,'dueDate',known_date,'priority',case when state->>'helpRequested'='true' then 'prompt' else 'today' end,
        'status','requested','revision',1,'createdBy',person->>'userId','createdByRole',person->>'role','createdByName','AI Call Bot',
        'assignedTo',person->>'userId','assignedToName','Assigned care team','actorId',person->>'userId','actorName','AI Call Bot','createdAt',stamp,'updatedAt',stamp),stamp);
      if state->>'helpRequested'='true' and private.care_family_allowed(previous.senior_id) then
       for member in select distinct m.user_id from public.care_memberships m where m.workspace_id='primary' and m.status='active' and m.role='family'
        and (m.senior_id=previous.senior_id or m.scope_json::jsonb ? previous.senior_id) loop
        perform private.care_route_notice(previous.senior_id,member.user_id,'family','serious_alert',ident::text);
       end loop;
      end if;
     end if;
    end if;
   end if;
  end if;
 end if;
 if signal is not null then
  insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('call-signal:'||job_id,previous.owner,'signal',previous.senior_id,
   jsonb_build_object('type','note','record',signal,'mood',signal->>'mood','helpRequested',signal->'helpRequested'),stamp) on conflict do nothing;
 end if;
 return true;
end $$;

-- Append-only staff review. It does not rewrite answers or close the assigned task.
create function private.care_call_review_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op<>'INSERT' then if old.kind='call_bot_review' then raise insufficient_privilege;end if;return new;end if;
 if new.kind<>'call_bot_review' then return new;end if;
 if not private.care_has(new.senior_id,array['coordinator','operations']) or new.owner<>'workspace:primary'
  or new.payload->>'actorId' is distinct from auth.uid()::text or char_length(coalesce(new.payload->>'outcome','')) not between 5 and 1600
  or not exists(select 1 from public.care_events e where e.id=new.payload->>'jobId' and e.kind='telephony_job' and e.senior_id=new.senior_id and e.payload->>'channel'='voice_bot')
  or new.id is distinct from 'call-review:'||(new.payload->>'jobId') then raise insufficient_privilege;end if;
 return new;
end $$;
revoke all on function private.care_call_review_guard() from public,anon,authenticated,service_role;
create trigger care_call_review_guard before insert or update on public.care_events for each row execute function private.care_call_review_guard();
create policy call_reviews_staff on public.care_events as restrictive for all to authenticated
 using(kind<>'call_bot_review' or private.care_has(senior_id,array['coordinator','operations']))
 with check(kind<>'call_bot_review' or private.care_has(senior_id,array['coordinator','operations']));

-- New call-task alerts join the phone worker, without draining website history.
create function private.care_call_request_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare contact jsonb;begin
 if new.kind<>'telephony_job' or new.payload->>'channel'<>'voice_bot' or private.care_service() then return new;end if;
 if not private.care_has(new.senior_id,array['coordinator','operations']) then raise insufficient_privilege;end if;
 if tg_op='INSERT' then
  perform pg_advisory_xact_lock(hashtextextended('call-bot-request-budget',0));
  select c into contact from jsonb_array_elements(private.care_live_contacts(new.senior_id)) c where c->>'id'=new.payload->>'contactId'
   and c->>'role'='senior' and c->>'callConsent'='true' limit 1;
  if contact is null or new.payload->>'requestedBy' is distinct from auth.uid()::text or new.payload->>'status'<>'queued'
   or new.payload->>'template'<>'checkin' or new.payload->>'language' not in ('hi','en') then raise insufficient_privilege;end if;
  if (new.payload-array['id','seniorId','contactId','recipientRole','channel','template','language','text','status','requestHash','state','createdAt','expiresAt','asOfDate','requestedBy','externalDelivery','deliveredToHandset','humanRead'])<>'{}'::jsonb
   or new.payload->>'id' is distinct from new.id or new.payload->>'seniorId' is distinct from new.senior_id
   or new.payload->'state' is distinct from '{"step":0}'::jsonb or new.payload->'externalDelivery' is distinct from 'false'::jsonb
   or new.payload->'humanRead' is distinct from 'false'::jsonb or new.payload->>'recipientRole'<>'senior' then raise invalid_parameter_value;end if;
  if extract(hour from clock_timestamp() at time zone 'Asia/Kolkata') not between 8 and 19 then raise exception using errcode='P0001',message='Trial wellbeing calls are available between 08:00 and 20:00 IST';end if;
  if (select count(*) from public.care_events e where e.kind='telephony_job' and e.payload->>'channel'='voice_bot' and e.created_at::timestamptz>clock_timestamp()-interval '1 day')>=5 then raise check_violation using message='Five bot call requests per showcase day are allowed';end if;
 end if;
 if tg_op='UPDATE' then
  if (new.payload-array['state','status','voiceState','callbackTokenHash','callbackOrigin','provider','providerId','updatedAt','lastError'])
   is distinct from (old.payload-array['state','status','voiceState','callbackTokenHash','callbackOrigin','provider','providerId','updatedAt','lastError'])
   or not (old.payload->>'status'='queued' and new.payload->>'status' in ('cancelled','submitting')
    or old.payload->>'status'='submitting' and new.payload->>'status' in ('accepted','submission_unknown')) then raise insufficient_privilege;end if;
  if old.payload->>'status'<>'queued' and new.payload->'voiceState' is distinct from old.payload->'voiceState' then raise insufficient_privilege;end if;
  if new.payload->>'status'='submitting' and (new.payload#>>'{voiceState,version}' is distinct from '2'
   or new.payload#>>'{voiceState,consent}' is distinct from 'pending' or new.payload#>'{voiceState,answers}' is distinct from '{}'::jsonb
   or new.payload#>>'{voiceState,cursor}' is distinct from '0' or coalesce(new.payload->>'callbackTokenHash','') !~ '^[a-f0-9]{64}$') then raise invalid_parameter_value;end if;
 end if;
 if tg_op='UPDATE' and new.payload->>'status'='submitting' and old.payload->>'status'='queued' then
  perform pg_advisory_xact_lock(hashtextextended('call-bot-single-caller',0));
  if exists(select 1 from public.care_events e where e.id<>new.id and e.kind='telephony_job' and e.payload->>'channel'='voice_bot'
   and e.payload->>'status' in ('submitting','accepted','ringing','answered','submission_unknown')) then raise check_violation using message='Inspect the active call before starting another';end if;
 end if;
 return new;
end $$;
revoke all on function private.care_call_request_guard() from public,anon,authenticated,service_role;
create trigger care_call_request_guard before insert or update on public.care_events for each row execute function private.care_call_request_guard();

do $filter$ declare source text;needle text;replacement text;begin
 needle:='or exists(select 1 from public.care_sms_checkins sc where sc.followup_id::text=n.source_id or sc.overdue_task_id::text=n.source_id or sc.review_task_id::text=n.source_id)';
 replacement:=needle||' or exists(select 1 from private.care_call_bot_followups cf where cf.request_id::text=n.source_id)';
 source:=pg_get_functiondef('private.care_notification_routing(text,jsonb)'::regprocedure);
 if strpos(source,needle)=0 then raise exception 'Review phone-only routing for call bot';end if;execute replace(source,needle,replacement);
 source:=pg_get_functiondef('private.care_phone_support(text,jsonb)'::regprocedure);
 if strpos(source,needle)=0 then raise exception 'Review phone-only queue for call bot';end if;execute replace(source,needle,replacement);
end $filter$;
