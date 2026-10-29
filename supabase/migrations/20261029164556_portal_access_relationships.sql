-- Email-bound household invitations and audited account removal. Health events are retained.
alter table public.care_invitations add column source text not null default 'admin' check(source in ('admin','household'));
alter table public.care_invitations add column actor_role text check(actor_role in ('senior','family'));
alter table public.care_invitations add column deleted_at timestamptz;
alter table public.care_invitations add column updated_at timestamptz not null default now();
create index care_household_invites on public.care_invitations(created_by,source,created_at desc) where deleted_at is null;
alter table public.care_account_settings add column deleted_at timestamptz;

create function private.care_access_directory() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.care_admin() then raise insufficient_privilege;end if;
 return jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'userId',m.user_id,'email',m.email,'name',m.display_name,'role',m.role,'seniorId',nullif(m.senior_id,''),'scope',m.scope_json::jsonb,'isAdmin',m.role='operations' and m.is_admin=1,'status',m.status,'createdAt',m.created_at) order by m.created_at desc) from public.care_memberships m where workspace_id='primary'),'[]'),
 'invites',coalesce((select jsonb_agg(x order by x->>'createdAt' desc) from (select jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'seniorId',i.senior_id,'scope',i.scope_json::jsonb,'source',i.source,'status',case when i.status='pending' and i.expires_at<=extract(epoch from now())*1000 then 'expired' else i.status end,'expiresAt',i.expires_at,'createdAt',i.created_at) x from public.care_invitations i where i.workspace_id='primary' and i.deleted_at is null order by i.created_at desc limit 200)t),'[]'));
end $$;
create function public.care_access_directory() returns jsonb language sql security invoker set search_path='' as $$select private.care_access_directory()$$;

create function private.care_manage_invitation(action text,invitation_id text,details jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.care_invitations%rowtype;mail text;role_name text;sid text;scope_value jsonb;stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 if not private.care_admin() then raise insufficient_privilege;end if;
 if action not in ('create','update','revoke','delete') or jsonb_typeof(details)<>'object' then raise invalid_parameter_value;end if;
 if action<>'create' then
  select * into item from public.care_invitations i where i.id=invitation_id and i.workspace_id='primary' and i.deleted_at is null for update;
  if item.id is null then raise no_data_found;end if;
  if action in ('update','revoke') and item.status<>'pending' then raise unique_violation using message='Only a pending invitation can be changed';end if;
 end if;
 if action in ('create','update') then
  mail:=lower(btrim(details->>'email'));role_name:=details->>'role';sid:=coalesce(details->>'seniorId','');scope_value:=details->'scope';
  if mail is null or length(mail)>254 or mail!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or role_name not in ('family','senior','coordinator','operations') or jsonb_typeof(scope_value)<>'array' or jsonb_array_length(scope_value) not between 1 and 200 or details->>'tokenHash'!~'^[a-f0-9]{64}$' or (details->>'expiresAt')::bigint not between (extract(epoch from now())*1000)::bigint+60000 and (extract(epoch from now())*1000)::bigint+30*86400000::bigint then raise invalid_parameter_value;end if;
  if role_name in ('family','senior') then
   if scope_value<>jsonb_build_array(sid) or not exists(select 1 from public.care_daily_scores where senior_id=sid) then raise invalid_parameter_value using message='Choose an existing senior';end if;
  else
   if sid<>'' then raise invalid_parameter_value;end if;
   if exists(select 1 from jsonb_array_elements_text(scope_value)v where v<>'*' and not exists(select 1 from public.care_daily_scores s where s.senior_id=v)) then raise invalid_parameter_value;end if;
  end if;
  if action='create' then
   insert into public.care_invitations(id,workspace_id,token_hash,email,role,senior_id,scope_json,created_by,status,expires_at,created_at,source)
   values(invitation_id,'primary',details->>'tokenHash',mail,role_name,sid,scope_value::text,auth.uid()::text,'pending',(details->>'expiresAt')::bigint,stamp,'admin');
  else
   update public.care_invitations set token_hash=details->>'tokenHash',email=mail,role=role_name,senior_id=sid,scope_json=scope_value::text,expires_at=(details->>'expiresAt')::bigint,created_by=auth.uid()::text,source='admin',actor_role=null,updated_at=now() where id=invitation_id;
  end if;
 elsif action='revoke' then
  update public.care_invitations set status='revoked',updated_at=now() where id=invitation_id;
 else
  -- Removing history invalidates an unused link; accepted memberships are managed separately.
  update public.care_invitations set status=case when status='pending' then 'revoked' else status end,deleted_at=now(),updated_at=now() where id=invitation_id;
 end if;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','audit','',jsonb_build_object('action','invitation_'||action,'actorId',auth.uid(),'invitationId',invitation_id,'detail','Invitation change saved. No message sent; accepted care access is unchanged.'),stamp);
 return jsonb_build_object('ok',true,'id',invitation_id);
end $$;
create function public.care_manage_invitation(action text,invitation_id text,details jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.care_manage_invitation(action,invitation_id,details)$$;

create function private.care_household(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text:=payload->>'role';uid text:=auth.uid()::text;sid text;mail text;target_role text;item public.care_memberships%rowtype;inv public.care_invitations%rowtype;ids jsonb;links jsonb;options jsonb;invitations jsonb;stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 if not private.care_actor_enabled() or role_name not in ('family','senior') or not exists(select 1 from public.care_memberships m where m.user_id=uid and m.workspace_id='primary' and m.status='active' and m.role=role_name) then raise insufficient_privilege;end if;
 if action='list' then
  select coalesce(jsonb_agg(distinct m.senior_id),'[]') into ids from public.care_memberships m where m.user_id=uid and m.workspace_id='primary' and m.status='active' and m.role=role_name;
  select coalesce(jsonb_agg(jsonb_build_object('id',s,'name',case when role_name='family' and not private.care_family_allowed(s) then 'Sharing disabled ('||s||')' else coalesce((select name from public.care_profiles where owner='workspace:primary' and senior_id=s),s) end) order by s),'[]') into options from jsonb_array_elements_text(ids)s;
  if role_name='senior' then
   select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'userId',m.user_id,'email',m.email,'name',m.display_name,'role','family','seniorId',m.senior_id,'canRemove',true) order by m.display_name),'[]') into links from public.care_memberships m where m.workspace_id='primary' and m.status='active' and m.role='family' and ids ? m.senior_id;
  else
   -- A family disconnects its own membership, never another person's identity.
   select coalesce(jsonb_agg(jsonb_build_object('id',mine.id,'userId',coalesce(other.user_id,''),'email',coalesce(other.email,''),'name',case when private.care_family_allowed(mine.senior_id) then coalesce(other.display_name,(select name from public.care_profiles where owner='workspace:primary' and senior_id=mine.senior_id),mine.senior_id) else 'Sharing disabled ('||mine.senior_id||')' end,'role','senior','seniorId',mine.senior_id,'canRemove',true) order by mine.senior_id),'[]') into links
   from public.care_memberships mine left join lateral(select m.user_id,m.email,m.display_name from public.care_memberships m where m.workspace_id='primary' and m.status='active' and m.role='senior' and m.senior_id=mine.senior_id and private.care_family_allowed(mine.senior_id) order by m.created_at limit 1)other on true where mine.user_id=uid and mine.workspace_id='primary' and mine.status='active' and mine.role='family';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'seniorId',i.senior_id,'status',case when i.status='pending' and i.expires_at<=extract(epoch from now())*1000 then 'expired' else i.status end,'expiresAt',i.expires_at,'createdAt',i.created_at,'canManage',true) order by i.created_at desc),'[]') into invitations from public.care_invitations i where i.workspace_id='primary' and i.source='household' and i.created_by=uid and i.actor_role=role_name and i.deleted_at is null;
  return jsonb_build_object('role',role_name,'seniorIds',ids,'links',links,'seniorOptions',options,'invitations',invitations,'canInvite',exists(select 1 from jsonb_array_elements_text(ids)s where private.care_family_allowed(s)));
 elsif action='invite' then
  sid:=payload->>'seniorId';mail:=lower(btrim(payload->>'email'));target_role:=case when role_name='senior' then 'family' else 'senior' end;
  if exists(select 1 from auth.users where id=auth.uid() and lower(email)=mail) then raise insufficient_privilege using message='Invite the other person using their own verified email';end if;
  if not exists(select 1 from public.care_memberships where workspace_id='primary' and user_id=uid and role=role_name and senior_id=sid and status='active') or not private.care_family_allowed(sid) then raise insufficient_privilege using message='A current household link and senior sharing consent are required';end if;
  if mail is null or length(mail)>254 or mail!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or payload->>'tokenHash'!~'^[a-f0-9]{64}$' or (payload->>'expiresAt')::bigint not between (extract(epoch from now())*1000)::bigint+60000 and (extract(epoch from now())*1000)::bigint+7*86400000::bigint then raise invalid_parameter_value;end if;
  if target_role='senior' and exists(select 1 from public.care_memberships where workspace_id='primary' and senior_id=sid and role='senior' and status='active' and lower(email)<>mail) then raise unique_violation using message='This senior already has an account; contact Operations to correct its login';end if;
  insert into public.care_invitations(id,workspace_id,token_hash,email,role,senior_id,scope_json,created_by,status,expires_at,created_at,source,actor_role) values(payload->>'id','primary',payload->>'tokenHash',mail,target_role,sid,jsonb_build_array(sid)::text,uid,'pending',(payload->>'expiresAt')::bigint,stamp,'household',role_name);
 elsif action='remove_invitation' then
  select * into inv from public.care_invitations where id=payload->>'id' and workspace_id='primary' and created_by=uid and source='household' and actor_role=role_name and deleted_at is null for update;
  if inv.id is null then raise insufficient_privilege;end if;
  update public.care_invitations set status=case when status='pending' then 'revoked' else status end,deleted_at=now(),updated_at=now() where id=inv.id;sid:=inv.senior_id;
 elsif action='remove_link' then
  select * into item from public.care_memberships where id=payload->>'id' and workspace_id='primary' and status='active' for update;
  if item.id is null or item.role<>'family' or (role_name='family' and item.user_id<>uid) or (role_name='senior' and not exists(select 1 from public.care_memberships where workspace_id='primary' and user_id=uid and role='senior' and senior_id=item.senior_id and status='active')) then raise insufficient_privilege;end if;
  update public.care_memberships set status='revoked' where id=item.id;
  delete from public.demo_sessions where owner=item.user_id;sid:=item.senior_id;
  update public.care_invitations set status='revoked',updated_at=now() where workspace_id='primary' and senior_id=sid and status='pending' and source='household' and (created_by=item.user_id or email=lower(item.email));
 else raise invalid_parameter_value;end if;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','audit',sid,jsonb_build_object('action','household_'||action,'actorId',uid,'membershipId',case when action='remove_link' then item.id else null end,'detail','Household access updated; care-team assignments and care history retained.'),stamp);
 return jsonb_build_object('ok',true,'role',coalesce(target_role,role_name));
end $$;
create function public.care_household(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.care_household(action,payload)$$;

create or replace function private.care_claim(token text,display text) returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.care_invitations%rowtype;mail text;uid text:=auth.uid()::text;stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 if not private.care_actor_enabled() then raise insufficient_privilege;end if;
 select lower(email) into mail from auth.users where id=auth.uid() and email_confirmed_at is not null and deleted_at is null;
 if mail is null then raise insufficient_privilege using message='Verified email required';end if;
 select * into invitation from public.care_invitations where token_hash=token and workspace_id='primary' for update;
 if invitation.id is null or invitation.deleted_at is not null or invitation.status<>'pending' or invitation.expires_at<=extract(epoch from now())*1000 then return jsonb_build_object('ok',false);end if;
 if invitation.source='household' and invitation.created_by=uid then raise insufficient_privilege using message='A household invitation must be accepted by the other person';end if;
 if invitation.email<>mail then raise insufficient_privilege using message='Invited email does not match verified account';end if;
 if exists(select 1 from public.care_account_settings where user_id::text=invitation.created_by and not enabled) then return jsonb_build_object('ok',false);end if;
 if invitation.source='admin' then
  if not exists(select 1 from public.care_memberships where user_id=invitation.created_by and workspace_id='primary' and status='active' and role='operations' and is_admin=1) then return jsonb_build_object('ok',false);end if;
 else
  if invitation.actor_role not in ('family','senior') or invitation.role<>(case when invitation.actor_role='senior' then 'family' else 'senior' end) or not exists(select 1 from public.care_memberships where user_id=invitation.created_by and workspace_id='primary' and status='active' and role=invitation.actor_role and senior_id=invitation.senior_id) or not private.care_family_allowed(invitation.senior_id) then return jsonb_build_object('ok',false);end if;
 end if;
 if invitation.role='senior' then
  perform pg_advisory_xact_lock(hashtextextended('senior-login:'||invitation.senior_id,0));
  if exists(select 1 from public.care_memberships where workspace_id='primary' and role='senior' and status='active' and ((senior_id=invitation.senior_id and user_id<>uid) or (user_id=uid and senior_id<>invitation.senior_id))) then raise unique_violation using message='This senior login is already assigned; ask Operations to review it';end if;
 end if;
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values('invite-'||invitation.id,'primary',uid,mail,left(coalesce(nullif(btrim(display),''),split_part(mail,'@',1)),120),invitation.role,invitation.senior_id,invitation.scope_json,0,'active',stamp) on conflict do nothing;
 update public.care_invitations set status='accepted',redeemed_by=uid,updated_at=now() where id=invitation.id;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','audit',invitation.senior_id,jsonb_build_object('action','invitation_accepted','actorId',uid,'invitationId',invitation.id,'role',invitation.role,'detail','Email-bound invitation accepted; existing senior consent remains in force.'),stamp);
 return jsonb_build_object('ok',true,'role',invitation.role);
end $$;

create table private.care_deleted_accounts(user_id uuid primary key references auth.users(id),actor_id uuid not null,email text,status text not null check(status in ('pending','completed')),created_at timestamptz not null default now(),completed_at timestamptz);
alter table private.care_deleted_accounts enable row level security;
-- Soft deletion retains the Auth primary key so health-record provenance is never orphaned.
create function private.care_deleted_membership_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='active' and exists(select 1 from public.care_account_settings where user_id::text=new.user_id and deleted_at is not null) then raise insufficient_privilege using message='A deleted login cannot receive care access';end if;return new;
end $$;
create trigger care_no_deleted_memberships before insert or update on public.care_memberships for each row execute function private.care_deleted_membership_guard();
create function private.care_deleted_settings_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.deleted_at is not null and (new.enabled or new.deleted_at is null) then raise insufficient_privilege using message='A deleted login cannot be restored';end if;return new;
end $$;
create trigger care_no_deleted_restore before update on public.care_account_settings for each row execute function private.care_deleted_settings_guard();

create or replace function public.care_admin_request(actor_id uuid,request_id uuid,operation text,request_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare item private.care_account_admin_requests%rowtype;
begin
 perform private.care_require_account_actor(actor_id);
 if operation not in ('create','assign','password','delete') or request_hash!~'^[a-f0-9]{64}$' then raise invalid_parameter_value;end if;
 insert into private.care_account_admin_requests(id,actor_id,action,request_hash) values(request_id,actor_id,operation,request_hash) on conflict do nothing;
 select * into item from private.care_account_admin_requests where id=request_id for update;
 if item.actor_id<>actor_id or item.action<>operation or item.request_hash<>request_hash then raise unique_violation;end if;
 if item.status='completed' then return jsonb_build_object('fresh',false,'status','completed','result',item.result);end if;
 if item.result ? 'claimed' and operation<>'delete' then return jsonb_build_object('fresh',false,'status','processing');end if;
 -- Retrying the same deletion is safe: access revocation and Auth soft deletion are idempotent.
 update private.care_account_admin_requests set result='{"claimed":true}' where id=request_id;
 return jsonb_build_object('fresh',true,'status','processing');
end $$;
create function public.care_admin_delete_access(actor_id uuid,target_user_id uuid,request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare mail text;stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 perform private.care_require_account_actor(actor_id);
 if target_user_id=actor_id or exists(select 1 from public.care_workspaces where id='primary' and owner_user_id=target_user_id::text) or exists(select 1 from public.care_memberships where workspace_id='primary' and user_id=target_user_id::text and status='active' and is_admin=1) then raise insufficient_privilege using message='The Operations owner is protected';end if;
 if not exists(select 1 from private.care_account_admin_requests r where r.id=request_id and r.actor_id=care_admin_delete_access.actor_id and action='delete' and status='processing') then raise invalid_parameter_value;end if;
 perform pg_advisory_xact_lock(hashtextextended('account:'||target_user_id::text,0));
 select email into mail from auth.users where id=target_user_id;if not found then raise no_data_found;end if;
 insert into private.care_deleted_accounts(user_id,actor_id,email,status) values(target_user_id,actor_id,mail,'pending') on conflict do nothing;
 insert into public.care_account_settings(user_id,enabled,credentials_valid_after,deleted_at) values(target_user_id,false,ceil(extract(epoch from clock_timestamp()))::bigint,now()) on conflict(user_id) do update set enabled=false,credentials_valid_after=excluded.credentials_valid_after,deleted_at=coalesce(care_account_settings.deleted_at,excluded.deleted_at),updated_at=now();
 update public.care_memberships set status='revoked' where user_id=target_user_id::text and workspace_id='primary' and status='active';
 delete from public.demo_sessions where owner=target_user_id::text;
 update public.care_push_subscriptions set disabled=1 where user_id=target_user_id::text;
 update public.care_invitations set status='revoked',updated_at=now() where workspace_id='primary' and status='pending' and (created_by=target_user_id::text or email=lower(mail));
 update public.care_account_contacts set phone=null,sms_consent=false,call_consent=false,recipient_confirmed=false,revision=revision+1,updated_at=now() where user_id=target_user_id;
 if not exists(select 1 from public.care_events where kind='audit' and payload->>'action'='account_delete_access' and payload->>'targetUserId'=target_user_id::text) then
  insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','audit','',jsonb_build_object('action','account_delete_access','actorId',actor_id,'targetUserId',target_user_id,'detail','Login disabled and care links revoked before identity deletion; care history retained.'),stamp);
 end if;
 return jsonb_build_object('ok',true,'email',(select email from private.care_deleted_accounts where user_id=target_user_id));
end $$;
create function public.care_admin_delete_complete(actor_id uuid,target_user_id uuid,request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare outcome jsonb:=jsonb_build_object('ok',true,'deleted',true,'recordsRetained',true);
begin
 perform private.care_require_account_actor(actor_id);
 if not exists(select 1 from private.care_deleted_accounts where user_id=target_user_id) or not exists(select 1 from auth.users where id=target_user_id and deleted_at is not null) then raise invalid_parameter_value;end if;
 update private.care_deleted_accounts set status='completed',completed_at=coalesce(completed_at,now()) where user_id=target_user_id;
 update private.care_account_admin_requests r set status='completed',result=outcome where r.id=request_id and r.actor_id=care_admin_delete_complete.actor_id and r.action='delete';
 if not found then raise invalid_parameter_value;end if;
 return outcome;
end $$;
-- Expose pending removal in the account directory, allowing an interrupted deletion to be retried.
do $$declare source text;begin
 source:=pg_get_functiondef('private.care_account_directory()'::regprocedure);
 source:=replace(source,'case when coalesce(s.enabled,true) then ''active'' else ''suspended'' end','case when s.deleted_at is not null then ''deletion_pending'' when coalesce(s.enabled,true) then ''active'' else ''suspended'' end');execute source;
end $$;

revoke all on function private.care_access_directory(),public.care_access_directory(),private.care_manage_invitation(text,text,jsonb),public.care_manage_invitation(text,text,jsonb),private.care_household(text,jsonb),public.care_household(text,jsonb) from public,anon;
grant execute on function private.care_access_directory(),public.care_access_directory(),private.care_manage_invitation(text,text,jsonb),public.care_manage_invitation(text,text,jsonb),private.care_household(text,jsonb),public.care_household(text,jsonb) to authenticated;
revoke all on function private.care_deleted_membership_guard(),private.care_deleted_settings_guard(),public.care_admin_delete_access(uuid,uuid,uuid),public.care_admin_delete_complete(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.care_admin_delete_access(uuid,uuid,uuid),public.care_admin_delete_complete(uuid,uuid,uuid) to service_role;
