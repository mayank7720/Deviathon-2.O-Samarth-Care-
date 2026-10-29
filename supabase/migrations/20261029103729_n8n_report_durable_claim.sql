-- One accepted workflow owns each saved report job, even with fresh HMAC nonces.
create index care_report_job_reference on public.care_events(owner,(payload->>'jobId'),sequence desc) where kind='report_job';
create function private.care_n8n_reserve_report(job_id text, facts_hash text, report_language text)
returns boolean language plpgsql security definer set search_path='' as $$
declare item public.care_events%rowtype;
begin
 if not private.care_service() then raise insufficient_privilege; end if;
 if job_id is null or job_id!~'^[A-Za-z0-9_-]{16,96}$'
  or facts_hash is null or facts_hash!~'^[a-f0-9]{64}$'
  or report_language is null or report_language not in ('en','hi') then return false; end if;
 select * into item from public.care_events e
  where e.owner='workspace:primary' and e.kind='report_job' and e.payload->>'jobId'=job_id
  order by e.sequence desc limit 1 for update;
 if item.id is null or item.payload->>'status' is distinct from 'awaiting_n8n'
  or item.payload->>'factsHash' is distinct from facts_hash
  or item.payload->>'language' is distinct from report_language
  or item.payload#>>'{localFacts,version}' is distinct from 'samarth.report-facts.v1'
  or coalesce(item.payload->>'expiresAt','')!~'^[0-9]{1,16}$' then return false; end if;
 if (item.payload->>'expiresAt')::bigint <= extract(epoch from clock_timestamp())*1000 then return false; end if;
 update public.care_events set payload=payload||jsonb_build_object(
  'status','claimed','claimedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  where id=item.id and owner=item.owner and kind='report_job';
 return true;
end $$;
create function public.care_n8n_claim_report(job_id text, facts_hash text, report_language text)
returns boolean language sql security invoker set search_path='' as $$
 select private.care_n8n_reserve_report(job_id,facts_hash,report_language)
$$;
revoke all on function private.care_n8n_reserve_report(text,text,text),public.care_n8n_claim_report(text,text,text) from public,anon,authenticated;
grant execute on function private.care_n8n_reserve_report(text,text,text),public.care_n8n_claim_report(text,text,text) to service_role;
