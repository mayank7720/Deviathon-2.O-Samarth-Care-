-- Run after the durable-claim migration. All fixture events are rolled back.
begin;
do $$
begin
 if has_function_privilege('anon','public.care_n8n_claim_report(text,text,text)','execute')
  or has_function_privilege('authenticated','public.care_n8n_claim_report(text,text,text)','execute') then
  raise exception 'Client roles must not reserve report jobs';
 end if;
end $$;
set local role service_role;
do $$
declare
 jid text:='claim_fixture_'||replace(gen_random_uuid()::text,'-','');
 eid text;
 facts text:=repeat('a',64);
 millis bigint:=(extract(epoch from clock_timestamp())*1000)::bigint;
 completion jsonb;
begin
 eid:='test:report:'||jid;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at)
 values(eid,'workspace:primary','report_job','S999998',jsonb_build_object(
  'jobId',jid,'status','awaiting_n8n','factsHash',facts,'language','en',
  'localFacts',jsonb_build_object('version','samarth.report-facts.v1'),'expiresAt',millis+60000),clock_timestamp()::text);
 if public.care_n8n_claim_report(jid,repeat('b',64),'en') then raise exception 'Wrong facts accepted';end if;
 if public.care_n8n_claim_report(jid,facts,'hi') then raise exception 'Wrong language accepted';end if;
 if not public.care_n8n_claim_report(jid,facts,'en') then raise exception 'First claim failed';end if;
 if public.care_n8n_claim_report(jid,facts,'en') then raise exception 'Claim repeated with a fresh request';end if;
 if not exists(select 1 from public.care_events where id=eid and payload->>'status'='claimed' and payload->>'claimedAt' is not null) then raise exception 'Claim was not persisted';end if;
 completion:=public.care_n8n_complete(jid,jsonb_build_object('factsHash',facts,'status','pending_review','text','Synthetic rollback-only report.','language','en','requiresHumanReview',true));
 if completion->>'completed' is distinct from 'true' then raise exception 'Claimed job could not complete';end if;
 if public.care_n8n_complete(jid,jsonb_build_object('factsHash',facts,'status','pending_review','text','Synthetic retry.'))->>'completed' is distinct from 'false' then raise exception 'Report completed twice';end if;
 if (select count(*) from public.care_events where id='n8n-report:'||jid and kind='generated_report')<>1 then raise exception 'Exactly one review report was not stored';end if;
 update public.care_events set payload=payload||jsonb_build_object('status','awaiting_n8n','expiresAt',millis-1) where id=eid;
 if public.care_n8n_claim_report(jid,facts,'en') then raise exception 'Expired claim accepted';end if;
 if public.care_n8n_claim_report('unknown_fixture_000001',facts,'en') then raise exception 'Unknown claim accepted';end if;
end $$;
rollback;
