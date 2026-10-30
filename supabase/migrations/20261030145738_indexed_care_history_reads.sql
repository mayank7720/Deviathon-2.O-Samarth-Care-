-- Use native indexed equality predicates before expensive row policies.
-- The previous JSON containment filters and CASE-based ordering forced scans
-- through thousands of gateway heartbeat rows for a single health-page read.
create index if not exists care_events_owner_time on public.care_events(owner,created_at desc,sequence desc);

create or replace function public.care_events_scan(options jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 v_ids text[]; v_kinds text[]; v_limit integer;
 v_before text:=options->>'beforeCreatedAt'; v_sequence bigint:=(options->>'beforeSequence')::bigint;
 v_since text:=options->>'sinceRecordDate'; v_ascending boolean:=coalesce((options->>'ascending')::boolean,true);
 v_sql text; v_result jsonb;
begin
 if options->'seniorIds' is not null and options->'seniorIds'<>'null'::jsonb then
  if jsonb_typeof(options->'seniorIds')<>'array' then raise invalid_parameter_value;end if;
  select coalesce(array_agg(value),'{}'::text[]) into v_ids from jsonb_array_elements_text(options->'seniorIds');
 end if;
 if options->'kinds' is not null and options->'kinds'<>'null'::jsonb then
  if jsonb_typeof(options->'kinds')<>'array' then raise invalid_parameter_value;end if;
  select coalesce(array_agg(value),'{}'::text[]) into v_kinds from jsonb_array_elements_text(options->'kinds');
 end if;
 v_limit:=least(5000,greatest(1,coalesce((options->>'limit')::integer,5000)));
 -- Only fixed clauses are assembled; all caller values stay bound parameters.
 v_sql:='select jsonb_build_object(''results'',coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb)) from (select e.id,e.kind,e.senior_id,e.payload::text as payload,e.created_at,e.sequence from public.care_events e where e.owner=$1';
 if v_ids is not null then v_sql:=v_sql||' and (e.senior_id='''' or e.senior_id=any($2))';end if;
 if v_kinds is not null then v_sql:=v_sql||' and e.kind=any($3)';end if;
 if v_since is not null then v_sql:=v_sql||' and (e.kind<>''signal'' or e.payload#>>''{record,date}'' >= $4)';end if;
 if v_before is not null then
  if v_sequence is null then v_sql:=v_sql||' and e.created_at<$5';
  else v_sql:=v_sql||' and (e.created_at,e.sequence)<($5,$6)';end if;
 end if;
 v_sql:=v_sql||case when v_ascending then ' order by e.created_at asc,e.sequence asc' else ' order by e.created_at desc,e.sequence desc' end||' limit $7) t';
 execute v_sql into v_result using options->>'owner',v_ids,v_kinds,v_since,v_before,v_sequence,v_limit;
 return v_result;
end $$;

revoke all on function public.care_events_scan(jsonb) from public,anon;
grant execute on function public.care_events_scan(jsonb) to authenticated,service_role;
