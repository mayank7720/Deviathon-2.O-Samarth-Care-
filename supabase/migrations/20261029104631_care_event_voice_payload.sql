-- WebRTC signaling legitimately stores SDP/ICE under a nested payload key.
-- Only actual reserved envelope keys are prohibited in authored event JSON.
create or replace function private.care_event_payload_keys() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(new.payload)='object' and new.payload ?| array['kind','owner','senior_id','created_at','sequence'] then
  raise invalid_parameter_value using message='Event payload cannot shadow its database envelope';
 end if;
 return new;
end $$;
