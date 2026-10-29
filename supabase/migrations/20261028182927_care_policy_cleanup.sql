-- Separate write policies avoid re-running an identical permissive SELECT
-- policy. The read policies and all caller/senior predicates stay unchanged.
drop policy profiles_write on public.care_profiles;
create policy profiles_insert on public.care_profiles for insert to authenticated
with check(private.care_has(senior_id,array['coordinator']));
create policy profiles_update on public.care_profiles for update to authenticated
using(private.care_has(senior_id,array['coordinator']))
with check(private.care_has(senior_id,array['coordinator']));
drop policy runtime_write on public.care_runtime;
create policy runtime_insert on public.care_runtime for insert to authenticated
with check((select private.care_admin()));
create policy runtime_update on public.care_runtime for update to authenticated
using((select private.care_admin())) with check((select private.care_admin()));

-- Explicit deny policies document the intended absence of client access.
-- Server-owned SECURITY DEFINER helpers continue to use their own privileges.
create policy settings_no_client_access on private.care_settings as restrictive
for all to anon,authenticated using(false) with check(false);
create policy dispatch_no_client_access on private.care_job_dispatch as restrictive
for all to anon,authenticated using(false) with check(false);
