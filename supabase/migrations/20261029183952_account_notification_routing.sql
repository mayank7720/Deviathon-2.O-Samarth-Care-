-- Role-specific notification intents are committed with their originating care event.
create table public.care_notification_routes (
 id text primary key, senior_id text not null, user_id uuid not null references auth.users(id),
 recipient_role text not null check(recipient_role in ('coordinator','operations','senior','family')),
 kind text not null check(kind in ('support_request','staff_alert','care_message','escalation','followup','serious_alert','weekly_summary','checkin')),
 source_id text not null, status text not null default 'pending' check(status in ('pending','awaiting_contact','queued','cooldown','blocked_access','expired','accepted','sent','delivered','failed','cancelled')),
 job_id text, contact_id text, queued_at timestamptz, created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '24 hours', last_error text
);
create index care_notification_routes_pending on public.care_notification_routes(created_at) where status in ('pending','awaiting_contact','cooldown','queued');
create index care_notification_routes_recipient on public.care_notification_routes(user_id,created_at desc);
alter table public.care_notification_routes enable row level security;
revoke all on public.care_notification_routes from public,anon,authenticated;
grant select on public.care_notification_routes to authenticated;
grant all on public.care_notification_routes to service_role;
create policy notification_routes_read on public.care_notification_routes for select to authenticated using(private.care_has(senior_id,array['coordinator','operations']) or (user_id=auth.uid() and private.care_shared_access(senior_id)));

create function private.care_route_member(uid text,sid text,r text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.care_memberships m join auth.users u on u.id::text=m.user_id left join public.care_account_settings a on a.user_id=u.id
 where m.user_id=uid and m.workspace_id='primary' and m.status='active' and m.role=r and coalesce(a.enabled,true) and u.deleted_at is null
 and (m.senior_id=sid or m.scope_json::jsonb ? sid or m.scope_json::jsonb ? '*') and (r<>'operations' or m.is_admin=1)
 and (r<>'family' or private.care_family_allowed(sid)))
$$;
create function private.care_route_owner(sid text,preferred text default null) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('userId',m.user_id,'role',m.role) from public.care_memberships m
 where private.care_route_member(m.user_id,sid,m.role) and (m.role='coordinator' or m.role='operations' and m.is_admin=1)
 order by case when m.user_id=preferred then 0 when m.role='coordinator' then 1 else 2 end,m.created_at,m.id limit 1
$$;
create function private.care_route_notice(sid text,uid text,r text,k text,source text) returns void language plpgsql security definer set search_path='' as $$
declare ident text:='route:'||encode(extensions.digest(sid||':'||uid||':'||r||':'||k||':'||source,'sha256'),'hex'); stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 if not private.care_route_member(uid,sid,r) then return;end if;
 insert into public.care_notification_routes(id,senior_id,user_id,recipient_role,kind,source_id) values(ident,sid,uid::uuid,r,k,source) on conflict do nothing;
 insert into public.care_deliveries(id,owner,senior_id,recipient_role,user_id,kind,channel,status,payload,source_id,created_at,delivered_at)
 values(ident||':in_app','workspace:primary',sid,r,uid,k,'in_app','delivered',jsonb_build_object('title',case k when 'support_request' then 'A household requested support' when 'escalation' then 'Operations review needed' when 'staff_alert' then 'Assigned senior needs review' when 'serious_alert' then 'Care-team follow-up needed' else 'Care update' end,'body','Open your secure care workspace to review this update.','routingSourceId',source),source,stamp,stamp) on conflict do nothing;
end $$;

create function private.care_route_event() returns trigger language plpgsql security definer set search_path='' as $$
declare person jsonb;uid text;r text;origin jsonb;
begin
 if new.owner<>'workspace:primary' then return new;end if;
 if new.kind='care_request' then
  person:=private.care_route_owner(new.senior_id,new.payload->>'assignedTo');
  if person is not null then perform private.care_route_notice(new.senior_id,person->>'userId',person->>'role',case when person->>'role'='operations' then 'escalation' else 'support_request' end,new.id);end if;
 elsif new.kind='care_request_state' then
  select payload into origin from public.care_events where id=new.payload->>'requestId' and kind='care_request';
  uid:=origin->>'createdBy';r:=origin->>'createdByRole';
  if uid is not null and uid<>new.payload->>'actorId' and r in ('family','senior') then perform private.care_route_notice(new.senior_id,uid,r,'followup',new.id);end if;
  if new.payload->>'actorId' in (select user_id from public.care_memberships where role in ('family','senior') and status='active') then
   person:=private.care_route_owner(new.senior_id,new.payload->>'assignedTo');
   if person is not null then perform private.care_route_notice(new.senior_id,person->>'userId',person->>'role',case when person->>'role'='operations' then 'escalation' else 'support_request' end,new.id);end if;
  end if;
  if new.payload->>'assignedTo' is not null then
   person:=private.care_route_owner(new.senior_id,new.payload->>'assignedTo');
   if person->>'userId'=new.payload->>'assignedTo' and person->>'userId'<>new.payload->>'actorId' then perform private.care_route_notice(new.senior_id,person->>'userId',person->>'role',case when person->>'role'='operations' then 'escalation' else 'support_request' end,new.id);end if;
  end if;
 elsif new.kind='communication' and new.payload->>'channel'='in_app' then
  uid:=new.payload->>'recipientId';r:=new.payload->>'recipientRole';
  if uid is not null and uid<>new.payload->>'senderId' then perform private.care_route_notice(new.senior_id,uid,r,case when r in ('coordinator','operations') then 'care_message' else 'followup' end,new.id);end if;
 end if;
 return new;
end $$;
create trigger care_route_saved_event after insert on public.care_events for each row execute function private.care_route_event();

create function private.care_route_score() returns trigger language plpgsql security definer set search_path='' as $$
declare person jsonb;member record;source text;
begin
 if new.owner<>'workspace:primary' then return new;end if;
 if new.payload->>'level'='unknown' then
  for member in select distinct user_id from public.care_memberships where workspace_id='primary' and status='active' and role='senior' and senior_id=new.senior_id loop perform private.care_route_notice(new.senior_id,member.user_id,'senior','checkin','missing:'||new.senior_id||':'||new.score_date);end loop;
  return new;
 end if;
 if new.payload->>'level' is distinct from 'high' then return new;end if;
 -- Stable daily evidence fingerprint deduplicates repeat cache refreshes.
 source:='risk:'||new.senior_id||':'||new.score_date||':'||encode(extensions.digest(coalesce((new.payload->'reasons')::text,'[]'),'sha256'),'hex');
 person:=private.care_route_owner(new.senior_id);
 if person is not null then perform private.care_route_notice(new.senior_id,person->>'userId',person->>'role',case when person->>'role'='operations' then 'escalation' else 'staff_alert' end,source);end if;
 if private.care_family_allowed(new.senior_id) then
  for member in select distinct user_id from public.care_memberships where workspace_id='primary' and status='active' and role='family' and (senior_id=new.senior_id or scope_json::jsonb ? new.senior_id) loop perform private.care_route_notice(new.senior_id,member.user_id,'family','serious_alert',source);end loop;
 end if;
 return new;
end $$;
create trigger care_route_daily_score after insert or update on public.care_daily_scores for each row execute function private.care_route_score();

create function private.care_route_reviewed_summary() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.owner='workspace:primary' and new.kind='weekly_summary' and new.channel='in_app' and new.status in ('queued','delivered','read') and new.payload->'summary' is not null and new.recipient_role='family' and (tg_op='INSERT' or old.status='pending_review') then
  perform private.care_route_notice(new.senior_id,new.user_id,'family','weekly_summary','approved-report:'||coalesce(new.payload->>'reportId',new.source_id,new.id));
 end if;return new;
end $$;
create trigger care_route_reviewed_summary after insert or update on public.care_deliveries for each row execute function private.care_route_reviewed_summary();

-- Resolve live contacts directly; changes in assignment no longer require re-saving a phone.
create function private.care_live_contacts(sid text default null) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]') from (select distinct jsonb_build_object('id','acct-'||m.user_id||'-'||left(m.role,1)||'-'||p.senior_id||'-'||c.revision,'seniorId',p.senior_id,'role',m.role,'userId',m.user_id,'name',m.display_name,'phone',c.phone,'revision',c.revision,'verified',c.recipient_confirmed,'smsConsent',c.sms_consent,'callConsent',c.call_consent) as x
 from public.care_memberships m join public.care_account_contacts c on c.user_id::text=m.user_id join public.care_profiles p on p.owner='workspace:primary' and (sid is null or p.senior_id=sid)
 where c.phone is not null and c.recipient_confirmed and (private.care_service() or private.care_has(p.senior_id,array['coordinator','operations'])) and private.care_route_member(m.user_id,p.senior_id,m.role)) q
$$;
create or replace function private.care_account_phone_contacts() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.care_has('',array['coordinator','operations']) then raise insufficient_privilege;end if;
 return (select coalesce(jsonb_agg(c),'[]') from jsonb_array_elements(private.care_live_contacts()) c where private.care_has(c->>'seniorId',array['coordinator','operations']));
end $$;

create function private.care_sms_text(template text,language text,recipient_role text) returns text language plpgsql immutable set search_path='' as $$
begin
 if recipient_role='senior' and template not in ('checkin','followup','serious_alert') or recipient_role='family' and template not in ('followup','serious_alert','weekly_summary') or recipient_role='coordinator' and template not in ('support_request','staff_alert','care_message') or recipient_role='operations' and template not in ('escalation','care_message') then return null;end if;
 if language='en' then return case template
 when 'support_request' then 'Samarth Care: A linked household has requested support. Open your secure care inbox to review and arrange contact.'
 when 'staff_alert' then 'Samarth Care: A senior in your assigned care list needs a prompt review. Open your secure care queue.'
 when 'care_message' then 'Samarth Care: You have a new care message in your secure inbox.'
 when 'escalation' then 'Samarth Care: An unassigned or overdue care request needs Operations review. Open your secure care queue.'
 when 'checkin' then 'Samarth Care: Please share a short wellbeing update with your care coordinator. This is not an emergency service.'
 when 'followup' then 'Samarth Care: Your care team would like to arrange a call. Please contact your coordinator when convenient.'
 when 'serious_alert' then 'Samarth Care: Please contact your care coordinator promptly for a check-in. For immediate distress, use your usual emergency support.'
 when 'weekly_summary' then 'Samarth Care: Your reviewed weekly update is ready in the protected care inbox. Contact your coordinator if you need a call.' end;
 elsif language='hi' then return case template
 when 'support_request' then 'समर्थ केयर: आपके जिम्मे परिवार ने सहायता मांगी है। सुरक्षित केयर इनबॉक्स देखें।'
 when 'staff_alert' then 'समर्थ केयर: आपके जिम्मे वरिष्ठ की शीघ्र समीक्षा जरूरी है। सुरक्षित केयर सूची देखें।'
 when 'care_message' then 'समर्थ केयर: सुरक्षित इनबॉक्स में नया केयर संदेश है।'
 when 'escalation' then 'समर्थ केयर: बिना जिम्मेदार या लंबित अनुरोध की ऑपरेशन्स समीक्षा जरूरी है। सुरक्षित केयर सूची देखें।'
 when 'checkin' then 'समर्थ केयर: कृपया अपनी देखभाल टीम को आज की कुशलता बताएँ।'
 when 'followup' then 'समर्थ केयर: कृपया कोऑर्डिनेटर से बात करने का समय तय करें।'
 when 'serious_alert' then 'समर्थ केयर: कृपया अपनी देखभाल टीम से जल्दी संपर्क करें।'
 when 'weekly_summary' then 'समर्थ केयर: आपकी साप्ताहिक जानकारी सुरक्षित इनबॉक्स में तैयार है।' end;end if;return null;
end $$;
-- Retain all lease and monotonic-receipt checks while using role-specific copy and current contacts.
do $$declare source text;start_at integer;finish_at integer;old_lookup text;begin
 source:=pg_get_functiondef('private.care_android_job_guard()'::regprocedure);
 start_at:=strpos(source,' expected_text:=case');finish_at:=strpos(source,' if expected_text is null');
 if start_at=0 or finish_at=0 then raise exception 'Unexpected Android prompt guard';end if;
 source:=substr(source,1,start_at-1)||' expected_text:=private.care_sms_text(p->>''template'',p->>''language'',p->>''recipientRole'');'||chr(10)||substr(source,finish_at);
 old_lookup:='select e.payload->''contact'' into c from public.care_events e where e.owner=new.owner and e.kind=''telephony_contact'' and e.senior_id=new.senior_id and e.payload#>>''{contact,id}''=p->>''contactId'' order by e.sequence desc limit 1;';
 if strpos(source,old_lookup)=0 then raise exception 'Unexpected Android contact lookup';end if;
 source:=replace(source,old_lookup,'select contact into c from jsonb_array_elements(private.care_live_contacts(new.senior_id)) contact where contact->>''id''=p->>''contactId'' limit 1;');
 execute source;
end $$;

create function private.care_notification_routing(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.care_notification_routes%rowtype;contact jsonb;job jsonb;hash text;jid text;stamp text;person jsonb;request record;oldjob public.care_events%rowtype;created integer:=0;queued_count integer:=0;processed integer:=0;
begin
 if not private.care_service() and not private.care_has('',array['coordinator','operations']) then raise insufficient_privilege;end if;
 if action not in ('status','process','reconcile') then raise invalid_parameter_value;end if;
 if action<>'status' then
  -- Pending support is retained even if a coordinator had not yet been assigned.
  for request in select e.* from public.care_events e where e.owner='workspace:primary' and e.kind='care_request' and (private.care_service() or private.care_has(e.senior_id,array['coordinator','operations'])) and not exists(select 1 from public.care_events x where x.kind='care_request_state' and x.payload->>'requestId'=e.id and x.payload->>'status' in ('completed','cancelled')) order by e.sequence desc limit 500 loop
   person:=private.care_route_owner(request.senior_id,coalesce((select x.payload->>'assignedTo' from public.care_events x where x.kind='care_request_state' and x.payload->>'requestId'=request.id order by (x.payload->>'revision')::integer desc limit 1),request.payload->>'assignedTo'));
   if person is not null then perform private.care_route_notice(request.senior_id,person->>'userId',person->>'role',case when person->>'role'='operations' then 'escalation' else 'support_request' end,request.id);end if;
   if request.created_at::timestamptz<clock_timestamp()-interval '24 hours' then
    for person in select jsonb_build_object('userId',m.user_id,'role',m.role) from public.care_memberships m where m.workspace_id='primary' and m.role='operations' and m.is_admin=1 and private.care_route_member(m.user_id,request.senior_id,'operations') loop perform private.care_route_notice(request.senior_id,person->>'userId','operations','escalation','overdue:'||request.id);end loop;
   end if;
  end loop;
 end if;
 if action='process' and not private.care_service() then
  for item in select n.* from public.care_notification_routes n where n.status in ('pending','awaiting_contact','cooldown','queued') and private.care_has(n.senior_id,array['coordinator','operations']) order by n.created_at limit 100 for update skip locked loop
   processed:=processed+1;
   if item.kind='support_request' then
    select e.* into oldjob from public.care_events e where e.id=item.source_id and e.kind in ('care_request','care_request_state');
    if oldjob.id is not null then
     person:=private.care_route_owner(item.senior_id,coalesce((select x.payload->>'assignedTo' from public.care_events x where x.kind='care_request_state' and x.payload->>'requestId'=coalesce(oldjob.payload->>'requestId',oldjob.id) order by (x.payload->>'revision')::integer desc limit 1),oldjob.payload->>'assignedTo'));
     if person->>'userId' is distinct from item.user_id::text then
      update public.care_notification_routes set status='blocked_access',last_error='The follow-up owner changed before SMS dispatch.' where id=item.id;continue;
     end if;
    end if;
   end if;
   if not private.care_route_member(item.user_id::text,item.senior_id,item.recipient_role) then update public.care_notification_routes set status='blocked_access',last_error='Recipient access or sharing permission was withdrawn.' where id=item.id;continue;end if;
   select c into contact from jsonb_array_elements(private.care_live_contacts(item.senior_id)) c where c->>'userId'=item.user_id::text and c->>'role'=item.recipient_role and c->'smsConsent'='true' limit 1;
   if item.job_id is not null then
    select * into oldjob from public.care_events where id=item.job_id and kind='telephony_job';
    if oldjob.payload->>'status' in ('accepted','sent','delivered','failed','cancelled') then update public.care_notification_routes set status=oldjob.payload->>'status' where id=item.id;continue;end if;
    if oldjob.payload->>'status'='processing' then continue;end if;
    if oldjob.payload->>'status'='queued' and item.contact_id=contact->>'id' then
     if (oldjob.payload->>'expiresAt')::timestamptz>clock_timestamp() then continue;else update public.care_notification_routes set status='expired',last_error='The device did not claim this SMS before expiry. Review before a new request.' where id=item.id;continue;end if;
    end if;
    if oldjob.payload->>'status'='queued' then update public.care_events set payload=payload||jsonb_build_object('status','cancelled','state',jsonb_build_object('step',(payload#>>'{state,step}')::integer+1),'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=oldjob.id;update public.care_notification_routes set job_id=null,contact_id=null where id=item.id;end if;
   end if;
   if item.expires_at<=clock_timestamp() then update public.care_notification_routes set status='expired',last_error='The notification window ended; review the saved care request.' where id=item.id;continue;end if;
   if contact is null then update public.care_notification_routes set status='awaiting_contact',job_id=null,contact_id=null,last_error='A confirmed current mobile number with SMS permission is required.' where id=item.id;continue;end if;
   perform pg_advisory_xact_lock(hashtextextended('care-route-rate:'||item.user_id::text,0));
   if (select count(*) from public.care_notification_routes n where n.user_id=item.user_id and n.job_id is not null and n.queued_at>clock_timestamp()-interval '24 hours')>=10 or exists(select 1 from public.care_notification_routes n where n.user_id=item.user_id and n.id<>item.id and n.job_id is not null and n.queued_at>clock_timestamp()-interval '15 minutes' and n.kind=item.kind) then update public.care_notification_routes set status='cooldown',last_error='Notifications are grouped to limit repeated SMS. The in-app notice is available.' where id=item.id;continue;end if;
   hash:=encode(extensions.digest(item.id||':'||(contact->>'id'),'sha256'),'hex');jid:=substr(hash,1,8)||'-'||substr(hash,9,4)||'-'||substr(hash,13,4)||'-'||substr(hash,17,4)||'-'||substr(hash,21,12);stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
   job:=jsonb_build_object('id',jid,'seniorId',item.senior_id,'contactId',contact->>'id','recipientRole',item.recipient_role,'channel','sms','template',item.kind,'language','en','text',private.care_sms_text(item.kind,'en',item.recipient_role),'status','queued','requestHash',hash,'state',jsonb_build_object('step',0),'createdAt',stamp,'expiresAt',to_char((clock_timestamp()+interval '30 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'asOfDate',private.care_history_current_date()::text,'requestedBy',auth.uid(),'externalDelivery',false,'deliveredToHandset',false,'humanRead',false);
   insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(jid,'workspace:primary','telephony_job',item.senior_id,job,stamp) on conflict do nothing;
   update public.care_notification_routes set status='queued',job_id=jid,contact_id=contact->>'id',queued_at=clock_timestamp(),last_error=null where id=item.id;queued_count:=queued_count+1;
  end loop;
  update public.care_events e set payload=e.payload||jsonb_build_object('status','cancelled','state',jsonb_build_object('step',(e.payload#>>'{state,step}')::integer+1),'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) from public.care_notification_routes n where n.job_id=e.id and n.status in ('blocked_access','expired') and e.kind='telephony_job' and e.payload->>'status'='queued' and private.care_has(e.senior_id,array['coordinator','operations']);
 end if;
 return jsonb_build_object('routes',coalesce((select jsonb_agg(x) from(select n.id,n.senior_id as "seniorId",n.recipient_role as "recipientRole",coalesce((select display_name from public.care_memberships m where m.user_id=n.user_id::text and m.status='active' order by m.created_at limit 1),n.recipient_role) as "recipientName",n.kind,n.status,n.job_id as "jobId",n.created_at as "createdAt",n.last_error as "lastError" from public.care_notification_routes n where private.care_service() or private.care_has(n.senior_id,array['coordinator','operations']) order by n.created_at desc limit 100)x),'[]'),'processed',processed,'queued',queued_count,'automaticSms',true,'callRequests','Requests notify assigned care staff. A separate approved action is required to place a call.');
end $$;
create function private.care_notification_job_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare route public.care_notification_routes%rowtype;origin public.care_events%rowtype;person jsonb;
begin
 if new.kind<>'telephony_job' or new.payload->>'status' not in ('queued','processing') then return new;end if;
 select * into route from public.care_notification_routes n where n.job_id=new.id;
 if route.id is null then return new;end if;
 if route.status not in ('queued','pending') or not private.care_route_member(route.user_id::text,route.senior_id,route.recipient_role) then raise insufficient_privilege using message='Notification recipient is no longer eligible';end if;
 if route.kind='support_request' then
  select * into origin from public.care_events e where e.id=route.source_id and e.kind in ('care_request','care_request_state');
  if origin.id is not null then
   person:=private.care_route_owner(route.senior_id,coalesce((select e.payload->>'assignedTo' from public.care_events e where e.kind='care_request_state' and e.payload->>'requestId'=coalesce(origin.payload->>'requestId',origin.id) order by (e.payload->>'revision')::integer desc limit 1),origin.payload->>'assignedTo'));
   if person->>'userId' is distinct from route.user_id::text then raise insufficient_privilege using message='Follow-up owner changed before dispatch';end if;
  end if;
 end if;return new;
end $$;
create trigger care_notification_job_guard before insert or update on public.care_events for each row execute function private.care_notification_job_guard();
create function public.care_notification_routing(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.care_notification_routing(action,payload)$$;
revoke all on function private.care_route_member(text,text,text),private.care_route_owner(text,text),private.care_route_notice(text,text,text,text,text),private.care_route_event(),private.care_route_score(),private.care_route_reviewed_summary(),private.care_notification_job_guard(),private.care_live_contacts(text),private.care_sms_text(text,text,text) from public,anon,authenticated;
-- The existing invoker Android guard needs these bounded read/text helpers.
grant execute on function private.care_live_contacts(text),private.care_sms_text(text,text,text) to authenticated;
revoke all on function private.care_notification_routing(text,jsonb),public.care_notification_routing(text,jsonb) from public,anon;
grant execute on function private.care_notification_routing(text,jsonb),public.care_notification_routing(text,jsonb) to authenticated,service_role;
