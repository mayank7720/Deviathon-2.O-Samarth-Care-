-- A changed contact must not silently change the recipient identity of a queued call.
create function private.care_sim_contact_identity_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare contact jsonb;
begin
 if new.kind<>'sim_call_job' or tg_op<>'UPDATE' then return new;end if;
 if old.payload->>'status'<>'queued' or new.payload->>'status'<>'claimed' then return new;end if;
 if auth.uid() is null or not private.care_has(new.senior_id,array['coordinator']) then raise insufficient_privilege;end if;
 select payload->'contact' into contact from public.care_events
  where owner=new.owner and kind='telephony_contact' and senior_id=new.senior_id and payload#>>'{contact,id}'=new.payload->>'contactId'
  order by sequence desc limit 1;
 if contact is null or contact->>'id' is distinct from new.payload->>'contactId'
  or contact->>'seniorId' is distinct from new.senior_id or contact->>'role' is distinct from new.payload->>'recipientRole'
  or contact->'verified' is distinct from 'true'::jsonb or contact->'callConsent' is distinct from 'true'::jsonb
  or (contact->>'role'='family' and not private.care_family_allowed(new.senior_id)) then
  raise insufficient_privilege using message='The queued SIM recipient identity or consent changed before claim';
 end if;
 return new;
end $$;
revoke all on function private.care_sim_contact_identity_guard() from public,anon,authenticated;
create trigger care_sim_contact_identity_guard before update on public.care_events for each row execute function private.care_sim_contact_identity_guard();
