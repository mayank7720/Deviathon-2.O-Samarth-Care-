create function public.care_update_account_channels(target_user_id uuid,sms_allowed boolean,call_allowed boolean,recipient_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare mobile text;
begin
 if not private.care_admin() then raise insufficient_privilege;end if;
 if recipient_confirmed is distinct from true then raise invalid_parameter_value;end if;
 select c.phone into mobile from public.care_account_contacts c where c.user_id=target_user_id for update;
 if mobile is null then raise invalid_parameter_value using message='Add a mobile number before enabling channels';end if;
 return public.care_set_account_phone(target_user_id,mobile,sms_allowed,call_allowed,recipient_confirmed);
end $$;
revoke all on function public.care_update_account_channels(uuid,boolean,boolean,boolean) from public,anon;
grant execute on function public.care_update_account_channels(uuid,boolean,boolean,boolean) to authenticated;
