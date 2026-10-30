-- Renew an expired SMS receipt lease without releasing a destination or
-- authorising a new send. Identity, scope, immutable content and state-step
-- guards above this branch remain in force. The signed relay GETs only an
-- existing gateway message ID, including when its contact was later edited.
do $receipt_guard$
declare source text; marker text; recovery text;
begin
 source:=pg_get_functiondef('private.care_android_job_guard()'::regprocedure);
 marker:='  claim:=next_status=''processing''';
 recovery:=$branch$
  if channel='sms' and previous_status=next_status and previous_status in ('processing','accepted','sent')
   and (previous->>'leaseExpiresAt')::timestamptz<=clock
   and p->'leaseHash' is distinct from previous->'leaseHash' then
   if (p-array['state','leaseHash','leaseExpiresAt','updatedAt']) is distinct from (previous-array['state','leaseHash','leaseExpiresAt','updatedAt'])
    or coalesce(p->>'leaseHash','') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p->'leaseExpiresAt') is distinct from 'string'
    or (p->>'leaseExpiresAt')::timestamptz<=clock or (p->>'leaseExpiresAt')::timestamptz>clock+interval '11 minutes'
    or (previous->>'createdAt')::timestamptz<clock-interval '24 hours'
    or (p->>'updatedAt')::timestamptz not between clock-interval '30 seconds' and clock+interval '30 seconds'
   then raise invalid_parameter_value using message='Receipt recovery cannot change or resend the saved SMS';end if;
   return new;
  end if;
$branch$;
 if strpos(source,marker)=0 then raise exception 'Unexpected Android lease guard';end if;
 execute replace(source,marker,recovery||marker);
end $receipt_guard$;

create or replace function private.care_account_job_recipient_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.care_service() or new.kind not in ('telephony_job','sim_call_job') or coalesce(new.payload->>'status','') not in ('queued','processing','submitting','dialing') then return new;end if;
 -- An inspect-only lease retains the original recipient. The Android evidence
 -- guard independently validates the state step, new lease and immutable job.
 if tg_op='UPDATE' and new.kind='telephony_job' and old.payload->>'channel'='sms'
  and old.payload->>'status'='processing' and new.payload->>'status'='processing'
  and (old.payload->>'leaseExpiresAt')::timestamptz<=clock_timestamp()
  and new.payload->'leaseHash' is distinct from old.payload->'leaseHash'
  and (new.payload-array['state','leaseHash','leaseExpiresAt','updatedAt'])=(old.payload-array['state','leaseHash','leaseExpiresAt','updatedAt'])
  and private.care_has(new.senior_id,array['coordinator','operations']) then return new;end if;
 if not exists(select 1 from jsonb_array_elements(public.care_account_phone_contacts()) c where c->>'id'=new.payload->>'contactId' and c->>'seniorId'=new.senior_id and c->>'role'=new.payload->>'recipientRole') then
  raise insufficient_privilege using message='Choose the current active account contact; old or unassigned numbers cannot be dispatched';
 end if;
 return new;
end $$;

-- Only notices linked to still-open phone support requests are eligible. A
-- retry for a non-queued job is always an inspect-only recovery.
do $receipt_queue$
declare source text; old_filter text; new_filter text;
begin
 source:=pg_get_functiondef('private.care_phone_support(text,jsonb)'::regprocedure);
 old_filter:='e.payload->>''channel''=''sms'' and (e.payload->>''status''=''queued'' or (e.payload->>''status''=''processing'' and (e.payload->>''leaseExpiresAt'')::timestamptz<=clock_timestamp())) and (e.payload->>''expiresAt'')::timestamptz>clock_timestamp()';
 new_filter:='e.payload->>''channel''=''sms'' and ((e.payload->>''status''=''queued'' and (e.payload->>''expiresAt'')::timestamptz>clock_timestamp()) or (e.payload->>''status'' in (''processing'',''accepted'',''sent'') and (e.payload->>''leaseExpiresAt'')::timestamptz<=clock_timestamp() and (e.payload->>''createdAt'')::timestamptz>clock_timestamp()-interval ''24 hours''))';
 if strpos(source,old_filter)=0 or strpos(source,'jsonb_build_object(''id'',e.id)')=0 then raise exception 'Unexpected phone-only receipt queue';end if;
 source:=replace(source,old_filter,new_filter);
 source:=replace(source,'jsonb_build_object(''id'',e.id)','jsonb_build_object(''id'',e.id,''receiptOnly'',e.payload->>''status''<>''queued'')');
 execute source;
end $receipt_queue$;
