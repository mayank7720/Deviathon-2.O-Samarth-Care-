-- Actual Postgres policy and history checks. All fictional fixtures roll back.
-- No delivery, password, account or external-communication action is created.
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select owner_user_id from public.care_workspaces where id='primary'),'role','authenticated','iat',extract(epoch from clock_timestamp())::bigint)::text,true);
set local role authenticated;
do $$
declare manifest jsonb; profile jsonb; result jsonb; first_page jsonb; second_page jsonb; b jsonb; dirty jsonb; watermark text; scores jsonb; replayed jsonb;
begin
 select coalesce((select p.profile from public.care_profiles p where owner='workspace:primary' and senior_id='S001'),jsonb_build_object('id','S001','name','Rollback Synthetic Senior','dataProvenance',jsonb_build_object('kind','synthetic'))) into profile;
 manifest:=jsonb_build_object('datasetId','history-rollback-fixture-v1','fingerprint',repeat('b',64),'generator','rollback-only','startDate','2026-08-01','endDate','2026-08-02','seniorCount',1,'days',2,'observations',2,'synthetic',true);
 perform public.care_import_synthetic_history(jsonb_build_object('manifest',manifest,'profiles',jsonb_build_array(profile)));
 perform public.care_import_synthetic_history(jsonb_build_object('manifest',manifest,'observations',jsonb_build_array(
  jsonb_build_object('id','rollback-S001-2026-08-01','seniorId','S001','date','2026-08-01','source','Synthetic rollback fixture','vitals',jsonb_build_object('systolic',120),'note','Synthetic baseline note','provenance',jsonb_build_object('synthetic',true)),
  jsonb_build_object('id','rollback-S001-2026-08-02','seniorId','S001','date','2026-08-02','source','Synthetic rollback fixture','vitals',jsonb_build_object('systolic',124),'medication',jsonb_build_object('prescribed',2,'taken',1),'provenance',jsonb_build_object('synthetic',true))
 )));
 perform public.care_import_synthetic_history(jsonb_build_object('manifest',manifest,'scores',jsonb_build_array(
  jsonb_build_object('seniorId','S001','date','2026-08-01','score',null,'level','unknown','reasons','[]'::jsonb,'synthetic',true),
  jsonb_build_object('seniorId','S001','date','2026-08-02','score',10,'level','low','reasons','[]'::jsonb,'synthetic',true)
 ),'complete',true));
 replayed:=public.care_import_synthetic_history(jsonb_build_object('manifest',manifest,'complete',true));
 if replayed->>'observations'<>'2' or replayed->>'scores'<>'2' then raise exception 'Idempotent completion changed archive counts';end if;
 begin
  perform public.care_import_synthetic_history(jsonb_build_object('manifest',manifest||jsonb_build_object('fingerprint',repeat('c',64))));
  raise exception 'Conflicting manifest was accepted';
 exception when unique_violation then null;end;
 -- Intentionally save an older measurement later. The history must still show
 -- 11:00 before 09:00, with the day-only synthetic entry last on that date.
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values
 ('history-rollback-late','workspace:primary','signal','S001',jsonb_build_object('type','vitals','record',jsonb_build_object('seniorId','S001','date','2026-08-02','observedAt','2026-08-02T05:30:00.000Z','timePrecision','minute','timezone','Asia/Kolkata','source','coordinator','vitals',jsonb_build_object('systolic',140),'note','Synthetic later measurement')),'2000-01-01T00:00:00Z');
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values
 ('history-rollback-early','workspace:primary','signal','S001',jsonb_build_object('type','vitals','record',jsonb_build_object('seniorId','S001','date','2026-08-02','observedAt','2026-08-02T03:30:00.000Z','timePrecision','minute','timezone','Asia/Kolkata','source','coordinator','vitals',jsonb_build_object('systolic',150),
 'medication',jsonb_build_object('prescribed',3,'taken',1,'doses',jsonb_build_array(jsonb_build_object('status','taken'),jsonb_build_object('status','unknown'),jsonb_build_object('status','unknown'))))),'2000-01-01T00:00:00Z');
 if exists(select 1 from public.care_observations where source_event_id like 'history-rollback-%' and recorded_at<'2026-01-01') then raise exception 'The client forged the save timestamp';end if;
 result:=public.care_history(jsonb_build_object('seniorId','S001','from','2026-08-01','to','2026-08-02','asOfDate','2026-10-29','datasetId',manifest->>'datasetId','groupBy','day','limit',200));
 if result#>>'{entries,0,id}'<>'event:history-rollback-late' or result#>>'{entries,1,id}'<>'event:history-rollback-early' then raise exception 'Measurement history follows insertion rather than observation time';end if;
 if result#>>'{entries,2,timePrecision}'<>'day' or result#>'{entries,2,observedAt}'<>'null'::jsonb then raise exception 'Day-only synthetic precision was lost';end if;
 select value into b from jsonb_array_elements(result->'buckets') where value->>'from'='2026-08-02';
 if b#>>'{vitals,systolic,count}'<>'2' or (b#>>'{vitals,systolic,mean}')::numeric<>145 then raise exception 'Synthetic baseline double-counts real-day readings';end if;
 if b#>>'{medication,missed}'<>'0' or b#>>'{medication,unknown}'<>'2' then raise exception 'Unknown medication doses became missed doses';end if;
 if (b->>'notesCount')::integer<>1 then raise exception 'Note counts do not match saved observations';end if;
 if result#>'{risk,0,score}'<>'null'::jsonb or result#>>'{risk,0,level}'<>'unknown' then raise exception 'Unknown baseline risk was fabricated';end if;
 first_page:=public.care_history(jsonb_build_object('seniorId','S001','from','2026-08-01','to','2026-08-02','asOfDate','2026-10-29','datasetId',manifest->>'datasetId','groupBy','month','limit',1));
 second_page:=public.care_history(jsonb_build_object('seniorId','S001','from','2026-08-01','to','2026-08-02','asOfDate','2026-10-29','datasetId',manifest->>'datasetId','groupBy','month','limit',1,'cursor',first_page->'nextCursor'));
 if first_page#>>'{entries,0,id}'=second_page#>>'{entries,0,id}' or second_page#>>'{entries,0,id}'<>'event:history-rollback-early' then raise exception 'Keyset pagination duplicated or skipped an intraday reading';end if;
 if first_page->'buckets'<>second_page->'buckets' or first_page#>>'{buckets,0,daysExpected}'<>'2' then raise exception 'Aggregates depend on the current page';end if;
 begin
  perform public.care_history(jsonb_build_object('seniorId','S001','from','2026-08-01','to','2026-08-02','asOfDate','2026-08-01','datasetId',manifest->>'datasetId'));
  raise exception 'History escaped the requested replay boundary';
 exception when invalid_parameter_value then null;end;
 dirty:=public.care_history_dirty('{}');
 select value->>'watermark' into watermark from jsonb_array_elements(dirty->'pending') where value->>'seniorId'='S001';
 if watermark is null then raise exception 'Backdated observations did not create a durable repair watermark';end if;
 -- The old watermark must not clear a newer event. This remains entirely local
 -- to this rolled-back transaction and sends no communications.
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('history-rollback-concurrent','workspace:primary','signal','S001',jsonb_build_object('type','note','record',jsonb_build_object('seniorId','S001','date','2026-08-02','source','coordinator','note','Synthetic additional check-in')),now()::text);
 select jsonb_agg(jsonb_build_object('date',d::date,'score',null,'level','unknown','reasons','[]'::jsonb)) into scores from generate_series('2026-08-01'::timestamp,'2026-10-29'::timestamp,interval '1 day') d;
 result:=public.care_history_scores_put(jsonb_build_object('seniorId','S001','from','2026-08-01','to','2026-10-29','revision','rollback-repair','scores',scores,'watermark',watermark));
 if result->>'acknowledged'<>'false' then raise exception 'A stale watermark acknowledged a newer observation';end if;
 dirty:=public.care_history_dirty('{}');
 select value->>'watermark' into watermark from jsonb_array_elements(dirty->'pending') where value->>'seniorId'='S001';
 result:=public.care_history_scores_put(jsonb_build_object('seniorId','S001','from','2026-08-01','to','2026-10-29','revision','rollback-repair','scores',scores,'watermark',watermark));
 if result->>'acknowledged'<>'true' then raise exception 'Completed history repair did not acknowledge its watermark';end if;
 -- Equal saved times still paginate by the database sequence.
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values
 ('history-rollback-audit-1','workspace:primary','audit','S001','{"action":"history_rollback"}','2026-01-01T00:00:00Z'),
 ('history-rollback-audit-2','workspace:primary','audit','S001','{"action":"history_rollback"}','2026-01-01T00:00:00Z');
 first_page:=public.care_events_scan(jsonb_build_object('owner','workspace:primary','seniorIds',jsonb_build_array('S001'),'kinds',jsonb_build_array('audit'),'ascending',false,'limit',1,'beforeCreatedAt','2026-01-02T00:00:00Z'));
 second_page:=public.care_events_scan(jsonb_build_object('owner','workspace:primary','seniorIds',jsonb_build_array('S001'),'kinds',jsonb_build_array('audit'),'ascending',false,'limit',1,'beforeCreatedAt',first_page#>>'{results,0,created_at}','beforeSequence',first_page#>>'{results,0,sequence}'));
 if first_page#>>'{results,0,id}'<>'history-rollback-audit-2' or second_page#>>'{results,0,id}'<>'history-rollback-audit-1' then raise exception 'Equal-time event pagination lost a record';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='coordinator@samarth.test'),'role','authenticated','iat',extract(epoch from clock_timestamp())::bigint)::text,true);
set local role authenticated;
do $$ begin
 perform public.care_history(jsonb_build_object('seniorId','S001','from','2026-08-01','to','2026-08-02','asOfDate','2026-10-29'));
 begin
  perform public.care_history(jsonb_build_object('seniorId','S003','from','2026-08-01','to','2026-08-02','asOfDate','2026-10-29'));
  raise exception 'Coordinator read another senior';
 exception when insufficient_privilege then null;end;
 begin
  perform public.care_import_synthetic_history('{}');raise exception 'Coordinator imported an archive';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='family@samarth.test'),'role','authenticated','iat',extract(epoch from clock_timestamp())::bigint)::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.care_observations) then raise exception 'Family read staff observation history directly';end if;
 begin
  perform public.care_history(jsonb_build_object('seniorId','S001','from','2026-08-01','to','2026-08-02','asOfDate','2026-10-29'));
  raise exception 'Family received raw history';
 exception when insufficient_privilege then null;end;
 begin
  perform public.care_history_dirty('{}');raise exception 'Family read repair jobs';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'History storage, chronology, coverage, pagination, repair and role checks passed' as result;
rollback;
