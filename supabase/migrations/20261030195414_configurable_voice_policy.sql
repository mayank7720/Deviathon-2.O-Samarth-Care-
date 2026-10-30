-- Operations owns access and hours for every new bot call. Installation keeps
-- existing hours, paused automation and recipient enrolments unchanged.
alter table private.care_call_auto_control
 add column calls_enabled boolean not null default true,
 add column restrict_hours boolean not null default true,
 add column window_start time not null default '08:00',
 add column window_end time not null default '20:00',
 add column help_outside_hours boolean not null default false,
 add constraint distinct_call_window check(not restrict_hours or window_start<>window_end);
alter table private.care_call_auto_settings drop constraint care_call_auto_settings_daily_time_check;

create function private.care_call_policy() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('callsEnabled',calls_enabled,'restrictHours',restrict_hours,
  'start',left(window_start::text,5),'end',left(window_end::text,5),'helpOutsideHours',help_outside_hours)
 from private.care_call_auto_control where id
$$;
revoke all on function private.care_call_policy() from public,anon,authenticated,service_role;

create function private.care_call_window_open(stamp timestamptz,is_help boolean default false) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select calls_enabled and (not restrict_hours or is_help and help_outside_hours
  or case when window_start<window_end then (stamp at time zone 'Asia/Kolkata')::time>=window_start and (stamp at time zone 'Asia/Kolkata')::time<window_end
   else (stamp at time zone 'Asia/Kolkata')::time>=window_start or (stamp at time zone 'Asia/Kolkata')::time<window_end end)
 from private.care_call_auto_control where id),false)
$$;
revoke all on function private.care_call_window_open(timestamptz,boolean) from public,anon,authenticated,service_role;

do $rpc$
declare source text;
begin
 source:=pg_get_functiondef('private.care_call_automation(text,jsonb)'::regprocedure);
 if strpos(source,'''revision'',cfg.revision')=0 or strpos(source,'if action=''control'' then')=0 then raise exception 'Review changed automation API';end if;
 source:=replace(source,'''revision'',cfg.revision','''revision'',cfg.revision,''callingPolicy'',private.care_call_policy()');
 source:=replace(source,'if action=''control'' then',$policy$
 if action='policy' then
  if not private.care_admin() then raise insufficient_privilege;end if;
  if (payload-array['revision','callsEnabled','restrictHours','start','end','helpOutsideHours'])<>'{}'
   or jsonb_typeof(payload->'callsEnabled') is distinct from 'boolean'
   or jsonb_typeof(payload->'restrictHours') is distinct from 'boolean'
   or jsonb_typeof(payload->'helpOutsideHours') is distinct from 'boolean'
   or coalesce(payload->>'start','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or coalesce(payload->>'end','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or coalesce(payload->>'revision','')!~'^[0-9]{1,8}$'
   or payload->>'restrictHours'='true' and payload->>'start'=payload->>'end' then raise invalid_parameter_value;end if;
  select * into cfg from private.care_call_auto_control where id for update;
  if cfg.revision<>(payload->>'revision')::integer then raise exception using errcode='P0001',message='Calling controls changed. Refresh before saving.';end if;
  update private.care_call_auto_control set calls_enabled=(payload->>'callsEnabled')::boolean,
   restrict_hours=(payload->>'restrictHours')::boolean,window_start=(payload->>'start')::time,window_end=(payload->>'end')::time,
   help_outside_hours=(payload->>'helpOutsideHours')::boolean,demo_until=null,revision=revision+1,updated_at=stamp,updated_by=auth.uid() where id;
  perform private.care_auto_log(null,null,'calling_policy_saved',case when payload->>'callsEnabled'='false' then 'all_calls_paused' when payload->>'restrictHours'='false' then 'all_day_access' else 'configured_window' end,auth.uid());
  return jsonb_build_object('ok',true,'callingPolicy',private.care_call_policy());
 end if;
 if action='control' then
$policy$);
 if strpos(source,'^(0[89]|1[0-9]):[0-5][0-9]$')=0 then raise exception 'Review changed daily time validation';end if;
 source:=replace(source,'^(0[89]|1[0-9]):[0-5][0-9]$','^([01][0-9]|2[0-3]):[0-5][0-9]$');
 execute source;
end $rpc$;

do $worker$
declare source text;needle text;
begin
 source:=pg_get_functiondef('private.care_call_automation_worker(text,jsonb)'::regprocedure);
 needle:='if extract(hour from stamp at time zone ''Asia/Kolkata'') not between 8 and 19 and (cfg.demo_until is null or cfg.demo_until<=stamp) then why:=''outside_hours'';';
 if strpos(source,needle)=0 then raise exception 'Review changed automation window';end if;
 source:=replace(source,needle,'if not private.care_call_window_open(stamp,r.origin=''help_sms'') then why:=''outside_hours'';');
 execute source;
 source:=pg_get_functiondef('private.care_voice_dispatch_config()'::regprocedure);
 if strpos(source,'return result||jsonb_build_object(')=0 then raise exception 'Review changed dispatch config';end if;
 source:=replace(source,'return result||jsonb_build_object(','return result||jsonb_build_object(''SAMARTH_CALL_POLICY'',private.care_call_policy(),');
 execute source;
 source:=pg_get_functiondef('private.care_call_request_guard()'::regprocedure);
 needle:='if extract(hour from clock_timestamp() at time zone ''Asia/Kolkata'') not between 8 and 19 then raise exception using errcode=''P0001'',message=''Trial wellbeing calls are available between 08:00 and 20:00 IST'';end if;';
 if strpos(source,needle)=0 then raise exception 'Review changed manual call window';end if;
 source:=replace(source,needle,'if not private.care_call_window_open(clock_timestamp(),new.payload ? ''sourceRequestId'') then raise exception using errcode=''P0001'',message=''Calling is paused or outside the hours configured by Operations'';end if;');
 execute source;
end $worker$;
