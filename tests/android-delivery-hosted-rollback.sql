-- Direct Data API-equivalent synthetic state regression. No SMS or call is sent.
begin;
create temporary table android_fixture(actor uuid,outsider uuid,job_id text,dial_id text,contact_id text,job jsonb,dial_job jsonb) on commit drop;
grant select,update on android_fixture to authenticated;
do $setup$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();h text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');hd text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');jid text;did text;c text:='android-rollback-'||substr(gen_random_uuid()::text,1,8);stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');p jsonb;
begin
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) select x,'android-rollback-'||x||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from (values(a),(b)) ids(x);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values
 (a::text,'primary',a::text,'android-rollback-'||a||'@example.invalid','Synthetic Android coordinator','coordinator','','["S999999"]',1,'active',stamp),
 (b::text,'primary',b::text,'android-rollback-'||b||'@example.invalid','Synthetic other coordinator','coordinator','','["S999998"]',0,'active',stamp);
 jid:=substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12);
 did:=substr(hd,1,8)||'-'||substr(hd,9,4)||'-'||substr(hd,13,4)||'-'||substr(hd,17,4)||'-'||substr(hd,21,12);
 p:=jsonb_build_object('id',jid,'seniorId','S999999','contactId',c,'recipientRole','senior','channel','sms','template','checkin','language','en','text','Samarth Care: Please share a short wellbeing update with your care coordinator. This is not an emergency service.','status','queued','requestHash',h,'state',jsonb_build_object('step',0),'createdAt',stamp,'expiresAt',to_char((now()+interval '30 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'asOfDate','2026-10-29','requestedBy',a,'externalDelivery',false,'deliveredToHandset',false,'humanRead',false);
 insert into android_fixture values(a,b,jid,did,c,p,p||jsonb_build_object('id',did,'requestHash',hd,'channel','android_dialer'));
end $setup$;
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) from android_fixture;
do $exercise$
declare x android_fixture%rowtype;p jsonb;stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');lease text:=to_char((now()+interval '10 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');changed integer;
begin
 select * into x from android_fixture;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(x.job_id,'workspace:primary','telephony_job','S999999',x.job,stamp);raise exception 'Unapproved destination accepted';exception when insufficient_privilege then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('android-contact:'||x.contact_id,'workspace:primary','telephony_contact','S999999',jsonb_build_object('contact',jsonb_build_object('id',x.contact_id,'seniorId','S999999','role','senior','phone','+19990000001','verified',true,'smsConsent',true,'callConsent',true),'actorId',x.actor),stamp);
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(x.job_id,'workspace:primary','telephony_job','S999999',x.job||'{"status":"delivered","externalDelivery":true,"deliveredToHandset":true}',stamp);raise exception 'Fabricated initial delivery accepted';exception when invalid_parameter_value then null;end;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(x.job_id,'workspace:primary','telephony_job','S999999',x.job||'{"text":"arbitrary text"}',stamp);raise exception 'Arbitrary SMS accepted';exception when invalid_parameter_value then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(x.job_id,'workspace:primary','telephony_job','S999999',x.job,stamp);
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('android-contact-withdraw:'||x.contact_id,'workspace:primary','telephony_contact','S999999',jsonb_build_object('contact',jsonb_build_object('id',x.contact_id,'seniorId','S999999','role','senior','phone','+19990000001','verified',true,'smsConsent',false,'callConsent',true),'actorId',x.actor),stamp);
 begin update public.care_events set payload=x.job||jsonb_build_object('status','processing','state',jsonb_build_object('step',1),'leaseHash',repeat('a',64),'leaseExpiresAt',lease,'updatedAt',stamp) where id=x.job_id;raise exception 'Withdrawn SMS permission accepted';exception when insufficient_privilege then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('android-contact-restore:'||x.contact_id,'workspace:primary','telephony_contact','S999999',jsonb_build_object('contact',jsonb_build_object('id',x.contact_id,'seniorId','S999999','role','senior','phone','+19990000001','verified',true,'smsConsent',true,'callConsent',true),'actorId',x.actor),stamp);
 begin update public.care_events set payload=x.job||jsonb_build_object('status','delivered','state',jsonb_build_object('step',1),'updatedAt',stamp) where id=x.job_id;raise exception 'Queue directly marked delivered';exception when insufficient_privilege then null;end;
 update public.care_events set payload=x.job||jsonb_build_object('status','processing','state',jsonb_build_object('step',1),'leaseHash',repeat('a',64),'leaseExpiresAt',lease,'updatedAt',stamp) where id=x.job_id;
 get diagnostics changed=row_count;if changed<>1 then raise exception 'Scoped coordinator could not claim once';end if;
 select payload into p from public.care_events where id=x.job_id;
 update public.care_events set payload=p||jsonb_build_object('status','cancelled','state',jsonb_build_object('step',2),'updatedAt',stamp) where id=x.job_id and (payload#>>'{state,step}')::integer=0;
 get diagnostics changed=row_count;if changed<>0 then raise exception 'Stale CAS updated a claimed job';end if;
 begin update public.care_events set payload=p||jsonb_build_object('status','processing','state',jsonb_build_object('step',2),'leaseHash',repeat('b',64),'updatedAt',stamp) where id=x.job_id;raise exception 'Live lease was stolen';exception when insufficient_privilege then null;end;
 update public.care_events set payload=p||jsonb_build_object('status','sent','state',jsonb_build_object('step',2),'provider','android_sms_gate','providerId',x.job_id,'externalDelivery',true,'deliveredToHandset',false,'lastError',null,'updatedAt',stamp) where id=x.job_id;
 select payload into p from public.care_events where id=x.job_id;
 begin update public.care_events set payload=p||jsonb_build_object('status','accepted','state',jsonb_build_object('step',3),'externalDelivery',false,'updatedAt',stamp) where id=x.job_id;raise exception 'Delivery state moved backward';exception when invalid_parameter_value then null;end;
 begin update public.care_events set payload=p||jsonb_build_object('status','delivered','state',jsonb_build_object('step',3),'providerId',gen_random_uuid()::text,'deliveredToHandset',true,'updatedAt',stamp) where id=x.job_id;raise exception 'Receipt provider identity changed';exception when invalid_parameter_value then null;end;
 update public.care_events set payload=p||jsonb_build_object('status','delivered','state',jsonb_build_object('step',3),'deliveredToHandset',true,'updatedAt',stamp) where id=x.job_id;
 select payload into p from public.care_events where id=x.job_id;
 begin update public.care_events set payload=p||jsonb_build_object('status','queued','state',jsonb_build_object('step',4),'updatedAt',stamp) where id=x.job_id;raise exception 'Terminal delivery was requeued';exception when insufficient_privilege then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(x.dial_id,'workspace:primary','telephony_job','S999999',x.dial_job,stamp);
 update public.care_events set payload=x.dial_job||jsonb_build_object('status','awaiting_device_action','state',jsonb_build_object('step',1),'updatedAt',stamp) where id=x.dial_id;
 if not exists(select 1 from public.care_events where id=x.dial_id and payload->>'status'='awaiting_device_action' and payload->'externalDelivery'='false'::jsonb) then raise exception 'Dialer-only state unavailable';end if;
end $exercise$;
select set_config('request.jwt.claim.sub',outsider::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true) from android_fixture;
do $scope$
declare x android_fixture%rowtype;changed integer;
begin
 select * into x from android_fixture;
 if exists(select 1 from public.care_events where id=x.job_id) then raise exception 'Outside coordinator read delivery';end if;
 update public.care_events set payload=payload||'{"status":"failed"}'::jsonb where id=x.job_id;
 get diagnostics changed=row_count;if changed<>0 then raise exception 'Outside coordinator updated delivery';end if;
end $scope$;
reset role;
rollback;
select 'Android delivery job RLS, fixed prompt, claim, CAS, monotonic receipt and scope checks passed; fixtures rolled back.' as verification;
