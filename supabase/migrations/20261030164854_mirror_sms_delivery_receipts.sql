-- Keep notification/intake displays aligned with the guarded job receipt.
-- No sending is performed by this projection and no client UPDATE is granted.
create function private.care_mirror_sms_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.owner<>'workspace:primary' or new.kind<>'telephony_job' or new.payload->>'channel'<>'sms'
  or new.payload->>'status' not in ('accepted','sent','delivered','failed','cancelled')
  or not (private.care_service() or private.care_has(new.senior_id,array['coordinator','operations'])) then return new;end if;
 update public.care_notification_routes n
 set status=new.payload->>'status',last_error=case when new.payload->>'status'='failed' then 'The paired device reported a sending failure.' else null end
 where n.job_id=new.id and n.senior_id=new.senior_id and n.status is distinct from new.payload->>'status';
 return new;
end $$;
revoke all on function private.care_mirror_sms_receipt() from public,anon,authenticated,service_role;
create trigger care_mirror_sms_receipt after update of payload on public.care_events
for each row when (new.kind='telephony_job' and old.payload->>'status' is distinct from new.payload->>'status')
execute function private.care_mirror_sms_receipt();

-- Repair only the cached projection, using existing authoritative job evidence.
update public.care_notification_routes n
set status=e.payload->>'status',last_error=case when e.payload->>'status'='failed' then 'The paired device reported a sending failure.' else null end
from public.care_events e
where e.owner='workspace:primary' and e.kind='telephony_job' and e.payload->>'channel'='sms'
 and n.job_id=e.id and n.senior_id=e.senior_id
 and e.payload->>'status' in ('accepted','sent','delivered','failed','cancelled')
 and n.status is distinct from e.payload->>'status';
