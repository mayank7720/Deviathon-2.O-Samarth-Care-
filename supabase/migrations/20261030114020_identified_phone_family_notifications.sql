-- Identify the senior in routed alerts without copying health notes into SMS.
-- A contextual prompt is created only from a saved, authorized route. Manual
-- message jobs retain their existing fixed templates and consent checks.
create function private.care_routed_sms_text(route_key text) returns text
language plpgsql stable security definer set search_path='' as $$
declare notice public.care_notification_routes%rowtype; phone_request public.care_phone_requests%rowtype;
 label text; prefix text:='Samarth Care: '; suffix text; topic text; compact_topic text;
 limit_chars integer:=160; budget integer; compact boolean;
begin
 select * into notice from public.care_notification_routes where id=route_key;
 if not found or not private.care_actor_enabled()
  or not private.care_has(notice.senior_id,array['coordinator','operations'])
  or not private.care_route_member(notice.user_id::text,notice.senior_id,notice.recipient_role)
  then raise insufficient_privilege;end if;
 if notice.recipient_role='senior' then return private.care_sms_text(notice.kind,'en','senior');end if;
 select name into label from public.care_profiles where owner='workspace:primary' and senior_id=notice.senior_id;
 -- Collapse whitespace and remove control, bidi-format and non-BMP characters.
 -- Keeping BMP names allows a conservative 70 UTF-16-unit single SMS limit.
 label:=trim(regexp_replace(regexp_replace(regexp_replace(coalesce(label,'Senior'),
  U&'[^\0001-\FFFF]','','g'),U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]','','g'),'[[:cntrl:][:space:]]+',' ','g'));
 if label='' then label:='Senior';end if;
 compact:=label !~ '^[A-Za-z0-9 .''-]*$';
 select * into phone_request from public.care_phone_requests where senior_id=notice.senior_id
  and (request_id::text=notice.source_id or notice.source_id='phone:'||id::text) limit 1;
 if phone_request.id is not null then
  compact_topic:=case phone_request.kind when 'help' then 'HELP SMS' else 'CALLBACK SMS' end;
  topic:=case phone_request.kind when 'help' then 'requested help by SMS' else 'requested a callback by SMS' end;
  if notice.recipient_role in ('coordinator','operations') then
   suffix:=' ('||notice.senior_id||') '||compact_topic||' at '||to_char(phone_request.received_at at time zone 'Asia/Kolkata','DD/MM HH24:MI')||' IST. Call '||phone_request.sender||'; verify identity. Open care queue.';
   if compact then suffix:=' ('||notice.senior_id||') '||compact_topic||'. Call '||phone_request.sender||'.';end if;
  else
   suffix:=' ('||notice.senior_id||') '||topic||' at '||to_char(phone_request.received_at at time zone 'Asia/Kolkata','DD/MM HH24:MI')||' IST. Please check on them and contact the care team.';
   if compact then suffix:=' ('||notice.senior_id||') '||compact_topic||'. Please check in.';end if;
  end if;
 else
  topic:=case notice.kind when 'support_request' then 'Support requested' when 'staff_alert' then 'Review needed'
   when 'care_message' then 'New care message' when 'escalation' then 'Overdue care request'
   when 'serious_alert' then 'Care follow-up needed' when 'weekly_summary' then 'Reviewed weekly update ready'
   else 'Care update' end;
  suffix:=' ('||notice.senior_id||'). '||topic||'. '||case when notice.recipient_role='family' then 'Please contact the care team or open your care inbox.' else 'Open your care queue for details.' end;
  if compact then
   compact_topic:=case notice.kind when 'support_request' then 'Support request' when 'staff_alert' then 'Review needed'
    when 'care_message' then 'Care message' when 'escalation' then 'Overdue request'
    when 'serious_alert' then 'Follow-up needed' when 'weekly_summary' then 'Weekly update ready' else 'Care update' end;
   suffix:=' ('||notice.senior_id||'). '||compact_topic||'. Open inbox.';
  end if;
 end if;
 if compact then prefix:='Samarth: ';limit_chars:=70;end if;
 budget:=limit_chars-char_length(prefix)-char_length(suffix);
 if budget<4 then raise check_violation using message='The care alert exceeds one SMS segment';end if;
 if char_length(label)>budget then label:=left(label,budget-1)||'.';end if;
 return prefix||label||suffix;
end $$;
revoke all on function private.care_routed_sms_text(text) from public,anon,authenticated,service_role;
grant execute on function private.care_routed_sms_text(text) to authenticated;

-- Runs after the actual phone request is saved, rather than guessing its sender
-- from a care-event payload. Unknown/shared callers never notify a household.
create function private.care_phone_family_notice() returns trigger
language plpgsql security definer set search_path='' as $$
declare member record;
begin
 if new.senior_id is null or new.request_id is null or not private.care_family_allowed(new.senior_id) then return new;end if;
 for member in select distinct m.user_id from public.care_memberships m
  where m.workspace_id='primary' and m.status='active' and m.role='family'
   and (m.senior_id=new.senior_id or m.scope_json::jsonb ? new.senior_id)
 loop
  perform private.care_route_notice(new.senior_id,member.user_id,'family',
   case new.kind when 'help' then 'serious_alert' else 'followup' end,new.request_id::text);
 end loop;
 return new;
end $$;
revoke all on function private.care_phone_family_notice() from public,anon,authenticated,service_role;
create trigger care_phone_notify_family after insert on public.care_phone_requests
 for each row execute function private.care_phone_family_notice();

-- Preserve the installed routing logic, including the phone-only queue filter,
-- current contacts, opt-outs, cooldowns, daily limits and duplicate prevention.
do $routing$ declare source text; old_prompt text; new_prompt text;begin
 source:=pg_get_functiondef('private.care_notification_routing(text,jsonb)'::regprocedure);
 old_prompt:='''text'',private.care_sms_text(item.kind,''en'',item.recipient_role)';
 new_prompt:='''text'',private.care_routed_sms_text(item.id),''notificationRouteId'',item.id';
 if strpos(source,old_prompt)=0 then raise exception 'Review changed notification routing before migration';end if;
 execute replace(source,old_prompt,new_prompt);
end $routing$;

-- Existing prompts are immutable snapshots. Profile edits must not prevent
-- delivery receipts. New contextual text must match its saved route and hash.
do $guard$ declare source text; old_prompt text; new_prompt text; old_keys text;begin
 source:=pg_get_functiondef('private.care_android_job_guard()'::regprocedure);
 old_prompt:=' expected_text:=private.care_sms_text(p->>''template'',p->>''language'',p->>''recipientRole'');';
 new_prompt:=$prompt$
 if tg_op='UPDATE' then expected_text:=old.payload->>'text';
 elsif p ? 'notificationRouteId' then
  if p->>'channel'<>'sms' or p->>'language'<>'en' or not exists(select 1 from public.care_notification_routes n
   where n.id=p->>'notificationRouteId' and n.senior_id=new.senior_id and n.recipient_role=p->>'recipientRole' and n.kind=p->>'template'
    and n.status in ('pending','awaiting_contact','cooldown','queued') and (n.job_id is null or n.job_id=new.id)
    and encode(extensions.digest(n.id||':'||(p->>'contactId'),'sha256'),'hex')=p->>'requestHash') then raise insufficient_privilege;end if;
  expected_text:=private.care_routed_sms_text(p->>'notificationRouteId');
 else expected_text:=private.care_sms_text(p->>'template',p->>'language',p->>'recipientRole');end if;
$prompt$;
 if strpos(source,old_prompt)=0 then raise exception 'Review changed Android prompt guard before migration';end if;
 source:=replace(source,old_prompt,new_prompt);
 old_keys:='array[''id'',''seniorId'',''contactId'',''recipientRole'',''channel'',''template'',''language'',''text'',''status'',''requestHash'',''state'',''createdAt'',''expiresAt'',''asOfDate'',''requestedBy'',''externalDelivery'',''deliveredToHandset'',''humanRead'']';
 if strpos(source,old_keys)=0 then raise exception 'Review changed Android insertion fields before migration';end if;
 source:=replace(source,old_keys,replace(old_keys,'''humanRead'']','''humanRead'',''notificationRouteId'']'));
 source:=replace(source,'Only a fixed generic Android prompt may be queued','Only a saved care alert or fixed Android prompt may be queued');
 execute source;
end $guard$;

-- The notification guard already validates access and current follow-up owner.
-- Resolve the route during insertion too, before its job_id is linked back.
do $route_guard$ declare source text;before_lookup text;after_lookup text;begin
 source:=pg_get_functiondef('private.care_notification_job_guard()'::regprocedure);
 before_lookup:='where n.job_id=new.id;';
 after_lookup:='where n.job_id=new.id or n.id=new.payload->>''notificationRouteId'';';
 if strpos(source,before_lookup)=0 then raise exception 'Review changed notification guard before migration';end if;
 source:=replace(source,before_lookup,after_lookup);
 source:=replace(source,'route.status not in (''queued'',''pending'')','(tg_op=''INSERT'' and route.status not in (''pending'',''awaiting_contact'',''cooldown'',''queued'') or tg_op<>''INSERT'' and route.status<>''queued'')');
 execute source;
end $route_guard$;

-- The staff queue's existing SMS badge refers to the assigned staff alert,
-- rather than whichever family route was created most recently.
do $queue_badge$ declare source text;old_filter text;begin
 source:=pg_get_functiondef('private.care_phone_support(text,jsonb)'::regprocedure);
 old_filter:='where n.source_id=r.request_id::text order by n.created_at desc limit 1';
 if strpos(source,old_filter)=0 then raise exception 'Review changed phone-queue status before migration';end if;
 execute replace(source,old_filter,'where n.source_id=r.request_id::text and n.user_id=r.assigned_to and n.recipient_role in (''coordinator'',''operations'') order by n.created_at desc limit 1');
end $queue_badge$;
