-- Narrow the Cartesian account/profile candidate set before expensive permission
-- helpers. Retain both caller scope and recipient/consent checks unchanged.
create or replace function private.care_live_contacts(sid text default null)
returns jsonb language sql stable security definer set search_path='' as $$
 with candidates as materialized (
  select m.user_id,m.role,m.display_name,p.senior_id,
         c.phone,c.revision,c.recipient_confirmed,c.sms_consent,c.call_consent
  from public.care_memberships m
  join public.care_account_contacts c on c.user_id::text=m.user_id
  join public.care_profiles p on p.owner='workspace:primary'
    and (sid is null or p.senior_id=sid)
    and (m.senior_id=p.senior_id or m.scope_json::jsonb ? p.senior_id or m.scope_json::jsonb ? '*')
  where m.workspace_id='primary' and m.status='active'
    and c.phone is not null and c.recipient_confirmed
 )
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
  select distinct jsonb_build_object(
   'id','acct-'||c.user_id||'-'||left(c.role,1)||'-'||c.senior_id||'-'||c.revision,
   'seniorId',c.senior_id,'role',c.role,'userId',c.user_id,'name',c.display_name,
   'phone',c.phone,'revision',c.revision,'verified',c.recipient_confirmed,
   'smsConsent',c.sms_consent,'callConsent',c.call_consent) as x
  from candidates c
  where ((select private.care_service()) or private.care_has(c.senior_id,array['coordinator','operations']))
    and private.care_route_member(c.user_id,c.senior_id,c.role)
 ) q
$$;
-- CREATE OR REPLACE retains the existing private function's grants. No RLS or
-- public API capability changes are made here.
