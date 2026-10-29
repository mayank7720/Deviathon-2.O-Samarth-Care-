-- Prepared hardware path: this migration does not enable a bridge or dial a phone.
-- The application additionally requires its private SIM HMAC and explicit enable flag.
create function private.care_sim_call_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
 p jsonb; before_payload jsonb; item public.care_events%rowtype; contact jsonb;
 stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 current_clock timestamptz:=clock_timestamp(); field text; ident text;
 terminal_state boolean; draft text; count_rows integer;
begin
 if tg_op='DELETE' then
  if old.kind in ('sim_call_job','sim_call_bridge','sim_call_nonce') then raise insufficient_privilege using message='SIM call history is retained for inspection';end if;
  return old;
 end if;
 if new.kind not in ('sim_call_job','sim_call_bridge','sim_call_nonce') then return new;end if;
 if auth.uid() is null or new.owner<>'workspace:primary' or not private.care_has(new.senior_id,array['coordinator']) then
  raise insufficient_privilege using message='A scoped coordinator must operate the SIM call bridge';
 end if;
 p:=new.payload;
 if jsonb_typeof(p) is distinct from 'object' then raise invalid_parameter_value;end if;
 if tg_op='UPDATE' then
  if new.id is distinct from old.id or new.owner is distinct from old.owner or new.kind is distinct from old.kind or new.senior_id is distinct from old.senior_id or new.created_at is distinct from old.created_at then raise insufficient_privilege using message='SIM call envelope is immutable';end if;
  if new.kind='sim_call_nonce' then raise insufficient_privilege using message='SIM bridge nonce history is append only';end if;
  before_payload:=old.payload;
  if p->'state' is distinct from jsonb_build_object('step',(before_payload#>>'{state,step}')::integer+1) then raise invalid_parameter_value using message='SIM state must advance exactly once';end if;
 end if;
 if new.kind='sim_call_nonce' then
  if new.id ~ '^sim-call-nonce:[a-f0-9]{64}$' then
   if new.senior_id<>'' or p->>'action' is distinct from 'bridge_request' or (p-array['action','createdAt'])<>'{}'::jsonb then raise invalid_parameter_value;end if;
   p:=jsonb_set(p,'{createdAt}',to_jsonb(stamp));
  elsif new.id ~ '^sim-call-rate:[a-f0-9]{64}:[0-9]{4}-[0-9]{2}-[0-9]{2}:([1-9]|10)$' then
   if p->>'action' is distinct from 'request_rate_slot' or (p-array['action','jobId'])<>'{}'::jsonb then raise invalid_parameter_value;end if;
   select * into item from public.care_events where id=p->>'jobId' and kind='sim_call_job' and owner=new.owner and senior_id=new.senior_id;
   if not found then raise invalid_parameter_value using message='SIM rate receipt requires its queued call';end if;
  else raise invalid_parameter_value using message='Invalid SIM nonce identity';end if;
  new.payload:=p;new.created_at:=stamp;return new;
 end if;
 if new.kind='sim_call_bridge' then
  if new.senior_id<>'' then raise invalid_parameter_value;end if;
  if new.id<>'sim-call-caller-lock' then
   if tg_op<>'INSERT' or new.id !~ '^sim-call-heartbeat:[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$' or p->'deviceReady' is distinct from 'true'::jsonb or (p-array['deviceReady','createdAt'])<>'{}'::jsonb then raise invalid_parameter_value using message='SIM heartbeats are append only';end if;
   new.payload:=jsonb_set(p,'{createdAt}',to_jsonb(stamp));new.created_at:=stamp;return new;
  end if;
  if tg_op='INSERT' then
   if p is distinct from '{"state":{"step":0},"activeJobId":null,"lockedUntil":null}'::jsonb then raise invalid_parameter_value using message='The single SIM caller starts idle';end if;
   new.created_at:=stamp;return new;
  end if;
  -- The adapter's loaded row adds its envelope fields while updating; bind them to the row.
  if (p-array['state','activeJobId','lockedUntil','id','seniorId'])<>'{}'::jsonb or p->>'id' is distinct from new.id or p->>'seniorId' is distinct from '' then raise invalid_parameter_value;end if;
  if before_payload->>'activeJobId' is null then
   select * into item from public.care_events where id=p->>'activeJobId' and kind='sim_call_job' and owner=new.owner;
   if not found or item.payload->>'status' is distinct from 'queued' or not private.care_has(item.senior_id,array['coordinator']) or (item.payload->>'expiresAt')::timestamptz<=current_clock or jsonb_typeof(p->'lockedUntil') is distinct from 'string' or (p->>'lockedUntil')::timestamptz<=current_clock or (p->>'lockedUntil')::timestamptz>current_clock+interval '11 minutes' then raise invalid_parameter_value using message='SIM lock requires a fresh scoped queued call';end if;
  else
   select * into item from public.care_events where id=before_payload->>'activeJobId' and kind='sim_call_job' and owner=new.owner;
   if not found or not private.care_has(item.senior_id,array['coordinator']) then raise insufficient_privilege;end if;
   if item.payload->>'status'='submission_unknown' then
    if p->>'activeJobId' is distinct from item.id or p->>'lockedUntil' is distinct from '9999-12-31T00:00:00.000Z' then raise insufficient_privilege using message='Unknown SIM submission stays locked for human inspection';end if;
   elsif item.payload->>'status' in ('declined','answers_recorded','disconnected','failed') then
    if p->'activeJobId' is distinct from 'null'::jsonb or p->'lockedUntil' is distinct from 'null'::jsonb then raise invalid_parameter_value;end if;
   else raise insufficient_privilege using message='A caller lock cannot expire or be replaced without terminal evidence';end if;
  end if;
  return new;
 end if;
 -- sim_call_job
 if new.senior_id !~ '^S[0-9]{3,6}$' or new.id !~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$' or p->>'id' is distinct from new.id or p->>'seniorId' is distinct from new.senior_id then raise invalid_parameter_value using message='SIM job identity is invalid';end if;
 if tg_op='INSERT' then
  if (p-array['id','seniorId','contactId','recipientRole','language','requestedBy','requestHash','status','state','createdAt','expiresAt','externalDelivery','callAnswered','consentGranted','audioCount','transcriptStatus','humanRead'])<>'{}'::jsonb
   or p->>'requestedBy' is distinct from auth.uid()::text or p->>'status' is distinct from 'queued' or p->'state' is distinct from '{"step":0}'::jsonb
   or p->'externalDelivery' is distinct from 'false'::jsonb or p->'callAnswered' is distinct from 'false'::jsonb or p->'consentGranted' is distinct from 'false'::jsonb or p->'audioCount' is distinct from '0'::jsonb or p->'humanRead' is distinct from 'false'::jsonb or p->>'transcriptStatus' is distinct from 'not_started'
   or not coalesce(p->>'language' in ('hi','en'),false) or not coalesce(p->>'recipientRole' in ('senior','family'),false) or not coalesce(p->>'requestHash' ~ '^[a-f0-9]{64}$',false)
   or not coalesce(p->>'contactId' ~ '^[A-Za-z0-9_-]{1,64}$',false) or jsonb_typeof(p->'expiresAt') is distinct from 'string' or (p->>'expiresAt')::timestamptz<=current_clock or (p->>'expiresAt')::timestamptz>current_clock+interval '31 minutes' then raise invalid_parameter_value using message='A SIM job starts queued without fabricated evidence';end if;
  ident:=p->>'requestHash';
  if new.id is distinct from substr(ident,1,8)||'-'||substr(ident,9,4)||'-'||substr(ident,13,4)||'-'||substr(ident,17,4)||'-'||substr(ident,21,12) then raise invalid_parameter_value;end if;
  perform pg_advisory_xact_lock(hashtextextended('sim-call-rate:'||(p->>'contactId'),0));
  select count(*) into count_rows from public.care_events where owner=new.owner and kind='sim_call_job' and senior_id=new.senior_id and payload->>'contactId'=p->>'contactId' and (payload->>'createdAt')::timestamptz>current_clock-interval '24 hours';
  if count_rows>=10 then raise check_violation using message='The approved contact reached its ten-request daily limit';end if;
  select payload->'contact' into contact from public.care_events where owner=new.owner and kind='telephony_contact' and senior_id=new.senior_id and payload#>>'{contact,id}'=p->>'contactId' order by sequence desc limit 1;
  if contact is null or contact->>'seniorId' is distinct from new.senior_id or contact->>'role' is distinct from p->>'recipientRole' or contact->'verified' is distinct from 'true'::jsonb or contact->'callConsent' is distinct from 'true'::jsonb or (p->>'recipientRole'='family' and not private.care_family_allowed(new.senior_id)) then raise insufficient_privilege using message='SIM calls require a saved verified contact with current consent';end if;
  new.payload:=jsonb_set(p,'{createdAt}',to_jsonb(stamp));new.created_at:=stamp;return new;
 end if;
 if (p-array['state','status','leaseHash','leaseExpiresAt','updatedAt','externalDelivery','callAnswered','consentGranted','audioCount','transcriptStatus','humanRead','draftIds']) is distinct from (before_payload-array['state','status','leaseHash','leaseExpiresAt','updatedAt','externalDelivery','callAnswered','consentGranted','audioCount','transcriptStatus','humanRead','draftIds']) then raise insufficient_privilege using message='SIM request identity is immutable';end if;
 if before_payload->>'status'='queued' then
  if p->>'status' is distinct from 'claimed' or not coalesce(p->>'leaseHash' ~ '^[a-f0-9]{64}$',false) or jsonb_typeof(p->'leaseExpiresAt') is distinct from 'string' or (p->>'leaseExpiresAt')::timestamptz<=current_clock or (p->>'leaseExpiresAt')::timestamptz>current_clock+interval '11 minutes' or (before_payload->>'expiresAt')::timestamptz<=current_clock then raise invalid_parameter_value using message='A SIM call can be claimed once while fresh';end if;
  select * into item from public.care_events where id='sim-call-caller-lock' and kind='sim_call_bridge' and owner=new.owner;
  if not found or item.payload->>'activeJobId' is distinct from new.id then raise insufficient_privilege using message='The single caller must be reserved before claiming';end if;
  select payload->'contact' into contact from public.care_events where owner=new.owner and kind='telephony_contact' and senior_id=new.senior_id and payload#>>'{contact,id}'=p->>'contactId' order by sequence desc limit 1;
  if contact->'verified' is distinct from 'true'::jsonb or contact->'callConsent' is distinct from 'true'::jsonb or (p->>'recipientRole'='family' and not private.care_family_allowed(new.senior_id)) then raise insufficient_privilege using message='Contact consent was withdrawn before claim';end if;
  if (p-array['state','status','leaseHash','leaseExpiresAt','updatedAt']) is distinct from (before_payload-array['state','status','leaseHash','leaseExpiresAt','updatedAt']) then raise invalid_parameter_value using message='A claim cannot fabricate call evidence';end if;
 elsif before_payload->>'status' in ('claimed','originated') then
  if not coalesce(p->>'status' in ('originated','declined','answers_recorded','disconnected','failed','submission_unknown'),false) or (before_payload->>'status'='originated' and p->>'status'='originated') or (before_payload->>'leaseExpiresAt')::timestamptz<=current_clock then raise invalid_parameter_value using message='Invalid SIM evidence transition';end if;
  if p->'leaseHash' is distinct from before_payload->'leaseHash' or p->'leaseExpiresAt' is distinct from before_payload->'leaseExpiresAt' or p->>'transcriptStatus' is distinct from 'not_started' or p ? 'draftIds' then raise invalid_parameter_value;end if;
  foreach field in array array['callAnswered','consentGranted','externalDelivery','humanRead'] loop if jsonb_typeof(p->field) is distinct from 'boolean' then raise invalid_parameter_value;end if;end loop;
  if p->'externalDelivery' is distinct from p->'callAnswered' or p->'humanRead' is distinct from 'false'::jsonb or jsonb_typeof(p->'audioCount') is distinct from 'number' or not coalesce(p->>'audioCount' ~ '^[0-4]$',false) or (p->'consentGranted'='true'::jsonb and p->'callAnswered'<>'true'::jsonb) or ((p->>'audioCount')::integer>0 and p->'consentGranted'<>'true'::jsonb) then raise invalid_parameter_value using message='SIM audio requires answered-channel and recording-consent evidence';end if;
  if p->>'status' in ('originated','submission_unknown') and (p->'callAnswered'<>'false'::jsonb or p->'consentGranted'<>'false'::jsonb or p->'audioCount'<>'0'::jsonb) then raise invalid_parameter_value;end if;
  if p->>'status'='declined' and (p->'consentGranted'<>'false'::jsonb or p->'audioCount'<>'0'::jsonb) then raise invalid_parameter_value;end if;
  if p->>'status'='answers_recorded' and (p->'callAnswered'<>'true'::jsonb or p->'consentGranted'<>'true'::jsonb or p->'audioCount'<>'4'::jsonb) then raise invalid_parameter_value;end if;
 elsif before_payload->>'status' in ('declined','answers_recorded','disconnected','failed','submission_unknown') then
  if p->>'status' is distinct from before_payload->>'status' or before_payload->>'transcriptStatus' is distinct from 'not_started' or p->>'transcriptStatus' is distinct from 'drafts_saved' or before_payload->'consentGranted' is distinct from 'true'::jsonb or (before_payload->>'audioCount')::integer<1 or (before_payload->>'leaseExpiresAt')::timestamptz<=current_clock then raise insufficient_privilege using message='Terminal calls cannot be requeued or redialled';end if;
  if (p-array['state','transcriptStatus','draftIds','updatedAt']) is distinct from (before_payload-array['state','transcriptStatus','draftIds','updatedAt']) or jsonb_typeof(p->'draftIds') is distinct from 'array' or jsonb_array_length(p->'draftIds')<>(p->>'audioCount')::integer then raise invalid_parameter_value;end if;
  if (select count(distinct value) from jsonb_array_elements_text(p->'draftIds'))<>jsonb_array_length(p->'draftIds') then raise invalid_parameter_value;end if;
  for draft in select value from jsonb_array_elements_text(p->'draftIds') loop
   select * into item from public.care_events where id='speech-draft:'||draft and kind='speech_draft' and owner=new.owner and senior_id=new.senior_id;
   if not found or item.payload#>>'{transcription,ticketId}' is distinct from draft or item.payload#>>'{transcription,actorId}' is distinct from auth.uid()::text or item.payload#>'{transcription,externalServiceUsed}' is distinct from 'false'::jsonb then raise insufficient_privilege using message='Call transcript metadata must reference signed same-senior drafts';end if;
  end loop;
 else raise insufficient_privilege using message='Invalid saved SIM call state';end if;
 new.payload:=jsonb_set(p,'{updatedAt}',to_jsonb(stamp));return new;
end $$;
revoke all on function private.care_sim_call_guard() from public,anon,authenticated;
create trigger care_sim_call_guard before insert or update or delete on public.care_events for each row execute function private.care_sim_call_guard();
create policy sim_call_updates on public.care_events for update to authenticated
 using(owner='workspace:primary' and (kind='sim_call_job' or (kind='sim_call_bridge' and id='sim-call-caller-lock')) and private.care_has(senior_id,array['coordinator']))
 with check(owner='workspace:primary' and (kind='sim_call_job' or (kind='sim_call_bridge' and id='sim-call-caller-lock')) and private.care_has(senior_id,array['coordinator']));
