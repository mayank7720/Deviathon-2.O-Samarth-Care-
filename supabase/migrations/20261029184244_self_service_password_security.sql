-- A user may invalidate only their own care sessions after changing an Auth
-- password. This does not grant memberships or touch another account.
create function private.care_password_changed() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not private.care_actor_enabled() then raise insufficient_privilege using message='Sign in to your active account';end if;
 insert into public.care_account_settings(user_id,credentials_valid_after,updated_at)
 values(actor,ceil(extract(epoch from clock_timestamp()))::bigint,now())
 on conflict(user_id) do update set credentials_valid_after=excluded.credentials_valid_after,updated_at=now();
 return jsonb_build_object('ok',true);
end $$;
create function public.care_password_changed() returns jsonb language sql security invoker set search_path='' as $$select private.care_password_changed()$$;
revoke all on function private.care_password_changed(),public.care_password_changed() from public,anon;
grant execute on function private.care_password_changed(),public.care_password_changed() to authenticated;
