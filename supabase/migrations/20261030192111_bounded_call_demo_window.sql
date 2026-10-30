-- A bounded, explicit Operations demo option; it is OFF on installation.
-- Only already opted-in automatic jobs can use it. Manual calls keep their
-- normal hours, and no recipient, consent, quota or paid-account guard changes.
alter table private.care_call_auto_control add column demo_until timestamptz;
do $control$
declare source text;
begin
 source:=pg_get_functiondef('private.care_call_automation(text,jsonb)'::regprocedure);
 if strpos(source,'array[''revision'',''enabled'',''remainingMinutes'',''allowanceConfirmed'']')=0 then raise exception 'Review changed automation control fields';end if;
 source:=replace(source,'array[''revision'',''enabled'',''remainingMinutes'',''allowanceConfirmed'']','array[''revision'',''enabled'',''remainingMinutes'',''allowanceConfirmed'',''demoEnabled'']');
 source:=replace(source,'''checkedAt'',cfg.checked_at','''demoUntil'',cfg.demo_until,''checkedAt'',cfg.checked_at');
 source:=replace(source,'  select * into cfg from private.care_call_auto_control where id for update;',$guard$
  if payload ? 'demoEnabled' and jsonb_typeof(payload->'demoEnabled') is distinct from 'boolean' then raise invalid_parameter_value;end if;
  if payload->>'demoEnabled'='true' and (payload->>'enabled' is distinct from 'true' or payload->>'allowanceConfirmed' is distinct from 'true') then raise invalid_parameter_value;end if;
  select * into cfg from private.care_call_auto_control where id for update;
$guard$);
 if strpos(source,'updated_at=stamp,updated_by=auth.uid() where id;')=0 then raise exception 'Review changed automation save';end if;
 source:=replace(source,'updated_at=stamp,updated_by=auth.uid() where id;',$save$
   demo_until=case when payload->>'enabled'='true' and payload->>'demoEnabled'='true' then stamp+interval '2 hours' else null end,
   updated_at=stamp,updated_by=auth.uid() where id;
  if payload->>'demoEnabled'='true' then perform private.care_auto_log(null,null,'demo_window_armed','two_hour_demo_window',auth.uid());end if;
$save$);
 execute source;
end $control$;
do $window$
declare source text;needle text:='if extract(hour from stamp at time zone ''Asia/Kolkata'') not between 8 and 19 then why:=''outside_hours'';';
begin
 source:=pg_get_functiondef('private.care_call_automation_worker(text,jsonb)'::regprocedure);
 if strpos(source,needle)=0 then raise exception 'Review changed call window';end if;
 execute replace(source,needle,'if extract(hour from stamp at time zone ''Asia/Kolkata'') not between 8 and 19 and (cfg.demo_until is null or cfg.demo_until<=stamp) then why:=''outside_hours'';');
 source:=pg_get_functiondef('private.care_voice_dispatch_config()'::regprocedure);
 if strpos(source,' return result;')=0 then raise exception 'Review changed private voice configuration';end if;
 execute replace(source,' return result;',$config$
 return result||jsonb_build_object('SAMARTH_CALL_DEMO_UNTIL',(select demo_until from private.care_call_auto_control where enabled and demo_until>private.care_auto_time()));
$config$);
end $window$;
