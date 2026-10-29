-- Keep elevated implementations outside the exposed API schema. Public entry
-- points run as the caller; private implementations still check current roles.
alter function public.care_account_directory() set schema private;
alter function public.care_account_phone_contacts() set schema private;
alter function public.care_set_account_phone(uuid,text,boolean,boolean,boolean) set schema private;
alter function public.care_update_account_channels(uuid,boolean,boolean,boolean) set schema private;
create function public.care_account_directory() returns jsonb language sql security invoker set search_path='' as $$select private.care_account_directory()$$;
create function public.care_account_phone_contacts() returns jsonb language sql security invoker set search_path='' as $$select private.care_account_phone_contacts()$$;
create function public.care_set_account_phone(target_user_id uuid,mobile text,sms_allowed boolean,call_allowed boolean,recipient_confirmed boolean) returns jsonb language sql security invoker set search_path='' as $$select private.care_set_account_phone(target_user_id,mobile,sms_allowed,call_allowed,recipient_confirmed)$$;
create function public.care_update_account_channels(target_user_id uuid,sms_allowed boolean,call_allowed boolean,recipient_confirmed boolean) returns jsonb language sql security invoker set search_path='' as $$select private.care_update_account_channels(target_user_id,sms_allowed,call_allowed,recipient_confirmed)$$;
revoke all on function public.care_account_directory(),public.care_account_phone_contacts(),public.care_set_account_phone(uuid,text,boolean,boolean,boolean),public.care_update_account_channels(uuid,boolean,boolean,boolean) from public,anon;
grant execute on function public.care_account_directory(),public.care_account_phone_contacts(),public.care_set_account_phone(uuid,text,boolean,boolean,boolean),public.care_update_account_channels(uuid,boolean,boolean,boolean) to authenticated;
