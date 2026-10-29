-- Tests only the care-session cutoff after Auth password success. No Auth password is changed.
begin;
do $$declare actor uuid:=gen_random_uuid();other_user uuid:=gen_random_uuid();stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');old_iat bigint:=floor(extract(epoch from now()))::bigint-120;cutoff bigint;result jsonb;
begin
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 select id,'password-cutoff-test-'||id||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from (values(actor),(other_user))v(id);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values
 (actor::text,'primary',actor::text,'password-cutoff-test-'||actor||'@example.invalid','Synthetic family','family','S900401','["S900401"]',0,'active',stamp),
 (other_user::text,'primary',other_user::text,'password-cutoff-test-'||other_user||'@example.invalid','Other synthetic family','family','S900402','["S900402"]',0,'active',stamp);
 insert into public.care_account_settings(user_id,enabled,credentials_valid_after) values(actor,true,0),(other_user,true,17);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','iat',old_iat)::text,true);
 perform set_config('role','authenticated',true);
 if not private.care_has('S900401',array['family']) then raise exception 'Fixture lacked its own care access';end if;
 result:=public.care_password_changed();
 if result->>'ok' is distinct from 'true' then raise exception 'Credential cutoff receipt missing';end if;
 if private.care_actor_enabled() or private.care_has('S900401',array['family']) then raise exception 'Old issued credential still has care access';end if;
 result:=public.care_account_self_state();
 if result->>'enabled' is distinct from 'true' or result->>'reauthenticationRequired' is distinct from 'true' then raise exception 'Password change suspended account or omitted reauthentication';end if;
 begin perform public.care_password_changed();raise exception 'Stale session changed the cutoff again';exception when insufficient_privilege then null;end;
 perform set_config('role','none',true);
 select credentials_valid_after into cutoff from public.care_account_settings where user_id=actor;
 if cutoff<=old_iat then raise exception 'Own credential cutoff was not advanced';end if;
 if not exists(select 1 from public.care_account_settings where user_id=other_user and enabled and credentials_valid_after=17) then raise exception 'Another account was changed';end if;
 if (select count(*) from public.care_memberships where user_id=actor::text and status='active' and role='family' and senior_id='S900401')<>1 then raise exception 'Password change altered household identity';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','iat',cutoff+1)::text,true);
 perform set_config('role','authenticated',true);
 if not private.care_actor_enabled() or not private.care_has('S900401',array['family']) then raise exception 'A fresh verified credential cannot regain its own care access';end if;
 if private.care_has('S900402',array['family']) then raise exception 'Fresh sign-in gained another household';end if;
 perform set_config('role','none',true);
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 perform set_config('role','anon',true);
 begin perform public.care_password_changed();raise exception 'Anonymous caller invoked credential cutoff';exception when insufficient_privilege then null;end;
 perform set_config('role','none',true);
end $$;
rollback;
select 'PASS: own cutoff advanced, old credentials denied, fresh own access retained, other user unchanged and anonymous rejected; fixtures rolled back, no Auth password changed' as result;
