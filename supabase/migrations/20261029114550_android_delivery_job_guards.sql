-- Normal coordinator JWTs may advance their scoped Android delivery jobs.
-- The separate application HMAC still authenticates the actual relay request.
-- This guard preserves fixed prompts, approved contacts and monotonic evidence
-- even for a direct Data API request; it does not assert carrier delivery itself.
create function private.care_android_job_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
 p jsonb:=new.payload; previous jsonb; c jsonb; expected_text text; channel text;
 clock timestamptz:=clock_timestamp(); previous_status text; next_status text;
 rank_before integer; rank_after integer; count_rows integer; claim boolean:=false; need_contact boolean:=false;
begin
 if new.kind<>'telephony_job' then return new;end if;
 channel:=case when tg_op='UPDATE' then old.payload->>'channel' else p->>'channel' end;
 -- Existing service-only voice callbacks retain their own guarded RPC path.
 if coalesce(channel,'') not in ('sms','android_dialer') then return new;end if;
 if auth.uid() is null or new.owner<>'workspace:primary' or not private.care_has(new.senior_id,array['coordinator']) then raise insufficient_privilege;end if;
 if jsonb_typeof(p) is distinct from 'object' or p->>'id' is distinct from new.id or p->>'seniorId' is distinct from new.senior_id
  or new.id !~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$' or new.senior_id !~ '^S[0-9]{3,6}$'
  or p->>'channel' is distinct from channel or p->'humanRead' is distinct from 'false'::jsonb then raise invalid_parameter_value;end if;
 expected_text:=case p->>'language'
  when 'en' then case p->>'template'
   when 'checkin' then 'Samarth Care: Please share a short wellbeing update with your care coordinator. This is not an emergency service.'
   when 'followup' then 'Samarth Care: Your care team would like to arrange a call. Please contact your coordinator when convenient.'
   when 'serious_alert' then 'Samarth Care: Please contact your care coordinator promptly for a check-in. For immediate distress, use your usual emergency support.'
   when 'weekly_summary' then 'Samarth Care: Your reviewed weekly update is ready in the protected care inbox. Contact your coordinator if you need a call.' end
  when 'hi' then case p->>'template'
   when 'checkin' then 'समर्थ केयर: कृपया अपनी देखभाल टीम को आज की कुशलता बताएँ।'
   when 'followup' then 'समर्थ केयर: कृपया कोऑर्डिनेटर से बात करने का समय तय करें।'
   when 'serious_alert' then 'समर्थ केयर: कृपया अपनी देखभाल टीम से जल्दी संपर्क करें।'
   when 'weekly_summary' then 'समर्थ केयर: आपकी साप्ताहिक जानकारी सुरक्षित इनबॉक्स में तैयार है।' end end;
 if expected_text is null or p->>'text' is distinct from expected_text then raise invalid_parameter_value using message='Only a fixed generic Android prompt may be queued';end if;
 if tg_op='INSERT' then
  if (p-array['id','seniorId','contactId','recipientRole','channel','template','language','text','status','requestHash','state','createdAt','expiresAt','asOfDate','requestedBy','externalDelivery','deliveredToHandset','humanRead'])<>'{}'::jsonb
   or p->>'status' is distinct from 'queued' or p->'state' is distinct from '{"step":0}'::jsonb
   or p->>'requestedBy' is distinct from auth.uid()::text or coalesce(p->>'requestHash','') !~ '^[a-f0-9]{64}$'
   or p->'externalDelivery' is distinct from 'false'::jsonb or p->'deliveredToHandset' is distinct from 'false'::jsonb
   or coalesce(p->>'recipientRole','') not in ('senior','family') or coalesce(p->>'contactId','') !~ '^[A-Za-z0-9_-]{1,64}$'
   or jsonb_typeof(p->'createdAt') is distinct from 'string' or jsonb_typeof(p->'expiresAt') is distinct from 'string'
   or (p->>'createdAt')::timestamptz<clock-interval '30 seconds' or (p->>'createdAt')::timestamptz>clock+interval '30 seconds'
   or (p->>'expiresAt')::timestamptz<=clock or (p->>'expiresAt')::timestamptz>clock+interval '31 minutes' then raise invalid_parameter_value using message='Android jobs start queued without delivery evidence';end if;
  if new.id is distinct from substr(p->>'requestHash',1,8)||'-'||substr(p->>'requestHash',9,4)||'-'||substr(p->>'requestHash',13,4)||'-'||substr(p->>'requestHash',17,4)||'-'||substr(p->>'requestHash',21,12) then raise invalid_parameter_value;end if;
  perform pg_advisory_xact_lock(hashtextextended('android-job-rate:'||(p->>'contactId'),0));
  select count(*) into count_rows from public.care_events e where e.owner=new.owner and e.kind='telephony_job' and e.senior_id=new.senior_id and e.payload->>'contactId'=p->>'contactId' and (e.payload->>'createdAt')::timestamptz>clock-interval '24 hours';
  if count_rows>=10 then raise check_violation using message='The approved contact reached its ten-request daily limit';end if;
  need_contact:=true;
 else
  previous:=old.payload;previous_status:=previous->>'status';next_status:=p->>'status';
  if new.id is distinct from old.id or new.owner is distinct from old.owner or new.kind is distinct from old.kind or new.senior_id is distinct from old.senior_id or new.created_at is distinct from old.created_at then raise insufficient_privilege;end if;
  if (p-array['status','state','leaseHash','leaseExpiresAt','updatedAt','provider','providerId','externalDelivery','deliveredToHandset','humanRead','lastError']) is distinct from (previous-array['status','state','leaseHash','leaseExpiresAt','updatedAt','provider','providerId','externalDelivery','deliveredToHandset','humanRead','lastError']) then raise insufficient_privilege using message='Android request identity is immutable';end if;
  if jsonb_typeof(previous#>'{state,step}') is distinct from 'number' or coalesce(previous#>>'{state,step}','') !~ '^[0-9]+$'
   or p->'state' is distinct from jsonb_build_object('step',(previous#>>'{state,step}')::integer+1)
   or jsonb_typeof(p->'updatedAt') is distinct from 'string' then raise invalid_parameter_value using message='Android evidence must advance once';end if;
  if previous_status in ('delivered','failed','cancelled','expired','completed','awaiting_device_action') then raise insufficient_privilege using message='Terminal Android evidence is retained';end if;
  claim:=next_status='processing' and (previous_status='queued' or (previous_status='processing' and (previous->>'leaseExpiresAt')::timestamptz<=clock));
  if claim then
   if (p-array['status','state','leaseHash','leaseExpiresAt','updatedAt']) is distinct from (previous-array['status','state','leaseHash','leaseExpiresAt','updatedAt'])
    or coalesce(p->>'leaseHash','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p->'leaseExpiresAt') is distinct from 'string'
    or (p->>'leaseExpiresAt')::timestamptz<=clock or (p->>'leaseExpiresAt')::timestamptz>clock+interval '11 minutes'
    or p->'externalDelivery' is distinct from 'false'::jsonb or p->'deliveredToHandset' is distinct from 'false'::jsonb
    or jsonb_typeof(previous->'expiresAt') is distinct from 'string' or (previous->>'expiresAt')::timestamptz<=clock then raise invalid_parameter_value using message='Android claim needs a fresh bounded lease';end if;
   need_contact:=true;
  elsif previous_status='queued' and next_status in ('cancelled','awaiting_device_action') then
   if next_status='awaiting_device_action' and channel<>'android_dialer' then raise invalid_parameter_value;end if;
   if (p-array['status','state','updatedAt']) is distinct from (previous-array['status','state','updatedAt']) then raise invalid_parameter_value using message='Queue changes cannot fabricate device evidence';end if;
   need_contact:=next_status='awaiting_device_action';
  else
   if coalesce(previous_status,'') not in ('processing','accepted','sent') or coalesce(previous->>'leaseHash','') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(previous->'leaseExpiresAt') is distinct from 'string'
    or (previous->>'leaseExpiresAt')::timestamptz<=clock or p->'leaseHash' is distinct from previous->'leaseHash'
    or p->'leaseExpiresAt' is distinct from previous->'leaseExpiresAt' then raise insufficient_privilege using message='Android receipt requires the unchanged active lease';end if;
   if (p-array['status','state','updatedAt','provider','providerId','externalDelivery','deliveredToHandset','humanRead','lastError']) is distinct from (previous-array['status','state','updatedAt','provider','providerId','externalDelivery','deliveredToHandset','humanRead','lastError']) then raise insufficient_privilege;end if;
   if channel='sms' then
    if coalesce(next_status,'') not in ('accepted','sent','delivered','failed','cancelled') or p->>'provider' is distinct from 'android_sms_gate' or p->>'providerId' is distinct from new.id
     or p->'externalDelivery' is distinct from to_jsonb(next_status in ('sent','delivered')) or p->'deliveredToHandset' is distinct from to_jsonb(next_status='delivered') then raise invalid_parameter_value using message='SMS receipt must state its factual gateway result';end if;
    rank_before:=case previous_status when 'processing' then 0 when 'accepted' then 1 when 'sent' then 2 end;
    rank_after:=case next_status when 'accepted' then 1 when 'sent' then 2 when 'delivered' then 3 end;
    if rank_after is not null and rank_after<rank_before then raise invalid_parameter_value using message='SMS delivery cannot move backwards';end if;
   else
    if previous_status<>'processing' or coalesce(next_status,'') not in ('awaiting_device_action','failed') or p->>'provider' is distinct from 'android_dialer'
     or p->'externalDelivery' is distinct from 'false'::jsonb or p->'deliveredToHandset' is distinct from 'false'::jsonb then raise invalid_parameter_value using message='A dialer opening is not an answered call';end if;
   end if;
   if (next_status='failed' and p->>'lastError' is distinct from 'The paired device reported a sending failure.') or (next_status<>'failed' and p->'lastError' is distinct from 'null'::jsonb) then raise invalid_parameter_value;end if;
  end if;
 end if;
 if need_contact then
  select e.payload->'contact' into c from public.care_events e where e.owner=new.owner and e.kind='telephony_contact' and e.senior_id=new.senior_id and e.payload#>>'{contact,id}'=p->>'contactId' order by e.sequence desc limit 1;
  if c is null or c->>'id' is distinct from p->>'contactId' or c->>'seniorId' is distinct from new.senior_id or c->>'role' is distinct from p->>'recipientRole'
   or c->'verified' is distinct from 'true'::jsonb or c->(case when channel='sms' then 'smsConsent' else 'callConsent' end) is distinct from 'true'::jsonb
   or coalesce(c->>'phone','') !~ '^\+[1-9][0-9]{7,14}$' or (p->>'recipientRole'='family' and not private.care_family_allowed(new.senior_id)) then raise insufficient_privilege using message='Android delivery requires its current approved contact and consent';end if;
 end if;
 return new;
end $$;
revoke all on function private.care_android_job_guard() from public,anon,authenticated;
create trigger care_android_job_guard before insert or update on public.care_events for each row execute function private.care_android_job_guard();
create policy android_job_updates on public.care_events for update to authenticated
 using(owner='workspace:primary' and kind='telephony_job' and payload->>'channel' in ('sms','android_dialer') and private.care_has(senior_id,array['coordinator']))
 with check(owner='workspace:primary' and kind='telephony_job' and payload->>'channel' in ('sms','android_dialer') and private.care_has(senior_id,array['coordinator']));
