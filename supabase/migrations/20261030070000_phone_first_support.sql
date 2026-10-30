-- Incoming phone help is independent of a browser session and the demo clock.
-- Only new, command-filtered SMS reaches this table; inbox exports are excluded.
create table public.care_phone_requests (
 id uuid primary key default gen_random_uuid(), event_id text not null unique,
 sender text not null check(sender ~ '^\+[1-9][0-9]{7,14}$'),
 message text not null check(char_length(message) between 1 and 1600),
 kind text not null check(kind in ('help','callback')), language text not null check(language in ('en','hi')),
 senior_id text, assigned_to uuid references auth.users(id), request_id uuid,
 status text not null default 'received' check(status in ('received','acknowledged','called','closed')),
 received_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
 acknowledged_at timestamptz, called_at timestamptz, closed_at timestamptz,
 escalated_at timestamptz, outcome text, acknowledged_by uuid references auth.users(id)
);
create index care_phone_requests_open on public.care_phone_requests(created_at) where status in ('received','acknowledged');
create index care_phone_requests_senior on public.care_phone_requests(senior_id,created_at desc);
alter table public.care_phone_requests enable row level security;
revoke all on public.care_phone_requests from public,anon,authenticated;
grant all on public.care_phone_requests to service_role;

create table private.care_phone_nonces(id text primary key,created_at timestamptz not null default clock_timestamp());
alter table private.care_phone_nonces enable row level security;
revoke all on private.care_phone_nonces from public,anon,authenticated,service_role;

-- A phone-only relay must never drain unrelated historical notification jobs.
do $phone_filter$ declare source text; before_filter text; after_filter text;begin
 source:=pg_get_functiondef('private.care_notification_routing(text,jsonb)'::regprocedure);
 before_filter:='where n.status in (''pending'',''awaiting_contact'',''cooldown'',''queued'') and private.care_has(n.senior_id,array[''coordinator'',''operations'']) order by n.created_at limit 100 for update skip locked';
 after_filter:='where n.status in (''pending'',''awaiting_contact'',''cooldown'',''queued'') and private.care_has(n.senior_id,array[''coordinator'',''operations'']) and (payload->>''phoneOnly'' is distinct from ''true'' or exists(select 1 from public.care_phone_requests pr where pr.status<>''closed'' and (pr.request_id::text=n.source_id or n.source_id=''phone:''||pr.id::text))) order by n.created_at limit 100 for update skip locked';
 if strpos(source,before_filter)=0 then raise exception 'Notification routing changed; review the phone-only filter before migration';end if;
 execute replace(source,before_filter,after_filter);
end $phone_filter$;

create function private.care_phone_support(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); item public.care_phone_requests%rowtype; candidates text[];
 sid text; person jsonb; fallback_person jsonb; source_role text; contact jsonb;
 stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 ident uuid; request_ident uuid; entry jsonb; actor_role text; latest_state jsonb; rev integer;
begin
 if not private.care_actor_enabled() then raise insufficient_privilege;end if;
 if action='contact' then
  sid:=payload->>'seniorId';
  if sid !~ '^S[0-9]{3,6}$' or not private.care_has(sid,array['senior','family','coordinator','operations'])
   or (not private.care_has(sid,array['senior','coordinator','operations']) and not private.care_family_allowed(sid)) then raise insufficient_privilege;end if;
  person:=private.care_route_owner(sid);
  select jsonb_build_object('name',m.display_name,'role',m.role,'phone',c.phone,'canCall',c.call_consent,'canSms',c.sms_consent)
   into contact from public.care_memberships m join public.care_account_contacts c on c.user_id::text=m.user_id
   where m.user_id=person->>'userId' and m.role=person->>'role' and m.status='active'
   and c.recipient_confirmed and c.phone is not null and (c.call_consent or c.sms_consent) limit 1;
  select jsonb_build_object('name',m.display_name,'role','operations','phone',c.phone,'canCall',c.call_consent,'canSms',c.sms_consent)
   into fallback_person from public.care_memberships m join public.care_account_contacts c on c.user_id::text=m.user_id
   join auth.users u on u.id=c.user_id left join public.care_account_settings s on s.user_id=u.id
   where m.workspace_id='primary' and m.role='operations' and m.is_admin=1 and m.status='active'
   and coalesce(s.enabled,true) and u.deleted_at is null and c.recipient_confirmed and c.phone is not null
   and (c.call_consent or c.sms_consent) limit 1;
  return jsonb_build_object('seniorId',sid,'coordinator',contact,'operations',fallback_person);
 end if;
 if not private.care_has('',array['coordinator','operations']) then raise insufficient_privilege;end if;
 if action='list' then
  return jsonb_build_object('requests',coalesce((select jsonb_agg(x order by x->>'createdAt' desc) from (
   select jsonb_build_object('id',r.id,'seniorId',r.senior_id,'seniorName',p.name,
    'maskedSender',left(r.sender,3)||'••••'||right(r.sender,3),'kind',r.kind,'language',r.language,
    'status',r.status,'message',r.message,'receivedAt',r.received_at,'createdAt',r.created_at,
    'acknowledgedAt',r.acknowledged_at,'calledAt',r.called_at,'escalatedAt',r.escalated_at,
    'outcome',r.outcome,'requestId',r.request_id,'assignedTo',r.assigned_to,
    'smsStatus',(select n.status from public.care_notification_routes n where n.source_id=r.request_id::text order by n.created_at desc limit 1),
    'canRespond',private.care_admin() or r.assigned_to=uid,
    'delayed',r.created_at-r.received_at>interval '5 minutes') x
   from public.care_phone_requests r left join public.care_profiles p on p.owner='workspace:primary' and p.senior_id=r.senior_id
   where private.care_admin() or r.senior_id is not null and private.care_has(r.senior_id,array['coordinator','operations'])
   order by r.created_at desc limit 100) entries),'[]'::jsonb),'isAdmin',private.care_admin());
 end if;
 if action='outbound' then
  perform private.care_notification_routing('process',jsonb_build_object('phoneOnly',true));
  return jsonb_build_object('jobs',coalesce((select jsonb_agg(jsonb_build_object('id',e.id)) from public.care_events e
   join public.care_notification_routes n on n.job_id=e.id
   where e.kind='telephony_job' and e.payload->>'channel'='sms' and e.payload->>'status'='queued'
    and private.care_has(e.senior_id,array['coordinator','operations'])
    and exists(select 1 from public.care_phone_requests pr where pr.status<>'closed' and (pr.request_id::text=n.source_id or n.source_id='phone:'||pr.id::text))),'[]'::jsonb));
 end if;
 if action='receive' then
  -- The relay cannot expand its coordinator's care scope. Unmatched or
  -- out-of-scope callers enter the Operations-only intake queue instead.
  if not private.care_has('',array['coordinator','operations']) then raise insufficient_privilege;end if;
  if coalesce(payload->>'eventId','') !~ '^[a-f0-9]{64}$' or coalesce(payload->>'sender','') !~ '^\+[1-9][0-9]{7,14}$'
   or coalesce(payload->>'kind','') not in ('help','callback') or coalesce(payload->>'language','') not in ('en','hi')
   or char_length(coalesce(payload->>'message','')) not between 1 and 1600
   or char_length(coalesce(payload->>'nonce','')) not between 16 and 160 or payload->>'receivedAt' is null then raise invalid_parameter_value;end if;
  if payload->>'kind'='help' and (payload->>'message') !~* '^(HELP|SOS|MADAD|BACHAO|मदद|सहायता|बचाओ)([[:space:]!:.।]|$)'
   or payload->>'kind'='callback' and (payload->>'message') !~* '^(CALL([[:space:]]+ME)?|CALLBACK|PHONE|कॉल|फोन)([[:space:]!:.।]|$)' then raise invalid_parameter_value;end if;
  if (payload->>'receivedAt')::timestamptz>clock_timestamp()+interval '1 minute'
   or (payload->>'receivedAt')::timestamptz<clock_timestamp()-interval '1 day' then raise invalid_parameter_value;end if;
  -- The same physical SMS may be retried with a fresh signed bridge nonce.
  perform pg_advisory_xact_lock(hashtextextended('phone-intake:'||(payload->>'eventId'),0));
  select * into item from public.care_phone_requests where event_id=payload->>'eventId';
  if found then return jsonb_build_object('ok',true,'id',item.id,'status',item.status,'replayed',true);end if;
  insert into private.care_phone_nonces(id) values(payload->>'nonce');
  select array_agg(distinct candidate) into candidates from (
   select case when m.role='senior' then m.senior_id else s.value end candidate
   from public.care_account_contacts c join public.care_memberships m on m.user_id=c.user_id::text
   join auth.users u on u.id=c.user_id left join public.care_account_settings a on a.user_id=u.id
   left join lateral jsonb_array_elements_text(case when m.role='family' then
    case when m.senior_id<>'' then jsonb_build_array(m.senior_id) else m.scope_json::jsonb end else '[]'::jsonb end) s on true
   where c.phone=payload->>'sender' and c.recipient_confirmed and m.workspace_id='primary' and m.status='active'
    and m.role in ('senior','family') and coalesce(a.enabled,true) and u.deleted_at is null
  ) matched where candidate ~ '^S[0-9]{3,6}$' and exists(select 1 from public.care_memberships m
   join public.care_account_contacts c on c.user_id::text=m.user_id where c.phone=payload->>'sender'
   and (m.role='senior' and m.senior_id=candidate or m.role='family' and private.care_family_allowed(candidate)));
  -- Shared/unknown numbers go to Operations, never a guessed senior's record.
  if cardinality(candidates)=1 and private.care_has(candidates[1],array['coordinator','operations']) then sid:=candidates[1];person:=private.care_route_owner(sid);end if;
  if person is null then select jsonb_build_object('userId',m.user_id,'role',m.role) into person
   from public.care_memberships m join auth.users u on u.id::text=m.user_id left join public.care_account_settings a on a.user_id=u.id
   where m.workspace_id='primary' and m.status='active' and m.role='operations' and m.is_admin=1 and coalesce(a.enabled,true) and u.deleted_at is null limit 1;end if;
  ident:=gen_random_uuid();
  if sid is not null then
   request_ident:=gen_random_uuid();
   select m.role into actor_role from public.care_memberships m where m.user_id=uid::text and m.status='active' and m.role in ('operations','coordinator') order by m.is_admin desc limit 1;
   entry:=jsonb_build_object('requestId',request_ident,'seniorId',sid,
    'action',case when payload->>'kind'='help' then 'Call senior promptly: help requested by SMS' else 'Return the requested phone call' end,
    'details','A request arrived from a registered phone number. Verify who is speaking when you call.','source','sms',
    'phoneRequestId',ident,'dueDate',to_char(clock_timestamp() at time zone 'Asia/Kolkata','YYYY-MM-DD'),
    'priority',case when payload->>'kind'='help' then 'prompt' else 'today' end,'status','requested','revision',1,
    'createdBy',uid,'createdByRole',actor_role,'createdByName','Phone intake','assignedTo',person->>'userId',
    'assignedToName','Assigned care team','createdAt',stamp,'updatedAt',stamp,'actorId',uid,'actorName','Phone intake');
   insert into public.care_events(id,owner,kind,senior_id,payload,created_at)
    values(request_ident::text,'workspace:primary','care_request',sid,entry,stamp);
   insert into public.care_events(id,owner,kind,senior_id,payload,created_at)
    values('phone-signal:'||ident,'workspace:primary','signal',sid,jsonb_build_object('type','note',
     'helpRequested',payload->>'kind'='help','record',jsonb_build_object('seniorId',sid,
      'date',to_char((payload->>'receivedAt')::timestamptz at time zone 'Asia/Kolkata','YYYY-MM-DD'),
      'observedAt',payload->>'receivedAt','source','phone-sms','note',payload->>'message',
      'helpRequested',payload->>'kind'='help','phoneRequestId',ident)),stamp);
  end if;
  insert into public.care_phone_requests(id,event_id,sender,message,kind,language,senior_id,assigned_to,request_id,received_at)
   values(ident,payload->>'eventId',payload->>'sender',payload->>'message',payload->>'kind',payload->>'language',sid,(person->>'userId')::uuid,request_ident,(payload->>'receivedAt')::timestamptz);
  if sid is null and person is not null then
   -- No household data is attached to an unmatched caller. Only Operations sees it.
   insert into public.care_deliveries(id,owner,senior_id,recipient_role,user_id,kind,channel,status,payload,source_id,created_at,delivered_at)
    values('phone-unmatched:'||ident,'workspace:primary','','operations',person->>'userId','phone_intake','in_app','delivered',
     jsonb_build_object('title','An incoming caller needs a callback','body','Match this phone request before linking it to a senior.'),ident::text,stamp,stamp);
  end if;
  return jsonb_build_object('ok',true,'id',ident,'status','received','matched',sid is not null,'replayed',false);
 end if;
 if action not in ('acknowledge','called','close','callback') then raise invalid_parameter_value;end if;
 select * into item from public.care_phone_requests where id=(payload->>'id')::uuid for update;
 if not found or not (private.care_admin() or item.assigned_to=uid and item.senior_id is not null and private.care_has(item.senior_id,array['coordinator','operations'])) then raise insufficient_privilege;end if;
 if item.status='closed' then raise check_violation using message='This request is closed.';end if;
 if action='callback' then return jsonb_build_object('dialUri','tel:'||item.sender,'connected',false);end if;
 if action='acknowledge' and item.status<>'received' or action='called' and item.status='called' then return jsonb_build_object('ok',true,'id',item.id,'replayed',true);end if;
 if action='acknowledge' then update public.care_phone_requests set status=case when status='received' then 'acknowledged' else status end,
  acknowledged_at=coalesce(acknowledged_at,clock_timestamp()),acknowledged_by=coalesce(acknowledged_by,uid) where id=item.id;
 elsif action='called' then
  update public.care_phone_requests set status='called',called_at=coalesce(called_at,clock_timestamp()),acknowledged_at=coalesce(acknowledged_at,clock_timestamp()),acknowledged_by=coalesce(acknowledged_by,uid) where id=item.id;
 elsif action='close' then
  if char_length(trim(payload->>'outcome')) not between 5 and 1600 then raise invalid_parameter_value;end if;
  update public.care_phone_requests set status='closed',outcome=trim(payload->>'outcome'),closed_at=clock_timestamp() where id=item.id;
  update public.care_events e set payload=e.payload||jsonb_build_object('status','cancelled',
   'state',jsonb_build_object('step',(e.payload#>>'{state,step}')::integer+1),'updatedAt',stamp)
   from public.care_notification_routes n where n.job_id=e.id and e.kind='telephony_job' and e.payload->>'status'='queued'
   and (n.source_id=item.request_id::text or n.source_id='phone:'||item.id::text);
  update public.care_notification_routes set status='cancelled',last_error='Phone support was resolved before SMS dispatch.'
   where (source_id=item.request_id::text or source_id='phone:'||item.id::text) and status in ('pending','awaiting_contact','cooldown','queued');
 end if;
 if item.request_id is not null then
  select e.payload into latest_state from public.care_events e where e.kind in ('care_request','care_request_state')
   and (e.id=item.request_id::text or e.payload->>'requestId'=item.request_id::text) order by (e.payload->>'revision')::integer desc limit 1;
  rev:=coalesce((latest_state->>'revision')::integer,1)+1;
  if latest_state->>'status' not in ('completed','cancelled') then
   entry:=latest_state||jsonb_build_object('revision',rev,'status',case action when 'acknowledge' then 'accepted' when 'called' then 'in_progress' else 'completed' end,
    'actorId',uid,'actorName','Care team','updatedAt',stamp,'reply',case action when 'acknowledge' then 'Phone request acknowledged; callback pending.' when 'called' then 'A care team member recorded a contact attempt.' else '' end,
    'outcome',case when action='close' then payload->>'outcome' else '' end);
   insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','care_request_state',item.senior_id,entry,stamp);
  end if;
 end if;
 return jsonb_build_object('ok',true,'id',item.id,'action',action);
end $$;

create function public.care_phone_support(action text,payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.care_phone_support(action,payload)$$;
revoke all on function private.care_phone_support(text,jsonb),public.care_phone_support(text,jsonb) from public,anon;
grant execute on function private.care_phone_support(text,jsonb),public.care_phone_support(text,jsonb) to authenticated;

create function private.care_phone_escalate() returns integer language plpgsql security definer set search_path='' as $$
declare item public.care_phone_requests%rowtype; manager text; stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); total integer:=0;
begin
 select m.user_id into manager from public.care_memberships m join auth.users u on u.id::text=m.user_id left join public.care_account_settings a on a.user_id=u.id
  where m.workspace_id='primary' and m.status='active' and m.role='operations' and m.is_admin=1 and coalesce(a.enabled,true) and u.deleted_at is null limit 1;
 if manager is null then return 0;end if;
 for item in select * from public.care_phone_requests where escalated_at is null
  and (status='received' and created_at<clock_timestamp()-case kind when 'help' then interval '2 minutes' else interval '5 minutes' end
   or status='acknowledged' and acknowledged_at<clock_timestamp()-interval '5 minutes'
   or status='called' and called_at<clock_timestamp()-interval '5 minutes') for update skip locked loop
  update public.care_phone_requests set escalated_at=clock_timestamp() where id=item.id;
  if item.senior_id is not null then perform private.care_route_notice(item.senior_id,manager,'operations','escalation','phone:'||item.id);
  else
   insert into public.care_deliveries(id,owner,senior_id,recipient_role,user_id,kind,channel,status,payload,source_id,created_at,delivered_at)
    values('phone-overdue:'||item.id,'workspace:primary','','operations',manager,'phone_intake','in_app','delivered',
     jsonb_build_object('title','A phone request is awaiting a response','body','Review the incoming phone queue and arrange a callback.'),item.id::text,stamp,stamp) on conflict do nothing;
  end if;
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function private.care_phone_escalate() from public,anon,authenticated,service_role;
select cron.schedule('samarth-phone-support-escalation','* * * * *',$cron$select private.care_phone_escalate();$cron$);
