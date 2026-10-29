-- A new senior is a new care identity, not a link to another person's record.
create sequence private.care_recorded_senior_sequence start with 100001 maxvalue 999999;
revoke all on sequence private.care_recorded_senior_sequence from public,anon,authenticated;
create function public.care_admin_onboard_senior(actor_id uuid,target_user_id uuid,details jsonb,request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare label text:=btrim(details->>'name'); mail text;sid text;profile jsonb;result jsonb;stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');day text:=private.care_history_current_date()::text;req private.care_account_admin_requests%rowtype;uid uuid:=target_user_id;
begin
 perform private.care_require_account_actor(actor_id);
 select * into req from private.care_account_admin_requests r where r.id=request_id for update;
 if req.actor_id is distinct from actor_id or req.action is distinct from 'onboard' then raise insufficient_privilege;end if;
 if req.status='completed' then return req.result;end if;
 if details-array['email','name','age','city','language','idempotencyKey']<>'{}'::jsonb or coalesce(length(label),0) not between 2 and 80 or coalesce(details->>'age','')!~'^[0-9]{2,3}$' or (details->>'age')::integer not between 60 and 120 or coalesce(length(btrim(details->>'city')),0) not between 2 and 80 or coalesce(details->>'language','') not in ('Hindi','English') then raise invalid_parameter_value;end if;
 select lower(email) into mail from auth.users where id=uid and email_confirmed_at is not null and deleted_at is null;
 if mail is null or mail is distinct from lower(btrim(details->>'email')) or exists(select 1 from public.care_memberships where user_id=uid::text and workspace_id='primary' and status='active') then raise invalid_parameter_value using message='New senior onboarding requires an unassigned confirmed login';end if;
 perform pg_advisory_xact_lock(hashtextextended('account:'||uid::text,0));
 sid:='S'||nextval('private.care_recorded_senior_sequence')::text;
 profile:=jsonb_build_object('id',sid,'name',label,'age',(details->>'age')::integer,'city',btrim(details->>'city'),'language',details->>'language','conditions','[]'::jsonb,'family','{}'::jsonb,'familyConsent',false,'coordinator','Awaiting care assignment','createdAt',stamp,'updatedAt',stamp,'dataProvenance',jsonb_build_object('kind','recorded','synthetic',false,'source','operations-onboarding','createdAt',stamp));
 insert into public.care_profiles(owner,senior_id,name,profile,updated_at) values('workspace:primary',sid,label,profile,stamp);
 insert into public.care_consents(owner,senior_id,family_allowed,actor_id,updated_at) values('workspace:primary',sid,false,actor_id::text,stamp);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values(gen_random_uuid()::text,'primary',uid::text,mail,label,'senior',sid,jsonb_build_array(sid)::text,0,'active',stamp);
 insert into public.care_account_settings(user_id) values(uid) on conflict do nothing;
 insert into public.care_account_contacts(user_id) values(uid) on conflict do nothing;
 insert into public.care_daily_scores(owner,senior_id,score_date,revision,payload,computed_at) values('workspace:primary',sid,day,'recorded-onboarding',profile||jsonb_build_object('asOfDate',day,'score',null,'level','unknown','warmup',true,'latest',null,'trend','[]'::jsonb,'action','Record an initial wellbeing check-in and assign a care coordinator.','reasons',jsonb_build_array(jsonb_build_object('title','No observations recorded','detail','New care record. No personal reference has been established.','source','data')),'seniorSafe',jsonb_build_object('id',sid,'name',label,'age',(details->>'age')::integer,'city',details->>'city','language',details->>'language','familyConsent',false,'latest','{}'::jsonb)),stamp);
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','audit',sid,jsonb_build_object('action','senior_onboarded','actorId',actor_id,'targetUserId',uid,'detail','Created the senior’s own care record and login; no observations, family links or phone number were invented.'),stamp);
 result:=jsonb_build_object('ok',true,'account',jsonb_build_object('userId',uid,'email',mail,'name',label),'senior',jsonb_build_object('id',sid,'name',label,'age',(details->>'age')::integer,'city',btrim(details->>'city'),'language',details->>'language'));
 update private.care_account_admin_requests r set status='completed',result=care_admin_onboard_senior.result where r.id=request_id and r.actor_id=care_admin_onboard_senior.actor_id;
 return result;
end $$;
revoke all on function public.care_admin_onboard_senior(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.care_admin_onboard_senior(uuid,uuid,jsonb,uuid) to service_role;

create function private.care_recorded_profiles() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(case when private.care_service() or private.care_has(p.senior_id,array['coordinator','operations','senior']) or private.care_family_allowed(p.senior_id) then p.profile else jsonb_build_object('id',p.senior_id,'name','Sharing disabled','familyConsent',false,'dataProvenance',jsonb_build_object('kind','recorded','synthetic',false)) end order by p.senior_id),'[]'::jsonb)
 from public.care_profiles p where p.owner='workspace:primary' and p.profile#>>'{dataProvenance,kind}'='recorded' and (private.care_service() or private.care_has(p.senior_id,array['coordinator','operations','senior','family']))
$$;
create function public.care_recorded_profiles() returns jsonb language sql stable security invoker set search_path='' as $$select private.care_recorded_profiles()$$;
revoke all on function private.care_recorded_profiles(),public.care_recorded_profiles() from public,anon;
grant execute on function private.care_recorded_profiles(),public.care_recorded_profiles() to authenticated,service_role;
