-- Run after report_job_reliability; all data changes are rolled back.
begin;
do $$begin
 if has_function_privilege('anon','public.care_n8n_fail(text,text,text)','execute') or has_function_privilege('authenticated','public.care_n8n_fail(text,text,text)','execute') then raise exception 'Failure hooks must be service only';end if;
 if has_function_privilege('anon','public.care_report_job_action(text,jsonb)','execute') then raise exception 'Anonymous clients must not retry';end if;
end $$;
set local role service_role;
do $$
declare jid text:='reliability_fixture_'||replace(gen_random_uuid()::text,'-','');eid text;facts text:=repeat('a',64);millis bigint:=(extract(epoch from clock_timestamp())*1000)::bigint;result jsonb;
begin
 eid:='test:report:'||jid;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(eid,'workspace:primary','report_job','S999998',jsonb_build_object('jobId',jid,'status','awaiting_n8n','factsHash',facts,'language','en','localFacts',jsonb_build_object('version','samarth.report-facts.v1'),'expiresAt',millis+60000),clock_timestamp()::text);
 if public.care_n8n_fail(jid,facts,'model_error')->>'failed' is distinct from 'false' then raise exception 'Unclaimed failure accepted';end if;
 if not public.care_n8n_claim_report(jid,facts,'en') then raise exception 'Claim failed';end if;
 if public.care_n8n_fail(jid,repeat('b',64),'model_error')->>'failed' is distinct from 'false' then raise exception 'Wrong evidence accepted';end if;
 if public.care_n8n_fail(jid,facts,'invalid_output')->>'failed' is distinct from 'true' then raise exception 'Failure not persisted';end if;
 if public.care_n8n_fail(jid,facts,'model_error')->>'failed' is distinct from 'false' then raise exception 'Failure accepted twice';end if;
 if public.care_n8n_complete(jid,jsonb_build_object('factsHash',facts,'status','pending_review','text','Must be rejected'))->>'completed' is distinct from 'false' then raise exception 'Failed job completed';end if;
 update public.care_events set payload=(payload-'claimedAt')||jsonb_build_object('status','awaiting_n8n','expiresAt',millis-1) where id=eid;
 result:=private.care_report_settle(eid);
 if result->>'status'<>'timed_out' or result->>'claimedAt' is not null then raise exception 'Unclaimed timeout not durable';end if;
 update public.care_events set payload=payload||jsonb_build_object('status','claimed') where id=eid;
 result:=private.care_report_settle(eid);
 if result->>'status'<>'timed_out' or result->>'claimedAt' is distinct from 'unknown' then raise exception 'Ambiguous claimed timeout may retry';end if;
 if public.care_n8n_complete(jid,jsonb_build_object('factsHash',facts,'status','pending_review','text','Must be rejected'))->>'completed' is distinct from 'false' then raise exception 'Timed-out job completed';end if;
end $$;
rollback;
