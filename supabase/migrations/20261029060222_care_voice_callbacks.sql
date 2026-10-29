create function private.care_voice_config() returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select coalesce(jsonb_object_agg(case name when 'samarth_twilio_auth_token' then 'TWILIO_AUTH_TOKEN' when 'samarth_twilio_trial_enabled' then 'SAMARTH_TWILIO_TRIAL_ENABLED' end,decrypted_secret),'{}') into result from vault.decrypted_secrets where name in ('samarth_twilio_auth_token','samarth_twilio_trial_enabled');return result;end $$;
create function public.care_voice_configuration() returns jsonb language sql security invoker set search_path='' as $$select private.care_voice_config()$$;
create function private.care_voice_get(job_id text) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select payload into result from public.care_events where id=job_id and owner='workspace:primary' and kind='telephony_job';return result;end $$;
create function public.care_voice_job(job_id text) returns jsonb language sql security invoker set search_path='' as $$select private.care_voice_get(job_id)$$;
create function private.care_voice_apply(job_id text,expected_revision integer,payload jsonb,signal jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare previous public.care_events%rowtype;stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select * into previous from public.care_events where id=job_id and kind='telephony_job' for update;
 if previous.id is null or (previous.payload#>>'{state,step}')::integer<>expected_revision then return false;end if;
 if payload->>'id' is distinct from previous.payload->>'id' or payload->>'seniorId' is distinct from previous.senior_id then raise invalid_parameter_value;end if;
 update public.care_events set payload=payload||jsonb_build_object('state',jsonb_build_object('step',expected_revision+1)) where id=job_id;
 if signal is not null then
  insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('call-signal:'||job_id,previous.owner,'signal',previous.senior_id,jsonb_build_object('type','note','record',signal,'mood',signal->>'mood','helpRequested',signal->'helpRequested'),stamp) on conflict do nothing;
  if coalesce((signal->>'helpRequested')::boolean,false) then insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('call-task:'||job_id,previous.owner,'task',previous.senior_id,jsonb_build_object('action','Call senior promptly: support requested during telephone check-in','status','open','note','Check the recorded answers with the senior','createdAt',stamp,'asOfDate',signal->>'date'),stamp) on conflict do nothing;end if;
 end if;return true;end $$;
create function public.care_voice_advance(job_id text,expected_revision integer,payload jsonb,signal jsonb default null) returns boolean language sql security invoker set search_path='' as $$select private.care_voice_apply(job_id,expected_revision,payload,signal)$$;
revoke all on function private.care_voice_config(),private.care_voice_get(text),private.care_voice_apply(text,integer,jsonb,jsonb),public.care_voice_configuration(),public.care_voice_job(text),public.care_voice_advance(text,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.care_voice_config(),private.care_voice_get(text),private.care_voice_apply(text,integer,jsonb,jsonb),public.care_voice_configuration(),public.care_voice_job(text),public.care_voice_advance(text,integer,jsonb,jsonb) to service_role;
create policy contacts_coordinator_only on public.care_events as restrictive for all to authenticated using(kind<>'telephony_contact' or private.care_has(senior_id,array['coordinator'])) with check(kind<>'telephony_contact' or (private.care_admin() and private.care_has(senior_id,array['coordinator'])));
