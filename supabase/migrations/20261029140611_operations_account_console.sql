create table public.care_account_settings (
 user_id uuid primary key references auth.users(id), enabled boolean not null default true,
 credentials_valid_after bigint not null default 0, updated_at timestamptz not null default now()
);
alter table public.care_account_settings enable row level security;
grant all on public.care_account_settings to service_role;
create function private.care_actor_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not exists(select 1 from public.care_account_settings s where s.user_id=auth.uid() and
 (not s.enabled or coalesce((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'iat')::bigint,0)<s.credentials_valid_after))
$$;
revoke all on function private.care_actor_enabled() from public,anon;
grant execute on function private.care_actor_enabled() to authenticated;
create function private.care_account_self_state() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',coalesce((select enabled from public.care_account_settings where user_id=auth.uid()),true),'reauthenticationRequired',coalesce((select enabled from public.care_account_settings where user_id=auth.uid()),true) and not private.care_actor_enabled())
$$;
create function public.care_account_self_state() returns jsonb language sql security invoker set search_path='' as $$select private.care_account_self_state()$$;
revoke all on function private.care_account_self_state(),public.care_account_self_state() from public,anon;
grant execute on function private.care_account_self_state(),public.care_account_self_state() to authenticated;
create or replace function private.care_admin() returns boolean language sql stable security definer set search_path='' as $$
 select private.care_actor_enabled() and exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.user_id=auth.uid()::text and m.status='active' and m.role='operations' and m.is_admin=1)
$$;
create or replace function private.care_has(sid text,roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select private.care_actor_enabled() and (exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.user_id=auth.uid()::text and m.status='active' and m.role=any(roles) and (sid='' or m.senior_id=sid or m.scope_json::jsonb ? '*' or m.scope_json::jsonb ? sid)) or (roles && array['coordinator','operations'] and private.care_admin()))
$$;
create policy enabled_membership_reader on public.care_memberships as restrictive for select to authenticated using((select private.care_actor_enabled()));

create table private.care_account_admin_requests (
 id uuid primary key, actor_id uuid not null, action text not null, request_hash text not null,
 status text not null default 'processing', result jsonb not null default '{}',created_at timestamptz not null default now()
);
alter table private.care_account_admin_requests enable row level security;

create function private.care_require_account_actor(actor_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.care_service() or not exists(select 1 from public.care_memberships m left join public.care_account_settings s on s.user_id=actor_id where m.user_id=actor_id::text and m.workspace_id='primary' and m.status='active' and m.role='operations' and m.is_admin=1 and coalesce(s.enabled,true)) then raise insufficient_privilege;end if;
end $$;
create function public.care_admin_request(actor_id uuid,request_id uuid,operation text,request_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare item private.care_account_admin_requests%rowtype;
begin
 perform private.care_require_account_actor(actor_id);
 if operation not in ('create','assign','password') or request_hash!~'^[a-f0-9]{64}$' then raise invalid_parameter_value;end if;
 insert into private.care_account_admin_requests(id,actor_id,action,request_hash) values(request_id,actor_id,operation,request_hash) on conflict do nothing;
 select * into item from private.care_account_admin_requests where id=request_id for update;
 if item.actor_id<>actor_id or item.action<>operation or item.request_hash<>request_hash then raise unique_violation;end if;
 if item.status='completed' then return jsonb_build_object('fresh',false,'status','completed','result',item.result);end if;
 -- The insertion owns the request only once, even across concurrent retries.
 if item.result ? 'claimed' then return jsonb_build_object('fresh',false,'status','processing');end if;
 update private.care_account_admin_requests set result='{"claimed":true}' where id=request_id;
 return jsonb_build_object('fresh',true,'status','processing');
end $$;
create function public.care_admin_find_user(actor_id uuid,account_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare item auth.users%rowtype;begin
 perform private.care_require_account_actor(actor_id);
 select * into item from auth.users where lower(email)=lower(account_email);
 if item.id is null then return null;end if;
 return jsonb_build_object('userId',item.id,'email',item.email,'confirmed',item.email_confirmed_at is not null);
end $$;

create function private.care_sync_account_contacts(target_user_id uuid,actor_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.care_account_contacts%rowtype;m record;sid text;identity text;stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');begin
 select * into c from public.care_account_contacts where user_id=target_user_id for update;
 if c.phone is null then return;end if;
 update public.care_account_contacts set revision=revision+1 where user_id=target_user_id returning * into c;
 for m in select distinct role,senior_id,scope_json from public.care_memberships where workspace_id='primary' and user_id=target_user_id::text and status='active' loop
  for sid in select distinct senior_id from public.care_daily_scores where (m.role in ('senior','family') and senior_id=m.senior_id) or (m.role in ('coordinator','operations') and (m.scope_json::jsonb ? '*' or m.scope_json::jsonb ? senior_id)) loop
   identity:='acct-'||target_user_id::text||'-'||left(m.role,1)||'-'||sid||'-'||c.revision;
   insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','telephony_contact',sid,jsonb_build_object('contact',jsonb_build_object('id',identity,'seniorId',sid,'role',m.role,'phone',c.phone,'verified',c.recipient_confirmed,'smsConsent',c.sms_consent,'callConsent',c.call_consent,'userId',target_user_id,'revision',c.revision),'actorId',actor_id),stamp);
  end loop;
 end loop;
end $$;

create function public.care_admin_apply(actor_id uuid,target_user_id uuid,operation text,details jsonb,request_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text:=details->>'role'; sid text; scope_value jsonb; label text; mail text; stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); protected boolean;outcome jsonb;
begin
 perform private.care_require_account_actor(actor_id);
 if operation not in ('create','assign','update','suspend','restore','password') or jsonb_typeof(details)<>'object' then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('account:'||target_user_id::text,0));
 select email into mail from auth.users where id=target_user_id;if mail is null then raise invalid_parameter_value;end if;
 select exists(select 1 from public.care_memberships where user_id=target_user_id::text and status='active' and is_admin=1) into protected;
 if protected and (operation<>'update' or role_name is not null) then raise insufficient_privilege using message='The sole administrator cannot be suspended, reassigned or reset from this console';end if;
 if details ? 'isAdmin' then raise insufficient_privilege;end if;
 label:=nullif(btrim(details->>'name'),'');
 if label is not null and length(label) not between 2 and 80 then raise invalid_parameter_value;end if;
 if operation='create' or operation='assign' or operation='update' and role_name is not null then
  if role_name not in ('senior','family','coordinator','operations') or jsonb_typeof(details->'seniorIds')<>'array' or jsonb_array_length(details->'seniorIds')>200 then raise invalid_parameter_value;end if;
  if coalesce((details->>'allSeniors')::boolean,false) then
   if role_name not in ('coordinator','operations') or jsonb_array_length(details->'seniorIds')<>0 then raise invalid_parameter_value;end if;scope_value:='["*"]';
  else
   scope_value:=details->'seniorIds';
   if jsonb_array_length(scope_value)=0 or (role_name='senior' and jsonb_array_length(scope_value)<>1) then raise invalid_parameter_value;end if;
   for sid in select jsonb_array_elements_text(scope_value) loop if not exists(select 1 from public.care_daily_scores where senior_id=sid) then raise invalid_parameter_value using message='Choose an existing senior';end if;end loop;
  end if;
  if operation='assign' and role_name='senior' and exists(select 1 from public.care_memberships where user_id=target_user_id::text and role='senior' and status='active' and senior_id<>(scope_value->>0)) then raise invalid_parameter_value using message='Use edit access to replace an existing senior link';end if;
  if operation='update' then update public.care_memberships set status='revoked' where user_id=target_user_id::text and workspace_id='primary' and role=role_name and status='active';end if;
  if role_name in ('coordinator','operations') then
   if operation='assign' then select case when scope_json::jsonb ? '*' or scope_value ? '*' then '["*"]'::jsonb else (select jsonb_agg(distinct x) from jsonb_array_elements(scope_json::jsonb||scope_value)x) end into scope_value from public.care_memberships where user_id=target_user_id::text and role=role_name and status='active';scope_value:=coalesce(scope_value,case when coalesce((details->>'allSeniors')::boolean,false) then '["*"]'::jsonb else details->'seniorIds' end);end if;
   insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values(gen_random_uuid()::text,'primary',target_user_id::text,mail,coalesce(label,split_part(mail,'@',1)),role_name,'',scope_value::text,0,'active',stamp)
   on conflict(workspace_id,user_id,role,senior_id) where status='active' do update set scope_json=excluded.scope_json;
  else
   for sid in select distinct jsonb_array_elements_text(scope_value) loop
    insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values(gen_random_uuid()::text,'primary',target_user_id::text,mail,coalesce(label,split_part(mail,'@',1)),role_name,sid,jsonb_build_array(sid)::text,0,'active',stamp) on conflict do nothing;
   end loop;
  end if;
 end if;
 if label is not null then update public.care_memberships set display_name=label where user_id=target_user_id::text and workspace_id='primary';end if;
 insert into public.care_account_settings(user_id) values(target_user_id) on conflict do nothing;
 insert into public.care_account_contacts(user_id) values(target_user_id) on conflict do nothing;
 if operation='suspend' then update public.care_account_settings set enabled=false,credentials_valid_after=ceil(extract(epoch from clock_timestamp()))::bigint,updated_at=now() where user_id=target_user_id;end if;
 if operation='restore' then update public.care_account_settings set enabled=true,updated_at=now() where user_id=target_user_id;end if;
 if operation='password' then update public.care_account_settings set credentials_valid_after=ceil(extract(epoch from clock_timestamp()))::bigint,updated_at=now() where user_id=target_user_id;end if;
 if operation in ('suspend','password','update') then delete from public.demo_sessions where owner=target_user_id::text;end if;
 perform private.care_sync_account_contacts(target_user_id,actor_id);
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','audit','',jsonb_build_object('action','account_'||operation,'actorId',actor_id,'targetUserId',target_user_id,'detail','Account administration change recorded; no password or contact number logged.'),stamp);
 outcome:=jsonb_build_object('ok',true,'account',jsonb_build_object('userId',target_user_id,'email',mail,'name',coalesce(label,split_part(mail,'@',1))));
 if request_id is not null then update private.care_account_admin_requests r set status='completed',result=outcome where r.id=request_id and r.actor_id=care_admin_apply.actor_id;end if;
 return outcome;
end $$;

create or replace function private.care_account_directory() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.care_admin() then raise insufficient_privilege;end if;
 return (select coalesce(jsonb_agg(x order by x->>'email'),'[]') from (
 select jsonb_build_object('userId',u.id,'email',u.email,'name',coalesce((select display_name from public.care_memberships where user_id=u.id::text order by created_at desc limit 1),u.raw_user_meta_data->>'display_name',split_part(u.email,'@',1)),
 'createdAt',u.created_at,'status',case when coalesce(s.enabled,true) then 'active' else 'suspended' end,
 'isAdmin',exists(select 1 from public.care_memberships where user_id=u.id::text and status='active' and is_admin=1),
 'roles',coalesce((select jsonb_agg(distinct role) from public.care_memberships where user_id=u.id::text and status='active'),'[]'),
 'seniorIds',coalesce((select jsonb_agg(distinct senior_id) from public.care_memberships where user_id=u.id::text and status='active' and senior_id<>''),'[]'),
 'assignments',coalesce((select jsonb_agg(a) from(select jsonb_build_object('role',m.role,'seniorIds',case when m.role in ('senior','family') then jsonb_agg(distinct m.senior_id) else coalesce((jsonb_agg(m.scope_json::jsonb)->0)-'*','[]') end,'allSeniors',bool_or(m.scope_json::jsonb ? '*')) a from public.care_memberships m where m.user_id=u.id::text and m.status='active' group by m.role)t),'[]'),
 'maskedPhone',case when c.phone is null then null else left(c.phone,3)||'••••'||right(c.phone,3) end,'smsConsent',coalesce(c.sms_consent,false),'callConsent',coalesce(c.call_consent,false),'recipientConfirmed',coalesce(c.recipient_confirmed,false)) x
 from auth.users u left join public.care_account_settings s on s.user_id=u.id left join public.care_account_contacts c on c.user_id=u.id where u.deleted_at is null) t);
end $$;

-- Disallow phone routing to a suspended recipient in addition to current links.
do $$ declare source text;begin
 source:=pg_get_functiondef('private.care_account_phone_contacts()'::regprocedure);
 source:=replace(source,'where e.owner=','where not exists(select 1 from public.care_account_settings s where s.user_id=c.user_id and not s.enabled) and e.owner=');execute source;
 source:=pg_get_functiondef('private.care_recipients(jsonb)'::regprocedure);
 source:=replace(source,'m.status=''active''','m.status=''active'' and not exists(select 1 from public.care_account_settings s where s.user_id::text=m.user_id and not s.enabled)');execute source;
end $$;
revoke all on function private.care_require_account_actor(uuid),private.care_sync_account_contacts(uuid,uuid),public.care_admin_request(uuid,uuid,text,text),public.care_admin_find_user(uuid,text),public.care_admin_apply(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.care_admin_request(uuid,uuid,text,text),public.care_admin_find_user(uuid,text),public.care_admin_apply(uuid,uuid,text,jsonb,uuid) to service_role;

create or replace function private.care_set_account_phone(target_user_id uuid,mobile text,sms_allowed boolean,call_allowed boolean,recipient_confirmed boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.care_admin() then raise insufficient_privilege;end if;
 if not exists(select 1 from public.care_memberships where workspace_id='primary' and user_id=target_user_id::text and status='active') then raise invalid_parameter_value;end if;
 if mobile is not null and (mobile !~ '^\+[1-9][0-9]{7,14}$' or recipient_confirmed is distinct from true) then raise invalid_parameter_value;end if;
 insert into public.care_account_contacts(user_id,phone,sms_consent,call_consent,recipient_confirmed,revision,updated_by)
 values(target_user_id,mobile,mobile is not null and sms_allowed,mobile is not null and call_allowed,mobile is not null and recipient_confirmed,1,auth.uid())
 on conflict(user_id) do update set phone=excluded.phone,sms_consent=excluded.sms_consent,call_consent=excluded.call_consent,recipient_confirmed=excluded.recipient_confirmed,revision=care_account_contacts.revision+1,updated_by=auth.uid(),updated_at=now();
 perform private.care_sync_account_contacts(target_user_id,auth.uid());
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','audit','',jsonb_build_object('action','account_phone_updated','actorId',auth.uid(),'targetUserId',target_user_id,'detail','Account contact and channel permissions updated; no message sent.'),to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 return jsonb_build_object('ok',true,'phoneConfigured',mobile is not null);
end $$;
