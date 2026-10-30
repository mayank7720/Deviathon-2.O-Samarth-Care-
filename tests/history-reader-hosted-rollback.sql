begin;
create or replace function pg_temp.original_care_scan(options jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('results',coalesce(jsonb_agg(to_jsonb(t)),'[]')) from (
 select id,kind,senior_id,payload::text as payload,created_at,sequence from public.care_events e
 where e.owner=options->>'owner' and (options->'seniorIds' is null or options->'seniorIds'='null' or e.senior_id='' or options->'seniorIds' ? e.senior_id)
 and (options->'kinds' is null or options->'kinds'='null' or options->'kinds' ? e.kind)
 and (options->>'sinceRecordDate' is null or e.kind<>'signal' or e.payload#>>'{record,date}'>=options->>'sinceRecordDate')
 and (options->>'beforeCreatedAt' is null or (options->>'beforeSequence' is null and e.created_at<options->>'beforeCreatedAt')
 or (options->>'beforeSequence' is not null and (e.created_at,e.sequence)<(options->>'beforeCreatedAt',(options->>'beforeSequence')::bigint)))
 order by case when coalesce((options->>'ascending')::boolean,true) then e.created_at end asc,case when coalesce((options->>'ascending')::boolean,true) then e.sequence end asc,case when not coalesce((options->>'ascending')::boolean,true) then e.created_at end desc,case when not coalesce((options->>'ascending')::boolean,true) then e.sequence end desc
 limit least(5000,greatest(1,coalesce((options->>'limit')::integer,5000)))) t
$$;
create temp table scan_checks(role text,rows integer,new_ms numeric);
grant insert on scan_checks to authenticated;
do $test$
declare r record;a jsonb;b jsonb;t timestamptz;opts jsonb;new_time numeric;
begin
 -- Filter and cursor equivalence without multiplying the old slow RLS lookup.
 for opts in select value from jsonb_array_elements('[{"owner":"workspace:primary","limit":10,"ascending":false},{"owner":"workspace:primary","kinds":["signal","report_job"],"seniorIds":["S001"],"limit":20,"ascending":true},{"owner":"workspace:primary","kinds":[],"limit":1},{"owner":"workspace:primary","seniorIds":[],"limit":20},{"owner":"other-workspace","limit":1},{"owner":"workspace:primary","kinds":["signal"],"sinceRecordDate":"2026-10-28","limit":20}]'::jsonb) loop
  a:=pg_temp.original_care_scan(opts);b:=public.care_events_scan(opts);
  if a is distinct from b then raise exception 'History filter semantics changed';end if;
  if jsonb_array_length(b->'results')>0 then
   opts:=opts||jsonb_build_object('beforeCreatedAt',b#>>'{results,0,created_at}','beforeSequence',b#>>'{results,0,sequence}');
   if pg_temp.original_care_scan(opts) is distinct from public.care_events_scan(opts) then raise exception 'History cursor semantics changed';end if;
  end if;
 end loop;
 -- Every role continues to receive exactly its caller-scoped RLS result.
 for r in select distinct on(role) user_id,role from public.care_memberships where status='active' and role in ('operations','coordinator','family','senior') order by role,created_at loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',r.user_id,'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
  execute 'set local role authenticated';
  opts:='{"owner":"workspace:primary","kinds":["signal","generated_report","report_job"],"limit":20,"ascending":false}'::jsonb;
  t:=clock_timestamp();b:=public.care_events_scan(opts);new_time:=extract(epoch from clock_timestamp()-t)*1000;
  select jsonb_build_object('results',coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb)) into a from (select id,kind,senior_id,payload::text as payload,created_at,sequence from public.care_events where owner='workspace:primary' and kind=any(array['signal','generated_report','report_job']) order by created_at desc,sequence desc limit 20)q;
  if a is distinct from b then raise exception 'Caller RLS differs for %',r.role;end if;
  if r.role in ('family','senior') and exists(select 1 from jsonb_array_elements(b->'results')x where x->>'kind' in ('generated_report','report_job')) then raise exception 'Unreviewed report exposed';end if;
  insert into scan_checks values(r.role,jsonb_array_length(b->'results'),new_time);
  execute 'reset role';
 end loop;
end $test$;
select role,rows,round(new_ms,1) as new_ms from scan_checks order by role;
rollback;