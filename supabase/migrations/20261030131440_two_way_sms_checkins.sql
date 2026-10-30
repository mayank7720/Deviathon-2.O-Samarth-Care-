-- Dedicated questionnaires: transport receipts never count as human answers.
create table public.care_sms_checkins (
 id uuid primary key default gen_random_uuid(), request_key text not null unique,
 senior_id text not null, recipient_id uuid not null references auth.users(id),
 contact_id text not null, phone text not null, code text not null unique,
 language text not null check(language in ('en','hi')), prompt text not null check(char_length(prompt)<=160),
 requires_code boolean not null, send_at timestamptz not null, due_at timestamptz not null,
 delivery_status text not null default 'queued' check(delivery_status in ('queued','processing','accepted','sent','delivered','failed','cancelled','expired','blocked')),
 started_at timestamptz, receipt_at timestamptz, lease_hash text, lease_until timestamptz,
 answer text check(answer in ('1','2','3')), answered_at timestamptz,
 followup_id uuid, overdue_task_id uuid, review_task_id uuid, overdue_at timestamptz,
 reviewed_at timestamptz, reviewed_by uuid, outcome text,
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null references auth.users(id)
);
create index care_sms_checkins_phone on public.care_sms_checkins(phone,created_at desc);
create index care_sms_checkins_due on public.care_sms_checkins(due_at) where answer is null and overdue_at is null and reviewed_at is null;
create index care_sms_checkins_queue on public.care_sms_checkins(send_at) where delivery_status in ('queued','processing','accepted','sent');
create table public.care_sms_checkin_replies (
 id uuid primary key default gen_random_uuid(), event_id text not null unique,
 sender text not null, message text not null check(char_length(message)<=80),
 received_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
 checkin_id uuid references public.care_sms_checkins(id),
 resolution text not null, reviewed_at timestamptz, reviewed_by uuid, outcome text
);
create index care_sms_checkin_replies_review on public.care_sms_checkin_replies(created_at) where reviewed_at is null;
alter table public.care_sms_checkins enable row level security;
alter table public.care_sms_checkin_replies enable row level security;
create policy sms_checkin_no_direct_access on public.care_sms_checkins as restrictive for all to anon,authenticated using(false) with check(false);
create policy sms_reply_no_direct_access on public.care_sms_checkin_replies as restrictive for all to anon,authenticated using(false) with check(false);
revoke all on public.care_sms_checkins,public.care_sms_checkin_replies from public,anon,authenticated;
grant all on public.care_sms_checkins,public.care_sms_checkin_replies to service_role;
create index care_sms_sender_contact_hash on public.care_account_contacts ((encode(extensions.digest(phone,'sha256'),'hex'))) where phone is not null;
create index care_sms_question_phone_hash on public.care_sms_checkins ((encode(extensions.digest(phone,'sha256'),'hex')));

-- Private helpers are reachable only from the checked RPC or scheduled sweep.
create function private.care_sms_checkin_task(qid uuid,reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare q public.care_sms_checkins%rowtype; ident uuid; person jsonb; member record; actor_role text;
 stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 select * into q from public.care_sms_checkins where id=qid for update;
 if not found or reason not in ('overdue','callback','help','late','failure') then raise invalid_parameter_value;end if;
 ident:=case when reason in ('overdue','failure') then q.overdue_task_id when reason='late' then q.review_task_id else q.followup_id end;
 if ident is not null then return ident;end if;
 person:=private.care_route_owner(q.senior_id);
 if person is null then return null;end if;
 ident:=gen_random_uuid();
 if reason in ('overdue','failure') then update public.care_sms_checkins set overdue_task_id=ident where id=qid;
 elsif reason='late' then update public.care_sms_checkins set review_task_id=ident where id=qid;
 else update public.care_sms_checkins set followup_id=ident where id=qid;end if;
 select m.role into actor_role from public.care_memberships m where m.user_id=auth.uid()::text and m.status='active' and m.role in ('coordinator','operations') order by m.is_admin desc limit 1;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at)
 values(ident::text,'workspace:primary','care_request',q.senior_id,jsonb_build_object(
 'requestId',ident,'seniorId',q.senior_id,'action',case reason when 'help' then 'Call promptly: SMS check-in requests help'
 when 'callback' then 'Return the SMS check-in callback request' when 'late' then 'Review a late or changed SMS check-in reply'
 when 'failure' then 'Contact senior: SMS question could not be delivered'
 else 'Contact senior: no SMS check-in reply received' end,
 'details','Verify who is speaking. An unanswered SMS means wellbeing is unknown. Review the saved check-in and other care evidence.',
 'source','sms-checkin','smsCheckinId',q.id,'dueDate',to_char(clock_timestamp() at time zone 'Asia/Kolkata','YYYY-MM-DD'),
 'priority',case when reason in ('help','late') then 'prompt' else 'today' end,'status','requested','revision',1,
 'createdBy',coalesce(auth.uid()::text,person->>'userId'),'createdByRole',coalesce(actor_role,person->>'role'),'createdByName','SMS check-in',
 'assignedTo',person->>'userId','assignedToName','Assigned care team','createdAt',stamp,'updatedAt',stamp,
 'actorId',coalesce(auth.uid()::text,person->>'userId'),'actorName','SMS check-in'),stamp);
 if reason in ('help','callback','late') and private.care_family_allowed(q.senior_id) then
  for member in select distinct user_id from public.care_memberships where workspace_id='primary' and status='active' and role='family'
   and (senior_id=q.senior_id or scope_json::jsonb ? q.senior_id) loop
   perform private.care_route_notice(q.senior_id,member.user_id,'family',case when reason='help' then 'serious_alert' else 'followup' end,ident::text);
  end loop;
 end if;
 return ident;
end $$;
revoke all on function private.care_sms_checkin_task(uuid,text) from public,anon,authenticated,service_role;

create function private.care_sms_checkin_sweep() returns integer
language plpgsql security definer set search_path='' as $$
declare q record;total integer:=0;
begin
 for q in select id from public.care_sms_checkins where due_at<clock_timestamp() and answer is null and overdue_at is null
  and reviewed_at is null and delivery_status<>'cancelled' order by due_at limit 100 for update skip locked loop
  perform private.care_sms_checkin_task(q.id,'overdue');
  update public.care_sms_checkins set overdue_at=clock_timestamp(),
   delivery_status=case when delivery_status='queued' then 'expired' else delivery_status end where id=q.id;
  total:=total+1;
 end loop;return total;
end $$;
revoke all on function private.care_sms_checkin_sweep() from public,anon,authenticated,service_role;
grant execute on function private.care_sms_checkin_sweep() to service_role;

create function private.care_sms_checkin(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.care_sms_checkins%rowtype;r public.care_sms_checkin_replies%rowtype;
 contact jsonb; contacts jsonb; candidates text[]; ids uuid[]; sid text; request_hash text;
 stamp timestamptz:=clock_timestamp(); scheduled timestamptz; due timestamptz;
 ident uuid; token uuid; keycode text; copy text; needs_code boolean; status text; choice text; result_reason text; attempt integer;
begin
 if not private.care_actor_enabled() or not private.care_has('',array['coordinator','operations']) then raise insufficient_privilege;end if;
 if action='eligible' then
  if coalesce(payload->>'senderHash','') !~ '^[a-f0-9]{64}$' then raise invalid_parameter_value;end if;
  insert into private.care_phone_nonces(id) values(payload->>'nonce');
  return jsonb_build_object('eligible',exists(select 1 from public.care_account_contacts c
   join public.care_memberships m on m.user_id=c.user_id::text join auth.users u on u.id=c.user_id
   left join public.care_account_settings a on a.user_id=u.id
   where c.phone is not null and encode(extensions.digest(c.phone,'sha256'),'hex')=payload->>'senderHash'
   and c.recipient_confirmed and m.workspace_id='primary' and m.status='active' and coalesce(a.enabled,true) and u.deleted_at is null
   and (private.care_admin() or c.user_id::text in (select v->>'userId' from jsonb_array_elements(private.care_live_contacts()) v)))
   or exists(select 1 from public.care_sms_checkins c where encode(extensions.digest(c.phone,'sha256'),'hex')=payload->>'senderHash'
    and c.created_at>stamp-interval '7 days' and private.care_has(c.senior_id,array['coordinator','operations'])));
 end if;
 if action='list' then
  return jsonb_build_object('checkins',coalesce((select jsonb_agg(x order by x->>'createdAt' desc) from (
   select jsonb_build_object('id',c.id,'seniorId',c.senior_id,'seniorName',p.name,'code',c.code,'prompt',c.prompt,
    'maskedPhone',left(c.phone,3)||'••••'||right(c.phone,3),'requiresCode',c.requires_code,'language',c.language,
    'sendAt',c.send_at,'dueAt',c.due_at,'createdAt',c.created_at,'deliveryStatus',c.delivery_status,'receiptAt',c.receipt_at,
    'answer',c.answer,'answeredAt',c.answered_at,'overdueAt',c.overdue_at,'followupId',c.followup_id,
    'overdueTaskId',c.overdue_task_id,'reviewTaskId',c.review_task_id,'reviewedAt',c.reviewed_at,'outcome',c.outcome) x
    from public.care_sms_checkins c left join public.care_profiles p on p.owner='workspace:primary' and p.senior_id=c.senior_id
    where private.care_has(c.senior_id,array['coordinator','operations']) order by c.created_at desc limit 100) entries),'[]'::jsonb),
   'reviewReplies',coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id',a.id,'maskedSender',left(a.sender,3)||'••••'||right(a.sender,3),'message',a.message,
     'receivedAt',a.received_at,'resolution',a.resolution,'reviewedAt',a.reviewed_at,'outcome',a.outcome) x
    from public.care_sms_checkin_replies a where private.care_admin() and a.resolution not in ('matched','duplicate','stop')
    order by a.created_at desc limit 100) entries),'[]'::jsonb),
   'contacts',(select coalesce(jsonb_agg(jsonb_build_object('seniorId',v->>'seniorId','maskedPhone',left(v->>'phone',3)||'••••'||right(v->>'phone',3))), '[]'::jsonb)
    from jsonb_array_elements(private.care_live_contacts()) v where v->>'role'='senior' and v->>'smsConsent'='true'),
   'quietHours','20:00–08:00 IST','isAdmin',private.care_admin());
 end if;
 if action='create' then
  sid:=payload->>'seniorId';
  if sid !~ '^S[0-9]{3,6}$' or not private.care_has(sid,array['coordinator','operations']) then raise insufficient_privilege;end if;
  if payload->>'language' not in ('en','hi') or coalesce(payload->>'consentConfirmed','')<>'true'
   or coalesce(payload->>'idempotencyKey','') !~ '^[A-Za-z0-9_-]{16,80}$' or coalesce(payload->>'windowHours','') not in ('2','4','8','24') then raise invalid_parameter_value;end if;
  request_hash:=encode(extensions.digest(auth.uid()::text||':'||sid||':'||(payload->>'idempotencyKey'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('sms-checkin-key:'||request_hash,0));
  select * into q from public.care_sms_checkins where request_key=request_hash;
  if found then return jsonb_build_object('ok',true,'id',q.id,'duplicate',true);end if;
  scheduled:=(payload->>'sendAt')::timestamptz;
  if scheduled is null or scheduled<stamp-interval '1 minute' or scheduled>stamp+interval '7 days'
   or extract(hour from scheduled at time zone 'Asia/Kolkata') not between 8 and 19 then
   raise exception using errcode='P0001',message='Schedule SMS check-ins between 08:00 and 20:00 IST within seven days';end if;
  due:=scheduled+make_interval(hours=>(payload->>'windowHours')::integer);
  contacts:=(select jsonb_agg(v) from jsonb_array_elements(private.care_live_contacts(sid)) v where v->>'role'='senior' and v->>'smsConsent'='true');
  if coalesce(jsonb_array_length(contacts),0)<>1 then raise exception using errcode='P0001',message='One active senior account with a confirmed SMS-enabled mobile is required';end if;
  contact:=contacts->0;
  perform pg_advisory_xact_lock(hashtextextended('sms-checkin-phone:'||(contact->>'phone'),0));
  if exists(select 1 from public.care_sms_checkins where senior_id=sid and answer is null and reviewed_at is null and due_at>stamp and delivery_status not in ('cancelled','failed','expired','blocked')) then
   raise exception using errcode='P0001',message='This senior already has an open SMS check-in';end if;
  if (select count(*) from public.care_sms_checkins where phone=contact->>'phone' and created_at>stamp-interval '1 day')+
   (select count(*) from public.care_events e where e.kind='telephony_job' and e.payload->>'contactId'=contact->>'id' and e.created_at::timestamptz>stamp-interval '1 day')>=10
   or exists(select 1 from public.care_sms_checkins where phone=contact->>'phone' and created_at>stamp-interval '15 minutes') then
   raise exception using errcode='P0001',message='SMS rate limit reached; wait before scheduling another question';end if;
  needs_code:=(select count(distinct candidate)>1 from (
   select case when m.role='senior' then m.senior_id else v.value end candidate
   from public.care_account_contacts c join public.care_memberships m on m.user_id=c.user_id::text
   join auth.users u on u.id=c.user_id left join public.care_account_settings a on a.user_id=u.id
   left join lateral jsonb_array_elements_text(case when m.role='family' then case when m.senior_id<>'' then jsonb_build_array(m.senior_id) else m.scope_json::jsonb end else '[]'::jsonb end) v on true
   where c.phone=contact->>'phone' and c.recipient_confirmed and m.workspace_id='primary' and m.status='active'
    and m.role in ('senior','family') and coalesce(a.enabled,true) and u.deleted_at is null
    and (m.role<>'family' or private.care_family_allowed(v.value))) bindings where candidate ~ '^S[0-9]{3,6}$');
  for attempt in 1..20 loop
   keycode:=upper(encode(extensions.gen_random_bytes(3),'hex'));
   perform pg_advisory_xact_lock(hashtextextended('sms-checkin-code:'||keycode,0));
   exit when not exists(select 1 from public.care_sms_checkins c where c.code=keycode);
  end loop;
  if exists(select 1 from public.care_sms_checkins c where c.code=keycode) then raise exception using errcode='P0001',message='Please retry creating the question reference';end if;
  copy:=case when payload->>'language'='hi' then 'SwasthSync: Kaise hain? Reply ' else 'SwasthSync: How are you? Reply ' end
   ||case when needs_code then keycode||' ' else '' end
   ||case when payload->>'language'='hi' then '1=theek, 2=call, 3=madad. ' else '1=okay, 2=call, 3=help. ' end
   ||'Ref '||keycode||case when payload->>'language'='hi' then '. STOP=SMS band. Yeh emergency seva nahi. Aapatkal:112.' else '. STOP=stop SMS. Not an emergency service; emergency:112.' end;
  insert into public.care_sms_checkins(request_key,senior_id,recipient_id,contact_id,phone,code,language,prompt,requires_code,send_at,due_at,created_by)
   values(request_hash,sid,(contact->>'userId')::uuid,contact->>'id',contact->>'phone',keycode,payload->>'language',copy,needs_code,scheduled,due,auth.uid()) returning * into q;
  return jsonb_build_object('ok',true,'id',q.id,'duplicate',false);
 end if;
 if action='outbound' then
  insert into private.care_phone_nonces(id) values(payload->>'nonce');
  if extract(hour from stamp at time zone 'Asia/Kolkata') not between 8 and 19 then return jsonb_build_object('jobs','[]'::jsonb);end if;
  return jsonb_build_object('jobs',coalesce((select jsonb_agg(jsonb_build_object('id',c.id)) from (select c.id from public.care_sms_checkins c
   where private.care_has(c.senior_id,array['coordinator','operations']) and c.send_at<=stamp and c.due_at>stamp
   and c.answer is null and c.reviewed_at is null and (c.delivery_status='queued' or c.delivery_status in ('processing','accepted','sent') and c.lease_until<stamp) order by c.send_at limit 10) c),'[]'::jsonb));
 end if;
 if action='review-reply' then
  if not private.care_admin() then raise insufficient_privilege;end if;
  if char_length(trim(coalesce(payload->>'outcome',''))) not between 5 and 1600 then raise invalid_parameter_value;end if;
  update public.care_sms_checkin_replies set reviewed_at=stamp,reviewed_by=auth.uid(),outcome=trim(payload->>'outcome') where id=(payload->>'id')::uuid and reviewed_at is null;
  return jsonb_build_object('ok',true);
 end if;
 if action='receive' then
  choice:=payload->>'choice';
  if coalesce(payload->>'eventId','') !~ '^[a-f0-9]{64}$' or coalesce(payload->>'sender','') !~ '^\+[1-9][0-9]{7,14}$'
   or choice is null or choice not in ('1','2','3','stop') or char_length(coalesce(payload->>'message','')) not between 1 and 80
   or payload->>'receivedAt' is null or (payload->>'receivedAt')::timestamptz not between stamp-interval '1 day' and stamp+interval '1 minute'
   or char_length(coalesce(payload->>'nonce','')) not between 16 and 160
   or (payload->>'code' is not null and payload->>'code' !~ '^[A-F0-9]{6}$') then raise invalid_parameter_value;end if;
  if choice='stop' and payload->>'message' not in ('STOP','UNSUBSCRIBE','बंद')
   or choice<>'stop' and (payload->>'code' is null and payload->>'message' !~ ('^'||choice||'[.!।]?$')
    or payload->>'code' is not null and payload->>'message' !~ ('^('||(payload->>'code')||'[[:space:]:#-]+'||choice||'|'||choice||'[[:space:]:#-]+'||(payload->>'code')||')[.!।]?$')) then raise invalid_parameter_value;end if;
  -- Repeat physical receipts and repeat signed requests cannot create more tasks.
  perform pg_advisory_xact_lock(hashtextextended('sms-reply:'||(payload->>'eventId'),0));
  select * into r from public.care_sms_checkin_replies where event_id=payload->>'eventId';
  if found then return jsonb_build_object('ok',true,'id',r.id,'replayed',true);end if;
  insert into private.care_phone_nonces(id) values(payload->>'nonce');
  perform pg_advisory_xact_lock(hashtextextended('sms-checkin-phone:'||(payload->>'sender'),0));
  if choice='stop' then
   -- Opt-out can only remove SMS permission, never grant or change identity.
   update public.care_account_contacts set sms_consent=false,revision=revision+1,updated_at=stamp,updated_by=auth.uid() where phone=payload->>'sender' and sms_consent
    and (private.care_admin() or user_id::text in (select v->>'userId' from jsonb_array_elements(private.care_live_contacts()) v));
   update public.care_sms_checkins set delivery_status='cancelled' where phone=payload->>'sender' and delivery_status='queued';
   result_reason:='stop';
  else
   select array_agg(distinct candidate) into candidates from (
    select case when m.role='senior' then m.senior_id else v.value end candidate
    from public.care_account_contacts c join public.care_memberships m on m.user_id=c.user_id::text
    join auth.users u on u.id=c.user_id left join public.care_account_settings a on a.user_id=u.id
    left join lateral jsonb_array_elements_text(case when m.role='family' then case when m.senior_id<>'' then jsonb_build_array(m.senior_id) else m.scope_json::jsonb end else '[]'::jsonb end) v on true
    where c.phone=payload->>'sender' and c.recipient_confirmed and m.workspace_id='primary' and m.status='active' and m.role in ('senior','family')
     and coalesce(a.enabled,true) and u.deleted_at is null and (m.role<>'family' or private.care_family_allowed(v.value))) bindings where candidate ~ '^S[0-9]{3,6}$';
   if payload->>'code' is not null then
    select * into q from public.care_sms_checkins where code=payload->>'code' and phone=payload->>'sender';
   elsif cardinality(candidates)=1 then
    select array_agg(id) into ids from public.care_sms_checkins where phone=payload->>'sender' and senior_id=candidates[1]
     and started_at is not null and due_at>=(payload->>'receivedAt')::timestamptz and delivery_status not in ('cancelled','blocked')
     and reviewed_at is null;
    if cardinality(ids)=1 then select * into q from public.care_sms_checkins where id=ids[1];end if;
   end if;
   result_reason:='unmatched';
   if q.id is null then result_reason:=case when cardinality(candidates)>1 then 'needs_code' else 'unmatched' end;
   elsif not private.care_has(q.senior_id,array['coordinator','operations']) then q.id:=null;result_reason:='out_of_scope';
   else
    select * into q from public.care_sms_checkins where id=q.id for update;
    contact:=(select v from jsonb_array_elements(private.care_live_contacts(q.senior_id)) v where v->>'id'=q.contact_id and v->>'phone'=payload->>'sender' and v->>'smsConsent'='true' limit 1);
    if contact is null then result_reason:='binding_changed';
    elsif q.started_at is null or (payload->>'receivedAt')::timestamptz<q.started_at or q.delivery_status in ('cancelled','blocked') then result_reason:='not_active';
    elsif q.answer is not null then
     result_reason:=case when q.answer=choice then 'duplicate' else 'changed_reply' end;
     if q.answer<>choice then perform private.care_sms_checkin_task(q.id,'late');end if;
    elsif (payload->>'receivedAt')::timestamptz>q.due_at or q.reviewed_at is not null then result_reason:='late';perform private.care_sms_checkin_task(q.id,'late');
    else
     result_reason:='matched';
     update public.care_sms_checkins set answer=choice,answered_at=(payload->>'receivedAt')::timestamptz where id=q.id;
     insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('sms-checkin-signal:'||q.id,'workspace:primary','signal',q.senior_id,
      jsonb_build_object('type','note','record',jsonb_build_object('seniorId',q.senior_id,'date',to_char((payload->>'receivedAt')::timestamptz at time zone 'Asia/Kolkata','YYYY-MM-DD'),
       'observedAt',payload->>'receivedAt','source','sms-checkin','smsCheckinId',q.id,'note',case choice when '1' then 'SMS check-in: senior reports doing okay. Other care evidence still needs review.'
        when '2' then 'SMS check-in: senior requests a callback.' else 'SMS check-in: senior requests help. A human must contact them promptly.' end,
       'helpRequested',choice='3','smsCheckinAnswer',choice)),to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
     if choice in ('2','3') then perform private.care_sms_checkin_task(q.id,case when choice='3' then 'help' else 'callback' end);end if;
    end if;
   end if;
  end if;
  insert into public.care_sms_checkin_replies(event_id,sender,message,received_at,checkin_id,resolution)
   values(payload->>'eventId',payload->>'sender',payload->>'message',(payload->>'receivedAt')::timestamptz,q.id,result_reason) returning id into ident;
  return jsonb_build_object('ok',true,'id',ident,'replayed',false,'resolution',result_reason);
 end if;
 if action not in ('claim','receipt','cancel','review') then raise invalid_parameter_value;end if;
 select * into q from public.care_sms_checkins where id=(payload->>'id')::uuid for update;
 if not found or not private.care_has(q.senior_id,array['coordinator','operations']) then raise insufficient_privilege;end if;
 if action='cancel' then
  if q.delivery_status<>'queued' then raise exception using errcode='P0001',message='Only an undispatched SMS can be cancelled';end if;
  update public.care_sms_checkins set delivery_status='cancelled' where id=q.id;
 elsif action='review' then
  if char_length(trim(coalesce(payload->>'outcome',''))) not between 5 and 1600 then raise invalid_parameter_value;end if;
  if q.reviewed_at is not null then return jsonb_build_object('ok',true,'duplicate',true);end if;
  update public.care_sms_checkins set reviewed_at=stamp,reviewed_by=auth.uid(),outcome=trim(payload->>'outcome'),delivery_status=case when delivery_status='queued' then 'cancelled' else delivery_status end where id=q.id;
 elsif action='claim' then
  insert into private.care_phone_nonces(id) values(payload->>'nonce');
  if q.delivery_status not in ('queued','processing','accepted','sent') or q.delivery_status<>'queued' and q.lease_until>stamp
   or q.due_at<=stamp or q.send_at>stamp or q.answer is not null or q.reviewed_at is not null
   or extract(hour from stamp at time zone 'Asia/Kolkata') not between 8 and 19 then raise exception using errcode='P0001',message='This check-in is not ready for relay delivery';end if;
  contact:=(select v from jsonb_array_elements(private.care_live_contacts(q.senior_id)) v where v->>'id'=q.contact_id and v->>'smsConsent'='true' and v->>'phone'=q.phone limit 1);
  if contact is null then
   update public.care_sms_checkins set delivery_status='blocked',overdue_at=stamp where id=q.id;
   perform private.care_sms_checkin_task(q.id,'failure');return jsonb_build_object('blocked',true);
  end if;
  token:=gen_random_uuid();
  update public.care_sms_checkins set delivery_status=case when delivery_status='queued' then 'processing' else delivery_status end,
   started_at=coalesce(started_at,stamp),lease_hash=encode(extensions.digest(token::text,'sha256'),'hex'),lease_until=stamp+interval '10 minutes' where id=q.id;
  return jsonb_build_object('job',jsonb_build_object('id',q.id,'channel','sms','phone',q.phone,'text',q.prompt,'leaseToken',token,'status',q.delivery_status,'receiptOnly',q.started_at is not null));
 elsif action='receipt' then
  insert into private.care_phone_nonces(id) values(payload->>'nonce');
  status:=payload->>'status';
  if payload->>'providerId'<>q.id::text or encode(extensions.digest(coalesce(payload->>'leaseToken',''),'sha256'),'hex') is distinct from q.lease_hash or q.lease_until<=stamp
   or status is null or status not in ('accepted','sent','delivered','failed','cancelled') or q.delivery_status not in ('processing','accepted','sent') then raise insufficient_privilege;end if;
  if status='accepted' and q.delivery_status='sent' then raise invalid_parameter_value;end if;
  update public.care_sms_checkins set delivery_status=status,receipt_at=stamp where id=q.id;
  if status='failed' then
   perform private.care_sms_checkin_task(q.id,'failure');update public.care_sms_checkins set overdue_at=stamp where id=q.id;
  end if;
 end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function private.care_sms_checkin(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.care_sms_checkin(text,jsonb) to authenticated;
create function public.care_sms_checkin(action text,payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.care_sms_checkin(action,payload)$$;
revoke all on function public.care_sms_checkin(text,jsonb) from public,anon,service_role;
grant execute on function public.care_sms_checkin(text,jsonb) to authenticated;

-- The timer has no user session. Accept only its pre-registered, fixed overdue
-- task identity; normal staff/household event validation remains unchanged.
do $system_task$ declare source text;needle text;begin
 source:=pg_get_functiondef('private.care_shared_event_guard()'::regprocedure);
 needle:=' p:=new.payload;sid:=new.senior_id;staff:=private.care_has(sid,array[''coordinator'',''operations'']);';
 if strpos(source,needle)=0 then raise exception 'Review shared care guard before registering timer tasks';end if;
 execute replace(source,needle,$guard$
 if auth.uid() is null and new.kind='care_request' and new.owner='workspace:primary'
  and exists(select 1 from public.care_sms_checkins q where q.overdue_task_id::text=new.id and q.senior_id=new.senior_id
   and new.payload->>'smsCheckinId'=q.id::text and new.payload->>'requestId'=new.id and new.payload->>'source'='sms-checkin') then return new;end if;
 p:=new.payload;sid:=new.senior_id;staff:=private.care_has(sid,array['coordinator','operations']);
 $guard$);
end $system_task$;

-- Keep this source category inside the phone-only worker's narrow allowlist.
do $filter$ declare source text;needle text; replacement text;begin
 source:=pg_get_functiondef('private.care_notification_routing(text,jsonb)'::regprocedure);
 needle:='and (payload->>''phoneOnly'' is distinct from ''true'' or exists(select 1 from public.care_phone_requests pr where pr.status<>''closed'' and (pr.request_id::text=n.source_id or n.source_id=''phone:''||pr.id::text)))';
 replacement:='and (payload->>''phoneOnly'' is distinct from ''true'' or exists(select 1 from public.care_phone_requests pr where pr.status<>''closed'' and (pr.request_id::text=n.source_id or n.source_id=''phone:''||pr.id::text)) or exists(select 1 from public.care_sms_checkins sc where sc.followup_id::text=n.source_id or sc.overdue_task_id::text=n.source_id or sc.review_task_id::text=n.source_id))';
 if strpos(source,needle)=0 then raise exception 'Review phone-only routing before adding check-ins';end if;
 execute replace(source,needle,replacement);
 source:=pg_get_functiondef('private.care_phone_support(text,jsonb)'::regprocedure);
 needle:='and exists(select 1 from public.care_phone_requests pr where pr.status<>''closed'' and (pr.request_id::text=n.source_id or n.source_id=''phone:''||pr.id::text))';
 replacement:='and (exists(select 1 from public.care_phone_requests pr where pr.status<>''closed'' and (pr.request_id::text=n.source_id or n.source_id=''phone:''||pr.id::text)) or exists(select 1 from public.care_sms_checkins sc where sc.followup_id::text=n.source_id or sc.overdue_task_id::text=n.source_id or sc.review_task_id::text=n.source_id))';
 if strpos(source,needle)=0 then raise exception 'Review phone-only jobs before adding check-ins';end if;
 execute replace(source,needle,replacement);
end $filter$;
select cron.schedule('samarth-sms-checkin-overdue','* * * * *',$cron$set local role service_role; select private.care_sms_checkin_sweep();$cron$);
