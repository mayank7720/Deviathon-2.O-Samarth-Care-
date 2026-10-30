-- Two independent, opt-in automations. No existing contact is enrolled and no
-- call is made by this migration. The existing manual/trial guards remain.
create table private.care_call_auto_control (
 id boolean primary key default true check(id), enabled boolean not null default false,
 revision integer not null default 1, budget_minutes integer not null default 0 check(budget_minutes between 0 and 75),
 reserved_minutes integer not null default 0 check(reserved_minutes>=0), checked_at timestamptz,
 updated_at timestamptz not null default clock_timestamp(), updated_by uuid,
 worker_at timestamptz, worker_reason text
);
insert into private.care_call_auto_control(id) values(true);
create table private.care_call_auto_settings (
 senior_id text primary key, daily_enabled boolean not null default false, help_enabled boolean not null default false,
 daily_time time not null default '10:00' check(daily_time>='08:00' and daily_time<'20:00'),
 language text not null default 'hi' check(language in ('hi','en')), revision integer not null default 1,
 senior_contact_id text, owner_contact_id text, owner_id uuid,
 daily_enabled_at timestamptz, help_enabled_at timestamptz,
 updated_at timestamptz not null default clock_timestamp(), updated_by uuid not null
);
create table private.care_call_auto_runs (
 id uuid primary key default gen_random_uuid(), action_key text not null unique,
 senior_id text not null, origin text not null check(origin in ('daily','help_sms')),
 source_request_id uuid references public.care_phone_requests(id),
 settings_revision integer not null, language text not null, requested_by uuid not null,
 senior_contact_id text not null, owner_contact_id text not null, owner_id uuid not null,
 status text not null default 'pending_senior' check(status in ('pending_senior','senior_call','pending_brief','briefing_call','completed','blocked','cancelled')),
 reason text, due_at timestamptz not null, expires_at timestamptz not null,
 senior_job_id text, brief_job_id text, lease_until timestamptz, needs_attention boolean not null default false,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index care_call_auto_due on private.care_call_auto_runs(due_at) where status in ('pending_senior','pending_brief','senior_call','briefing_call');
create index care_call_auto_senior on private.care_call_auto_runs(senior_id,created_at desc);
create table private.care_call_auto_log (
 id bigint generated always as identity primary key, run_id uuid references private.care_call_auto_runs(id),
 senior_id text, event text not null, reason text, actor_id uuid, created_at timestamptz not null default clock_timestamp()
);
create index care_call_auto_log_run on private.care_call_auto_log(run_id,id);
alter table private.care_call_auto_control enable row level security;
alter table private.care_call_auto_settings enable row level security;
alter table private.care_call_auto_runs enable row level security;
alter table private.care_call_auto_log enable row level security;
revoke all on private.care_call_auto_control,private.care_call_auto_settings,private.care_call_auto_runs,private.care_call_auto_log from public,anon,authenticated,service_role;

create function private.care_auto_time() returns timestamptz language sql volatile set search_path='' as $$select clock_timestamp()$$;
revoke all on function private.care_auto_time() from public,anon,authenticated,service_role;

-- Live contacts retain the existing account, assignment and family checks.
-- The shared-number test includes other active account roles, not just seniors.
create function private.care_auto_contacts(sid text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare senior jsonb; owner_contact jsonb; person jsonb; contacts jsonb; why text; service_phone text;
begin
 contacts:=private.care_live_contacts(sid);person:=private.care_route_owner(sid);
 if (select count(*) from jsonb_array_elements(contacts)c where c->>'role'='senior' and c->>'verified'='true' and c->>'callConsent'='true')<>1 then why:='senior_contact';
 else
  select c into senior from jsonb_array_elements(contacts)c where c->>'role'='senior' and c->>'verified'='true' and c->>'callConsent'='true';
  select c into owner_contact from jsonb_array_elements(contacts)c where c->>'userId'=person->>'userId' and c->>'role'=person->>'role' and c->>'verified'='true' and c->>'callConsent'='true' limit 1;
  if owner_contact is null then why:='coordinator_contact';end if;
 end if;
 if why is null then
  select decrypted_secret into service_phone from vault.decrypted_secrets where name='samarth_twilio_from_number';
  if senior->>'phone'=owner_contact->>'phone' or senior->>'phone'=service_phone or owner_contact->>'phone'=service_phone
   or exists(select 1 from public.care_account_contacts c join public.care_memberships m on m.user_id=c.user_id::text
    where c.phone in (senior->>'phone',owner_contact->>'phone') and m.status='active' and m.workspace_id='primary'
     and c.user_id::text not in (senior->>'userId',owner_contact->>'userId')) then why:='shared_number';end if;
 end if;
 return jsonb_build_object('senior',senior,'owner',owner_contact,'reason',why);
end $$;
revoke all on function private.care_auto_contacts(text) from public,anon,authenticated,service_role;

create function private.care_auto_log(run uuid,sid text,event text,reason text default null,actor uuid default null) returns void
language sql security definer set search_path='' as $$
 insert into private.care_call_auto_log(run_id,senior_id,event,reason,actor_id) values(run,sid,event,reason,actor)
$$;
revoke all on function private.care_auto_log(uuid,text,text,text,uuid) from public,anon,authenticated,service_role;

create function private.care_auto_manual_reserved(since timestamptz) returns integer
language sql stable security definer set search_path='' as $$
 select (4*count(*))::integer from public.care_events e where e.kind='telephony_job' and e.payload->>'channel'='voice_bot'
  and not(e.payload ? 'automationRunId') and e.created_at::timestamptz>=since
$$;
revoke all on function private.care_auto_manual_reserved(timestamptz) from public,anon,authenticated,service_role;

create function private.care_call_automation(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.care_call_auto_control%rowtype; setting private.care_call_auto_settings%rowtype;
 sid text; c jsonb; stamp timestamptz:=private.care_auto_time();
begin
 if not private.care_actor_enabled() or not private.care_has('',array['coordinator','operations']) then raise insufficient_privilege;end if;
 if jsonb_typeof(payload)<>'object' then raise invalid_parameter_value;end if;
 if action='list' then
  select * into cfg from private.care_call_auto_control where id;
  return jsonb_build_object('version','care-call-automation-v1','isAdmin',private.care_admin(),
   'control',jsonb_build_object('enabled',cfg.enabled,'revision',cfg.revision,'remainingMinutes',greatest(0,cfg.budget_minutes-cfg.reserved_minutes-private.care_auto_manual_reserved(cfg.checked_at)),
    'reservedMinutes',cfg.reserved_minutes+private.care_auto_manual_reserved(cfg.checked_at),'checkedAt',cfg.checked_at,'workerAt',cfg.worker_at,'workerReason',cfg.worker_reason),
   'settings',coalesce((with candidates as materialized(select p.senior_id,p.name,private.care_auto_contacts(p.senior_id) contact from public.care_profiles p
    where p.owner='workspace:primary' and private.care_has(p.senior_id,array['coordinator','operations'])
     and (exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.role='senior' and m.status='active' and m.senior_id=p.senior_id)
       or exists(select 1 from private.care_call_auto_settings previous where previous.senior_id=p.senior_id)))
    select jsonb_agg(x order by x->>'seniorId') from (select jsonb_build_object(
    'seniorId',p.senior_id,'name',p.name,'revision',coalesce(s.revision,0),'dailyEnabled',coalesce(s.daily_enabled,false),'helpEnabled',coalesce(s.help_enabled,false),
    'dailyTime',left(coalesce(s.daily_time,'10:00'::time)::text,5),'language',coalesce(s.language,'hi'),'updatedAt',s.updated_at,
    'ready',(p.contact->>'reason' is null),'blockedReason',coalesce(p.contact->>'reason',case when s.senior_contact_id is not null and (p.contact#>>'{senior,id}' is distinct from s.senior_contact_id or p.contact#>>'{owner,id}' is distinct from s.owner_contact_id) then 'contact_changed' end),
    'seniorMobile',case when p.contact#>>'{senior,phone}' is not null then left(p.contact#>>'{senior,phone}',3)||'••••'||right(p.contact#>>'{senior,phone}',3) end,
    'ownerName',p.contact#>>'{owner,name}',
    'ownerMobile',case when p.contact#>>'{owner,phone}' is not null then left(p.contact#>>'{owner,phone}',3)||'••••'||right(p.contact#>>'{owner,phone}',3) end) x
    from candidates p left join private.care_call_auto_settings s on s.senior_id=p.senior_id)q),'[]'::jsonb),
   'runs',coalesce((select jsonb_agg(x order by x->>'createdAt' desc) from(select jsonb_build_object('id',r.id,'seniorId',r.senior_id,'origin',r.origin,
    'sourceRequestId',r.source_request_id,'status',r.status,'reason',r.reason,'needsAttention',r.needs_attention,'createdAt',r.created_at,'dueAt',r.due_at,
    'seniorJobId',r.senior_job_id,'briefJobId',r.brief_job_id,
    'seniorCall',(select jsonb_build_object('status',e.payload->>'status','consent',e.payload#>>'{voiceState,consent}','summary',e.payload#>'{voiceState,summary}') from public.care_events e where e.id=r.senior_job_id),
    'briefingCall',(select jsonb_build_object('status',e.payload->>'status','response',e.payload#>>'{voiceState,answers,noticeResponse}') from public.care_events e where e.id=r.brief_job_id),
    'timeline',(select coalesce(jsonb_agg(jsonb_build_object('event',l.event,'reason',l.reason,'at',l.created_at) order by l.id),'[]') from private.care_call_auto_log l where l.run_id=r.id))x
    from private.care_call_auto_runs r where private.care_has(r.senior_id,array['coordinator','operations']) order by r.created_at desc limit 60)q),'[]'::jsonb));
 end if;
 if action='control' then
  if not private.care_admin() then raise insufficient_privilege;end if;
  if (payload-array['revision','enabled','remainingMinutes','allowanceConfirmed'])<>'{}' or jsonb_typeof(payload->'enabled')<>'boolean'
   or coalesce(payload->>'revision','')!~'^[0-9]{1,8}$' or coalesce(payload->>'remainingMinutes','')!~'^[0-9]{1,2}$'
   or (payload->>'remainingMinutes')::integer not between 0 and 75 then raise invalid_parameter_value;end if;
  select * into cfg from private.care_call_auto_control where id for update;
  if cfg.revision<>(payload->>'revision')::integer then raise exception using errcode='P0001',message='Settings changed. Refresh before saving.';end if;
  if payload->>'enabled'='true' and (payload->>'allowanceConfirmed' is distinct from 'true' or (payload->>'remainingMinutes')::integer<8) then
   raise exception using errcode='P0001',message='Confirm at least eight remaining free-trial minutes before arming automatic calls.';end if;
  if payload->>'allowanceConfirmed'='true' and exists(select 1 from public.care_events e where e.kind='telephony_job' and e.payload->>'channel'='voice_bot' and e.payload->>'status' in ('submitting','accepted','ringing','answered','submission_unknown')) then
   raise exception using errcode='P0001',message='Reconcile the active or uncertain call before resetting the trial allowance.';end if;
  update private.care_call_auto_control set enabled=(payload->>'enabled')::boolean,revision=revision+1,
   budget_minutes=case when payload->>'allowanceConfirmed'='true' then (payload->>'remainingMinutes')::integer else budget_minutes end,
   reserved_minutes=case when payload->>'allowanceConfirmed'='true' then (select (count(*)*4)::integer from public.care_events e where e.kind='telephony_job' and e.payload->>'channel'='voice_bot' and e.payload->>'status'='queued') else reserved_minutes end,
   checked_at=case when payload->>'allowanceConfirmed'='true' then stamp else checked_at end,updated_at=stamp,updated_by=auth.uid() where id;
  if payload->>'enabled'='false' then
   update public.care_events e set payload=e.payload||jsonb_build_object('status','cancelled','updatedAt',stamp,'state',jsonb_build_object('step',coalesce((e.payload#>>'{state,step}')::integer,0)+1))
    where e.kind='telephony_job' and e.payload ? 'automationRunId' and e.payload->>'status'='queued';
   with cancelled as (update private.care_call_auto_runs r set status='cancelled',reason='paused',updated_at=stamp
    where r.status in ('pending_senior','pending_brief') or r.status in ('senior_call','briefing_call') and exists(select 1 from public.care_events e where e.id=case r.status when 'senior_call' then r.senior_job_id else r.brief_job_id end and e.payload->>'status'='cancelled')
    returning r.id,r.senior_id)
   insert into private.care_call_auto_log(run_id,senior_id,event,reason,actor_id) select id,senior_id,'undispatched_calls_cancelled','paused',auth.uid() from cancelled;
  end if;
  perform private.care_auto_log(null,null,case when payload->>'enabled'='true' then 'automation_armed' else 'automation_paused' end,null,auth.uid());
  return jsonb_build_object('ok',true);
 end if;
 if action<>'save' then raise invalid_parameter_value;end if;
 sid:=payload->>'seniorId';
 if not private.care_has(sid,array['coordinator','operations']) or not exists(select 1 from public.care_profiles where owner='workspace:primary' and senior_id=sid) then raise insufficient_privilege;end if;
 if (payload-array['seniorId','revision','dailyEnabled','helpEnabled','dailyTime','language','trialVerified','consentConfirmed'])<>'{}'
  or jsonb_typeof(payload->'dailyEnabled')<>'boolean' or jsonb_typeof(payload->'helpEnabled')<>'boolean'
  or coalesce(payload->>'dailyTime','')!~'^(0[89]|1[0-9]):[0-5][0-9]$' or coalesce(payload->>'language','') not in ('hi','en')
  or coalesce(payload->>'revision','')!~'^[0-9]{1,8}$' then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('call-auto-settings:'||sid,0));
 select * into setting from private.care_call_auto_settings where senior_id=sid for update;
 if coalesce(setting.revision,0)<>(payload->>'revision')::integer then raise exception using errcode='P0001',message='This senior’s settings changed. Refresh before saving.';end if;
 c:=private.care_auto_contacts(sid);
 if payload->>'dailyEnabled'='true' or payload->>'helpEnabled'='true' then
  if payload->>'trialVerified' is distinct from 'true' or payload->>'consentConfirmed' is distinct from 'true' then raise invalid_parameter_value;end if;
  if c->>'reason' is not null then raise exception using errcode='P0001',message='Confirm unique voice-enabled senior and care-owner mobiles under Accounts before enabling automatic calls.';end if;
 end if;
 insert into private.care_call_auto_settings(senior_id,daily_enabled,help_enabled,daily_time,language,revision,senior_contact_id,owner_contact_id,owner_id,daily_enabled_at,help_enabled_at,updated_at,updated_by)
 values(sid,(payload->>'dailyEnabled')::boolean,(payload->>'helpEnabled')::boolean,(payload->>'dailyTime')::time,payload->>'language',coalesce(setting.revision,0)+1,
  c#>>'{senior,id}',c#>>'{owner,id}',(c#>>'{owner,userId}')::uuid,
  case when payload->>'dailyEnabled'='true' then case when setting.daily_enabled then setting.daily_enabled_at else stamp end end,
  case when payload->>'helpEnabled'='true' then case when setting.help_enabled then setting.help_enabled_at else stamp end end,stamp,auth.uid())
 on conflict(senior_id) do update set daily_enabled=excluded.daily_enabled,help_enabled=excluded.help_enabled,daily_time=excluded.daily_time,language=excluded.language,
  revision=excluded.revision,senior_contact_id=excluded.senior_contact_id,owner_contact_id=excluded.owner_contact_id,owner_id=excluded.owner_id,
  daily_enabled_at=excluded.daily_enabled_at,help_enabled_at=excluded.help_enabled_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
 perform private.care_auto_log(null,sid,'settings_saved',null,auth.uid());
 return jsonb_build_object('ok',true,'revision',coalesce(setting.revision,0)+1);
end $$;
revoke all on function private.care_call_automation(text,jsonb) from public,anon,authenticated,service_role;
create function public.care_call_automation(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.care_call_automation(action,payload)$$;
grant execute on function private.care_call_automation(text,jsonb) to authenticated;
revoke all on function public.care_call_automation(text,jsonb) from public,anon,service_role;
grant execute on function public.care_call_automation(text,jsonb) to authenticated;

create function private.care_auto_phone_plan() returns trigger
language plpgsql security definer set search_path='' as $$
declare setting private.care_call_auto_settings%rowtype; rid uuid; why text; c jsonb;
begin
 if new.kind<>'help' or new.senior_id is null then return new;end if;
 select * into setting from private.care_call_auto_settings where senior_id=new.senior_id and help_enabled and help_enabled_at<=new.created_at and help_enabled_at<=new.received_at;
 if not found then return new;end if;
 if new.created_at-new.received_at>interval '5 minutes' then return new;end if;
 c:=private.care_auto_contacts(new.senior_id);
 -- A family report can alert staff but does not silently trigger a senior bot.
 if new.sender is distinct from c#>>'{senior,phone}' or new.assigned_to is distinct from setting.owner_id then return new;end if;
 why:=case when not(select enabled from private.care_call_auto_control where id) then 'paused' when c->>'reason' is not null then c->>'reason' end;
 insert into private.care_call_auto_runs(action_key,senior_id,origin,source_request_id,settings_revision,language,requested_by,senior_contact_id,owner_contact_id,owner_id,due_at,expires_at,status,reason,needs_attention)
 values('help:'||new.id,new.senior_id,'help_sms',new.id,setting.revision,setting.language,setting.updated_by,setting.senior_contact_id,setting.owner_contact_id,setting.owner_id,
  private.care_auto_time(),private.care_auto_time()+interval '30 minutes',case when why is null then 'pending_senior' else 'blocked' end,why,why is not null)
 on conflict(action_key) do nothing returning id into rid;
 if rid is not null then perform private.care_auto_log(rid,new.senior_id,'help_text_matched',why);end if;
 return new;
end $$;
revoke all on function private.care_auto_phone_plan() from public,anon,authenticated,service_role;
create trigger care_auto_help_after_insert after insert on public.care_phone_requests for each row execute function private.care_auto_phone_plan();

create function private.care_auto_job_allowed(jid text) returns boolean
language plpgsql security definer set search_path='' as $$
declare job jsonb; r private.care_call_auto_runs%rowtype;s private.care_call_auto_settings%rowtype;c private.care_call_auto_control%rowtype;contacts jsonb;
begin
 if not private.care_service() then return false;end if;
 select payload into job from public.care_events where id=jid and kind='telephony_job' and owner='workspace:primary';
 if job->>'automationRunId' is null then return true;end if;
 select * into r from private.care_call_auto_runs where id::text=job->>'automationRunId';
 select * into s from private.care_call_auto_settings where senior_id=r.senior_id;
 select * into c from private.care_call_auto_control where id;
 if r.id is null or not c.enabled or c.checked_at is null or c.checked_at<private.care_auto_time()-interval '24 hours'
  or r.settings_revision<>s.revision or r.status not in ('senior_call','briefing_call')
  or r.origin='daily' and not s.daily_enabled or r.origin='help_sms' and not s.help_enabled
  or job->>'seniorId'<>r.senior_id or job->>'requestedBy'<>r.requested_by::text
  or not (job->>'automationPhase'='senior' and r.senior_job_id=jid and job->>'contactId'=r.senior_contact_id
    or job->>'automationPhase'='brief' and r.brief_job_id=jid and job->>'contactId'=r.owner_contact_id) then return false;end if;
 contacts:=private.care_auto_contacts(r.senior_id);
 return contacts->>'reason' is null and contacts#>>'{senior,id}'=r.senior_contact_id and contacts#>>'{owner,id}'=r.owner_contact_id
  and (r.source_request_id is null or exists(select 1 from public.care_phone_requests p where p.id=r.source_request_id and p.senior_id=r.senior_id and p.assigned_to=r.owner_id and p.status<>'closed' and p.sender=contacts#>>'{senior,phone}'));
end $$;
revoke all on function private.care_auto_job_allowed(text) from public,anon,authenticated,service_role;

-- Preserve all existing manual-call recipient checks and enrich only a saved
-- automatic briefing with bounded, structured facts from its own senior call.
create or replace function private.care_voice_recipient(job_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job jsonb;contact jsonb;sid text;source public.care_phone_requests%rowtype;cue_ids jsonb:='[]'; prior jsonb;notice jsonb;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select e.payload into job from public.care_events e where e.id=job_id and e.owner='workspace:primary' and e.kind='telephony_job';sid:=job->>'seniorId';
 if job is null or job->>'channel'<>'voice_bot' or not exists(select 1 from public.care_memberships m
  where m.user_id=job->>'requestedBy' and m.workspace_id='primary' and m.role in ('coordinator','operations') and private.care_route_member(m.user_id,sid,m.role)) then return null;end if;
 if job ? 'automationRunId' and not private.care_auto_job_allowed(job_id) then return null;end if;
 select v into contact from jsonb_array_elements(private.care_live_contacts(sid))v where v->>'id'=job->>'contactId' and v->>'role'=coalesce(job->>'recipientRole','senior') and v->>'verified'='true' and v->>'callConsent'='true' limit 1;
 if contact is null then return null;end if;
 if job ? 'sourceRequestId' then
  select * into source from public.care_phone_requests p where p.id::text=job->>'sourceRequestId' and p.senior_id=sid and p.status<>'closed';
  if source.id is null or contact->>'role'='coordinator' and source.assigned_to::text is distinct from contact->>'userId' then return null;end if;
  select coalesce(jsonb_agg(cue),'[]') into cue_ids from(select distinct c->>'cue' as cue from jsonb_array_elements(case when jsonb_typeof(source.analysis->'cues')='array' then source.analysis->'cues' else '[]'::jsonb end)c where c->>'cue' ~ '^[a-z_]{2,40}$' order by cue limit 8)q;
 end if;
 notice:=jsonb_build_object('reference',sid,'cues',cue_ids,'kind',coalesce(source.kind,'care_update'),'urgent',coalesce(source.analysis->>'urgency'='immediate',false));
 if job->>'automationPhase'='brief' then
  select e.payload->'voiceState' into prior from private.care_call_auto_runs r left join public.care_events e on e.id=r.senior_job_id where r.id::text=job->>'automationRunId';
  notice:=notice||jsonb_build_object('checkin',jsonb_build_object('completionReason',coalesce(prior->>'completionReason','not_started'),'consent',prior->>'consent',
   'answers',coalesce(prior->'answers','{}'::jsonb),'reportedCues',coalesce(prior->'reportedCues','[]'::jsonb)));
 end if;
 return contact||jsonb_build_object('voiceNotice',notice);
end $$;

create function private.care_auto_attention(rid uuid,why text) returns void
language plpgsql security definer set search_path='' as $$
declare r private.care_call_auto_runs%rowtype;manager text;
begin
 select * into r from private.care_call_auto_runs where id=rid;
 update private.care_call_auto_runs set needs_attention=true where id=rid;
 select user_id into manager from public.care_memberships where workspace_id='primary' and role='operations' and is_admin=1 and status='active' limit 1;
 if manager is not null then perform private.care_route_notice(r.senior_id,manager,'operations','escalation','auto-call:'||rid);end if;
 perform private.care_auto_log(rid,r.senior_id,'human_review_required',why);
end $$;
revoke all on function private.care_auto_attention(uuid,text) from public,anon,authenticated,service_role;

create function private.care_call_automation_worker(action text,arguments jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.care_call_auto_control%rowtype;s private.care_call_auto_settings%rowtype;r private.care_call_auto_runs%rowtype;
 stamp timestamptz:=private.care_auto_time(); due timestamptz; date_key text:=to_char(private.care_auto_time() at time zone 'Asia/Kolkata','YYYY-MM-DD');
 j jsonb; c jsonb; selected jsonb; why text; jid text; phase text; rid uuid; job_status text; template_key text; ident text;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('call-automation-tick',0)) then return jsonb_build_object('reason','active_call');end if;
 if action='failure' then
  update private.care_call_auto_runs set reason='worker_unavailable',updated_at=stamp where senior_job_id=arguments->>'jobId' or brief_job_id=arguments->>'jobId' returning id,senior_id into rid,ident;
  if rid is not null then perform private.care_auto_log(rid,ident,'worker_result_unconfirmed','worker_unavailable');end if;
  return jsonb_build_object('ok',true);
 end if;
 if action<>'tick' or arguments<>'{}'::jsonb then raise invalid_parameter_value;end if;
 select * into cfg from private.care_call_auto_control where id for update;
 update private.care_call_auto_control set worker_at=stamp,worker_reason=null where id;
 -- Settle real carrier outcomes first, including when Operations has paused.
 for r in select * from private.care_call_auto_runs where status in ('senior_call','briefing_call') order by created_at limit 50 for update skip locked loop
  select payload into j from public.care_events where id=case r.status when 'senior_call' then r.senior_job_id else r.brief_job_id end and kind='telephony_job';
  job_status:=j->>'status';
  if job_status in ('completed','failed','cancelled') then
   if job_status='cancelled' then
    update private.care_call_auto_runs set status='cancelled',reason='cancelled',lease_until=null,updated_at=stamp where id=r.id;
    perform private.care_auto_log(r.id,r.senior_id,'call_cancelled');
   elsif r.status='senior_call' then
    update private.care_call_auto_runs set status=case when cfg.enabled then 'pending_brief' else 'cancelled' end,reason=case when cfg.enabled then null else 'paused' end,lease_until=null,updated_at=stamp,expires_at=stamp+interval '30 minutes' where id=r.id;
    perform private.care_auto_log(r.id,r.senior_id,'senior_call_ended',coalesce(j#>>'{voiceState,completionReason}','not_started'));
   else
    why:=case when j#>>'{voiceState,answers,noticeResponse}'='acknowledged' and j#>>'{voiceState,consent}'='granted' then null else 'notice_unacknowledged' end;
    update private.care_call_auto_runs set status='completed',reason=why,needs_attention=why is not null,updated_at=stamp,lease_until=null where id=r.id;
    perform private.care_auto_log(r.id,r.senior_id,'coordinator_call_ended',coalesce(why,'recipient_acknowledged'));
    if why is not null then perform private.care_auto_attention(r.id,why);end if;
   end if;
  elsif job_status in ('submitting','submission_unknown') and (j->>'updatedAt')::timestamptz<stamp-interval '5 minutes' then
   if r.reason is distinct from 'active_call' then perform private.care_auto_attention(r.id,'active_call');end if;
   update private.care_call_auto_runs set reason='active_call',updated_at=stamp where id=r.id;
  end if;
 end loop;
 if not cfg.enabled then
  update private.care_call_auto_control set worker_reason='paused' where id;
  return jsonb_build_object('reason','paused');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('call-bot-request-budget',0));
 -- Only today's future-enabled daily slot, never a historical catch-up batch.
 for s in select * from private.care_call_auto_settings where daily_enabled order by senior_id limit 10000 loop
  due:=((date_key||' '||s.daily_time::text)::timestamp at time zone 'Asia/Kolkata');
  if due>=s.daily_enabled_at and due<=stamp then
   insert into private.care_call_auto_runs(action_key,senior_id,origin,settings_revision,language,requested_by,senior_contact_id,owner_contact_id,owner_id,due_at,expires_at)
   values('daily:'||s.senior_id||':'||date_key,s.senior_id,'daily',s.revision,s.language,s.updated_by,s.senior_contact_id,s.owner_contact_id,s.owner_id,due,due+interval '30 minutes')
   on conflict(action_key) do nothing returning id into rid;
   if rid is not null then perform private.care_auto_log(rid,s.senior_id,'daily_call_due');end if;
  end if;
 end loop;
 for r in select * from private.care_call_auto_runs where status in ('pending_senior','pending_brief','senior_call','briefing_call')
  order by case origin when 'help_sms' then 0 else 1 end,case when status in ('pending_brief','briefing_call') then 0 else 1 end,due_at limit 100 for update skip locked loop
  if r.lease_until>stamp then continue;end if;
  if r.status in ('senior_call','briefing_call') then
   select payload into j from public.care_events where id=case r.status when 'senior_call' then r.senior_job_id else r.brief_job_id end;
   if j->>'status'<>'queued' then continue;end if;
  end if;
  select * into s from private.care_call_auto_settings where senior_id=r.senior_id;
  c:=private.care_auto_contacts(r.senior_id);why:=null;
  if r.settings_revision<>s.revision or r.origin='daily' and not s.daily_enabled or r.origin='help_sms' and not s.help_enabled then why:='settings_changed';
  elsif c->>'reason' is not null then why:=c->>'reason';
  elsif c#>>'{senior,id}' is distinct from r.senior_contact_id or c#>>'{owner,id}' is distinct from r.owner_contact_id then why:='contact_changed';
  elsif r.source_request_id is not null and not exists(select 1 from public.care_phone_requests p where p.id=r.source_request_id and p.senior_id=r.senior_id and p.status<>'closed' and p.assigned_to=r.owner_id and p.sender=c#>>'{senior,phone}') then why:='source_closed';
  elsif not private.care_route_member(r.requested_by::text,r.senior_id,case when exists(select 1 from public.care_memberships where user_id=r.requested_by::text and role='operations' and is_admin=1) then 'operations' else 'coordinator' end) then why:='source_changed';
  elsif r.origin='daily' and r.status='pending_senior' and exists(select 1 from public.care_phone_requests where senior_id=r.senior_id and kind='help' and status<>'closed') then why:='active_help';
  elsif r.expires_at<=stamp then why:='expired';end if;
  if why is not null then
   update private.care_call_auto_runs set status='blocked',reason=why,needs_attention=true,updated_at=stamp where id=r.id;
   update public.care_events set payload=payload||jsonb_build_object('status','cancelled','updatedAt',stamp,'state',jsonb_build_object('step',coalesce((payload#>>'{state,step}')::integer,0)+1)) where id in (r.senior_job_id,r.brief_job_id) and kind='telephony_job' and payload->>'status'='queued';
   perform private.care_auto_attention(r.id,why);continue;
  end if;
  if extract(hour from stamp at time zone 'Asia/Kolkata') not between 8 and 19 then why:='outside_hours';
  elsif cfg.checked_at is null or cfg.checked_at<stamp-interval '24 hours' then why:='quota_unknown';
  elsif coalesce((select decrypted_secret from vault.decrypted_secrets where name='samarth_twilio_trial_enabled'),'false')<>'true' then why:='provider_not_connected';
  elsif exists(select 1 from public.care_events where kind='telephony_job' and payload->>'channel'='voice_bot' and payload->>'status' in ('submitting','accepted','ringing','answered','submission_unknown')) then why:='active_call';
  elsif (select count(*) from public.care_events where kind='telephony_job' and payload->>'channel'='voice_bot' and created_at::timestamptz>stamp-interval '1 day')>=(case when r.status='pending_senior' then 4 else 5 end) and r.status in ('pending_senior','pending_brief') then why:='daily_limit';
  elsif cfg.budget_minutes-cfg.reserved_minutes-private.care_auto_manual_reserved(cfg.checked_at)<(case when r.status='pending_senior' then 8 else 4 end) and r.status in ('pending_senior','pending_brief') then why:='quota_exhausted';end if;
  if why is not null then
   if r.reason is distinct from why then perform private.care_auto_log(r.id,r.senior_id,'dispatch_held',why);end if;
   update private.care_call_auto_runs set reason=why,updated_at=stamp where id=r.id;
   update private.care_call_auto_control set worker_reason=why where id;
   continue;
  end if;
  phase:=case when r.status in ('pending_senior','senior_call') then 'senior' else 'brief' end;
  jid:=case phase when 'senior' then r.senior_job_id else r.brief_job_id end;
  if jid is null then
   jid:=gen_random_uuid()::text;selected:=case phase when 'senior' then c->'senior' else c->'owner' end;
   template_key:=case selected->>'role' when 'senior' then 'checkin' when 'coordinator' then 'staff_alert' else 'escalation' end;
   j:=jsonb_build_object('id',jid,'seniorId',r.senior_id,'contactId',selected->>'id','recipientRole',selected->>'role','channel','voice_bot','template',template_key,'language',r.language,
    'text',private.care_sms_text(template_key,r.language,selected->>'role'),'status','queued','requestHash',encode(extensions.digest(r.action_key||':'||phase,'sha256'),'hex'),
    'state',jsonb_build_object('step',0),'createdAt',stamp,'expiresAt',stamp+interval '30 minutes','asOfDate',date_key,'requestedBy',r.requested_by,
    'externalDelivery',false,'deliveredToHandset',false,'humanRead',false,'automationRunId',r.id,'automationPhase',phase);
   if r.source_request_id is not null then j:=j||jsonb_build_object('sourceRequestId',r.source_request_id);end if;
   insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(jid,'workspace:primary','telephony_job',r.senior_id,j,to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
   update private.care_call_auto_control set reserved_minutes=reserved_minutes+4 where id;
   cfg.reserved_minutes:=cfg.reserved_minutes+4;
   update private.care_call_auto_runs set senior_job_id=case phase when 'senior' then jid else senior_job_id end,brief_job_id=case phase when 'brief' then jid else brief_job_id end where id=r.id;
   perform private.care_auto_log(r.id,r.senior_id,case phase when 'senior' then 'senior_call_saved' else 'coordinator_briefing_saved' end);
  end if;
  update private.care_call_auto_runs set status=case phase when 'senior' then 'senior_call' else 'briefing_call' end,reason=null,lease_until=stamp+interval '2 minutes',updated_at=stamp where id=r.id;
  return jsonb_build_object('jobId',jid,'language',r.language);
 end loop;
 return jsonb_build_object('reason','no_due_calls');
end $$;
revoke all on function private.care_call_automation_worker(text,jsonb) from public,anon,authenticated;
grant execute on function private.care_call_automation_worker(text,jsonb) to service_role;
create function public.care_call_automation_worker(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.care_call_automation_worker(action,payload)$$;
revoke all on function public.care_call_automation_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.care_call_automation_worker(text,jsonb) to service_role;

create function private.care_call_automation_invoke() returns bigint
language plpgsql security definer set search_path='' as $$
declare project_url text; anon_key text; signing_key text;ident bigint;
begin
 if not exists(select 1 from private.care_call_auto_control where enabled) and not exists(select 1 from private.care_call_auto_runs where status in ('senior_call','briefing_call')) then return null;end if;
 select decrypted_secret into project_url from vault.decrypted_secrets where name='samarth_project_url';
 select decrypted_secret into anon_key from vault.decrypted_secrets where name='samarth_anon_key';
 select decrypted_secret into signing_key from vault.decrypted_secrets where name='samarth_n8n_hmac_secret';
 if project_url is null or anon_key is null or length(signing_key)<32 then return null;end if;
 select net.http_post(url:=project_url||'/functions/v1/call-automation',headers:=jsonb_build_object('Content-Type','application/json','apikey',anon_key,'Authorization','Bearer '||anon_key,'x-samarth-automation-key',signing_key),body:='{}',timeout_milliseconds:=45000) into ident;
 return ident;
end $$;
revoke all on function private.care_call_automation_invoke() from public,anon,authenticated,service_role;
select cron.schedule('samarth-call-automation','* * * * *','select private.care_call_automation_invoke();');
