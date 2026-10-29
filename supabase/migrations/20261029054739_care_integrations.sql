-- Service capabilities for signed n8n callbacks and user-authorized owner setup.
create table private.care_integration_nonces(nonce_hash text primary key,job_id text not null,kind text not null,expires_at bigint not null);
alter table private.care_integration_nonces enable row level security;
revoke all on private.care_integration_nonces from public,anon,authenticated;
create policy nonce_no_client on private.care_integration_nonces as restrictive for all to anon,authenticated using(false) with check(false);

create function private.care_n8n_config() returns jsonb language plpgsql security definer set search_path='' as $$
declare secret text;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='samarth_n8n_hmac_secret';
 return jsonb_build_object('SAMARTH_N8N_HMAC_SECRET',secret);
end $$;
create function public.care_n8n_configuration() returns jsonb language sql security invoker set search_path='' as $$select private.care_n8n_config()$$;
create function private.care_n8n_get(job_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.care_events%rowtype;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select * into item from public.care_events where owner='workspace:primary' and kind='report_job' and payload->>'jobId'=job_id order by sequence desc limit 1;
 if item.id is null then return null;end if;
 return item.payload||jsonb_build_object('seniorId',item.senior_id,'eventId',item.id);
end $$;
create function public.care_n8n_job(job_id text) returns jsonb language sql security invoker set search_path='' as $$select private.care_n8n_get(job_id)$$;
create function private.care_n8n_nonce(nonce_hash text,job_id text,kind text,expires_at bigint) returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 if nonce_hash!~'^[a-f0-9]{64}$' or kind not in ('weekly_report.request','weekly_report.completed','voice_checkin.request') or expires_at<extract(epoch from now())*1000 or expires_at>extract(epoch from now())*1000+900000 then return false;end if;
 if not exists(select 1 from public.care_events e where e.kind in ('report_job','telephony_job') and (e.payload->>'jobId'=job_id or e.id=job_id) and coalesce(e.payload->>'status','') in ('awaiting_n8n','claimed','queued') and coalesce((e.payload->>'expiresAt')::bigint,extract(epoch from now())::bigint*1000+1)>extract(epoch from now())*1000) then return false;end if;
 insert into private.care_integration_nonces values(nonce_hash,job_id,kind,expires_at) on conflict do nothing;get diagnostics changed=row_count;
 return changed=1;
end $$;
create function public.care_n8n_claim_nonce(nonce_hash text,job_id text,kind text,expires_at bigint) returns boolean language sql security invoker set search_path='' as $$select private.care_n8n_nonce(nonce_hash,job_id,kind,expires_at)$$;
create function private.care_n8n_finish(job_id text,report jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.care_events%rowtype; rid text:='n8n-report:'||job_id; stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); member record;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select * into item from public.care_events where owner='workspace:primary' and kind='report_job' and payload->>'jobId'=job_id order by sequence desc limit 1 for update;
 if item.id is null or item.payload->>'status' not in ('awaiting_n8n','claimed') then return jsonb_build_object('completed',false);end if;
 if report->>'factsHash' is distinct from item.payload->>'factsHash' or report->>'status'<>'pending_review' or report->>'text' is null or length(report->>'text')>16000 then raise invalid_parameter_value;end if;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(rid,item.owner,'generated_report',item.senior_id,jsonb_build_object('status','pending_review','report',report),stamp);
 update public.care_events set payload=payload||jsonb_build_object('status','completed','reportId',rid) where id=item.id;
 if exists(select 1 from public.care_consents c where c.owner=item.owner and c.senior_id=item.senior_id and c.family_allowed) then
  for member in select distinct user_id from public.care_memberships where workspace_id='primary' and role='family' and senior_id=item.senior_id and status='active' loop
   insert into public.care_deliveries(id,owner,senior_id,recipient_role,user_id,kind,channel,status,payload,source_id,created_at,attempts) values('report-delivery:'||rid||':'||member.user_id,item.owner,item.senior_id,'family',member.user_id,'weekly_summary','in_app','pending_review',jsonb_build_object('title','Weekly wellbeing report for review','body',report->>'text','summary',jsonb_build_object('text',report->>'text','period',report->'period','language',report->>'language','method',report->>'method','requiresHumanReview',true),'reportId',rid),rid,stamp,0) on conflict do nothing;
  end loop;
 end if;
 return jsonb_build_object('completed',true,'reportId',rid);
end $$;
create function public.care_n8n_complete(job_id text,report jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.care_n8n_finish(job_id,report)$$;
create function private.care_owner_access(owner_id uuid,password text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 if length(password)<32 or not exists(select 1 from auth.users u join private.care_settings s on s.key='bootstrap_owner_email' and lower(u.email)=lower(s.value) where u.id=owner_id) then raise insufficient_privilege;end if;
 if exists(select 1 from vault.decrypted_secrets where name='samarth_owner_bootstrap_password') then return false;end if;
 perform vault.create_secret(password,'samarth_owner_bootstrap_password','User-authorized initial owner access; rotate after first login');return true;
end $$;
create function public.care_save_owner_access(owner_id uuid,password text) returns boolean language sql security invoker set search_path='' as $$select private.care_owner_access(owner_id,password)$$;

create or replace function private.care_job_config() returns jsonb language plpgsql security definer set search_path='' as $$
declare output jsonb; settings jsonb;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select coalesce(jsonb_object_agg(case name when 'samarth_vapid_public_key' then 'VAPID_PUBLIC_KEY' when 'samarth_vapid_private_key' then 'VAPID_PRIVATE_KEY' when 'samarth_vapid_subject' then 'VAPID_SUBJECT' end,decrypted_secret),'{}') into output from vault.decrypted_secrets where name in ('samarth_vapid_public_key','samarth_vapid_private_key','samarth_vapid_subject');
 select coalesce(jsonb_object_agg(key,value),'{}') into settings from private.care_settings where key in ('SAMARTH_DATA_MODE','SAMARTH_COHORT_END');return output||settings;
end $$;
revoke all on function private.care_n8n_config(),private.care_n8n_get(text),private.care_n8n_nonce(text,text,text,bigint),private.care_n8n_finish(text,jsonb),private.care_owner_access(uuid,text),public.care_n8n_configuration(),public.care_n8n_job(text),public.care_n8n_claim_nonce(text,text,text,bigint),public.care_n8n_complete(text,jsonb),public.care_save_owner_access(uuid,text) from public,anon,authenticated;
grant execute on function private.care_n8n_config(),private.care_n8n_get(text),private.care_n8n_nonce(text,text,text,bigint),private.care_n8n_finish(text,jsonb),private.care_owner_access(uuid,text),public.care_n8n_configuration(),public.care_n8n_job(text),public.care_n8n_claim_nonce(text,text,text,bigint),public.care_n8n_complete(text,jsonb),public.care_save_owner_access(uuid,text) to service_role;
