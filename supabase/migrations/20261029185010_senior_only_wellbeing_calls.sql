-- A four-question wellbeing bot is always addressed to the senior, never their relatives or care staff.
create function private.care_senior_bot_recipient_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.kind='sim_call_job' and (tg_op='INSERT' or new.payload->>'status' in ('queued','claimed'))) or (new.kind='telephony_job' and new.payload->>'channel'='voice_bot' and (tg_op='INSERT' or new.payload->>'status' in ('queued','submitting'))) then
  if new.payload->>'recipientRole' is distinct from 'senior' then raise invalid_parameter_value using message='A wellbeing bot must be addressed to the senior account';end if;
 end if;return new;
end $$;
revoke all on function private.care_senior_bot_recipient_guard() from public,anon,authenticated;
create trigger care_senior_bot_recipient_guard before insert or update on public.care_events for each row execute function private.care_senior_bot_recipient_guard();
