-- Standalone Samarth Care. No service key is used by application requests.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table private.care_settings (key text primary key, value text not null);
create table public.care_workspaces (
  id text primary key, owner_user_id text not null, created_at text not null
);
create table public.care_memberships (
  id text primary key, workspace_id text not null references public.care_workspaces(id),
  user_id text not null, email text not null, display_name text not null,
  role text not null check (role in ('coordinator','senior','family','operations')),
  senior_id text not null default '', scope_json text not null check (jsonb_typeof(scope_json::jsonb) = 'array' and jsonb_array_length(scope_json::jsonb)>0),
  is_admin integer not null default 0 check(is_admin in (0,1)),
  status text not null check(status in ('active','revoked')), created_at text not null,
  check ((role in ('senior','family') and senior_id ~ '^S[0-9]{3,6}$' and scope_json::jsonb = jsonb_build_array(senior_id)) or (role in ('coordinator','operations') and senior_id=''))
);
create unique index care_membership_active_assignment on public.care_memberships(workspace_id,user_id,role,senior_id) where status='active';
create index care_membership_user_scope on public.care_memberships(user_id,workspace_id,status);
create table public.care_invitations (
  id text primary key, workspace_id text not null references public.care_workspaces(id), token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  email text not null check(email=lower(email)), role text not null check(role in ('coordinator','senior','family','operations')),
  senior_id text not null default '', scope_json text not null check(jsonb_typeof(scope_json::jsonb)='array' and jsonb_array_length(scope_json::jsonb)>0),
  created_by text not null, status text not null check(status in ('pending','accepted','revoked')), expires_at bigint not null,
  redeemed_by text, created_at text not null,
  check ((role in ('senior','family') and senior_id ~ '^S[0-9]{3,6}$' and scope_json::jsonb=jsonb_build_array(senior_id)) or (role in ('coordinator','operations') and senior_id=''))
);
create index care_invites_workspace on public.care_invitations(workspace_id,created_at desc);
create table public.demo_sessions (id text primary key,owner text not null,role text not null,senior_id text not null default '',expires_at bigint not null);
create index care_sessions_owner on public.demo_sessions(owner,expires_at);
create table public.care_events (
 id text primary key, owner text not null check(owner='workspace:primary'), kind text not null, senior_id text not null default '',
 payload jsonb not null check(jsonb_typeof(payload)='object'), created_at text not null,
 sequence bigint generated always as identity unique
);
create index care_events_scope_time on public.care_events(owner,senior_id,created_at desc,sequence desc);
create index care_events_kind_time on public.care_events(owner,kind,created_at desc,sequence desc);
create index care_events_room on public.care_events(owner,(payload->>'roomId'),sequence) where kind='voice_signal';
create table public.care_profiles (owner text not null,senior_id text not null,name text not null,profile jsonb not null,updated_at text not null,primary key(owner,senior_id));
create table public.care_consents (owner text not null,senior_id text not null,family_allowed boolean not null default false,actor_id text not null,updated_at text not null,primary key(owner,senior_id));
create table public.care_vitals (event_id text primary key references public.care_events(id) on delete cascade,owner text not null,senior_id text not null,record_date date not null,systolic numeric,diastolic numeric,glucose numeric,spo2 numeric,weight numeric,record jsonb not null);
create index care_vitals_senior_date on public.care_vitals(owner,senior_id,record_date desc);
create table public.care_medication_logs (event_id text primary key references public.care_events(id) on delete cascade,owner text not null,senior_id text not null,record_date date not null,scheduled_count integer,taken_count integer,doses jsonb not null default '[]',record jsonb not null);
create index care_medications_senior_date on public.care_medication_logs(owner,senior_id,record_date desc);
create table public.care_notes (event_id text primary key references public.care_events(id) on delete cascade,owner text not null,senior_id text not null,record_date date not null,note text not null,source text,cues jsonb not null default '[]');
create index care_notes_senior_date on public.care_notes(owner,senior_id,record_date desc);
create table public.care_runtime (id text primary key,owner text not null,mode text not null check(mode in ('replay','live')),as_of_date text not null,timezone text not null,updated_at text not null);
create table public.care_daily_scores (owner text not null,senior_id text not null,score_date text not null,revision text not null,payload jsonb not null,computed_at text not null,primary key(owner,senior_id,score_date));
create index care_scores_date on public.care_daily_scores(owner,score_date desc,senior_id);
create table public.care_jobs (id text primary key,owner text not null,kind text not null,job_date text not null,status text not null,result_json jsonb not null default '{}',created_at text not null,completed_at text);
create index care_jobs_owner_date on public.care_jobs(owner,job_date desc);
create table public.care_deliveries (id text primary key,owner text not null,senior_id text not null,recipient_role text not null,user_id text,kind text not null,channel text not null,status text not null,payload jsonb not null,source_id text,created_at text not null,delivered_at text,read_at text,last_error text,attempts integer not null default 0,claimed_at text);
create index care_delivery_recipient on public.care_deliveries(owner,user_id,created_at desc);
create index care_delivery_scope on public.care_deliveries(owner,senior_id,recipient_role,created_at desc);
create table public.care_push_subscriptions (id text primary key,owner text not null,user_id text not null,endpoint text not null,subscription_json jsonb not null,created_at text not null,disabled integer not null default 0);
create unique index care_push_endpoint on public.care_push_subscriptions(user_id,endpoint);

-- Private lookup helpers deliberately bypass recursive membership policies.
-- They always bind the caller to auth.uid(), never user_metadata or caller arguments.
create function private.care_service() returns boolean language sql stable security invoker set search_path='' as $$select current_setting('role',true)='service_role'$$;
create function private.care_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.user_id=auth.uid()::text and m.status='active' and m.is_admin=1)
$$;
create function private.care_has(sid text,roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.user_id=auth.uid()::text and m.status='active' and m.role=any(roles) and (sid='' or m.senior_id=sid or m.scope_json::jsonb ? '*' or m.scope_json::jsonb ? sid))
$$;
create function private.care_family_allowed(sid text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.care_consents c where c.owner='workspace:primary' and c.senior_id=sid and c.family_allowed)
$$;
create function private.care_voice_room(p jsonb,sid text,signals boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.care_has(sid,array['coordinator','senior','family'])
 and (not private.care_has(sid,array['family']) or private.care_has(sid,array['coordinator','senior']) or private.care_family_allowed(sid))
 and (p->>'createdBy'=auth.uid()::text or p->>'peerId'=auth.uid()::text or (not signals and p->>'peerId' is null and ((p->>'createdByRole'='coordinator' and private.care_has(sid,array['senior','family'])) or (p->>'createdByRole' in ('senior','family') and private.care_has(sid,array['coordinator'])))))
 and (not ((p->>'createdByRole'='family') or (p->>'peerRole'='family')) or private.care_family_allowed(sid))
$$;
create function private.care_signal_room(room_id text,sid text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.care_events e where e.id=room_id and e.kind='voice_room' and e.senior_id=sid and private.care_voice_room(e.payload,sid,true) and e.payload->>'status'<>'ended' and (e.payload->>'expiresAt')::bigint > extract(epoch from now())*1000)
$$;
create function private.care_event_read(k text,sid text,p jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and case
 when k='voice_signal' then private.care_signal_room(p->>'roomId',sid)
 when k='voice_room' then private.care_voice_room(p,sid,false)
 when k='audit' then private.care_admin() or (sid<>'' and private.care_has(sid,array['coordinator']))
 when k='ivr_session' then private.care_has(sid,array['coordinator']) or (private.care_has(sid,array['senior']) and p#>>'{state,userId}'=auth.uid()::text)
 when k='communication' then private.care_has(sid,array['coordinator','operations']) or ((private.care_has(sid,array['senior']) or (private.care_has(sid,array['family']) and private.care_family_allowed(sid))) and (p->>'senderId'=auth.uid()::text or private.care_has(sid,array[p->>'recipientRole'])))
 when k='communication_read' then private.care_has(sid,array['coordinator','operations']) or p->>'userId'=auth.uid()::text
 when k='consent' then private.care_has(sid,array['coordinator','operations','senior'])
 when k='alert_policy' then private.care_has('',array['coordinator','operations'])
 else private.care_has(sid,array['coordinator','operations']) or (sid<>'' and k='signal' and private.care_has(sid,array['senior'])) end
$$;
create function private.care_event_write(k text,sid text,p jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and case
 when k='audit' then private.care_has(sid,array['coordinator','operations','senior','family'])
 when k='consent' then sid<>'' and private.care_has(sid,array['coordinator','senior']) and jsonb_typeof(p->'allowed')='boolean'
 when k='signal' then sid<>'' and (private.care_has(sid,array['coordinator','senior']) or (private.care_has(sid,array['family']) and private.care_family_allowed(sid) and p->>'type'='note' and p#>>'{record,source}'='family-message'))
 when k='task' then sid<>'' and private.care_has(sid,array['coordinator','senior'])
 when k='ivr_session' then private.care_has(sid,array['coordinator','senior']) and p#>>'{state,userId}'=auth.uid()::text
 when k='communication' then p->>'senderId'=auth.uid()::text and private.care_has(sid,array[p->>'senderRole']) and (private.care_has(sid,array['coordinator','operations']) or (p->>'recipientRole'='coordinator' and p->>'channel'='in_app' and (private.care_has(sid,array['senior']) or (private.care_has(sid,array['family']) and private.care_family_allowed(sid)))))
 when k='communication_read' then p->>'userId'=auth.uid()::text and private.care_has(sid,array['coordinator','operations','senior','family']) and (not private.care_has(sid,array['family']) or private.care_has(sid,array['coordinator','operations','senior']) or private.care_family_allowed(sid))
 when k='voice_room' then private.care_voice_room(p,sid,false)
 when k='voice_signal' then p->>'senderId'=auth.uid()::text and private.care_signal_room(p->>'roomId',sid)
 when k='alert_policy' then private.care_admin()
 else private.care_has(sid,array['coordinator']) end
$$;

alter table private.care_settings enable row level security;
do $$ declare t text; begin foreach t in array array['care_workspaces','care_memberships','care_invitations','demo_sessions','care_events','care_profiles','care_consents','care_vitals','care_medication_logs','care_notes','care_runtime','care_daily_scores','care_jobs','care_deliveries','care_push_subscriptions'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
create policy workspace_read on public.care_workspaces for select to authenticated using(id='primary');
create policy members_read on public.care_memberships for select to authenticated using(user_id=(select auth.uid())::text or (select private.care_admin()));
create policy members_revoke on public.care_memberships for update to authenticated using((select private.care_admin()) and user_id<>(select auth.uid())::text) with check(status='revoked' and user_id<>(select auth.uid())::text);
create policy invitations_read on public.care_invitations for select to authenticated using((select private.care_admin()));
create policy invitations_create on public.care_invitations for insert to authenticated with check((select private.care_admin()) and created_by=(select auth.uid())::text and status='pending' and workspace_id='primary');
create policy sessions_read on public.demo_sessions for select to authenticated using(owner=(select auth.uid())::text);
create policy sessions_insert on public.demo_sessions for insert to authenticated with check(owner=(select auth.uid())::text and private.care_has(senior_id,array[role]) and expires_at <= extract(epoch from now())*1000+86500000);
create policy sessions_delete on public.demo_sessions for delete to authenticated using(owner=(select auth.uid())::text or (select private.care_admin()));
create policy events_read on public.care_events for select to authenticated using(private.care_event_read(kind,senior_id,payload));
create policy events_insert on public.care_events for insert to authenticated with check(private.care_event_write(kind,senior_id,payload));
create policy events_update on public.care_events for update to authenticated using((kind='task' and private.care_has(senior_id,array['coordinator'])) or (kind='ivr_session' and private.care_event_read(kind,senior_id,payload)) or (kind='voice_room' and private.care_voice_room(payload,senior_id,false))) with check(private.care_event_write(kind,senior_id,payload));
create policy events_delete on public.care_events for delete to authenticated using(kind='voice_signal' and private.care_event_read(kind,senior_id,payload));
create policy profiles_read on public.care_profiles for select to authenticated using(private.care_has(senior_id,array['coordinator','operations','senior']) or (private.care_has(senior_id,array['family']) and private.care_family_allowed(senior_id)));
create policy profiles_write on public.care_profiles for all to authenticated using(private.care_has(senior_id,array['coordinator'])) with check(private.care_has(senior_id,array['coordinator']));
create policy consents_read on public.care_consents for select to authenticated using(private.care_has(senior_id,array['coordinator','operations','senior','family']));
create policy consents_insert on public.care_consents for insert to authenticated with check(private.care_has(senior_id,array['coordinator','senior']) and actor_id=(select auth.uid())::text);
create policy consents_update on public.care_consents for update to authenticated using(private.care_has(senior_id,array['coordinator','senior'])) with check(private.care_has(senior_id,array['coordinator','senior']) and actor_id=(select auth.uid())::text);
do $$ declare t text; begin foreach t in array array['care_vitals','care_medication_logs','care_notes'] loop
 execute format('create policy clinical_read on public.%I for select to authenticated using(private.care_has(senior_id,array[''coordinator'',''operations'',''senior'']))',t);
 end loop; end $$;
create policy runtime_read on public.care_runtime for select to authenticated using(private.care_has('',array['coordinator','operations','senior','family']));
create policy runtime_write on public.care_runtime for all to authenticated using((select private.care_admin())) with check((select private.care_admin()));
-- Scores contain staff detail. Family/senior-safe representations are served only by care_workflow.
create policy scores_staff on public.care_daily_scores for all to authenticated using(private.care_has(senior_id,array['coordinator','operations'])) with check(private.care_has(senior_id,array['coordinator']));
create policy jobs_staff on public.care_jobs for all to authenticated using(private.care_has('',array['coordinator','operations'])) with check(private.care_has('',array['coordinator']));
create policy deliveries_read on public.care_deliveries for select to authenticated using(private.care_has(senior_id,array['coordinator','operations']) or (status in ('delivered','read') and user_id=(select auth.uid())::text and private.care_has(senior_id,array[recipient_role]) and (recipient_role<>'family' or private.care_family_allowed(senior_id))));
create policy deliveries_insert on public.care_deliveries for insert to authenticated with check(private.care_has(senior_id,array['coordinator']));
create policy deliveries_update on public.care_deliveries for update to authenticated using(private.care_has(senior_id,array['coordinator'])) with check(private.care_has(senior_id,array['coordinator']));
create policy push_read on public.care_push_subscriptions for select to authenticated using(user_id=(select auth.uid())::text);
create policy push_insert on public.care_push_subscriptions for insert to authenticated with check(user_id=(select auth.uid())::text and private.care_has('',array['coordinator','operations','senior','family']));
create policy push_update on public.care_push_subscriptions for update to authenticated using(user_id=(select auth.uid())::text) with check(user_id=(select auth.uid())::text);
create policy push_delete on public.care_push_subscriptions for delete to authenticated using(user_id=(select auth.uid())::text);

-- Immutable envelope + participant invariants also apply to direct REST callers.
create function private.care_event_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.id<>old.id or new.owner<>old.owner or new.kind<>old.kind or new.senior_id<>old.senior_id or new.created_at<>old.created_at then raise insufficient_privilege using message='Event envelope is immutable'; end if;
 if old.kind='voice_room' then
  if (new.payload-array['peerId','peerRole','status','endedAt'])<>(old.payload-array['peerId','peerRole','status','endedAt']) then raise insufficient_privilege using message='Voice room identity is immutable'; end if;
  if old.payload->>'status'='ended' then raise insufficient_privilege using message='Voice room ended'; end if;
  if new.payload->>'status'<>'ended' and ((new.payload->>'peerId') is distinct from auth.uid()::text or not private.care_has(old.senior_id,array[new.payload->>'peerRole']) or (old.payload->>'peerId' is not null and old.payload->>'peerId'<>auth.uid()::text)) then raise insufficient_privilege using message='Invalid voice room participant'; end if;
 end if;
 if old.kind='ivr_session' and ((new.payload->'state'-array['step','answers','complete','mood','note','helpRequested','callRequested','requiresHumanReview'])<>(old.payload->'state'-array['step','answers','complete','mood','note','helpRequested','callRequested','requiresHumanReview'])) then raise insufficient_privilege using message='Check-in identity is immutable'; end if;
 return new;
end $$;
create trigger care_event_immutable before update on public.care_events for each row execute function private.care_event_guard();

-- Normalize accepted inputs in the same transaction as their event.
create function private.care_project_event() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb:=new.payload->'record';
begin
 if auth.uid() is null and not private.care_service() then raise insufficient_privilege; end if;
 if new.kind='consent' then insert into public.care_consents(owner,senior_id,family_allowed,actor_id,updated_at) values(new.owner,new.senior_id,(new.payload->>'allowed')::boolean,coalesce(auth.uid()::text,'background-job'),new.created_at) on conflict(owner,senior_id) do update set family_allowed=excluded.family_allowed,actor_id=excluded.actor_id,updated_at=excluded.updated_at;
 elsif new.kind='signal' and r->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then
  if new.payload->>'type'='vitals' then insert into public.care_vitals values(new.id,new.owner,new.senior_id,(r->>'date')::date,(r#>>'{vitals,systolic}')::numeric,(r#>>'{vitals,diastolic}')::numeric,(r#>>'{vitals,glucose}')::numeric,(r#>>'{vitals,spo2}')::numeric,(r#>>'{vitals,weight}')::numeric,r);
  elsif new.payload->>'type'='medication' then insert into public.care_medication_logs values(new.id,new.owner,new.senior_id,(r->>'date')::date,(r#>>'{medication,prescribed}')::integer,(r#>>'{medication,taken}')::integer,coalesce(r#>'{medication,doses}','[]'),r);
  elsif new.payload->>'type'='note' then insert into public.care_notes values(new.id,new.owner,new.senior_id,(r->>'date')::date,coalesce(r->>'note',''),r->>'source',coalesce(new.payload->'cues','[]'));
  end if;
 end if;
 return new;
end $$;
create trigger care_event_project after insert on public.care_events for each row execute function private.care_project_event();

create function private.care_bootstrap() returns boolean language plpgsql security definer set search_path='' as $$
declare uid text:=auth.uid()::text; mail text; role_name text; stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 if uid is null then return false; end if;
 select lower(u.email) into mail from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
 if mail is null or mail<>(select value from private.care_settings where key='bootstrap_owner_email') then return false; end if;
 perform pg_advisory_xact_lock(hashtext('samarth-bootstrap'));
 if exists(select 1 from public.care_workspaces where id='primary') then return false; end if;
 insert into public.care_workspaces values('primary',uid,stamp);
 foreach role_name in array array['coordinator','operations','senior','family'] loop
 insert into public.care_memberships values('owner-'||role_name,'primary',uid,mail,split_part(mail,'@',1),role_name,case when role_name in ('senior','family') then 'S001' else '' end,case when role_name in ('senior','family') then '["S001"]' else '["*"]' end,1,'active',stamp);
 end loop;
 return true;
end $$;
create function public.care_bootstrap_owner() returns boolean language sql security invoker set search_path='' as $$select private.care_bootstrap()$$;
create function private.care_claim(token text,display text) returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.care_invitations; mail text; uid text:=auth.uid()::text;
begin
 if uid is null then raise insufficient_privilege; end if;
 select lower(email) into mail from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if mail is null then raise insufficient_privilege using message='Verified email required'; end if;
 select * into invitation from public.care_invitations where token_hash=token and workspace_id='primary' for update;
 if invitation.id is null or invitation.status<>'pending' or invitation.expires_at<=extract(epoch from now())*1000 then return jsonb_build_object('ok',false); end if;
 if invitation.email<>mail then raise insufficient_privilege using message='Invited email does not match verified account'; end if;
 -- Invitation owner must still hold administrator access when the invitation is claimed.
 if not exists(select 1 from public.care_memberships where user_id=invitation.created_by and workspace_id='primary' and status='active' and is_admin=1) then return jsonb_build_object('ok',false); end if;
 insert into public.care_memberships values('invite-'||invitation.id,'primary',uid,mail,left(display,120),invitation.role,invitation.senior_id,invitation.scope_json,0,'active',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) on conflict do nothing;
 update public.care_invitations set status='accepted',redeemed_by=uid where id=invitation.id;
 return jsonb_build_object('ok',true,'role',invitation.role);
end $$;
create function public.care_accept_invitation(token_hash text,display_name text) returns jsonb language sql security invoker set search_path='' as $$select private.care_claim(token_hash,display_name)$$;

-- Application compatibility RPC: fixed statements only; executes with caller RLS.
create function public.care_store_batch(commands jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cmd jsonb; a jsonb; op text; out_rows jsonb; changes bigint; result jsonb:='[]';
begin
 if jsonb_typeof(commands)<>'array' or jsonb_array_length(commands)>100 then raise invalid_parameter_value; end if;
 for cmd in select value from jsonb_array_elements(commands) loop
  a:=cmd->'args';op:=cmd->>'op';out_rows:='[]';changes:=0;
  case op
  when 'workspace_get' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into out_rows from (select * from public.care_workspaces where id=a->>0) t;
  when 'members_own' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into out_rows from (select * from public.care_memberships where workspace_id=a->>0 and user_id=a->>1 and status=a->>2 order by created_at,id) t;
  when 'members_list' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into out_rows from (select * from public.care_memberships where workspace_id=a->>0 order by created_at desc limit 1000) t;
  when 'members_get' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into out_rows from (select * from public.care_memberships where id=a->>0 and workspace_id=a->>1) t;
  when 'members_revoke' then update public.care_memberships set status=a->>0 where workspace_id=a->>1 and user_id=a->>2 and role=a->>3 and senior_id=a->>4;get diagnostics changes=row_count;
  when 'session_get' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into out_rows from (select * from public.demo_sessions where id=a->>0 and owner=a->>1 and expires_at>(a->>2)::bigint) t;
  when 'session_insert' then insert into public.demo_sessions values(a->>0,a->>1,a->>2,a->>3,(a->>4)::bigint);get diagnostics changes=row_count;
  when 'session_delete' then delete from public.demo_sessions where id=a->>0 and owner=a->>1;get diagnostics changes=row_count;
  when 'session_expire' then delete from public.demo_sessions where owner=a->>0 and expires_at<=(a->>1)::bigint;get diagnostics changes=row_count;
  when 'session_revoke' then delete from public.demo_sessions where owner=a->>0;get diagnostics changes=row_count;
  when 'invites_list' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into out_rows from (select id,email,role,senior_id,status,expires_at,created_at from public.care_invitations where workspace_id=a->>0 order by created_at desc limit 100) t;
  when 'invites_get' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into out_rows from (select * from public.care_invitations where token_hash=a->>0 and workspace_id=a->>1) t;
  when 'invites_insert' then insert into public.care_invitations(id,workspace_id,token_hash,email,role,senior_id,scope_json,created_by,status,expires_at,created_at) values(a->>0,a->>1,a->>2,a->>3,a->>4,a->>5,a->>6,a->>7,a->>8,(a->>9)::bigint,a->>10);get diagnostics changes=row_count;
  when 'event_insert' then insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(a->>0,a->>1,a->>2,a->>3,(a->>4)::jsonb,a->>5);get diagnostics changes=row_count;
  when 'events_list' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into out_rows from (select id,kind,senior_id,payload::text as payload,created_at from public.care_events where owner=a->>0 order by created_at,sequence limit 5000) t;
  when 'event_get' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into out_rows from (select id,senior_id,payload::text as payload,created_at from public.care_events where id=a->>0 and owner=a->>1 and kind=a->>2) t;
  when 'event_update' then update public.care_events set payload=(a->>0)::jsonb where id=a->>1 and owner=a->>2 and kind=a->>3;get diagnostics changes=row_count;
  when 'ivr_advance' then update public.care_events set payload=(a->>0)::jsonb where id=a->>1 and owner=a->>2 and kind=a->>3 and (payload#>>'{state,step}')::integer=(a->>4)::integer;get diagnostics changes=row_count;
  when 'ivr_insert_once' then insert into public.care_events(id,owner,kind,senior_id,payload,created_at) select a->>0,a->>1,a->>2,a->>3,(a->>4)::jsonb,a->>5 where exists(select 1 from public.care_events where id=a->>6 and owner=a->>7 and kind=a->>8 and payload=(a->>9)::jsonb) on conflict do nothing;get diagnostics changes=row_count;
  when 'events_expire' then delete from public.care_events where owner=a->>0 and kind=a->>1 and created_at<a->>2;get diagnostics changes=row_count;
  when 'voice_signals' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into out_rows from (select id,payload::text as payload from public.care_events where owner=a->>0 and kind=a->>1 and payload->>'roomId'=a->>2 order by created_at,sequence limit 100) t;
  when 'voice_claim' then update public.care_events set payload=payload||jsonb_build_object('peerId',a->>0,'peerRole',a->>1,'status','active') where id=a->>2 and owner=a->>3 and kind=a->>4 and (payload->>'peerId' is null or payload->>'peerId'=a->>5) and payload->>'status'<>'ended' and (payload->>'expiresAt')::bigint>(a->>6)::bigint;get diagnostics changes=row_count;
  when 'voice_end' then update public.care_events set payload=payload||jsonb_build_object('status','ended','endedAt',a->>0) where id=a->>1 and owner=a->>2 and kind=a->>3;get diagnostics changes=row_count;
  when 'voice_cleanup' then delete from public.care_events where owner=a->>0 and kind=a->>1 and payload->>'roomId'=a->>2;get diagnostics changes=row_count;
  when 'voice_signal_type' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into out_rows from (select id from public.care_events where owner=a->>0 and kind=a->>1 and payload->>'roomId'=a->>2 and payload#>>'{payload,type}'=a->>3 limit 1) t;
  when 'voice_count' then select jsonb_build_array(jsonb_build_object('count',count(*))) into out_rows from public.care_events where owner=a->>0 and kind=a->>1 and payload->>'roomId'=a->>2;
  when 'voice_signal_insert' then
   -- Serialize the limit check with room closure and competing signal inserts.
   perform 1 from public.care_events where id=a->>6 for update;
   insert into public.care_events(id,owner,kind,senior_id,payload,created_at) select a->>0,a->>1,a->>2,a->>3,(a->>4)::jsonb,a->>5 where exists(select 1 from public.care_events where id=a->>6 and owner=a->>7 and kind=a->>8 and payload->>'status'<>'ended' and (payload->>'expiresAt')::bigint>(a->>9)::bigint and (payload->>'createdBy'=a->>10 or payload->>'peerId'=a->>11)) and (select count(*) from public.care_events where owner=a->>12 and kind='voice_signal' and payload->>'roomId'=a->>13)<100 on conflict do nothing;get diagnostics changes=row_count;
  else raise invalid_parameter_value using message='Unknown registered care operation';
  end case;
  result:=result||jsonb_build_array(jsonb_build_object('results',out_rows,'meta',jsonb_build_object('changes',changes)));
 end loop;
 return result;
end $$;
create function public.care_events_scan(options jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('results',coalesce(jsonb_agg(to_jsonb(t)),'[]')) from (
 select id,kind,senior_id,payload::text as payload,created_at from public.care_events e
 where e.owner=options->>'owner' and (options->'seniorIds' is null or options->'seniorIds'='null' or e.senior_id='' or options->'seniorIds' ? e.senior_id)
 and (options->'kinds' is null or options->'kinds'='null' or options->'kinds' ? e.kind)
 and (options->>'sinceRecordDate' is null or e.kind<>'signal' or e.payload#>>'{record,date}'>=options->>'sinceRecordDate')
 and (options->>'beforeCreatedAt' is null or e.created_at<options->>'beforeCreatedAt')
 order by case when coalesce((options->>'ascending')::boolean,true) then e.created_at end asc,case when coalesce((options->>'ascending')::boolean,true) then e.sequence end asc,case when not coalesce((options->>'ascending')::boolean,true) then e.created_at end desc,case when not coalesce((options->>'ascending')::boolean,true) then e.sequence end desc
 limit least(5000,greatest(1,coalesce((options->>'limit')::integer,5000)))) t
$$;

-- A carefully bounded private read is needed because full score payloads must
-- never be granted to family accounts through the raw REST table endpoint.
create function private.care_safe_scores(p jsonb,single_row boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare output jsonb;
begin
 if auth.uid() is null and not private.care_service() then raise insufficient_privilege; end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into output from (
  select d.owner,d.senior_id,d.score_date,d.revision,d.computed_at,
  case when private.care_service() or private.care_has(d.senior_id,array['coordinator','operations']) then d.payload
   when private.care_has(d.senior_id,array['senior']) then d.payload->'seniorSafe'
   else d.payload->'familySafe' end as payload
  from public.care_daily_scores d where d.owner=p->>'owner' and d.score_date=p->>'date'
  and (not single_row or d.senior_id=p->>'seniorId')
  and (single_row or (d.revision=p->>'revision' and d.senior_id>coalesce(p->>'cursor','')))
  and (private.care_service() or private.care_has(d.senior_id,array['coordinator','operations'])
   or (private.care_has(d.senior_id,array['senior']) and jsonb_typeof(d.payload->'seniorSafe')='object')
   or (private.care_has(d.senior_id,array['family']) and private.care_family_allowed(d.senior_id) and jsonb_typeof(d.payload->'familySafe')='object'))
  order by d.senior_id limit case when single_row then 1 else least(500,greatest(1,coalesce((p->>'limit')::integer,250))) end
 ) t;
 return case when single_row then output->0 else output end;
end $$;
-- Narrow private helpers expose only the dispatch capability needed by a fresh
-- coordinator assignment. They never make subscription tables broadly readable.
create function private.care_recipient_allowed(uid text) returns boolean language sql stable security definer set search_path='' as $$
 select private.care_service() or exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.user_id=uid and m.status='active' and
 (m.user_id=auth.uid()::text or (m.role='family' and private.care_family_allowed(m.senior_id) and private.care_has(m.senior_id,array['coordinator'])) or
 (m.role in ('coordinator','operations') and private.care_has('',array['coordinator']) and (m.scope_json::jsonb ? '*' or exists(select 1 from jsonb_array_elements_text(m.scope_json::jsonb) sid where private.care_has(sid,array['coordinator']))))))
$$;
create function private.care_recipients(p jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select m.id,m.user_id,''::text as email,''::text as display_name,m.role,m.senior_id,m.scope_json,m.status,m.is_admin from public.care_memberships m where m.workspace_id=coalesce(p->>'workspaceId','primary') and m.workspace_id='primary' and m.status='active' and (private.care_service() or m.user_id=auth.uid()::text or (private.care_has('',array['coordinator']) and private.care_recipient_allowed(m.user_id))) order by m.id limit 2000) t
$$;
create function private.care_recipient_push(p jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare output jsonb;
begin
 if p->>'owner'<>'workspace:primary' or not private.care_recipient_allowed(p->>'userId') then raise insufficient_privilege; end if;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('subscription',t.subscription_json)),'[]') into output from (select * from public.care_push_subscriptions where owner=p->>'owner' and user_id=p->>'userId' and disabled=0 order by created_at desc limit 10) t;
 return output;
end $$;
create function private.care_recipient_push_disable(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p->>'owner'<>'workspace:primary' or not private.care_recipient_allowed(p->>'userId') then raise insufficient_privilege; end if;
 update public.care_push_subscriptions set disabled=1 where owner=p->>'owner' and user_id=p->>'userId' and endpoint=p->>'endpoint';return '{"ok":true}';
end $$;
create function private.care_delivery_read(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p->>'userId' is distinct from auth.uid()::text or p->>'owner'<>'workspace:primary' then raise insufficient_privilege; end if;
 update public.care_deliveries d set status='read',read_at=p->>'readAt' where d.owner=p->>'owner' and d.id=p->>'id' and d.user_id=auth.uid()::text and d.recipient_role=p->>'recipientRole' and d.channel='in_app' and d.status in ('delivered','read') and private.care_has(d.senior_id,array[d.recipient_role]) and (d.recipient_role<>'family' or private.care_family_allowed(d.senior_id));
 return '{"ok":true}';
end $$;
create function public.care_workflow(operation text,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p jsonb:=payload; output jsonb; count_rows integer; r jsonb;
begin
 if auth.uid() is null and not private.care_service() then raise insufficient_privilege; end if;
 if p->>'owner' is distinct from 'workspace:primary' and operation<>'members_get' then raise insufficient_privilege; end if;
 case operation
 when 'runtime_get' then select to_jsonb(t) into output from public.care_runtime t where owner=p->>'owner';
 when 'runtime_set' then
  insert into public.care_runtime(id,owner,mode,as_of_date,timezone,updated_at) values(p->>'owner',p->>'owner',p->>'mode',p->>'date',p->>'timezone',p->>'updatedAt') on conflict(id) do update set mode=excluded.mode,as_of_date=excluded.as_of_date,timezone=excluded.timezone,updated_at=excluded.updated_at;output:='{"ok":true}';
 when 'score_get' then output:=private.care_safe_scores(p,true);
 when 'scores_get' then output:=private.care_safe_scores(p,false);
 when 'scores_put' then
  if jsonb_typeof(p->'scores')<>'array' or jsonb_array_length(p->'scores')>500 then raise invalid_parameter_value; end if;
  insert into public.care_daily_scores(owner,senior_id,score_date,revision,payload,computed_at) select p->>'owner',x->>'seniorId',p->>'date',p->>'revision',x->'payload',p->>'computedAt' from jsonb_array_elements(p->'scores') x on conflict(owner,senior_id,score_date) do update set revision=excluded.revision,payload=excluded.payload,computed_at=excluded.computed_at;get diagnostics count_rows=row_count;output:=jsonb_build_object('count',count_rows);
 when 'consents_get' then select coalesce(jsonb_agg(jsonb_build_object('senior_id',c.senior_id,'allowed',case when c.family_allowed then 1 else 0 end,'updated_at',c.updated_at)),'[]') into output from public.care_consents c where owner=p->>'owner';
 when 'consent_put' then
  insert into public.care_consents(owner,senior_id,family_allowed,actor_id,updated_at) values(p->>'owner',p->>'seniorId',(p->>'allowed')::boolean,coalesce(auth.uid()::text,'background-job'),p->>'updatedAt') on conflict(owner,senior_id) do update set family_allowed=excluded.family_allowed,actor_id=excluded.actor_id,updated_at=excluded.updated_at;output:='{"ok":true}';
 when 'consents_seed' then
  if jsonb_typeof(p->'consents')<>'array' or jsonb_array_length(p->'consents')>500 then raise invalid_parameter_value;end if;
  insert into public.care_consents(owner,senior_id,family_allowed,actor_id,updated_at) select p->>'owner',c->>'seniorId',(c->>'allowed')::boolean,coalesce(auth.uid()::text,'background-job'),p->>'updatedAt' from jsonb_array_elements(p->'consents') c on conflict(owner,senior_id) do nothing;output:='{"ok":true}';
 when 'members_get' then output:=private.care_recipients(p);
 when 'delivery_put' then
  insert into public.care_deliveries(id,owner,senior_id,recipient_role,user_id,kind,channel,status,payload,source_id,created_at,attempts) values(p->>'id',p->>'owner',p->>'seniorId',p->>'recipientRole',p->>'userId',p->>'kind',p->>'channel',coalesce(p->>'status','queued'),p->'payload',p->>'sourceId',p->>'createdAt',0) on conflict do nothing;get diagnostics count_rows=row_count;output:=jsonb_build_object('created',count_rows>0);
 when 'deliveries_get' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into output from (select * from public.care_deliveries d where d.owner=p->>'owner' and (d.created_at<coalesce(p->>'cursor','9999') or (d.created_at=p->>'cursor' and d.id>coalesce(p->>'cursorId',''))) and (p->>'userId' is null or d.user_id=p->>'userId') and (p->>'recipientRole' is null or d.recipient_role=p->>'recipientRole') and (p->'seniorIds' is null or p->'seniorIds'='null' or p->'seniorIds' ? d.senior_id) and (p->'statuses' is null or p->'statuses'='null' or p->'statuses' ? d.status) and (p->>'maxAttempts' is null or d.attempts<(p->>'maxAttempts')::integer) and (p->>'availableBefore' is null or d.status<>'processing' or d.claimed_at<p->>'availableBefore') order by created_at desc,id limit least(500,greatest(1,coalesce((p->>'limit')::integer,250)))) t;
 when 'delivery_get' then select to_jsonb(t) into output from public.care_deliveries t where owner=p->>'owner' and id=p->>'id';
 when 'delivery_update' then
  update public.care_deliveries set status=p->>'status',attempts=coalesce((p->>'attempts')::integer,0),delivered_at=p->>'deliveredAt',read_at=p->>'readAt',last_error=p->>'lastError',claimed_at=null where id=p->>'id' and owner=p->>'owner';output:='{"ok":true}';
 when 'delivery_claim' then
  update public.care_deliveries set status='processing',attempts=attempts+1,claimed_at=p->>'claimedAt' where owner=p->>'owner' and id=p->>'id' and attempts=(p->>'attempts')::integer and attempts<3 and (status in ('queued','failed') or (status='processing' and claimed_at<p->>'expiredBefore'));get diagnostics count_rows=row_count;output:=jsonb_build_object('claimed',count_rows>0);
 when 'delivery_read' then output:=private.care_delivery_read(p);
 when 'alert_seen_put' then
  insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(p->>'id',p->>'owner','alert_seen',p->>'seniorId',jsonb_build_object('alertId',p->>'alertId','firstSeenAt',p->>'firstSeenAt'),p->>'firstSeenAt') on conflict do nothing;
  select e.payload into output from public.care_events e where e.owner=p->>'owner' and e.id=p->>'id' and e.kind='alert_seen';
 when 'push_get' then output:=private.care_recipient_push(p);
 when 'push_put' then
  insert into public.care_push_subscriptions(id,owner,user_id,endpoint,subscription_json,created_at,disabled) values(p->>'id',p->>'owner',p->>'userId',p#>>'{subscription,endpoint}',p->'subscription',p->>'createdAt',0) on conflict(id) do update set subscription_json=excluded.subscription_json,disabled=0;output:='{"ok":true}';
 when 'push_delete' then output:=private.care_recipient_push_disable(p);
 when 'job_get' then select to_jsonb(t) into output from public.care_jobs t where owner=p->>'owner' and id=p->>'id';
 when 'job_put' then
  insert into public.care_jobs(id,owner,kind,job_date,status,result_json,created_at,completed_at) values(p->>'id',p->>'owner','daily',p->>'date',p->>'status',coalesce(p->'result','{}'),p->>'createdAt',p->>'completedAt') on conflict(id) do update set status=excluded.status,result_json=excluded.result_json,completed_at=excluded.completed_at;output:='{"ok":true}';
 else raise invalid_parameter_value using message='Unknown care workflow operation';
 end case;
 return output;
end $$;

revoke all on all tables in schema public from anon,authenticated;
grant select on public.care_workspaces,public.care_memberships,public.care_invitations,public.demo_sessions,public.care_events,public.care_profiles,public.care_consents,public.care_vitals,public.care_medication_logs,public.care_notes,public.care_runtime,public.care_daily_scores,public.care_jobs,public.care_deliveries,public.care_push_subscriptions to authenticated;
grant insert on public.care_invitations,public.demo_sessions,public.care_events,public.care_profiles,public.care_consents,public.care_runtime,public.care_daily_scores,public.care_jobs,public.care_deliveries,public.care_push_subscriptions to authenticated;
grant update(status) on public.care_memberships to authenticated;
grant update on public.care_events,public.care_profiles,public.care_consents,public.care_runtime,public.care_daily_scores,public.care_jobs,public.care_deliveries,public.care_push_subscriptions to authenticated;
grant delete on public.demo_sessions,public.care_events,public.care_push_subscriptions to authenticated;
grant usage,select on sequence public.care_events_sequence_seq to authenticated;
revoke all on all functions in schema private from public,anon;
grant execute on all functions in schema private to authenticated;
revoke all on function public.care_store_batch(jsonb),public.care_events_scan(jsonb),public.care_bootstrap_owner(),public.care_accept_invitation(text,text) from public,anon;
grant execute on function public.care_store_batch(jsonb),public.care_events_scan(jsonb),public.care_bootstrap_owner(),public.care_accept_invitation(text,text) to authenticated;
revoke all on function public.care_workflow(text,jsonb) from public,anon;
grant execute on function public.care_workflow(text,jsonb) to authenticated;

-- Only the deployed background function uses this role. Browser requests retain
-- their verified user's JWT and cannot call the service-only credential RPCs.
grant usage on schema private to service_role;
grant all on all tables in schema public to service_role;
grant usage,select on sequence public.care_events_sequence_seq to service_role;
grant execute on all functions in schema private to service_role;
grant execute on function public.care_store_batch(jsonb),public.care_events_scan(jsonb),public.care_workflow(text,jsonb) to service_role;

create function private.care_job_secret(secret text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 if secret is null or length(secret)<32 or length(secret)>256 then return false;end if;
 return coalesce((select value=encode(sha256(convert_to(secret,'UTF8')),'hex') from private.care_settings where key='job_secret_hash'),false);
end $$;
create function public.care_validate_job_secret(secret text) returns boolean language sql security invoker set search_path='' as $$select private.care_job_secret(secret)$$;
create function private.care_job_config() returns jsonb language plpgsql security definer set search_path='' as $$
declare output jsonb;
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 select coalesce(jsonb_object_agg(case name when 'samarth_vapid_public_key' then 'VAPID_PUBLIC_KEY' when 'samarth_vapid_private_key' then 'VAPID_PRIVATE_KEY' when 'samarth_vapid_subject' then 'VAPID_SUBJECT' end,decrypted_secret),'{}') into output from vault.decrypted_secrets where name in ('samarth_vapid_public_key','samarth_vapid_private_key','samarth_vapid_subject');
 return output;
end $$;
create function public.care_job_configuration() returns jsonb language sql security invoker set search_path='' as $$select private.care_job_config()$$;
revoke all on function private.care_job_secret(text),private.care_job_config(),public.care_validate_job_secret(text),public.care_job_configuration() from public,anon,authenticated;
grant execute on function private.care_job_secret(text),private.care_job_config(),public.care_validate_job_secret(text),public.care_job_configuration() to service_role;
