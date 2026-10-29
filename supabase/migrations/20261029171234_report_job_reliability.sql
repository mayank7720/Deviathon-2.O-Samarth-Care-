-- Signed failure receipts and bounded jobs; no automatic retry of ambiguous inference.
create function private.care_report_settle(event_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.care_events%rowtype;
begin
 select * into item from public.care_events e where e.id=event_id and e.owner='workspace:primary' and e.kind='report_job' for update;
 if item.id is null then return null;end if;
 if not private.care_service() and not private.care_has(item.senior_id,array['coordinator','operations']) then raise insufficient_privilege;end if;
 if item.payload->>'status' in ('awaiting_n8n','claimed') and coalesce(item.payload->>'expiresAt','')~'^[0-9]{1,16}$' and (item.payload->>'expiresAt')::bigint<=extract(epoch from clock_timestamp())*1000 then
  item.payload:=item.payload||jsonb_build_object('status','timed_out','failureCode','deadline_exceeded','finishedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))||case when item.payload->>'status'='claimed' and item.payload->>'claimedAt' is null then jsonb_build_object('claimedAt','unknown') else '{}'::jsonb end;
  update public.care_events set payload=item.payload where id=item.id;
 end if;
 return item.payload;
end $$;
create function private.care_report_action(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if saved->>'status'<>'failed' and not (saved->>'status'='timed_out' and saved->>'claimedAt' is null) then raise exception 'Report execution inspection required' using errcode='40001';end if;
 if payload->>'jobId' is null or payload->>'jobId'!~'^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$' or payload->>'retryId' is distinct from 'report:'||auth.uid()::text||':'||(payload->>'jobId') then raise invalid_parameter_value;end if;
 next_job:=(saved-'claimedAt'-'finishedAt'-'failureCode'-'reportId'-'retryJobId'-'retryEventId')||jsonb_build_object('jobId',payload->>'jobId','status','awaiting_n8n','expiresAt',floor(extract(epoch from clock_timestamp())*1000)+300000,'retryOf',saved->>'jobId','envelope',(saved->'envelope')||jsonb_build_object('jobId',payload->>'jobId'));
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(payload->>'retryId',item.owner,'report_job',item.senior_id,next_job,stamp);
 update public.care_events set payload=saved||jsonb_build_object('retryJobId',payload->>'jobId','retryEventId',payload->>'retryId') where id=item.id;
 return jsonb_build_object('created',true,'id',payload->>'retryId','seniorId',item.senior_id,'createdAt',stamp,'job',next_job);
end $$;
create function public.care_report_job_action(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.care_report_action(action,payload)$$;
revoke all on function private.care_report_settle(text),private.care_report_action(text,jsonb),public.care_report_job_action(text,jsonb) from public,anon;
grant execute on function private.care_report_settle(text) to authenticated,service_role;
grant execute on function private.care_report_action(text,jsonb),public.care_report_job_action(text,jsonb) to authenticated;

create function private.care_n8n_failed(job_id text,facts_hash text,failure_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.care_events%rowtype;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 if failure_code is null or failure_code not in ('model_error','invalid_output','workflow_error','callback_rejected') then raise invalid_parameter_value;end if;
 select * into item from public.care_events e where e.owner='workspace:primary' and e.kind='report_job' and e.payload->>'jobId'=job_id order by e.sequence desc limit 1 for update;
 if item.id is null or item.payload->>'status'<>'claimed' or item.payload->>'factsHash' is distinct from facts_hash then return jsonb_build_object('failed',false);end if;
 if (item.payload->>'expiresAt')::bigint<=extract(epoch from clock_timestamp())*1000 then perform private.care_report_settle(item.id);return jsonb_build_object('failed',false);end if;
 update public.care_events set payload=payload||jsonb_build_object('status','failed','failureCode',failure_code,'finishedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=item.id;
 return jsonb_build_object('failed',true);
end $$;
create function public.care_n8n_fail(job_id text,facts_hash text,failure_code text) returns jsonb language sql security invoker set search_path='' as $$select private.care_n8n_failed(job_id,facts_hash,failure_code)$$;
revoke all on function private.care_n8n_failed(text,text,text),public.care_n8n_fail(text,text,text) from public,anon,authenticated;
grant execute on function private.care_n8n_failed(text,text,text),public.care_n8n_fail(text,text,text) to service_role;

create or replace function private.care_n8n_finish(job_id text,report jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.care_events%rowtype; rid text:='n8n-report:'||job_id; stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); member record;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select * into item from public.care_events where owner='workspace:primary' and kind='report_job' and payload->>'jobId'=job_id order by sequence desc limit 1 for update;
 if item.id is null or item.payload->>'status' is distinct from 'claimed' or coalesce(item.payload->>'expiresAt','')!~'^[0-9]{1,16}$' or (item.payload->>'expiresAt')::bigint<=extract(epoch from clock_timestamp())*1000 then return jsonb_build_object('completed',false);end if;
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

create or replace function private.care_n8n_nonce(nonce_hash text,job_id text,kind text,expires_at bigint) returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;begin
 if not private.care_service() then raise insufficient_privilege;end if;
 if nonce_hash!~'^[a-f0-9]{64}$' or kind not in ('weekly_report.request','weekly_report.completed','weekly_report.failed','voice_checkin.request') or expires_at<extract(epoch from now())*1000 or expires_at>extract(epoch from now())*1000+900000 then return false;end if;
 if kind='voice_checkin.request' then
  if not exists(select 1 from public.care_events e where e.id=job_id and e.kind='telephony_job' and e.payload->>'channel'='voice_bot' and e.payload->>'status'='queued' and (e.payload->>'expiresAt')::timestamptz>now()) then return false;end if;
 else
  if not exists(select 1 from public.care_events e where e.kind='report_job' and e.payload->>'jobId'=job_id and e.payload->>'status' in ('awaiting_n8n','claimed') and (e.payload->>'expiresAt')::bigint>extract(epoch from now())*1000) then return false;end if;
 end if;
 insert into private.care_integration_nonces values(nonce_hash,job_id,kind,expires_at) on conflict do nothing;get diagnostics changed=row_count;return changed=1;
end $$;

-- Bring older awaiting jobs under the same five-minute deadline.
update public.care_events set payload=payload||jsonb_build_object('expiresAt',least((payload->>'expiresAt')::bigint,floor(extract(epoch from created_at::timestamptz)*1000)+300000))
 where owner='workspace:primary' and kind='report_job' and payload->>'status' in ('awaiting_n8n','claimed') and coalesce(payload->>'expiresAt','')~'^[0-9]{1,16}$';
