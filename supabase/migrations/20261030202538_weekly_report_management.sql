-- Immutable generated reports have separate, revisioned human review records.
-- No existing summary is shared, withdrawn or enrolled by this migration.
create table private.care_report_reviews(
 report_id text primary key references public.care_events(id),senior_id text not null,
 revision integer not null default 0,state text not null default 'pending' check(state in ('pending','reviewed','rejected')),
 archived boolean not null default false,note text not null default '' check(length(note)<=2000),checks jsonb not null default '{}',
 updated_at timestamptz not null default clock_timestamp(),updated_by uuid
);
create table private.care_report_review_events(
 id bigint generated always as identity primary key,report_id text not null references public.care_events(id),senior_id text not null,
 request_key uuid not null,action text not null,actor_id uuid not null,note text not null default '',details jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp(),unique(report_id,request_key)
);
create index care_report_review_event_history on private.care_report_review_events(report_id,id desc);
alter table private.care_report_reviews enable row level security;
alter table private.care_report_review_events enable row level security;
revoke all on private.care_report_reviews,private.care_report_review_events from public,anon,authenticated,service_role;

create function private.care_report_family_eligible(uid text,sid text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.user_id=uid and m.role='family' and m.status='active'
  and (m.senior_id=sid or m.scope_json::jsonb ? sid)
  and not exists(select 1 from public.care_account_settings s where s.user_id::text=m.user_id and not s.enabled))
$$;
revoke all on function private.care_report_family_eligible(text,text) from public,anon,authenticated,service_role;

create function private.care_report_management(action text,request jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.care_events%rowtype;r private.care_report_reviews%rowtype;sid text;stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 recipient text;rid text;report jsonb;copy jsonb;changed integer:=0;previous text;prior_publish text:=current_setting('samarth.report_publish',true);
begin
 if not private.care_actor_enabled() or not private.care_has('',array['coordinator','operations']) then raise insufficient_privilege;end if;
 if action='list' then
  sid:=request->>'seniorId';
  if sid is null or not private.care_has(sid,array['coordinator','operations']) then raise insufficient_privilege;end if;
  return jsonb_build_object('sharingConsent',exists(select 1 from public.care_consents where owner='workspace:primary' and senior_id=sid and family_allowed),
   'families',coalesce((select jsonb_agg(x) from(select distinct on(m.user_id) jsonb_build_object('userId',m.user_id,'name',coalesce(nullif(btrim(m.display_name),''),'Family member'))x
    from public.care_memberships m where m.role='family' and private.care_report_family_eligible(m.user_id,sid)
     and (m.senior_id=sid or m.scope_json::jsonb ? sid) order by m.user_id,m.created_at desc)q),'[]'),
   'reviews',coalesce((select jsonb_agg(x order by x->>'createdAt' desc) from(select jsonb_build_object('reportId',e.id,'createdAt',e.created_at,
    'revision',coalesce(v.revision,0),'state',coalesce(v.state,'pending'),'archived',coalesce(v.archived,false),'note',coalesce(v.note,''),'checks',coalesce(v.checks,'{}'),
    'updatedAt',v.updated_at,'recipients',coalesce((select jsonb_agg(jsonb_build_object('deliveryId',d.id,'userId',d.user_id,
     'name',coalesce((select nullif(btrim(m.display_name),'') from public.care_memberships m where m.user_id=d.user_id and m.role='family' order by m.created_at desc limit 1),'Family member'),
     'status',d.status,'sharedAt',d.delivered_at,'readAt',d.read_at,'eligible',private.care_report_family_eligible(d.user_id,sid)))
     from public.care_deliveries d where d.owner='workspace:primary' and d.senior_id=sid and d.recipient_role='family' and d.channel='in_app' and d.kind='weekly_summary' and (d.source_id=e.id or d.payload->>'reportId'=e.id)),'[]'),
    'history',coalesce((select jsonb_agg(h order by h->>'at' desc) from(select jsonb_build_object('id',a.id,'action',a.action,'note',a.note,'at',a.created_at,
     'actor',coalesce((select nullif(btrim(m.display_name),'') from public.care_memberships m where m.user_id=a.actor_id::text and m.role in ('coordinator','operations') order by m.created_at desc limit 1),'Care staff'),'details',a.details)h
     from private.care_report_review_events a where a.report_id=e.id order by a.id desc limit 30)history),'[]'))x
    from public.care_events e left join private.care_report_reviews v on v.report_id=e.id
    where e.owner='workspace:primary' and e.kind='generated_report' and e.senior_id=sid order by e.created_at desc,e.sequence desc limit 100)q),'[]'));
 end if;
 if action not in ('note','review','reject','reopen','archive','restore','share','withdraw')
  or (request-array['reportId','revision','idempotencyKey','note','checks','recipientIds'])<>'{}'
  or coalesce(request->>'revision','')!~'^[0-9]{1,8}$'
  or coalesce(request->>'idempotencyKey','')!~*'^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$'
  or request ? 'note' and (jsonb_typeof(request->'note')<>'string' or length(request->>'note')>2000) then raise invalid_parameter_value;end if;
 select * into item from public.care_events where id=request->>'reportId' and owner='workspace:primary' and kind='generated_report' for update;
 if item.id is null then raise no_data_found;end if;sid:=item.senior_id;
 if not (private.care_has(sid,array['coordinator']) or private.care_admin()) then raise insufficient_privilege;end if;
 if exists(select 1 from private.care_report_review_events where report_id=item.id and request_key=(request->>'idempotencyKey')::uuid) then return jsonb_build_object('ok',true,'repeated',true);end if;
 insert into private.care_report_reviews(report_id,senior_id) values(item.id,sid) on conflict do nothing;
 select * into r from private.care_report_reviews where report_id=item.id for update;
 if r.revision<>(request->>'revision')::integer then raise exception using errcode='P0001',message='This report changed. Refresh it before saving your review.';end if;
 if action in ('reject','withdraw') and length(btrim(coalesce(request->>'note','')))<5 then raise exception using errcode='P0001',message='Record a reason in at least five characters.';end if;
 if action='review' then
  if r.archived or coalesce(item.payload#>>'{report,text}','')='' or item.payload#>'{report,evidence}' is null then raise exception using errcode='P0001',message='Restore the completed evidence-backed draft before reviewing.';end if;
  if request->'checks' is distinct from '{"evidence":true,"uncertainty":true,"noDiagnosis":true}'::jsonb then raise exception using errcode='P0001',message='Complete all three review checks.';end if;
  r.state:='reviewed';r.checks:=request->'checks';
 elsif action='reopen' then r.state:='pending';r.checks:='{}';
 elsif action='reject' then
  r.state:='rejected';r.checks:='{}';
  update public.care_deliveries d set status=case when d.status in ('delivered','read') then 'withdrawn' else 'rejected' end,claimed_at=null
   where d.owner=item.owner and d.senior_id=sid and d.kind='weekly_summary' and d.channel='in_app' and (d.source_id=item.id or d.payload->>'reportId'=item.id);get diagnostics changed=row_count;
 elsif action='archive' then r.archived:=true;
 elsif action='restore' then r.archived:=false;
 elsif action='withdraw' then
  update public.care_deliveries d set status='withdrawn',claimed_at=null where d.owner=item.owner and d.senior_id=sid and d.kind='weekly_summary' and d.channel='in_app'
   and (d.source_id=item.id or d.payload->>'reportId'=item.id) and d.status in ('delivered','read','queued','processing');get diagnostics changed=row_count;
 elsif action='share' then
  if r.archived or r.state<>'reviewed' then raise exception using errcode='P0001',message='Mark the active draft reviewed before sharing.';end if;
  if not exists(select 1 from public.care_consents where owner=item.owner and senior_id=sid and family_allowed) then raise insufficient_privilege;end if;
  if jsonb_typeof(request->'recipientIds') is distinct from 'array' or jsonb_array_length(request->'recipientIds') not between 1 and 20 then raise invalid_parameter_value;end if;
  if (select count(distinct x) from jsonb_array_elements_text(request->'recipientIds')x)<>jsonb_array_length(request->'recipientIds') then raise invalid_parameter_value;end if;
  -- Save the review state before the delivery trigger checks it; a later error
  -- rolls back this and every selected recipient as one transaction.
  update private.care_report_reviews set state=r.state where report_id=item.id;
  report:=item.payload->'report';
  if coalesce(report->>'text','')='' then raise invalid_parameter_value;end if;
  perform set_config('samarth.report_publish',item.id,true);
  copy:=jsonb_build_object('title','Reviewed weekly wellbeing summary','body',report->>'text','reportId',item.id,
   'summary',jsonb_build_object('text',report->>'text','period',report->'period','language',report->>'language','method',report->>'method','generation',report->'generation','requiresHumanReview',false,'clinicalPrediction',false));
  for recipient in select jsonb_array_elements_text(request->'recipientIds') loop
   if not private.care_report_family_eligible(recipient,sid) then raise exception using errcode='P0001',message='A selected family account is no longer eligible. Refresh the recipients.';end if;
   rid:='report-delivery:'||item.id||':'||recipient;
   select status into previous from public.care_deliveries where id=rid;
   if previous in ('delivered','read') then continue;end if;
   insert into public.care_deliveries(id,owner,senior_id,recipient_role,user_id,kind,channel,status,payload,source_id,created_at,delivered_at,attempts)
    values(rid,item.owner,sid,'family',recipient,'weekly_summary','in_app','delivered',copy,item.id,stamp,stamp,1)
    on conflict(id) do update set status='delivered',payload=excluded.payload,delivered_at=excluded.delivered_at,read_at=null,last_error=null,claimed_at=null;
   changed:=changed+1;
  end loop;
  perform set_config('samarth.report_publish',coalesce(prior_publish,''),true);
 end if;
 update private.care_report_reviews set revision=r.revision+1,state=r.state,archived=r.archived,checks=r.checks,
  note=case when request ? 'note' then btrim(request->>'note') else r.note end,updated_at=clock_timestamp(),updated_by=auth.uid() where report_id=item.id;
 insert into private.care_report_review_events(report_id,senior_id,request_key,action,actor_id,note,details)
 values(item.id,sid,(request->>'idempotencyKey')::uuid,action,auth.uid(),coalesce(btrim(request->>'note'),''),jsonb_build_object('changedCopies',changed));
 return jsonb_build_object('ok',true,'repeated',false,'changedCopies',changed,'revision',r.revision+1);
end $$;
revoke all on function private.care_report_management(text,jsonb) from public,anon,service_role;
grant execute on function private.care_report_management(text,jsonb) to authenticated;
create function public.care_report_management(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.care_report_management(action,payload)$$;
revoke all on function public.care_report_management(text,jsonb) from public,anon,service_role;
grant execute on function public.care_report_management(text,jsonb) to authenticated;

create function private.care_report_sharing_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare report_key text;review private.care_report_reviews%rowtype;
begin
 if new.kind<>'weekly_summary' or new.channel<>'in_app' or new.status not in ('queued','processing','delivered','read') then return new;end if;
 report_key:=coalesce(new.payload->>'reportId',new.source_id);
 if not exists(select 1 from public.care_events where id=report_key and kind='generated_report') then return new;end if;
 if tg_op='UPDATE' and old.status in ('delivered','read') and new.status in ('delivered','read') then return new;end if;
 select * into review from private.care_report_reviews where report_id=report_key;
 if review.report_id is null or review.state<>'reviewed' or review.archived or current_setting('samarth.report_publish',true) is distinct from report_key then raise exception using errcode='P0001',message='Review and share the active report through its weekly summary controls.';end if;
 return new;
end $$;
revoke all on function private.care_report_sharing_guard() from public,anon,authenticated,service_role;
create trigger care_report_sharing_guard before insert or update on public.care_deliveries for each row execute function private.care_report_sharing_guard();
