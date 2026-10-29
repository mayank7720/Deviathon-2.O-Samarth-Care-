-- Event types and ownership come from columns, never user-supplied JSON keys.
-- Logical payload IDs remain supported; readers keep the actual row ID last.
create function private.care_event_payload_keys() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(new.payload)='object' and new.payload ?| array['kind','owner','senior_id','created_at','sequence','payload'] then
  raise invalid_parameter_value using message='Event payload cannot shadow its database envelope';
 end if;
 return new;
end $$;
revoke all on function private.care_event_payload_keys() from public,anon,authenticated;
create trigger care_event_payload_keys before insert or update on public.care_events for each row execute function private.care_event_payload_keys();
