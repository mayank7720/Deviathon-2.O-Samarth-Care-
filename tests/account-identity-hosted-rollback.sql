-- Identity boundaries only; all synthetic identities and care records roll back.
begin;
do $$declare owner_id uuid; a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 select owner_user_id::uuid into owner_id from public.care_workspaces where id='primary';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','service_role','iat',extract(epoch from now())::bigint)::text,true);
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 select id,'identity-test-'||id||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from (values(a),(b),(c))v(id);
 insert into public.care_profiles(owner,senior_id,name,profile,updated_at) values('workspace:primary','S900101','Synthetic Identity One','{"id":"S900101","name":"Synthetic Identity One"}',stamp),('workspace:primary','S900102','Synthetic Identity Two','{"id":"S900102","name":"Synthetic Identity Two"}',stamp);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at)
 values(a::text,'primary',a::text,'identity-test-'||a||'@example.invalid','Synthetic Identity One','senior','S900101','["S900101"]',0,'active',stamp),
 (b::text,'primary',b::text,'identity-test-'||b||'@example.invalid','Synthetic Family','family','S900101','["S900101"]',0,'active',stamp);
 begin
  update public.care_memberships set senior_id='S900102',scope_json='["S900102"]' where id=a::text;
  raise exception 'Senior login reassigned to a different person';exception when insufficient_privilege then null;end;
 begin
  insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values(gen_random_uuid()::text,'primary',b::text,'identity-test-'||b||'@example.invalid','Invalid mixed identity','coordinator','','["S900101"]',0,'active',stamp);
  raise exception 'Family account gained coordinator identity';exception when insufficient_privilege then null;end;
 begin
  insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values(c::text,'primary',c::text,'identity-test-'||c||'@example.invalid','Second senior login','senior','S900101','["S900101"]',0,'active',stamp);
  raise exception 'Second active login for one senior was accepted';exception when unique_violation then null;end;
 perform set_config('role','service_role',true);
 begin
  perform public.care_admin_validate_identity(owner_id,c,'create','{"role":"operations","seniorIds":[],"allSeniors":true}');
  raise exception 'Extra Operations identity was accepted';exception when insufficient_privilege then null;end;
 begin
  perform public.care_admin_validate_identity(owner_id,c,'create','{"role":"senior","name":"Other person","seniorIds":["S900102"],"allSeniors":false}');
  raise exception 'Mismatched senior name was accepted';exception when invalid_parameter_value then null;end;
 perform public.care_admin_validate_identity(owner_id,c,'create','{"role":"senior","name":"Synthetic Identity Two","seniorIds":["S900102"],"allSeniors":false}');
 begin
  perform public.care_admin_validate_identity(owner_id,b,'assign','{"role":"coordinator","seniorIds":["S900101"],"allSeniors":false}');
  raise exception 'Account identity conversion accepted';exception when insufficient_privilege then null;end;
 begin
  perform public.care_admin_validate_identity(owner_id,c,'onboard','{"password":"not allowed in care storage"}');
  raise exception 'Password reached care storage';exception when invalid_parameter_value then null;end;
 perform set_config('role','none',true);
end $$;
rollback;
select 'PASS: single identity, own senior record, duplicate login and Operations boundaries; fixtures rolled back' as result;
