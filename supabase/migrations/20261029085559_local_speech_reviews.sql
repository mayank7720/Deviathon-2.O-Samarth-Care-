-- Verify local inference provenance at the database boundary, including direct
-- Data API writes. Audio never enters Postgres; only signed transcript drafts do.
create function private.care_speech_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 p jsonb; t jsonb; d public.care_events%rowtype; r public.care_events%rowtype;
 secret text; expected text; ticket text; stamp text;
 clock_ms numeric:=extract(epoch from clock_timestamp())*1000;
 is_speech_signal boolean;
begin
 if tg_op='DELETE' then
  if old.kind in ('speech_draft','speech_review') or (old.kind='signal' and old.payload#>>'{record,source}'='local-whisper-reviewed') then
   raise insufficient_privilege using message='Speech history is append only';
  end if;
  return old;
 end if;
 is_speech_signal:=new.kind='signal' and (new.payload#>>'{record,source}' like 'local-whisper%' or new.payload#>'{record,transcription,ticketId}' is not null);
 if tg_op='UPDATE' then
  if old.kind in ('speech_draft','speech_review') or is_speech_signal or (old.kind='signal' and old.payload#>>'{record,source}'='local-whisper-reviewed') then
   raise insufficient_privilege using message='Speech history is append only';
  end if;
  return new;
 end if;
 if new.kind not in ('speech_draft','speech_review') and not is_speech_signal then return new;end if;
 if auth.uid() is null or not private.care_has(new.senior_id,array['coordinator']) or new.owner<>'workspace:primary' or new.senior_id='' then
  raise insufficient_privilege using message='A scoped coordinator must record speech history';
 end if;
 p:=new.payload;
 if jsonb_typeof(p) is distinct from 'object' then raise invalid_parameter_value;end if;
 stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 if new.kind='speech_draft' then
  if (p-array['transcription','receipt','consentConfirmed','actorId','status'])<>'{}'::jsonb
   or p->'consentConfirmed' is distinct from 'true'::jsonb or p->>'status' is distinct from 'awaiting_review'
   or p->>'actorId' is distinct from auth.uid()::text
   or jsonb_typeof(p->'receipt') is distinct from 'object'
   or jsonb_typeof(p#>'{receipt,payload}') is distinct from 'string'
   or length(p#>>'{receipt,payload}')>96000
   or coalesce(p#>>'{receipt,signature}','') !~ '^[a-f0-9]{64}$' then raise invalid_parameter_value;end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name='samarth_speech_secret';
  if secret is null or length(secret)<32 then raise insufficient_privilege using message='Speech pairing is unavailable';end if;
  expected:=encode(extensions.hmac(convert_to(E'speech-receipt\n'||(p#>>'{receipt,payload}'),'UTF8'),convert_to(secret,'UTF8'),'sha256'),'hex');
  if expected is distinct from p#>>'{receipt,signature}' then raise insufficient_privilege using message='Invalid local speech provenance';end if;
  t:=(p#>>'{receipt,payload}')::jsonb;
  if t is distinct from p->'transcription' or jsonb_typeof(t) is distinct from 'object'
   or (t-array['version','ticketId','seniorId','actorId','origin','model','language','languageProbability','durationSeconds','audioSha256','text','segments','createdAt','expiresAt','externalServiceUsed'])<>'{}'::jsonb
   or t->'version' is distinct from '1'::jsonb or t->>'seniorId' is distinct from new.senior_id
   or t->>'actorId' is distinct from auth.uid()::text
   or coalesce(t->>'ticketId','') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or new.id is distinct from 'speech-draft:'||(t->>'ticketId')
   or t->'externalServiceUsed' is distinct from 'false'::jsonb
   or coalesce(t->>'model','') !~ '^faster-whisper:(base|small)$'
   or jsonb_typeof(t->'text') is distinct from 'string' or length(btrim(t->>'text')) not between 1 and 6000
   or coalesce(t->>'audioSha256','') !~ '^[a-f0-9]{64}$'
   or coalesce(t->>'language','') !~ '^[a-z]{2,3}$'
   or coalesce(t->>'origin','') !~ '^(https://[a-zA-Z0-9.-]+(:[0-9]+)?|http://(localhost|127[.]0[.]0[.]1)(:[0-9]+)?)$'
   or jsonb_typeof(t->'createdAt') is distinct from 'number'
   or jsonb_typeof(t->'expiresAt') is distinct from 'number'
   or jsonb_typeof(t->'durationSeconds') is distinct from 'number'
   or jsonb_typeof(t->'segments') is distinct from 'array' then raise invalid_parameter_value;end if;
  if (t->>'createdAt')::numeric>clock_ms+30000 or (t->>'createdAt')::numeric<clock_ms-86400000
   or (t->>'expiresAt')::numeric<=clock_ms or (t->>'expiresAt')::numeric>(t->>'createdAt')::numeric+86400000
   or (t->>'durationSeconds')::numeric<=0 or (t->>'durationSeconds')::numeric>180
   or jsonb_array_length(t->'segments')>120 then raise invalid_parameter_value;end if;
  if t ? 'languageProbability' and (jsonb_typeof(t->'languageProbability') is distinct from 'number'
   or (t->>'languageProbability')::numeric not between 0 and 1) then raise invalid_parameter_value;end if;
  if exists(select 1 from jsonb_array_elements(t->'segments') s where jsonb_typeof(s) is distinct from 'object'
   or jsonb_typeof(s->'text') is distinct from 'string' or length(s->>'text')>6000
   or jsonb_typeof(s->'start') is distinct from 'number' or jsonb_typeof(s->'end') is distinct from 'number') then raise invalid_parameter_value;end if;
  if exists(select 1 from jsonb_array_elements(t->'segments') s where (s->>'start')::numeric<0
   or (s->>'end')::numeric<(s->>'start')::numeric or (s->>'end')::numeric>(t->>'durationSeconds')::numeric+1) then raise invalid_parameter_value;end if;
 elsif new.kind='speech_review' then
  ticket:=p->>'ticketId';
  if (p-array['ticketId','action','editedText','note','actorId','originalAudioSha256','createdAt'])<>'{}'::jsonb
   or coalesce(ticket,'') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or new.id is distinct from 'speech-review:'||ticket or p->>'actorId' is distinct from auth.uid()::text
   or coalesce(p->>'action','') not in ('approve','reject')
   or jsonb_typeof(p->'editedText') is distinct from 'string' or jsonb_typeof(p->'note') is distinct from 'string'
   or length(p->>'note')>1600 or (p->>'action'='approve' and length(btrim(p->>'editedText')) not between 1 and 6000)
   or (p->>'action'='reject' and p->>'editedText'<>'') then raise invalid_parameter_value;end if;
  select * into d from public.care_events where owner=new.owner and senior_id=new.senior_id and kind='speech_draft' and id='speech-draft:'||ticket;
  if d.id is null or p->>'originalAudioSha256' is distinct from d.payload#>>'{transcription,audioSha256}' then raise invalid_parameter_value using message='A review must refer to its signed draft';end if;
  new.payload:=jsonb_set(p,'{createdAt}',to_jsonb(stamp));
 else
  t:=p#>'{record,transcription}'; ticket:=t->>'ticketId';
  select * into d from public.care_events where owner=new.owner and senior_id=new.senior_id and kind='speech_draft' and id='speech-draft:'||ticket;
  select * into r from public.care_events where owner=new.owner and senior_id=new.senior_id and kind='speech_review' and id='speech-review:'||ticket;
  if d.id is null or r.id is null or r.payload->>'action' is distinct from 'approve'
   or r.payload->>'actorId' is distinct from auth.uid()::text
   or p->>'type' is distinct from 'note' or p#>>'{record,source}' is distinct from 'local-whisper-reviewed'
   or p#>>'{record,seniorId}' is distinct from new.senior_id
   or p#>>'{record,note}' is distinct from r.payload->>'editedText'
   or coalesce(p#>>'{record,date}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or new.id is distinct from 'speech-signal:'||ticket
   or t is distinct from jsonb_build_object('ticketId',ticket,'model',d.payload#>>'{transcription,model}','audioSha256',d.payload#>>'{transcription,audioSha256}','reviewedBy',auth.uid()::text)
   then raise invalid_parameter_value using message='Only the approved words may become a speech signal';end if;
 end if;
 new.created_at:=stamp;
 return new;
end $$;
revoke all on function private.care_speech_guard() from public,anon,authenticated;
create trigger care_speech_guard before insert or update or delete on public.care_events for each row execute function private.care_speech_guard();
