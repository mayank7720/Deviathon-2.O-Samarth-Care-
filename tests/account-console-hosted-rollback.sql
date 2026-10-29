-- Exercise administrator transactions and caller-scoped RLS; no Auth API calls.
begin;
set local role service_role;
do $$ declare actor uuid;target uuid;request uuid:=gen_random_uuid();r jsonb;begin
 select owner_user_id::uuid into actor from public.care_workspaces where id='primary';
 select user_id::uuid into target from public.care_memberships where email='family@samarth.test' and status='active' limit 1;
 r:=public.care_admin_request(actor,request,'assign',repeat('a',64));if r->>'fresh'<>'true' then raise exception 'Fresh request failed';end if;
 r:=public.care_admin_request(actor,request,'assign',repeat('a',64));if r->>'fresh'<>'false' then raise exception 'Duplicate request claimed twice';end if;
 perform public.care_admin_apply(actor,target,'assign','{"role":"family","seniorIds":["S003"],"allSeniors":false}',request);
 if (select count(*) from public.care_memberships where user_id=target::text and role='family' and status='active')<>3 then raise exception 'Family allocation replaced old links';end if;
 r:=public.care_admin_request(actor,request,'assign',repeat('a',64));if r->>'status'<>'completed' then raise exception 'Completed request did not replay';end if;
 perform public.care_admin_apply(actor,target,'update','{"name":"Updated Family","role":"family","seniorIds":["S001","S002"],"allSeniors":false}');
 if exists(select 1 from public.care_memberships where user_id=target::text and role='family' and senior_id='S003' and status='active') then raise exception 'Old link retained after replacement';end if;
 begin perform public.care_admin_apply(actor,actor,'suspend','{}');raise exception 'Administrator suspended itself';exception when insufficient_privilege then null;end;
 begin perform public.care_admin_apply(actor,target,'assign','{"role":"family","seniorIds":["S999"],"allSeniors":false}');raise exception 'Invented senior accepted';exception when invalid_parameter_value then null;end;
 perform public.care_admin_apply(actor,target,'suspend','{}');
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='family@samarth.test'),'role','authenticated','iat',extract(epoch from now())::bigint+30)::text,true);
set local role authenticated;
do $$ begin
 if private.care_has('S001',array['family']) then raise exception 'Suspended account accessed senior';end if;
 if exists(select 1 from public.care_memberships where user_id=auth.uid()::text) then raise exception 'Suspended account retained memberships';end if;
end $$;
reset role;
set local role service_role;
do $$ declare actor uuid;target uuid;coord uuid;begin
 select owner_user_id::uuid into actor from public.care_workspaces where id='primary';
 select user_id::uuid into target from public.care_memberships where email='family@samarth.test' limit 1;
 select user_id::uuid into coord from public.care_memberships where email='coordinator@samarth.test' and status='active' limit 1;
 perform public.care_admin_apply(actor,target,'restore','{}');
 perform public.care_admin_apply(actor,coord,'assign','{"role":"coordinator","seniorIds":["S003"],"allSeniors":false}');
 if not exists(select 1 from public.care_memberships where user_id=coord::text and status='active' and scope_json::jsonb ? 'S001' and scope_json::jsonb ? 'S003') then raise exception 'Coordinator caseload did not merge';end if;
 begin perform public.care_admin_apply(coord,target,'suspend','{}');raise exception 'Coordinator administered users';exception when insufficient_privilege then null;end;
 perform public.care_admin_apply(actor,target,'password','{}');
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='family@samarth.test'),'role','authenticated','iat',1)::text,true);
set local role authenticated;
do $$ begin if private.care_has('S001',array['family']) then raise exception 'Old token retained access after password reset';end if;end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='family@samarth.test'),'role','authenticated','iat',extract(epoch from now())::bigint+30)::text,true);
set local role authenticated;
do $$ begin if not private.care_has('S001',array['family']) then raise exception 'Fresh session did not regain restored access';end if;end $$;
reset role;
rollback;
