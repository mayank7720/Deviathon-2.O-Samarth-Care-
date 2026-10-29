-- Operations owns administration. Coordinator and recipient identities stay separate.
create or replace function private.care_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.user_id=auth.uid()::text and m.status='active' and m.role='operations' and m.is_admin=1)
$$;
update public.care_memberships set is_admin=0 where role<>'operations';
update public.care_memberships m set status='revoked' where m.role<>'operations' and m.user_id=(select owner_user_id from public.care_workspaces where id='primary');
delete from public.demo_sessions where owner=(select owner_user_id from public.care_workspaces where id='primary');
alter table public.care_memberships add constraint care_admin_operations_only check(is_admin=0 or role='operations');
create unique index care_one_operations_admin on public.care_memberships(workspace_id) where status='active' and is_admin=1;
create or replace function private.care_has(sid text,roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.user_id=auth.uid()::text and m.status='active' and m.role=any(roles) and (sid='' or m.senior_id=sid or m.scope_json::jsonb ? '*' or m.scope_json::jsonb ? sid))
 or (roles && array['coordinator','operations'] and private.care_admin()))
$$;
create or replace function private.care_bootstrap() returns boolean language plpgsql security definer set search_path='' as $$
declare uid text:=auth.uid()::text; mail text; stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 if uid is null then return false;end if;
 select lower(email) into mail from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if mail is null or mail<>(select value from private.care_settings where key='bootstrap_owner_email') then return false;end if;
 perform pg_advisory_xact_lock(hashtext('samarth-bootstrap'));
 if exists(select 1 from public.care_workspaces where id='primary') then return false;end if;
 insert into public.care_workspaces values('primary',uid,stamp);
 insert into public.care_memberships values('owner-operations','primary',uid,mail,'Operations Manager','operations','','["*"]',1,'active',stamp);
 return true;
end $$;

create table public.care_account_contacts (
 user_id uuid primary key references auth.users(id), phone text check(phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
 sms_consent boolean not null default false, call_consent boolean not null default false,
 recipient_confirmed boolean not null default false, revision integer not null default 0,
 updated_by uuid, updated_at timestamptz not null default now(),
 check(phone is not null or (not sms_consent and not call_consent and not recipient_confirmed))
);
alter table public.care_account_contacts enable row level security;
create policy account_contact_read on public.care_account_contacts for select to authenticated using(user_id=(select auth.uid()) or (select private.care_admin()));
grant select on public.care_account_contacts to authenticated;
grant all on public.care_account_contacts to service_role;
insert into public.care_account_contacts(user_id) select distinct user_id::uuid from public.care_memberships where status='active';

create function public.care_account_directory() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.care_admin() then raise insufficient_privilege;end if;
 return (select coalesce(jsonb_agg(x order by x->>'email'),'[]') from (
 select jsonb_build_object('userId',u.id,'email',u.email,'name',min(m.display_name),'roles',jsonb_agg(distinct m.role),
 'seniorIds',coalesce(jsonb_agg(distinct m.senior_id) filter(where m.senior_id<>''),'[]'),
 'maskedPhone',case when c.phone is null then null else left(c.phone,3)||'••••'||right(c.phone,3) end,
 'smsConsent',coalesce(c.sms_consent,false),'callConsent',coalesce(c.call_consent,false),'recipientConfirmed',coalesce(c.recipient_confirmed,false)) x
 from auth.users u join public.care_memberships m on m.user_id=u.id::text and m.workspace_id='primary' and m.status='active'
 left join public.care_account_contacts c on c.user_id=u.id group by u.id,c.phone,c.sms_consent,c.call_consent,c.recipient_confirmed) t);
end $$;

create function public.care_set_account_phone(target_user_id uuid,mobile text,sms_allowed boolean,call_allowed boolean,recipient_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.care_account_contacts%rowtype; m record; sid text; identity text; contact jsonb; stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 if not private.care_admin() then raise insufficient_privilege;end if;
 if not exists(select 1 from public.care_memberships where workspace_id='primary' and user_id=target_user_id::text and status='active') then raise invalid_parameter_value;end if;
 if mobile is not null and (mobile !~ '^\+[1-9][0-9]{7,14}$' or recipient_confirmed is distinct from true) then raise invalid_parameter_value;end if;
 insert into public.care_account_contacts(user_id,phone,sms_consent,call_consent,recipient_confirmed,revision,updated_by)
 values(target_user_id,mobile,mobile is not null and sms_allowed,mobile is not null and call_allowed,mobile is not null and recipient_confirmed,1,auth.uid())
 on conflict(user_id) do update set phone=excluded.phone,sms_consent=excluded.sms_consent,call_consent=excluded.call_consent,recipient_confirmed=excluded.recipient_confirmed,revision=care_account_contacts.revision+1,updated_by=auth.uid(),updated_at=now() returning * into c;
 if mobile is not null then
  for m in select distinct role,senior_id,scope_json from public.care_memberships where workspace_id='primary' and user_id=target_user_id::text and status='active' loop
   for sid in select distinct s.senior_id from public.care_memberships s where s.role='senior' and s.status='active' and s.workspace_id='primary'
    and ((m.role in ('senior','family') and s.senior_id=m.senior_id) or (m.role in ('coordinator','operations') and (m.scope_json::jsonb ? '*' or m.scope_json::jsonb ? s.senior_id))) loop
    identity:='acct-'||target_user_id::text||'-'||left(m.role,1)||'-'||sid||'-'||c.revision;
    contact:=jsonb_build_object('id',identity,'seniorId',sid,'role',m.role,'phone',mobile,'verified',true,'smsConsent',c.sms_consent,'callConsent',c.call_consent,'userId',target_user_id,'revision',c.revision);
    insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','telephony_contact',sid,jsonb_build_object('contact',contact,'actorId',auth.uid(),'verification','Administrator confirmed account recipient and channel consent'),stamp);
   end loop;
  end loop;
 end if;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','audit','',jsonb_build_object('action','account_phone_updated','actorId',auth.uid(),'targetUserId',target_user_id,'detail','Account contact and channel permissions updated; no message sent.'),stamp);
 return jsonb_build_object('ok',true,'phoneConfigured',mobile is not null);
end $$;

-- Only current account bindings and active assignments are routable. Old versions
-- stay in historical receipts but can never be selected for another dispatch.
create function public.care_account_phone_contacts() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.care_has('',array['coordinator','operations']) then raise insufficient_privilege;end if;
 return (select coalesce(jsonb_agg(e.payload->'contact' order by e.sequence),'[]') from public.care_events e
 join public.care_account_contacts c on c.user_id::text=e.payload#>>'{contact,userId}' and c.phone=e.payload#>>'{contact,phone}' and c.revision::text=e.payload#>>'{contact,revision}' and c.recipient_confirmed
 where e.owner='workspace:primary' and e.kind='telephony_contact' and private.care_has(e.senior_id,array['coordinator','operations'])
 and exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.status='active' and m.user_id=c.user_id::text and m.role=e.payload#>>'{contact,role}' and (m.senior_id=e.senior_id or m.scope_json::jsonb ? '*' or m.scope_json::jsonb ? e.senior_id)));
end $$;

create function private.care_account_job_recipient_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if private.care_service() or new.kind not in ('telephony_job','sim_call_job') or coalesce(new.payload->>'status','') not in ('queued','processing','submitting','dialing') then return new;end if;
 if not exists(select 1 from jsonb_array_elements(public.care_account_phone_contacts()) c where c->>'id'=new.payload->>'contactId' and c->>'seniorId'=new.senior_id and c->>'role'=new.payload->>'recipientRole') then
  raise insufficient_privilege using message='Choose the current active account contact; old or unassigned numbers cannot be dispatched';
 end if;
 return new;
end $$;
create trigger care_account_job_recipient_guard before insert or update on public.care_events for each row execute function private.care_account_job_recipient_guard();

-- Extend the existing fixed-template delivery guards without weakening leases,
-- transition checks, HMAC evidence or destination consent.
do $$ declare source text;begin
 source:=pg_get_functiondef('private.care_android_job_guard()'::regprocedure);
 if position('not in (''senior'',''family'')' in source)=0 then raise exception 'Unexpected Android guard revision';end if;
 source:=replace(source,'not in (''senior'',''family'')','not in (''senior'',''family'',''coordinator'',''operations'')');
 execute source;
 source:=pg_get_functiondef('private.care_operations_guard()'::regprocedure);
 source:=replace(source,'m.role=''coordinator''','m.role=''operations'' and m.is_admin=1');execute source;
end $$;

revoke all on function public.care_account_directory(),public.care_set_account_phone(uuid,text,boolean,boolean,boolean),public.care_account_phone_contacts(),private.care_account_job_recipient_guard() from public,anon;
grant execute on function public.care_account_directory(),public.care_set_account_phone(uuid,text,boolean,boolean,boolean),public.care_account_phone_contacts() to authenticated;

create function public.care_finish_showcase_accounts() returns jsonb language plpgsql security definer set search_path='' as $$
declare spec record; ident uuid; sid text; stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 if not private.care_service() then raise insufficient_privilege;end if;
 for spec in select * from (values
  ('coordinator@samarth.test','Care Coordinator','coordinator',array['']::text[]),
  ('family@samarth.test','Family Member','family',array['S001','S002']::text[]),
  ('senior1@samarth.test','Senior Member 1','senior',array['S001']::text[]),
  ('senior2@samarth.test','Senior Member 2','senior',array['S002']::text[])) as x(email,label,role_name,senior_ids) loop
  select id into ident from auth.users where email=spec.email and raw_app_meta_data->>'samarth_showcase'='v1';
  if ident is null then raise invalid_parameter_value using message='The expected showcase identity has not been provisioned';end if;
  foreach sid in array spec.senior_ids loop
   insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at)
    values('showcase-'||spec.role_name||'-'||ident::text||'-'||sid,'primary',ident::text,spec.email,spec.label,spec.role_name,sid,
    case when spec.role_name='coordinator' then '["S001","S002"]' else jsonb_build_array(sid)::text end,0,'active',stamp)
    on conflict do nothing;
  end loop;
  insert into public.care_account_contacts(user_id) values(ident) on conflict do nothing;
 end loop;
 return jsonb_build_object('ok',true,'accounts',4,'familyLinks',2);
end $$;
revoke all on function public.care_finish_showcase_accounts() from public,anon,authenticated;
grant execute on function public.care_finish_showcase_accounts() to service_role;
