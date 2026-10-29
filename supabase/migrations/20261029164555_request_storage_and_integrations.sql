-- Minimal authenticated request receipts; clinical content stays in its domain tables.
create table public.care_request_receipts (
 request_id uuid primary key, actor_id uuid not null references auth.users(id),
 category text not null check(category ~ '^[a-z-]{1,32}$'),
 method text not null check(method in ('GET','HEAD','POST','PATCH','PUT','DELETE','OPTIONS')),
 status smallint not null check(status between 100 and 599),
 duration_ms integer not null check(duration_ms between 0 and 300000),
 recorded_at timestamptz not null default clock_timestamp()
);
create index care_request_receipts_actor_time on public.care_request_receipts(actor_id,recorded_at desc);
create index care_request_receipts_time on public.care_request_receipts(recorded_at desc);
alter table public.care_request_receipts enable row level security;
revoke all on public.care_request_receipts from public,anon,authenticated;
grant select on public.care_request_receipts to authenticated;
grant all on public.care_request_receipts to service_role;
create policy request_receipts_read on public.care_request_receipts for select to authenticated
 using(actor_id=(select auth.uid()) or private.care_admin());

create function private.care_record_request(metadata jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise insufficient_privilege using message='Sign in required';end if;
 if jsonb_typeof(metadata)<>'object' or metadata-array['requestId','category','method','status','durationMs']<>'{}'::jsonb then raise invalid_parameter_value using message='Unsupported receipt fields';end if;
 insert into public.care_request_receipts(request_id,actor_id,category,method,status,duration_ms)
 values((metadata->>'requestId')::uuid,auth.uid(),metadata->>'category',metadata->>'method',(metadata->>'status')::smallint,(metadata->>'durationMs')::integer)
 on conflict(request_id) do nothing;
 -- Receipt retention does not delete care records or the care-action audit trail.
 delete from public.care_request_receipts where recorded_at<clock_timestamp()-interval '90 days';
 return jsonb_build_object('stored',true);
end $$;
revoke all on function private.care_record_request(jsonb) from public,anon;
grant execute on function private.care_record_request(jsonb) to authenticated;
create function public.care_record_request(metadata jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.care_record_request(metadata)$$;
revoke all on function public.care_record_request(jsonb) from public,anon;
grant execute on function public.care_record_request(jsonb) to authenticated;

create function private.care_system_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.care_admin() then raise insufficient_privilege using message='Operations administrator required';end if;
 return jsonb_build_object('checkedAt',clock_timestamp(),'database','connected',
 'counts',jsonb_build_object(
 'profiles',(select count(*) from public.care_profiles where owner='workspace:primary'),
 'observations',(select count(*) from public.care_observations where owner='workspace:primary'),
 'riskSnapshots',(select count(*) from public.care_risk_history where owner='workspace:primary'),
 'careEvents',(select count(*) from public.care_events where owner='workspace:primary'),
 'deliveries',(select count(*) from public.care_deliveries where owner='workspace:primary'),
 'requestReceipts',(select count(*) from public.care_request_receipts)),
 'eventKinds',coalesce((select jsonb_agg(x) from (select kind,count(*) as count from public.care_events where owner='workspace:primary' group by kind order by kind)x),'[]'::jsonb),
 'pendingHistoryRepairs',(select count(*) from private.care_history_pending),
 'recentRequests',coalesce((select jsonb_agg(x) from (select request_id as "requestId",category,method,status,duration_ms as "durationMs",recorded_at as "recordedAt" from public.care_request_receipts order by recorded_at desc limit 30)x),'[]'::jsonb));
end $$;
revoke all on function private.care_system_status() from public,anon;
grant execute on function private.care_system_status() to authenticated;
create function public.care_system_status() returns jsonb language sql security invoker set search_path='' as $$select private.care_system_status()$$;
revoke all on function public.care_system_status() from public,anon;
grant execute on function public.care_system_status() to authenticated;
