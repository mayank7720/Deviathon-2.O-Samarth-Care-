-- Shared care actions are distinct from confidential coordinator case notes.
-- All recipients and actors are resolved from active database memberships.
create function private.care_shared_access(sid text) returns boolean language sql stable security definer set search_path='' as $$
 select sid<>'' and (private.care_has(sid,array['coordinator','operations','senior']) or (private.care_has(sid,array['family']) and private.care_family_allowed(sid)))
$$;
create function private.care_conversation_directory(sid text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when private.care_shared_access(sid) then coalesce((select jsonb_agg(to_jsonb(t) order by t.role,t.name) from (
  select distinct m.user_id as "userId",m.display_name as name,m.role,(m.is_admin=1) as "isAdmin"
  from public.care_memberships m left join public.care_account_settings a on a.user_id::text=m.user_id
  where m.workspace_id='primary' and m.status='active' and coalesce(a.enabled,true) and m.user_id<>auth.uid()::text
   and (m.senior_id=sid or m.scope_json::jsonb ? sid or m.scope_json::jsonb ? '*')
   and (m.role<>'operations' or m.is_admin=1) and (m.role<>'family' or private.care_family_allowed(sid))
   and (private.care_has(sid,array['coordinator','operations']) or m.role in ('coordinator','operations') or (m.role='senior' and private.care_has(sid,array['family'])) or (m.role='family' and private.care_has(sid,array['senior'])))
 ) t),'[]'::jsonb) else '[]'::jsonb end
$$;
create function public.care_conversation_recipients(senior_id text) returns jsonb language sql stable security invoker set search_path='' as $$select private.care_conversation_directory(senior_id)$$;
revoke all on function private.care_shared_access(text),private.care_conversation_directory(text),public.care_conversation_recipients(text) from public,anon;
grant execute on function private.care_shared_access(text),private.care_conversation_directory(text),public.care_conversation_recipients(text) to authenticated;

create function private.care_targeted_message(sid text,p jsonb,writing boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select private.care_shared_access(sid) and case when writing then
  p->>'senderId'=auth.uid()::text and exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.status='active' and m.user_id=auth.uid()::text and m.role=p->>'senderRole' and (m.senior_id=sid or m.scope_json::jsonb ? sid or m.scope_json::jsonb ? '*'))
  and exists(select 1 from jsonb_array_elements(private.care_conversation_directory(sid)) r where r->>'userId'=p->>'recipientId' and r->>'role'=p->>'recipientRole')
  and (p->>'channel'='in_app' or private.care_has(sid,array['coordinator','operations']))
 else
  private.care_has(sid,array['coordinator','operations']) or p->>'senderId'=auth.uid()::text or p->>'recipientId'=auth.uid()::text
 end
$$;
create function private.care_message_receipt(sid text,p jsonb,writing boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select private.care_shared_access(sid) and (not writing or p->>'userId'=auth.uid()::text) and exists(
  select 1 from public.care_events e where e.owner='workspace:primary' and e.kind='communication' and e.id=p->>'messageId' and e.senior_id=sid
  and private.care_targeted_message(sid,e.payload,false) and (not writing or e.payload->>'recipientId'=auth.uid()::text)
 )
$$;
revoke all on function private.care_targeted_message(text,jsonb,boolean),private.care_message_receipt(text,jsonb,boolean) from public,anon;
grant execute on function private.care_targeted_message(text,jsonb,boolean),private.care_message_receipt(text,jsonb,boolean) to authenticated;
create policy portal_care_read on public.care_events for select to authenticated using(kind in ('care_request','care_request_state','checkin') and private.care_shared_access(senior_id));
create policy portal_care_insert on public.care_events for insert to authenticated with check(
 (kind in ('care_request','care_request_state','checkin') and private.care_shared_access(senior_id)) or
 (kind='communication' and private.care_targeted_message(senior_id,payload,true))
);
-- Restrictive policies also constrain older permissive staff policies.
create policy portal_care_scope_read on public.care_events as restrictive for select to authenticated using(
 case when kind='communication' then private.care_targeted_message(senior_id,payload,false)
 when kind='communication_read' then private.care_message_receipt(senior_id,payload,false)
 when kind in ('care_request','care_request_state','checkin') then private.care_shared_access(senior_id) else true end
);
create policy portal_care_scope_write on public.care_events as restrictive for insert to authenticated with check(
 case when kind='communication' then private.care_targeted_message(senior_id,payload,true)
 when kind='communication_read' then private.care_message_receipt(senior_id,payload,true)
 when kind in ('care_request','care_request_state','checkin') then private.care_shared_access(senior_id) else true end
);
create unique index care_request_one_revision on public.care_events(owner,(payload->>'requestId'),((payload->>'revision')::integer)) where kind in ('care_request','care_request_state');
create index care_request_senior_time on public.care_events(owner,senior_id,created_at desc) where kind in ('care_request','care_request_state','checkin');

create function private.care_shared_event_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare p jsonb; prior jsonb; origin jsonb; staff boolean; target text; rev integer; sid text;
begin
 if tg_op<>'INSERT' then
  if old.kind in ('care_request','care_request_state','checkin','communication','communication_read') then raise insufficient_privilege using message='Care conversations and shared action history are append-only';end if;
  return case when tg_op='DELETE' then old else new end;
 end if;
 if new.kind not in ('care_request','care_request_state','checkin') then return new;end if;
 p:=new.payload;sid:=new.senior_id;staff:=private.care_has(sid,array['coordinator','operations']);
 if not private.care_shared_access(sid) or new.owner<>'workspace:primary' or p->>'seniorId' is distinct from sid then raise insufficient_privilege using message='Shared care access to this senior is required';end if;
 if p ?| array['kind','owner','senior_id','created_at','sequence','payload','privateNote','staffNote'] then raise invalid_parameter_value using message='Do not include private notes or storage fields in a shared care action';end if;
 if new.kind='checkin' then
  if p->>'checkinId' is distinct from new.id or new.id!~'^[a-fA-F0-9]{8}-([a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$' or p->>'reportedBy' is distinct from auth.uid()::text then raise insufficient_privilege;end if;
  if not exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.user_id=auth.uid()::text and m.status='active' and m.role=p->>'reportedByRole') then raise insufficient_privilege;end if;
  if coalesce(p->>'language','') not in ('en','hi') or coalesce(p->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or (p->>'date')::date>private.care_history_current_date() or (not staff and (p->>'date')::date<>private.care_history_current_date()) then raise invalid_parameter_value using message='Use the current wellbeing date and a supported language';end if;
  if jsonb_typeof(p->'answers') is distinct from 'object' or (select count(*) from jsonb_object_keys(p->'answers'))<>4
   or coalesce(p#>>'{answers,wellbeing}','') not in ('usual','changed','help') or coalesce(p#>>'{answers,medicines}','') not in ('taken','missed','review')
   or coalesce(p#>>'{answers,daily_routine}','') not in ('usual','less_food','less_sleep') or coalesce(p#>>'{answers,support}','') not in ('routine','today','prompt')
   or length(coalesce(p->>'note',''))>1600 or coalesce(length(p->>'summary'),0) not between 10 and 2400 then raise invalid_parameter_value using message='Complete all four wellbeing questions';end if;
  return new;
 end if;
 if p->>'actorId' is distinct from auth.uid()::text or coalesce(p->>'requestId','')!~'^[a-fA-F0-9]{8}-([a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$' or coalesce(p->>'revision','')!~'^[1-9][0-9]{0,8}$' then raise insufficient_privilege;end if;
 rev:=(p->>'revision')::integer;
 if coalesce(length(btrim(p->>'action')),0) not between 3 and 240 or length(coalesce(p->>'details',''))>1600 or coalesce(p->>'priority','') not in ('routine','today','prompt') or coalesce(p->>'dueDate','')!~'^\d{4}-\d{2}-\d{2}$' then raise invalid_parameter_value using message='A shared follow-up needs an action, valid date and priority';end if;
 perform (p->>'dueDate')::date;
 perform pg_advisory_xact_lock(hashtextextended(new.owner||':shared-request:'||(p->>'requestId'),0));
 if new.kind='care_request' then
  if new.id is distinct from p->>'requestId' or rev<>1 or p->>'status' is distinct from 'requested' or p->>'createdBy' is distinct from auth.uid()::text then raise invalid_parameter_value using message='A follow-up starts as requested at revision one';end if;
  if not exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.user_id=auth.uid()::text and m.status='active' and m.role=p->>'createdByRole') then raise insufficient_privilege;end if;
  if not staff and p->>'assignedTo' is not null then raise insufficient_privilege using message='Only care staff can assign requests';end if;
 else
  select e.payload into origin from public.care_events e where e.owner=new.owner and e.kind='care_request' and e.id=p->>'requestId' and e.senior_id=sid;
  if origin is null then raise invalid_parameter_value using message='Create a follow-up before recording progress';end if;
  select e.payload into prior from public.care_events e where e.owner=new.owner and e.kind in ('care_request','care_request_state') and e.payload->>'requestId'=p->>'requestId' order by (e.payload->>'revision')::integer desc limit 1;
  if rev<>(prior->>'revision')::integer+1 then raise unique_violation using message='Follow-up revision changed. Refresh before retrying';end if;
  if prior->>'status' in ('completed','cancelled') then raise invalid_parameter_value using message='Closed follow-ups cannot be changed';end if;
  if (p-array['status','revision','reply','outcome','updatedAt','actorId','actorName','assignedTo','assignedToName']) is distinct from (prior-array['status','revision','reply','outcome','updatedAt','actorId','actorName','assignedTo','assignedToName']) then raise invalid_parameter_value using message='Follow-up identity is immutable';end if;
  if staff then
   if coalesce(p->>'status','') not in ('accepted','in_progress','completed','cancelled') then raise insufficient_privilege;end if;
  else
   if coalesce(p->>'status','') not in ('acknowledged','reported_done') or p->'assignedTo' is distinct from prior->'assignedTo' or p->'assignedToName' is distinct from prior->'assignedToName' then raise insufficient_privilege using message='Members may acknowledge or report their part completed';end if;
  end if;
  if p->>'status'='completed' and coalesce(length(btrim(p->>'outcome')),0)<5 then raise invalid_parameter_value using message='A completed follow-up requires an outcome';end if;
  if p->>'status'='reported_done' and coalesce(length(btrim(p->>'reply')),0)<3 then raise invalid_parameter_value using message='Explain the completed action';end if;
  if length(coalesce(p->>'reply',''))>1600 or length(coalesce(p->>'outcome',''))>1600 then raise invalid_parameter_value;end if;
 end if;
 target:=p->>'assignedTo';
 if target is not null and not exists(select 1 from public.care_memberships m left join public.care_account_settings a on a.user_id::text=m.user_id where m.workspace_id='primary' and m.status='active' and coalesce(a.enabled,true) and m.user_id=target and (m.role='coordinator' or m.role='operations' and m.is_admin=1) and (m.scope_json::jsonb ? '*' or m.scope_json::jsonb ? sid)) then raise invalid_parameter_value using message='Choose an active assigned care staff account';end if;
 return new;
end $$;
revoke all on function private.care_shared_event_guard() from public,anon,authenticated;
create trigger care_shared_history_guard before insert or update or delete on public.care_events for each row execute function private.care_shared_event_guard();
