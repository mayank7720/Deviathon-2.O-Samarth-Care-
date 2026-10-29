-- Synthetic recipient-routing regression. No gateway, call or SMS request is made.
begin;
do $$declare c uuid:=gen_random_uuid(); other_c uuid:=gen_random_uuid();f uuid:=gen_random_uuid();owner_id uuid;stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');begin
 select owner_user_id::uuid into owner_id from public.care_workspaces where id='primary';
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) select x,'route-'||x||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from(values(c),(other_c),(f))t(x);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values
 (c::text,'primary',c::text,'route-'||c||'@example.invalid','Routing primary','coordinator','','["S001"]',0,'active','1900-01-01'),
 (other_c::text,'primary',other_c::text,'route-'||other_c||'@example.invalid','Routing unrelated','coordinator','','["S002"]',0,'active','1900-01-01'),
 (f::text,'primary',f::text,'route-'||f||'@example.invalid','Routing family','family','S001','["S001"]',0,'active',stamp);
 insert into public.care_account_contacts(user_id,phone,sms_consent,call_consent,recipient_confirmed,revision) values(c,'+19990000091',true,false,true,1),(other_c,'+19990000092',true,false,true,1);
 update public.care_consents set family_allowed=true where owner='workspace:primary' and senior_id='S001';
 perform set_config('test.route.date',private.care_history_current_date()::text,true);perform set_config('test.route.coord',c::text,true);perform set_config('test.route.family',f::text,true);perform set_config('test.route.other',other_c::text,true);perform set_config('test.route.owner',owner_id::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.route.family'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$declare id text:=gen_random_uuid()::text;stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');p jsonb;begin
 p:=jsonb_build_object('requestId',id,'seniorId','S001','action','Please arrange a call','details','Synthetic family support request','dueDate',current_setting('test.route.date'),'priority','today','status','requested','revision',1,'createdBy',auth.uid()::text,'createdByRole','family','createdByName','Routing family','assignedTo',null,'assignedToName',null,'createdAt',stamp,'updatedAt',stamp,'actorId',auth.uid()::text,'actorName','Routing family');
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at)values(id,'workspace:primary','care_request','S001',p,stamp);
 perform set_config('test.route.request',id,true);
 if exists(select 1 from public.care_notification_routes n where n.source_id=current_setting('test.route.request')) then raise exception 'Family leaked staff routing metadata';end if;
 begin perform public.care_notification_routing('process','{}');raise exception 'Family ran staff processor';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.route.coord'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$declare result jsonb;job text;contact jsonb;begin
 if (select count(*) from public.care_notification_routes where source_id=current_setting('test.route.request') and user_id::text=current_setting('test.route.coord') and kind='support_request')<>1 then raise exception 'Primary coordinator did not receive atomic support intent';end if;
 if exists(select 1 from public.care_notification_routes where source_id=current_setting('test.route.request') and user_id::text=current_setting('test.route.other')) then raise exception 'Unrelated coordinator received support intent';end if;
 result:=public.care_notification_routing('process','{}');
 select job_id into job from public.care_notification_routes where source_id=current_setting('test.route.request') and user_id::text=auth.uid()::text;
 if job is null or not exists(select 1 from public.care_events where id=job and kind='telephony_job' and payload->>'recipientRole'='coordinator' and payload->>'template'='support_request' and payload->>'status'='queued' and payload->'externalDelivery'='false') then raise exception 'Coordinator SMS was not queued accurately';end if;
 perform set_config('test.route.job',job,true);
 result:=public.care_notification_routing('process','{}');
 if (select count(*) from public.care_events where kind='telephony_job' and id=job)<>1 then raise exception 'Duplicate processing created duplicate job';end if;
 select c into contact from jsonb_array_elements(public.care_account_phone_contacts()) c where c->>'userId'=auth.uid()::text and c->>'seniorId'='S001';
 if contact->>'phone'<>'+19990000091' then raise exception 'Staff contact did not resolve current bound phone';end if;
end $$;
reset role;
update public.care_account_contacts set phone='+19990000093',revision=revision+1 where user_id::text=current_setting('test.route.coord');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.route.coord'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$declare job text;begin
 perform public.care_notification_routing('process','{}');
 select job_id into job from public.care_notification_routes where source_id=current_setting('test.route.request') and user_id::text=auth.uid()::text;
 if job=current_setting('test.route.job') then raise exception 'Changed phone retained stale queued target';end if;
 if not exists(select 1 from public.care_events where id=current_setting('test.route.job') and payload->>'status'='cancelled') then raise exception 'Old unsent phone request not cancelled';end if;
 if not exists(select 1 from jsonb_array_elements(public.care_account_phone_contacts()) c where c->>'userId'=auth.uid()::text and c->>'phone'='+19990000093') then raise exception 'Replacement phone did not resolve';end if;
end $$;
reset role;
update public.care_account_contacts set sms_consent=false,revision=revision+1 where user_id::text=current_setting('test.route.coord');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.route.coord'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$begin
 perform public.care_notification_routing('process','{}');
 if not exists(select 1 from public.care_notification_routes where source_id=current_setting('test.route.request') and status='awaiting_contact') then raise exception 'Withdrawn SMS consent was ignored';end if;
end $$;
reset role;
-- A family with a second linked senior receives a consented serious update for that senior.
insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) select id||'-second','primary',user_id,email,display_name,'family','S002','["S002"]',0,'active',created_at from public.care_memberships where user_id=current_setting('test.route.family') limit 1;
update public.care_consents set family_allowed=true where owner='workspace:primary' and senior_id='S002';
update public.care_daily_scores set payload=payload||'{"level":"high","reasons":["Synthetic routing regression"]}'::jsonb where owner='workspace:primary' and senior_id='S002' and score_date=(select max(score_date) from public.care_daily_scores where senior_id='S002');
do $$begin
 if not exists(select 1 from public.care_notification_routes where senior_id='S002' and user_id::text=current_setting('test.route.family') and recipient_role='family' and kind='serious_alert') then raise exception 'Second linked senior did not route to consented family';end if;
end $$;
-- Only an actual reviewed summary transition creates its SMS-ready notice.
do $$declare ident text:='routing-summary-'||gen_random_uuid();begin
 insert into public.care_deliveries(id,owner,senior_id,recipient_role,user_id,kind,channel,status,payload,source_id,created_at,attempts)values(ident,'workspace:primary','S001','family',current_setting('test.route.family'),'weekly_summary','in_app','pending_review','{"summary":{"text":"Synthetic reviewed summary"},"body":"Synthetic reviewed summary"}',ident,now()::text,0);
 if exists(select 1 from public.care_notification_routes where source_id='approved-report:'||ident) then raise exception 'Unreviewed summary queued a phone notice';end if;
 update public.care_deliveries set status='queued' where id=ident;
 if not exists(select 1 from public.care_notification_routes where source_id='approved-report:'||ident and kind='weekly_summary' and user_id::text=current_setting('test.route.family')) then raise exception 'Reviewed summary notice did not route to its recipient';end if;
end $$;
rollback;
select 'PASS: atomic support routing, exact assigned coordinator, current phone, withdrawal, deduplication; all fixtures rolled back' as result;
