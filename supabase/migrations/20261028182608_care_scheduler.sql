-- Private, account-local scheduling. No health data enters an HTTP request body.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

create table private.care_job_dispatch (
  singleton boolean primary key default true check(singleton),
  last_dispatched_at timestamptz
);
alter table private.care_job_dispatch enable row level security;
revoke all on private.care_job_dispatch from public,anon,authenticated,service_role;
insert into private.care_job_dispatch(singleton) values(true);

-- The random request credential is generated in the database and never returned.
do $setup$
declare job_secret text;
begin
 select decrypted_secret into job_secret from vault.decrypted_secrets where name='samarth_job_secret';
 if job_secret is null then
  job_secret:=encode(extensions.gen_random_bytes(32),'hex');
  perform vault.create_secret(job_secret,'samarth_job_secret','Samarth Care private background request credential');
 end if;
 insert into private.care_settings(key,value) values('job_secret_hash',encode(sha256(convert_to(job_secret,'UTF8')),'hex'))
 on conflict(key) do update set value=excluded.value;
end $setup$;

create function private.care_dispatch_job(force_run boolean default false) returns bigint
language plpgsql security definer set search_path='' as $dispatch$
declare project_url text; project_anon_key text; job_secret text; last_dispatch timestamptz; request_id bigint;
begin
 -- Root configures the selected project's public URL/JWT separately in Vault.
 select decrypted_secret into project_url from vault.decrypted_secrets where name='samarth_project_url';
 select decrypted_secret into project_anon_key from vault.decrypted_secrets where name='samarth_anon_key';
 select decrypted_secret into job_secret from vault.decrypted_secrets where name='samarth_job_secret';
 if project_url is null or project_anon_key is null or job_secret is null then return null; end if;
 if project_url !~ '^https://[a-z0-9]{20}\.supabase\.co$' or project_anon_key !~ '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
  raise exception 'The private scheduler project configuration is invalid';
 end if;
 -- A burst never blocks another clinical transaction just to enqueue a job.
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('samarth-care-job-dispatch',0)) then return null; end if;
 select last_dispatched_at into last_dispatch from private.care_job_dispatch where singleton=true;
 if not force_run and last_dispatch is not null and last_dispatch>pg_catalog.clock_timestamp()-interval '30 seconds' then return null; end if;
 update private.care_job_dispatch set last_dispatched_at=pg_catalog.clock_timestamp() where singleton=true;
 select net.http_post(
  url:=project_url||'/functions/v1/daily-care',
  body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||project_anon_key,'apikey',project_anon_key,'x-samarth-job-secret',job_secret),
  timeout_milliseconds:=120000
 ) into request_id;
 return request_id;
end $dispatch$;

create function private.care_request_daily() returns trigger
language plpgsql security definer set search_path='' as $trigger$
begin
 if tg_table_name='care_events' then
  if new.kind not in ('signal','consent','alert_state','task') then return new; end if;
  if tg_op='UPDATE' and new.payload is not distinct from old.payload then return new; end if;
 end if;
 perform private.care_dispatch_job(false);
 return new;
exception when others then
 -- Persisting a care observation must survive a scheduler outage. No exception
 -- details or clinical payload are copied into an application-visible error.
 raise warning 'Care processing deferred; the periodic job can retry';
 return new;
end $trigger$;

create trigger care_event_requests_processing after insert or update on public.care_events
for each row execute function private.care_request_daily();
create trigger care_consent_requests_processing after insert or update on public.care_consents
for each row execute function private.care_request_daily();

-- Ordinary accounts cannot invoke privileged dispatch or inspect its throttle.
revoke all on function private.care_dispatch_job(boolean),private.care_request_daily() from public,anon,authenticated,service_role;

select cron.schedule('samarth-care-background','*/15 * * * *',$cron$select private.care_dispatch_job(true);$cron$);
