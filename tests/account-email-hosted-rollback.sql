begin;
do $test$ declare actor uuid; target uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); outcome jsonb;begin
 select owner_user_id::uuid into actor from public.care_workspaces where id='primary';
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 values(target,'email-test-'||target||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}');
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,status,is_admin,created_at)
 values(target::text,'primary',target::text,'email-test-'||target||'@example.invalid','Email test family','family','S001','["S001"]','active',0,'2000-01-01T00:00:00Z');
 execute 'set local role service_role';
 perform public.care_admin_request(actor,request,'email',repeat('a',64));
 begin
  perform public.care_admin_apply(actor,target,'email',jsonb_build_object('email','changed-'||target||'@example.invalid','confirmEmailChange',true),request);
  raise exception 'Unconfirmed Auth change was accepted';exception when insufficient_privilege then null;
 end;
 -- This synthetic, rolled-back write models only Auth's successful API result.
 execute 'reset role';
 update auth.users set email='changed-'||target||'@example.invalid' where id=target;
 execute 'set local role service_role';
 outcome:=public.care_admin_apply(actor,target,'email',jsonb_build_object('email','changed-'||target||'@example.invalid','confirmEmailChange',true),request);
 if outcome->>'ok'<>'true' then raise exception 'Email application failed';end if;
 if not exists(select 1 from public.care_memberships where user_id=target::text and email='changed-'||target||'@example.invalid' and role='family' and senior_id='S001' and status='active') then raise exception 'Identity changed or membership email was not synchronized';end if;
 if not exists(select 1 from public.care_account_settings where user_id=target and credentials_valid_after>extract(epoch from now())-1) then raise exception 'Old sessions were retained';end if;
 outcome:=public.care_admin_request(actor,request,'email',repeat('a',64));
 if outcome->>'status'<>'completed' then raise exception 'Email action was not idempotently completed';end if;
 begin perform public.care_admin_apply(actor,actor,'email','{}',request);raise exception 'Protected owner override accepted';exception when insufficient_privilege then null;end;
end $test$;
rollback;
select true as account_email_rollback_checks_passed;
