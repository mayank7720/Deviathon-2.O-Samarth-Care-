create or replace function private.care_n8n_nonce(nonce_hash text,job_id text,kind text,expires_at bigint) returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;begin
 if not private.care_service() then raise insufficient_privilege;end if;
 if nonce_hash!~'^[a-f0-9]{64}$' or kind not in ('weekly_report.request','weekly_report.completed','voice_checkin.request') or expires_at<extract(epoch from now())*1000 or expires_at>extract(epoch from now())*1000+900000 then return false;end if;
 if kind='voice_checkin.request' then
  if not exists(select 1 from public.care_events e where e.id=job_id and e.kind='telephony_job' and e.payload->>'channel'='voice_bot' and e.payload->>'status'='queued' and (e.payload->>'expiresAt')::timestamptz>now()) then return false;end if;
 else
  if not exists(select 1 from public.care_events e where e.kind='report_job' and e.payload->>'jobId'=job_id and e.payload->>'status' in ('awaiting_n8n','claimed') and (e.payload->>'expiresAt')::bigint>extract(epoch from now())*1000) then return false;end if;
 end if;
 insert into private.care_integration_nonces values(nonce_hash,job_id,kind,expires_at) on conflict do nothing;get diagnostics changed=row_count;return changed=1;
end $$;
create function private.care_voice_dispatch_config() returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select coalesce(jsonb_object_agg(case name when 'samarth_twilio_auth_token' then 'TWILIO_AUTH_TOKEN' when 'samarth_twilio_trial_enabled' then 'SAMARTH_TWILIO_TRIAL_ENABLED' when 'samarth_twilio_account_sid' then 'TWILIO_ACCOUNT_SID' when 'samarth_twilio_from_number' then 'TWILIO_FROM_NUMBER' when 'samarth_public_url' then 'SAMARTH_PUBLIC_URL' when 'samarth_n8n_hmac_secret' then 'SAMARTH_N8N_HMAC_SECRET' end,decrypted_secret),'{}') into result from vault.decrypted_secrets where name in ('samarth_twilio_auth_token','samarth_twilio_trial_enabled','samarth_twilio_account_sid','samarth_twilio_from_number','samarth_public_url','samarth_n8n_hmac_secret');return result;end $$;
create function public.care_voice_dispatch_configuration() returns jsonb language sql security invoker set search_path='' as $$select private.care_voice_dispatch_config()$$;
create function private.care_voice_recipient(job_id text) returns jsonb language plpgsql security definer set search_path='' as $$declare job jsonb;contact jsonb;sid text;begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select payload into job from public.care_events where id=job_id and kind='telephony_job';sid:=job->>'seniorId';
 if job is null or not exists(select 1 from public.care_memberships m where m.user_id=job->>'requestedBy' and m.status='active' and m.role='coordinator' and (m.scope_json::jsonb?'*' or m.scope_json::jsonb?sid)) then return null;end if;
 select payload->'contact' into contact from public.care_events where kind='telephony_contact' and senior_id=sid and payload#>>'{contact,id}'=job->>'contactId' order by sequence desc limit 1;
 if contact is null or coalesce((contact->>'verified')::boolean,false)=false or coalesce((contact->>'callConsent')::boolean,false)=false then return null;end if;
 if contact->>'role'='family' and not exists(select 1 from public.care_consents c where c.senior_id=sid and c.family_allowed) then return null;end if;return contact;
end $$;
create function public.care_voice_contact(job_id text) returns jsonb language sql security invoker set search_path='' as $$select private.care_voice_recipient(job_id)$$;
revoke all on function private.care_voice_dispatch_config(),public.care_voice_dispatch_configuration(),private.care_voice_recipient(text),public.care_voice_contact(text) from public,anon,authenticated;
grant execute on function private.care_voice_dispatch_config(),public.care_voice_dispatch_configuration(),private.care_voice_recipient(text),public.care_voice_contact(text) to service_role;
