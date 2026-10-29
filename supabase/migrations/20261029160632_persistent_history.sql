-- Versioned synthetic history is separate from care events and from mutable score caches.
create table public.care_history_datasets (
 dataset_id text primary key, owner text not null check(owner='workspace:primary'),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'), generator text not null,
 start_date date not null, end_date date not null, senior_count integer not null check(senior_count between 1 and 10000),
 day_count integer not null check(day_count between 1 and 730), observation_count integer not null check(observation_count>=0),
 manifest jsonb not null, status text not null default 'importing' check(status in ('importing','complete')),
 imported_at timestamptz not null default now(), completed_at timestamptz,
 check(end_date-start_date+1=day_count)
);
create table public.care_observations (
 id text primary key, sequence bigint generated always as identity unique,
 owner text not null check(owner='workspace:primary'), senior_id text not null,
 dataset_id text references public.care_history_datasets(dataset_id), source_event_id text unique references public.care_events(id),
 record_date date not null, observed_at timestamptz, time_precision text not null check(time_precision in ('day','minute','second')),
 timezone text not null default 'Asia/Kolkata', recorded_at timestamptz, imported_at timestamptz not null default now(),
 source text not null, synthetic boolean not null default false, record jsonb not null check(jsonb_typeof(record)='object'),
 check((time_precision='day' and observed_at is null) or (time_precision<>'day' and observed_at is not null)),
 check((synthetic and dataset_id is not null and source_event_id is null) or (not synthetic and source_event_id is not null and dataset_id is null))
);
create index care_observations_timeline on public.care_observations(owner,senior_id,record_date desc,(coalesce(observed_at,'-infinity'::timestamptz)) desc,sequence desc);
create index care_observations_dataset on public.care_observations(dataset_id,senior_id,record_date) where synthetic;
create unique index care_observations_synthetic_day on public.care_observations(dataset_id,senior_id,record_date) where synthetic;
create table public.care_risk_history (
 id text primary key, owner text not null check(owner='workspace:primary'), senior_id text not null, score_date date not null,
 dataset_id text references public.care_history_datasets(dataset_id), snapshot_kind text not null check(snapshot_kind in ('synthetic-baseline','computed')),
 score numeric check(score between 0 and 100), level text not null check(level in ('unknown','low','medium','high')),
 urgency text, reasons jsonb not null default '[]', action text, revision text, computed_at timestamptz not null default now(),
 check((snapshot_kind='synthetic-baseline' and dataset_id is not null) or (snapshot_kind='computed' and dataset_id is null)),
 check(score is not null or level='unknown')
);
create index care_risk_history_timeline on public.care_risk_history(owner,senior_id,score_date,snapshot_kind);
alter table public.care_history_datasets enable row level security;
alter table public.care_observations enable row level security;
alter table public.care_risk_history enable row level security;
revoke all on public.care_history_datasets,public.care_observations,public.care_risk_history from public,anon,authenticated;
grant select on public.care_history_datasets,public.care_observations,public.care_risk_history to authenticated;
grant all on public.care_history_datasets,public.care_observations,public.care_risk_history to service_role;
create policy history_datasets_staff on public.care_history_datasets for select to authenticated using(private.care_has('',array['coordinator','operations']));
create policy observations_staff on public.care_observations for select to authenticated using(private.care_has(senior_id,array['coordinator','operations']));
create policy risk_history_staff on public.care_risk_history for select to authenticated using(private.care_has(senior_id,array['coordinator','operations']));
create table private.care_history_pending (
 owner text not null check(owner='workspace:primary'),senior_id text not null,from_date date not null,last_date date not null,
 watermark bigint not null,updated_at timestamptz not null default now(),primary key(owner,senior_id),check(last_date>=from_date)
);
alter table private.care_history_pending enable row level security;
revoke all on private.care_history_pending from public,anon,authenticated;
create policy history_pending_no_direct_access on private.care_history_pending for all to authenticated using(false) with check(false);

create function private.care_history_current_date() returns date language sql stable security definer set search_path='' as $$
 select coalesce((select case when mode='live' then (now() at time zone 'Asia/Kolkata')::date else as_of_date::date end from public.care_runtime where owner='workspace:primary' limit 1),
 (select end_date from public.care_history_datasets where status='complete' order by completed_at desc,dataset_id desc limit 1),(now() at time zone 'Asia/Kolkata')::date)
$$;
revoke all on function private.care_history_current_date() from public,anon,authenticated;

create function private.care_history_saved_clock() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.kind='signal' then new.created_at:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');end if;
 return new;
end $$;
revoke all on function private.care_history_saved_clock() from public,anon,authenticated;
create trigger care_history_saved_clock before insert on public.care_events for each row execute function private.care_history_saved_clock();

-- An ordinary saved event retains each individual reading. Day-only historical
-- records remain day-only; the import time is never invented as measurement time.
create function private.care_history_project_event() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb:=new.payload->'record'; stamp timestamptz; precision_name text; zone_name text;
begin
 if new.kind<>'signal' or jsonb_typeof(r)<>'object' then return new;end if;
 if coalesce(r->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise invalid_parameter_value using message='Observation date is required';end if;
 if nullif(r->>'observedAt','') is not null and r->>'observedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then raise invalid_parameter_value using message='Observation time needs an explicit UTC offset';end if;
 stamp:=nullif(r->>'observedAt','')::timestamptz;
 precision_name:=case when stamp is null then 'day' else coalesce(r->>'timePrecision','second') end;
 zone_name:=coalesce(nullif(r->>'timezone',''),'Asia/Kolkata');
 if zone_name<>'Asia/Kolkata' then raise invalid_parameter_value using message='Use the workspace timezone Asia/Kolkata';end if;
 if precision_name not in ('day','minute','second') or (stamp is null)<>(precision_name='day') then raise invalid_parameter_value using message='Observation precision does not match its time';end if;
 if stamp is not null and ((stamp at time zone zone_name)::date<>(r->>'date')::date or stamp>clock_timestamp()+interval '1 minute') then raise invalid_parameter_value using message='Observation time must match its date and cannot be in the future';end if;
 insert into public.care_observations(id,owner,senior_id,source_event_id,record_date,observed_at,time_precision,timezone,recorded_at,source,synthetic,record)
 values('event:'||new.id,new.owner,new.senior_id,new.id,(r->>'date')::date,stamp,precision_name,zone_name,new.created_at::timestamptz,coalesce(nullif(r->>'source',''),'recorded'),false,r)
 on conflict(id) do update set record=excluded.record,observed_at=excluded.observed_at,time_precision=excluded.time_precision;
 insert into private.care_history_pending(owner,senior_id,from_date,last_date,watermark)
 values(new.owner,new.senior_id,(r->>'date')::date,(r->>'date')::date,new.sequence)
 on conflict(owner,senior_id) do update set from_date=least(care_history_pending.from_date,excluded.from_date),last_date=greatest(care_history_pending.last_date,excluded.last_date),watermark=greatest(care_history_pending.watermark,excluded.watermark),updated_at=clock_timestamp();
 return new;
end $$;
revoke all on function private.care_history_project_event() from public,anon,authenticated;
create trigger care_history_project_event after insert or update on public.care_events for each row execute function private.care_history_project_event();
insert into public.care_observations(id,owner,senior_id,source_event_id,record_date,observed_at,time_precision,recorded_at,source,synthetic,record)
 select 'event:'||id,owner,senior_id,id,(payload#>>'{record,date}')::date,nullif(payload#>>'{record,observedAt}','')::timestamptz,
 case when nullif(payload#>>'{record,observedAt}','') is null then 'day' else coalesce(payload#>>'{record,timePrecision}','second') end,
 created_at::timestamptz,coalesce(payload#>>'{record,source}','recorded'),false,payload->'record'
 from public.care_events where kind='signal' and payload#>>'{record,date}' ~ '^\d{4}-\d{2}-\d{2}$' on conflict(id) do nothing;
insert into private.care_history_pending(owner,senior_id,from_date,last_date,watermark)
 select owner,senior_id,min((payload#>>'{record,date}')::date),max((payload#>>'{record,date}')::date),max(sequence)
 from public.care_events where kind='signal' and payload#>>'{record,date}' ~ '^\d{4}-\d{2}-\d{2}$' group by owner,senior_id on conflict do nothing;

create function private.care_history_project_score() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.care_risk_history(id,owner,senior_id,score_date,snapshot_kind,score,level,urgency,reasons,action,computed_at)
 values('computed:'||new.owner||':'||new.senior_id||':'||new.score_date,new.owner,new.senior_id,new.score_date::date,'computed',
 (new.payload->>'score')::numeric,coalesce(new.payload->>'level','unknown'),new.payload->>'urgency',coalesce(new.payload->'reasons','[]'),new.payload->>'action',new.computed_at::timestamptz)
 on conflict(id) do update set score=excluded.score,level=excluded.level,urgency=excluded.urgency,reasons=excluded.reasons,action=excluded.action,computed_at=excluded.computed_at;
 return new;
end $$;
revoke all on function private.care_history_project_score() from public,anon,authenticated;
create trigger care_history_project_score after insert or update on public.care_daily_scores for each row execute function private.care_history_project_score();
insert into public.care_risk_history(id,owner,senior_id,score_date,snapshot_kind,score,level,urgency,reasons,action,computed_at)
 select 'computed:'||owner||':'||senior_id||':'||score_date,owner,senior_id,score_date::date,'computed',(payload->>'score')::numeric,
 coalesce(payload->>'level','unknown'),payload->>'urgency',coalesce(payload->'reasons','[]'),payload->>'action',computed_at::timestamptz
 from public.care_daily_scores on conflict(id) do nothing;

-- Only the current Operations administrator can import a synthetic fixture. No
-- contact, membership, care-event, delivery or real-record row is changed here.
create function private.care_import_synthetic_history(batch jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=batch->'manifest'; ds public.care_history_datasets%rowtype; item jsonb; prior jsonb; rid text; sid text; d date; profiles_count integer; observations_count integer; scores_count integer; stamp timestamptz:=clock_timestamp();
begin
 if auth.uid() is null or not private.care_admin() then raise insufficient_privilege using message='Only Operations can import synthetic history';end if;
 if jsonb_typeof(batch)<>'object' or jsonb_typeof(m)<>'object' or octet_length(batch::text)>4000000 then raise invalid_parameter_value using message='Invalid history batch';end if;
 if coalesce(m->>'synthetic','')<>'true' or coalesce(m->>'datasetId','') !~ '^[a-zA-Z0-9:_-]{8,180}$' or coalesce(m->>'fingerprint','') !~ '^[a-f0-9]{64}$' or coalesce(m->>'generator','')='' then raise invalid_parameter_value using message='A versioned synthetic manifest is required';end if;
 if (m->>'endDate')::date-(m->>'startDate')::date+1<>(m->>'days')::integer or (m->>'days')::integer not between 1 and 730 or (m->>'seniorCount')::integer not between 1 and 10000 or (m->>'observations')::integer not between 0 and 7300000 then raise invalid_parameter_value using message='Invalid synthetic history bounds';end if;
 if jsonb_typeof(coalesce(batch->'profiles','[]'))<>'array' or jsonb_typeof(coalesce(batch->'observations','[]'))<>'array' or jsonb_typeof(coalesce(batch->'scores','[]'))<>'array'
 or jsonb_array_length(coalesce(batch->'profiles','[]'))>500 or jsonb_array_length(coalesce(batch->'observations','[]'))>500 or jsonb_array_length(coalesce(batch->'scores','[]'))>500 then raise invalid_parameter_value using message='History import chunks contain at most 500 rows per type';end if;
 perform pg_advisory_xact_lock(hashtext('care-history-import:'||(m->>'datasetId')));
 select * into ds from public.care_history_datasets where dataset_id=m->>'datasetId';
 if ds.dataset_id is not null and ds.manifest<>m then raise unique_violation using message='This dataset version already has a different manifest';end if;
 if ds.dataset_id is null then
  insert into public.care_history_datasets(dataset_id,owner,fingerprint,generator,start_date,end_date,senior_count,day_count,observation_count,manifest)
  values(m->>'datasetId','workspace:primary',m->>'fingerprint',m->>'generator',(m->>'startDate')::date,(m->>'endDate')::date,(m->>'seniorCount')::integer,(m->>'days')::integer,(m->>'observations')::integer,m);
  select * into ds from public.care_history_datasets where dataset_id=m->>'datasetId';
 end if;
 for item in select value from jsonb_array_elements(coalesce(batch->'profiles','[]')) loop
  sid:=item->>'id';
  if coalesce(sid,'') !~ '^S[0-9]{3,5}$' or coalesce(item#>>'{dataProvenance,kind}','')<>'synthetic' or coalesce(item->>'name','')='' then raise invalid_parameter_value using message='Only explicitly synthetic senior profiles can be imported';end if;
  select profile into prior from public.care_profiles where owner=ds.owner and senior_id=sid;
  if prior is not null and prior<>item then raise unique_violation using message='An existing senior profile differs; no profile was overwritten';end if;
  if ds.status='complete' and prior is null then raise insufficient_privilege using message='Completed synthetic datasets cannot add profiles';end if;
  insert into public.care_profiles(owner,senior_id,name,profile,updated_at) values(ds.owner,sid,item->>'name',item,to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) on conflict do nothing;
 end loop;
 for item in select value from jsonb_array_elements(coalesce(batch->'observations','[]')) loop
  sid:=item->>'seniorId';d:=(item->>'date')::date;rid:='synthetic:'||ds.dataset_id||':'||(item->>'id');
  if coalesce(item->>'id','')='' or length(rid)>350 or d<ds.start_date or d>ds.end_date or coalesce(item#>>'{provenance,synthetic}','')<>'true' or nullif(item->>'observedAt','') is not null
  or not exists(select 1 from public.care_profiles where owner=ds.owner and senior_id=sid and profile#>>'{dataProvenance,kind}'='synthetic') then raise invalid_parameter_value using message='Synthetic observation provenance, date or senior is invalid';end if;
  select record into prior from public.care_observations where id=rid;
  if prior is not null and prior<>item then raise unique_violation using message='Synthetic records are immutable within a dataset version';end if;
  if ds.status='complete' and prior is null then raise insufficient_privilege using message='Completed synthetic datasets are immutable';end if;
  insert into public.care_observations(id,owner,senior_id,dataset_id,record_date,observed_at,time_precision,recorded_at,source,synthetic,record)
  values(rid,ds.owner,sid,ds.dataset_id,d,null,'day',null,coalesce(item->>'source','synthetic'),true,item) on conflict do nothing;
 end loop;
 for item in select value from jsonb_array_elements(coalesce(batch->'scores','[]')) loop
  sid:=item->>'seniorId';d:=(item->>'date')::date;rid:='baseline:'||ds.dataset_id||':'||sid||':'||d::text;
  if d<ds.start_date or d>ds.end_date or coalesce(item->>'synthetic','')<>'true' or not exists(select 1 from public.care_profiles where owner=ds.owner and senior_id=sid) then raise invalid_parameter_value using message='Synthetic score provenance, date or senior is invalid';end if;
  if exists(select 1 from public.care_risk_history where id=rid and (score is distinct from (item->>'score')::numeric or level is distinct from item->>'level' or reasons is distinct from coalesce(item->'reasons','[]'))) then raise unique_violation using message='Synthetic score history is immutable';end if;
  if ds.status='complete' and not exists(select 1 from public.care_risk_history where id=rid) then raise insufficient_privilege using message='Completed synthetic score history is immutable';end if;
  insert into public.care_risk_history(id,owner,senior_id,score_date,dataset_id,snapshot_kind,score,level,urgency,reasons,action)
  values(rid,ds.owner,sid,d,ds.dataset_id,'synthetic-baseline',(item->>'score')::numeric,item->>'level',item->>'urgency',coalesce(item->'reasons','[]'),item->>'action') on conflict do nothing;
 end loop;
 select count(*) into observations_count from public.care_observations where dataset_id=ds.dataset_id;
 select count(distinct senior_id) into profiles_count from public.care_observations where dataset_id=ds.dataset_id;
 select count(*) into scores_count from public.care_risk_history where dataset_id=ds.dataset_id;
 if coalesce((batch->>'complete')::boolean,false) then
  if observations_count<>ds.observation_count or profiles_count<>ds.senior_count or scores_count<>ds.senior_count*ds.day_count or exists(select 1 from public.care_risk_history where dataset_id=ds.dataset_id group by senior_id having count(*)<>ds.day_count) then raise check_violation using message='Synthetic import is incomplete; counts do not match the manifest';end if;
  update public.care_history_datasets set status='complete',completed_at=coalesce(completed_at,stamp) where dataset_id=ds.dataset_id;
 end if;
 return jsonb_build_object('datasetId',ds.dataset_id,'status',case when coalesce((batch->>'complete')::boolean,false) then 'complete' else ds.status end,'profiles',profiles_count,'observations',observations_count,'scores',scores_count,'manifest',m);
end $$;
create function public.care_import_synthetic_history(batch jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.care_import_synthetic_history(batch)$$;
revoke all on function private.care_import_synthetic_history(jsonb),public.care_import_synthetic_history(jsonb) from public,anon;
grant execute on function private.care_import_synthetic_history(jsonb),public.care_import_synthetic_history(jsonb) to authenticated;

create function private.care_history(options jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sid text:=options->>'seniorId'; first_date date; last_date date; as_of date; workspace_date date; group_name text:=coalesce(options->>'groupBy','day'); page_size integer:=least(200,greatest(1,coalesce((options->>'limit')::integer,50)));
 ds public.care_history_datasets%rowtype; entry_rows jsonb; cursor_value jsonb; bucket_rows jsonb; risk_rows jsonb;
begin
 if auth.uid() is null or sid is null or not private.care_has(sid,array['coordinator','operations']) then raise insufficient_privilege using message='Staff access to this senior is required';end if;
 if group_name not in ('day','week','month') then raise invalid_parameter_value using message='Choose day, week or month grouping';end if;
 first_date:=(options->>'from')::date;last_date:=(options->>'to')::date;as_of:=(options->>'asOfDate')::date;
 select * into ds from public.care_history_datasets where owner='workspace:primary' and status='complete' and (options->>'datasetId' is null or dataset_id=options->>'datasetId') order by completed_at desc,dataset_id desc limit 1;
 select case when mode='live' then (now() at time zone 'Asia/Kolkata')::date else as_of_date::date end into workspace_date from public.care_runtime where owner='workspace:primary' limit 1;
 workspace_date:=coalesce(workspace_date,ds.end_date,(now() at time zone 'Asia/Kolkata')::date);
 as_of:=least(as_of,workspace_date);
 if first_date is null or last_date is null or as_of is null or first_date>last_date or last_date>as_of or last_date-first_date>365 then raise invalid_parameter_value using message='Choose a range of at most 366 days ending no later than the workspace date';end if;
 with selected as (
  select o.* from public.care_observations o where owner='workspace:primary' and senior_id=sid and record_date between first_date and last_date and (not synthetic or dataset_id=ds.dataset_id)
  and (options->'cursor' is null or options->'cursor'='null' or (record_date,coalesce(observed_at,'-infinity'::timestamptz),sequence)<((options#>>'{cursor,date}')::date,coalesce((options#>>'{cursor,observedAt}')::timestamptz,'-infinity'::timestamptz),(options#>>'{cursor,sequence}')::bigint))
  order by record_date desc,coalesce(observed_at,'-infinity'::timestamptz) desc,sequence desc limit page_size+1
 ), page as (select * from selected order by record_date desc,coalesce(observed_at,'-infinity'::timestamptz) desc,sequence desc limit page_size)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'seniorId',senior_id,'date',record_date,'observedAt',observed_at,'timePrecision',time_precision,'timezone',timezone,'recordedAt',recorded_at,'source',source,'synthetic',synthetic,'datasetId',dataset_id,'record',record) order by record_date desc,coalesce(observed_at,'-infinity'::timestamptz) desc,sequence desc),'[]'),
 case when (select count(*) from selected)>page_size then (select jsonb_build_object('date',record_date,'observedAt',observed_at,'sequence',sequence::text) from page order by record_date,coalesce(observed_at,'-infinity'::timestamptz),sequence limit 1) else null end into entry_rows,cursor_value from page;
 with days as (
  select d::date as d,case group_name when 'month' then date_trunc('month',d)::date when 'week' then date_trunc('week',d)::date else d::date end as bucket
  from generate_series(first_date::timestamp,last_date::timestamp,interval '1 day') d
 ), observations as materialized (
  select o.*,case group_name when 'month' then date_trunc('month',record_date)::date when 'week' then date_trunc('week',record_date)::date else record_date end as bucket
  from public.care_observations o where owner='workspace:primary' and senior_id=sid and record_date between first_date and last_date and (not synthetic or dataset_id=ds.dataset_id)
 ), readings as (
  select o.bucket,v.key,(v.value#>>'{}')::numeric as value from observations o cross join lateral jsonb_each(coalesce(o.record->'vitals','{}')) v
  where v.key in ('systolic','diastolic','glucose','spo2','weight') and jsonb_typeof(v.value)='number'
  and (not o.synthetic or not exists(select 1 from observations actual where not actual.synthetic and actual.record_date=o.record_date and jsonb_typeof(actual.record#>array['vitals',v.key])='number'))
 ), vital_stats as (
  select bucket,key,count(*) as n,round(avg(value),2) as average,min(value) as minimum,max(value) as maximum from readings group by bucket,key
 ), meds as (
  select distinct on(record_date) bucket,record_date,(record#>>'{medication,prescribed}')::integer as scheduled,(record#>>'{medication,taken}')::integer as taken,
  case when jsonb_typeof(record#>'{medication,doses}')='array' and jsonb_array_length(record#>'{medication,doses}')>0 then (select count(*)::integer from jsonb_array_elements(record#>'{medication,doses}') dose where dose->>'status'='missed') else greatest(0,(record#>>'{medication,prescribed}')::integer-(record#>>'{medication,taken}')::integer) end as missed,
  case when jsonb_typeof(record#>'{medication,doses}')='array' then (select count(*)::integer from jsonb_array_elements(record#>'{medication,doses}') dose where dose->>'status'='unknown') else 0 end as unknown_count
  from observations where jsonb_typeof(record#>'{medication,prescribed}')='number' and jsonb_typeof(record#>'{medication,taken}')='number'
  order by record_date,synthetic,observed_at desc nulls last,sequence desc
 ), groups as (select bucket,min(d) as first,max(d) as last,count(*) as expected from days group by bucket)
 select coalesce(jsonb_agg(jsonb_build_object('from',g.first,'to',g.last,'label',g.bucket::text,'daysExpected',g.expected,
 'daysObserved',(select count(distinct record_date) from observations where bucket=g.bucket),'records',(select count(*) from observations where bucket=g.bucket),
 'notesCount',(select count(*) from observations where bucket=g.bucket and length(trim(coalesce(record->>'note','')))>0),
 'missingDays',g.expected-(select count(distinct record_date) from observations where bucket=g.bucket),
 'vitals',coalesce((select jsonb_object_agg(key,jsonb_build_object('count',n,'mean',average,'min',minimum,'max',maximum)) from vital_stats where bucket=g.bucket),'{}'),
 'medication',jsonb_build_object('scheduled',(select sum(scheduled) from meds where bucket=g.bucket),'taken',(select sum(taken) from meds where bucket=g.bucket),
 'missed',(select sum(missed) from meds where bucket=g.bucket),'unknown',(select sum(unknown_count) from meds where bucket=g.bucket),'daysLogged',(select count(*) from meds where bucket=g.bucket))) order by g.first),'[]') into bucket_rows from groups g;
 select coalesce(jsonb_agg(jsonb_build_object('date',score_date,'score',score,'level',level,'urgency',urgency,'reasons',reasons,'action',action,'computedAt',computed_at,'synthetic',snapshot_kind='synthetic-baseline','source',snapshot_kind) order by score_date),'[]') into risk_rows from (
  select distinct on(score_date) * from public.care_risk_history where owner='workspace:primary' and senior_id=sid and score_date between first_date and last_date and (snapshot_kind='computed' or dataset_id=ds.dataset_id)
  order by score_date,case when snapshot_kind='computed' then 0 else 1 end,computed_at desc
 ) r;
 return jsonb_build_object('range',jsonb_build_object('from',first_date,'to',last_date,'asOfDate',as_of,'groupBy',group_name,'timezone','Asia/Kolkata'),
 'entries',entry_rows,'nextCursor',cursor_value,'buckets',bucket_rows,'risk',risk_rows,'dataset',case when ds.dataset_id is null then null else ds.manifest end,'stored',true,
 'rebuildPending',exists(select 1 from private.care_history_pending where owner='workspace:primary' and senior_id=sid and from_date<=(options->>'to')::date));
end $$;
create function public.care_history(options jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.care_history(options)$$;
revoke all on function private.care_history(jsonb),public.care_history(jsonb) from public,anon;
grant execute on function private.care_history(jsonb),public.care_history(jsonb) to authenticated;

-- The caller recomputes all affected dates after a backdated observation. Keep
-- these derived snapshots separate from the immutable synthetic baseline.
create function private.care_history_scores_put(options jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid text:=options->>'seniorId'; first_date date:=(options->>'from')::date; last_date date:=(options->>'to')::date; item jsonb; d date; stamp timestamptz:=clock_timestamp(); n integer:=0; acknowledged boolean:=false;
begin
 if sid is null or not (private.care_service() or (auth.uid() is not null and private.care_has(sid,array['coordinator']))) then raise insufficient_privilege using message='Only assigned care staff can refresh score history';end if;
 if first_date is null or last_date is null or first_date>last_date or last_date-first_date>365 or last_date>(now() at time zone 'Asia/Kolkata')::date
 or jsonb_typeof(options->'scores')<>'array' or jsonb_array_length(options->'scores')>366 or coalesce(options->>'revision','')='' then raise invalid_parameter_value using message='Invalid score history refresh';end if;
 for item in select value from jsonb_array_elements(options->'scores') loop
  d:=(item->>'date')::date;
  if d is null or d<first_date or d>last_date or coalesce(item->>'level','') not in ('unknown','low','medium','high') or jsonb_typeof(coalesce(item->'reasons','[]'))<>'array' then raise invalid_parameter_value using message='A score lies outside the requested range';end if;
  insert into public.care_risk_history(id,owner,senior_id,score_date,snapshot_kind,score,level,urgency,reasons,action,revision,computed_at)
  values('computed:workspace:primary:'||sid||':'||d::text,'workspace:primary',sid,d,'computed',(item->>'score')::numeric,item->>'level',item->>'urgency',coalesce(item->'reasons','[]'),item->>'action',options->>'revision',stamp)
  on conflict(id) do update set score=excluded.score,level=excluded.level,urgency=excluded.urgency,reasons=excluded.reasons,action=excluded.action,revision=excluded.revision,computed_at=excluded.computed_at;
  n:=n+1;
 end loop;
 if options->>'watermark' is not null and n=last_date-first_date+1 and n=(select count(distinct value->>'date') from jsonb_array_elements(options->'scores')) then
  delete from private.care_history_pending where owner='workspace:primary' and senior_id=sid and watermark=(options->>'watermark')::bigint and from_date>=first_date and private.care_history_pending.last_date<=(options->>'to')::date;
  acknowledged:=found;
 end if;
 return jsonb_build_object('updated',n,'from',first_date,'to',last_date,'acknowledged',acknowledged);
end $$;
create function public.care_history_scores_put(options jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.care_history_scores_put(options)$$;
revoke all on function private.care_history_scores_put(jsonb),public.care_history_scores_put(jsonb) from public,anon;
grant execute on function private.care_history_scores_put(jsonb),public.care_history_scores_put(jsonb) to authenticated,service_role;

create function private.care_history_dirty(options jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare maximum integer:=least(250,greatest(1,coalesce((options->>'limit')::integer,200))); result jsonb;more boolean;
begin
 if not private.care_service() and (auth.uid() is null or not private.care_has('',array['coordinator'])) then raise insufficient_privilege using message='Only care staff can repair score history';end if;
 with selected as (select * from private.care_history_pending where owner='workspace:primary' and (private.care_service() or private.care_has(senior_id,array['coordinator'])) order by updated_at,senior_id limit maximum+1),page as (select * from selected order by updated_at,senior_id limit maximum)
 select coalesce(jsonb_agg(jsonb_build_object('seniorId',senior_id,'from',from_date,'to',last_date,'watermark',watermark::text) order by updated_at,senior_id),'[]'),(select count(*) from selected)>maximum into result,more from page;
 return jsonb_build_object('pending',result,'hasMore',more);
end $$;
create function public.care_history_dirty(options jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.care_history_dirty(options)$$;
revoke all on function private.care_history_dirty(jsonb),public.care_history_dirty(jsonb) from public,anon;
grant execute on function private.care_history_dirty(jsonb),public.care_history_dirty(jsonb) to authenticated,service_role;

-- Keyset pagination preserves records sharing the same timestamp. Relay status
-- and clinical history can now be fetched independently without silent truncation.
create or replace function public.care_events_scan(options jsonb) returns jsonb language sql security invoker set search_path='' as $$
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
