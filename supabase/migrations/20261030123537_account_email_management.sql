-- Auth is updated only by the protected administrator Edge function. This RPC
-- verifies Auth's saved email before synchronizing membership labels and
-- invalidating all existing target sessions. No passwords are stored here.
do $email$ declare source text;begin
 source:=pg_get_functiondef('public.care_admin_request(uuid,uuid,text,text)'::regprocedure);
 if strpos(source,'''create'',''onboard'',''assign'',''password'',''delete''')=0 then raise exception 'Review changed account request guard';end if;
 execute replace(source,'''create'',''onboard'',''assign'',''password'',''delete''','''create'',''onboard'',''assign'',''password'',''email'',''delete''');
 source:=pg_get_functiondef('public.care_admin_apply(uuid,uuid,text,jsonb,uuid)'::regprocedure);
 if strpos(source,'''create'',''assign'',''update'',''suspend'',''restore'',''password''')=0 then raise exception 'Review changed account apply guard';end if;
 source:=replace(source,'''create'',''assign'',''update'',''suspend'',''restore'',''password''','''create'',''assign'',''update'',''suspend'',''restore'',''password'',''email''');
 source:=replace(source,' if label is not null then update public.care_memberships',
 $guard$ if operation='email' then
  if details->>'email' is distinct from lower(mail) or details->'confirmEmailChange' is distinct from 'true'::jsonb
   or details ? 'password' or not exists(select 1 from private.care_account_admin_requests r where r.id=request_id and r.actor_id=care_admin_apply.actor_id and r.action='email' and r.status='processing') then raise insufficient_privilege;end if;
  update public.care_memberships set email=mail where user_id=target_user_id::text and workspace_id='primary';
 end if;
 if label is not null then update public.care_memberships$guard$);
 source:=replace(source,'if operation=''password'' then','if operation in (''password'',''email'') then');
 source:=replace(source,'operation in (''suspend'',''password'',''update'')','operation in (''suspend'',''password'',''email'',''update'')');
 execute source;
end $email$;
