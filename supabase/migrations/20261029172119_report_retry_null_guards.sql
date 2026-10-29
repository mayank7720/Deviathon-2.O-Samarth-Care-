-- Harden terminal transitions against missing JSON status fields.
create or replace function private.care_report_action(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.care_events%rowtype; child public.care_events%rowtype; saved jsonb; next_job jsonb; stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 if action not in ('settle','retry') then raise invalid_parameter_value;end if;
 select * into item from public.care_events e where e.id=payload->>'id' and e.owner='workspace:primary' and e.kind='report_job' for update;
 if item.id is null then raise no_data_found;end if;
 if not private.care_has(item.senior_id,array['coordinator','operations']) then raise insufficient_privilege;end if;
 saved:=private.care_report_settle(item.id);
 if action='settle' then return saved;end if;
 if saved->>'retryEventId' is not null then
  select * into child from public.care_events e where e.id=saved->>'retryEventId' and e.owner=item.owner and e.kind='report_job';
  return jsonb_build_object('created',false,'id',child.id,'seniorId',child.senior_id,'createdAt',child.created_at,'job',child.payload);
 end if;
 if coalesce(saved->>'status','')<>'failed' and not (coalesce(saved->>'status','')='timed_out' and saved->>'claimedAt' is null) then raise exception 'Report execution inspection required' using errcode='40001';end if;
 if payload->>'jobId' is null or payload->>'jobId'!~'^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$' or payload->>'retryId' is distinct from 'report:'||auth.uid()::text||':'||(payload->>'jobId') then raise invalid_parameter_value;end if;
 next_job:=(saved-'claimedAt'-'finishedAt'-'failureCode'-'reportId'-'retryJobId'-'retryEventId')||jsonb_build_object('jobId',payload->>'jobId','status','awaiting_n8n','expiresAt',floor(extract(epoch from clock_timestamp())*1000)+300000,'retryOf',saved->>'jobId','envelope',(saved->'envelope')||jsonb_build_object('jobId',payload->>'jobId'));
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(payload->>'retryId',item.owner,'report_job',item.senior_id,next_job,stamp);
 update public.care_events set payload=saved||jsonb_build_object('retryJobId',payload->>'jobId','retryEventId',payload->>'retryId') where id=item.id;
 return jsonb_build_object('created',true,'id',payload->>'retryId','seniorId',item.senior_id,'createdAt',stamp,'job',next_job);
end $$;

create or replace function private.care_n8n_failed(job_id text,facts_hash text,failure_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.care_events%rowtype;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 if failure_code is null or failure_code not in ('model_error','invalid_output','workflow_error','callback_rejected') then raise invalid_parameter_value;end if;
 select * into item from public.care_events e where e.owner='workspace:primary' and e.kind='report_job' and e.payload->>'jobId'=job_id order by e.sequence desc limit 1 for update;
 if item.id is null or item.payload->>'status' is distinct from 'claimed' or item.payload->>'factsHash' is distinct from facts_hash then return jsonb_build_object('failed',false);end if;
 if (item.payload->>'expiresAt')::bigint<=extract(epoch from clock_timestamp())*1000 then perform private.care_report_settle(item.id);return jsonb_build_object('failed',false);end if;
 update public.care_events set payload=payload||jsonb_build_object('status','failed','failureCode',failure_code,'finishedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=item.id;
 return jsonb_build_object('failed',true);
end $$;
