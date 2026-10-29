-- These tables are reached only through checked RPC implementations.
revoke all on public.care_account_settings,private.care_account_admin_requests from public,anon,authenticated;
create policy no_direct_account_settings on public.care_account_settings for all to authenticated using(false) with check(false);
create policy no_direct_admin_requests on private.care_account_admin_requests for all to authenticated using(false) with check(false);
