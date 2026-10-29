-- A login is one person's identity. Care links are permissions, not interchangeable personas.
create table private.care_account_identity (
 user_id uuid primary key references auth.users(id),
 role text not null check(role in ('senior','family','coordinator','operations')),
 senior_id text,
 created_at timestamptz not null default now(),
 check((role='senior' and senior_id ~ '^S[0-9]{3,6}$') or (role<>'senior' and senior_id is null))
);
alter table private.care_account_identity enable row level security;
revoke all on private.care_account_identity from public,anon,authenticated;
create policy identity_no_direct_access on private.care_account_identity to authenticated using(false) with check(false);
insert into private.care_account_identity(user_id,role,senior_id)
 select user_id::uuid,min(role),case when min(role)='senior' then min(senior_id) end
 from public.care_memberships where workspace_id='primary' and status='active'
 group by user_id having count(distinct role)=1;

create function private.care_identity_membership_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare identity private.care_account_identity%rowtype;
begin
 if new.workspace_id<>'primary' or new.status<>'active' then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('account-identity:'||new.user_id,0));
 if new.role='operations' and (new.is_admin<>1 or not exists(select 1 from public.care_workspaces where id='primary' and owner_user_id=new.user_id)) then raise insufficient_privilege using message='Operations access belongs only to the workspace owner';end if;
 select * into identity from private.care_account_identity where user_id=new.user_id::uuid;
 if identity.user_id is not null and (identity.role<>new.role or identity.role='senior' and identity.senior_id<>new.senior_id) then raise insufficient_privilege using message='Account identity type and senior identity cannot be changed';end if;
 if exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.user_id=new.user_id and m.status='active' and m.id<>new.id and (m.role<>new.role or new.role='senior' and m.senior_id<>new.senior_id)) then raise insufficient_privilege using message='Use separate logins for separate identity types';end if;
 if new.role='senior' then
  perform pg_advisory_xact_lock(hashtextextended('senior-login:'||new.senior_id,0));
  if exists(select 1 from public.care_memberships m where m.workspace_id='primary' and m.status='active' and m.role='senior' and m.senior_id=new.senior_id and m.user_id<>new.user_id) then raise unique_violation using message='This senior already has a login';end if;
 end if;
 insert into private.care_account_identity(user_id,role,senior_id) values(new.user_id::uuid,new.role,case when new.role='senior' then new.senior_id end) on conflict do nothing;
 return new;
end $$;
revoke all on function private.care_identity_membership_guard() from public,anon,authenticated;
create trigger care_identity_membership_guard before insert or update on public.care_memberships for each row execute function private.care_identity_membership_guard();

create function public.care_admin_validate_identity(actor_id uuid,target_user_id uuid,operation text,details jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare identity private.care_account_identity%rowtype;role_name text:=details->>'role';sid text;label text;
begin
 perform private.care_require_account_actor(actor_id);
 if operation not in ('create','assign','update','onboard') then raise invalid_parameter_value;end if;
 if details ? 'password' then raise invalid_parameter_value using message='Passwords must never reach care storage';end if;
 if operation='onboard' then return jsonb_build_object('valid',true);end if;
 if role_name is null then return jsonb_build_object('valid',true);end if;
 if role_name not in ('senior','family','coordinator') then raise insufficient_privilege using message='Operations is reserved for the sole workspace owner';end if;
 if target_user_id is not null then
  select * into identity from private.care_account_identity where user_id=target_user_id;
  if identity.user_id is not null and identity.role<>role_name then raise insufficient_privilege using message='An account cannot change identity type';end if;
 end if;
 if role_name='senior' then
  if jsonb_typeof(details->'seniorIds')<>'array' or jsonb_array_length(details->'seniorIds')<>1 or coalesce((details->>'allSeniors')::boolean,false) then raise invalid_parameter_value;end if;
  sid:=details#>>'{seniorIds,0}';select name into label from public.care_profiles where owner='workspace:primary' and senior_id=sid;
  if label is null then raise invalid_parameter_value using message='Choose an existing senior';end if;
  if identity.user_id is not null and identity.senior_id is distinct from sid then raise insufficient_privilege using message='The senior’s own identity cannot be reassigned';end if;
  if exists(select 1 from public.care_memberships where workspace_id='primary' and role='senior' and status='active' and senior_id=sid and (target_user_id is null or user_id<>target_user_id::text)) then raise unique_violation using message='The senior already has a login';end if;
  if details ? 'name' and btrim(details->>'name') is distinct from label then raise invalid_parameter_value using message='The senior login must use the senior’s recorded identity';end if;
 end if;
 return jsonb_build_object('valid',true,'name',label);
end $$;
revoke all on function public.care_admin_validate_identity(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.care_admin_validate_identity(uuid,uuid,text,jsonb) to service_role;

-- Keep the current checked administrator functions and add validation at their entry.
do $$declare source text;old text;begin
 source:=pg_get_functiondef('public.care_admin_apply(uuid,uuid,text,jsonb,uuid)'::regprocedure);old:=source;
 source:=replace(source,'perform private.care_require_account_actor(actor_id);','perform private.care_require_account_actor(actor_id); if operation in (''create'',''assign'',''update'') then perform public.care_admin_validate_identity(actor_id,target_user_id,operation,details);end if;');
 source:=replace(source,'label:=nullif(btrim(details->>''name''),'''');','label:=nullif(btrim(details->>''name''),''''); if role_name=''senior'' then select name into label from public.care_profiles where owner=''workspace:primary'' and senior_id=details#>>''{seniorIds,0}'';end if;');
 if source=old then raise exception 'Administrator identity validation patch target missing';end if;execute source;
 source:=pg_get_functiondef('public.care_admin_request(uuid,uuid,text,text)'::regprocedure);old:=source;
 source:=replace(source,'''create'',''assign'',''password'',''delete''','''create'',''onboard'',''assign'',''password'',''delete''');
 if source=old then raise exception 'Onboarding request patch target missing';end if;execute source;
 source:=pg_get_functiondef('private.care_manage_invitation(text,text,jsonb)'::regprocedure);old:=source;
 source:=replace(source,'role_name not in (''family'',''senior'',''coordinator'',''operations'')','role_name not in (''family'',''senior'',''coordinator'')');
 if source=old then raise exception 'Invitation role patch target missing';end if;
 old:=source;
 source:=replace(source,'if action=''create'' then','if role_name=''coordinator'' and not exists(select 1 from public.care_memberships m join auth.users u on u.id::text=m.user_id left join public.care_account_settings a on a.user_id=u.id where m.workspace_id=''primary'' and m.status=''active'' and m.role=''coordinator'' and lower(u.email)=mail and u.deleted_at is null and coalesce(a.enabled,true)) then raise invalid_parameter_value using message=''Provision the coordinator account before inviting it to care access'';end if; if exists(select 1 from private.care_account_identity i join auth.users u on u.id=i.user_id where lower(u.email)=mail and i.role<>role_name) then raise insufficient_privilege using message=''The invited email belongs to a different account type'';end if; if role_name=''senior'' and exists(select 1 from public.care_memberships m where m.workspace_id=''primary'' and m.status=''active'' and m.role=''senior'' and m.senior_id=sid and lower(m.email)<>mail) then raise unique_violation using message=''This senior already has a login'';end if; if action=''create'' then');
 if source=old then raise exception 'Invitation identity patch target missing';end if;execute source;
end $$;
