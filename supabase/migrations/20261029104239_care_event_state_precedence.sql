-- Parenthesize JSON extraction before subtracting allowed state fields.
-- Otherwise operator resolution can try to cast literal 'state' to JSON.
create or replace function private.care_event_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.id<>old.id or new.owner<>old.owner or new.kind<>old.kind or new.senior_id<>old.senior_id or new.created_at<>old.created_at then raise insufficient_privilege using message='Event envelope is immutable';end if;
 if old.kind='voice_room' then
  if (new.payload-array['peerId','peerRole','status','endedAt'])<>(old.payload-array['peerId','peerRole','status','endedAt']) then raise insufficient_privilege using message='Voice room identity is immutable';end if;
  if old.payload->>'status'='ended' then raise insufficient_privilege using message='Voice room ended';end if;
  if new.payload->>'status'<>'ended' and ((new.payload->>'peerId') is distinct from auth.uid()::text or not private.care_has(old.senior_id,array[new.payload->>'peerRole']) or (old.payload->>'peerId' is not null and old.payload->>'peerId'<>auth.uid()::text)) then raise insufficient_privilege using message='Invalid voice room participant';end if;
 end if;
 if old.kind='ivr_session' then
  if ((new.payload->'state')-array['step','answers','complete','mood','note','helpRequested','callRequested','requiresHumanReview'])<>((old.payload->'state')-array['step','answers','complete','mood','note','helpRequested','callRequested','requiresHumanReview']) then raise insufficient_privilege using message='Check-in identity is immutable';end if;
 end if;
 return new;
end $$;
