-- Missing optional source metadata must not make an ordinary signal a speech one.
do $$
declare definition text; original text; old_clause text:=$old$is_speech_signal:=new.kind='signal' and (new.payload#>>'{record,source}' like 'local-whisper%' or new.payload#>'{record,transcription,ticketId}' is not null);$old$;
begin
 select pg_get_functiondef('private.care_speech_guard()'::regprocedure) into original;
 definition:=replace(original,old_clause,$new$is_speech_signal:=coalesce(new.kind='signal' and (new.payload#>>'{record,source}' like 'local-whisper%' or new.payload#>'{record,transcription,ticketId}' is not null),false);$new$);
 if definition=original then raise exception 'Expected speech predicate was not found; preserve the current function';end if;
 execute definition;
end $$;

-- Bind every clinical record to its authorized database row. Existing imports
-- may omit the duplicate seniorId; populate it rather than redirecting records.
create or replace function private.care_event_payload_keys() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(new.payload)='object' and new.payload ?| array['kind','owner','senior_id','created_at','sequence'] then
  raise invalid_parameter_value using message='Event payload cannot shadow its database envelope';
 end if;
 if new.kind='signal' then
  if jsonb_typeof(new.payload->'record') is distinct from 'object' then raise invalid_parameter_value using message='A signal needs a structured record';end if;
  if new.payload#>'{record,seniorId}' is not null and new.payload#>>'{record,seniorId}' is distinct from new.senior_id then raise invalid_parameter_value using message='Signal senior identity must match its authorized row';end if;
  new.payload:=jsonb_set(new.payload,'{record,seniorId}',to_jsonb(new.senior_id));
 end if;
 return new;
end $$;
