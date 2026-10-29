-- Administrator-run synthetic database regression. No call or service request;
-- all users, contacts, jobs and policy exercises are rolled back.
begin;
create temporary table sim_fixture(actor uuid,outsider uuid,contact_id text,job_id text,job2_id text,payload jsonb) on commit drop;
grant select,update on sim_fixture to authenticated;
create function pg_temp.sim_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'SIM guard regression: %',label;end if;end$$;
do $setup$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();h text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');h2 text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');id1 text;id2 text;c text:='sim-rollback-'||substr(gen_random_uuid()::text,1,8);stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');p jsonb;
begin
 if exists(select 1 from public.care_events where kind='sim_call_bridge' and id='sim-call-caller-lock' and payload->>'activeJobId' is not null) then raise exception 'Run this rollback regression only while the prepared SIM caller is idle';end if;
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) select id,'sim-rollback-'||id||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from (values(a),(b)) x(id);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values
 (a::text,'primary',a::text,'sim-rollback-'||a||'@example.invalid','Synthetic SIM coordinator','coordinator','','["S999999"]',1,'active',stamp),
 (b::text,'primary',b::text,'sim-rollback-'||b||'@example.invalid','Synthetic other coordinator','coordinator','','["S999998"]',0,'active',stamp);
 id1:=substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12);
 id2:=substr(h2,1,8)||'-'||substr(h2,9,4)||'-'||substr(h2,13,4)||'-'||substr(h2,17,4)||'-'||substr(h2,21,12);
 p:=jsonb_build_object('id',id1,'seniorId','S999999','contactId',c,'recipientRole','senior','language','hi','requestedBy',a,'requestHash',h,'status','queued','state',jsonb_build_object('step',0),'createdAt',stamp,'expiresAt',to_char((now()+interval '30 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'externalDelivery',false,'callAnswered',false,'consentGranted',false,'audioCount',0,'transcriptStatus','not_started','humanRead',false);
 insert into sim_fixture values(a,b,c,id1,id2,p);
end $setup$;
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) from sim_fixture;
do $queued$
declare x sim_fixture%rowtype;p jsonb;changed integer;
begin
 select * into x from sim_fixture;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(x.job_id,'workspace:primary','sim_call_job','S999999',x.payload,now()::text);raise exception 'Missing verified contact was accepted';exception when insufficient_privilege then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('sim-fixture-contact:'||x.contact_id,'workspace:primary','telephony_contact','S999999',jsonb_build_object('contact',jsonb_build_object('id',x.contact_id,'seniorId','S999999','role','senior','phone','+19990000001','verified',true,'callConsent',true,'smsConsent',true),'actorId',x.actor),now()::text);
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(x.job_id,'workspace:primary','sim_call_job','S999999',x.payload||'{"status":"answers_recorded","callAnswered":true,"consentGranted":true,"audioCount":4}'::jsonb,now()::text);raise exception 'Fabricated initial recording was accepted';exception when invalid_parameter_value then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(x.job_id,'workspace:primary','sim_call_job','S999999',x.payload,now()::text);
 select payload into p from public.care_events where id=x.job_id;
 begin update public.care_events set payload=p||jsonb_build_object('state',jsonb_build_object('step',1),'status','claimed','leaseHash',repeat('a',64),'leaseExpiresAt',now()+interval '10 minutes') where id=x.job_id;raise exception 'Call claim without caller lock was accepted';exception when insufficient_privilege then null;end;
 if not exists(select 1 from public.care_events where id='sim-call-caller-lock') then insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('sim-call-caller-lock','workspace:primary','sim_call_bridge','','{"state":{"step":0},"activeJobId":null,"lockedUntil":null}',now()::text);end if;
 update public.care_events set payload=payload||jsonb_build_object('id','sim-call-caller-lock','seniorId','','state',jsonb_build_object('step',(payload#>>'{state,step}')::integer+1),'activeJobId',x.job_id,'lockedUntil',to_char((now()+interval '10 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id='sim-call-caller-lock';
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('sim-fixture-contact-changed:'||x.contact_id,'workspace:primary','telephony_contact','S999999',jsonb_build_object('contact',jsonb_build_object('id',x.contact_id,'seniorId','S999999','role','family','phone','+19990000001','verified',true,'callConsent',true,'smsConsent',true),'actorId',x.actor),now()::text);
 begin update public.care_events set payload=p||jsonb_build_object('state',jsonb_build_object('step',1),'status','claimed','leaseHash',repeat('a',64),'leaseExpiresAt',to_char((now()+interval '10 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=x.job_id;raise exception 'Changed contact recipient identity was accepted';exception when insufficient_privilege then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('sim-fixture-contact-restored:'||x.contact_id,'workspace:primary','telephony_contact','S999999',jsonb_build_object('contact',jsonb_build_object('id',x.contact_id,'seniorId','S999999','role','senior','phone','+19990000001','verified',true,'callConsent',true,'smsConsent',true),'actorId',x.actor),now()::text);
 update public.care_events set payload=p||jsonb_build_object('state',jsonb_build_object('step',1),'status','claimed','leaseHash',repeat('a',64),'leaseExpiresAt',to_char((now()+interval '10 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=x.job_id;
 get diagnostics changed=row_count;perform pg_temp.sim_assert(changed=1,'one fresh claim');
 select payload into p from public.care_events where id=x.job_id;
 begin update public.care_events set payload=p||'{"state":{"step":2},"status":"queued"}'::jsonb where id=x.job_id;raise exception 'Claimed call was requeued';exception when invalid_parameter_value then null;end;
 begin update public.care_events set payload=p||'{"state":{"step":2},"status":"originated","callAnswered":true,"externalDelivery":true}'::jsonb where id=x.job_id;raise exception 'CLI exit fabricated a call answer';exception when invalid_parameter_value then null;end;
 begin update public.care_events set payload=payload||jsonb_build_object('state',jsonb_build_object('step',(payload#>>'{state,step}')::integer+1),'activeJobId',null,'lockedUntil',null) where id='sim-call-caller-lock';raise exception 'Active caller lock was released without terminal evidence';exception when insufficient_privilege then null;end;
 update public.care_events set payload=p||'{"state":{"step":2},"status":"submission_unknown"}'::jsonb where id=x.job_id;
 update public.care_events set payload=payload||jsonb_build_object('state',jsonb_build_object('step',(payload#>>'{state,step}')::integer+1),'lockedUntil','9999-12-31T00:00:00.000Z') where id='sim-call-caller-lock';
 begin update public.care_events set payload=payload||jsonb_build_object('state',jsonb_build_object('step',(payload#>>'{state,step}')::integer+1),'activeJobId',null,'lockedUntil',null) where id='sim-call-caller-lock';raise exception 'Unknown call lock was cleared';exception when insufficient_privilege then null;end;
 select payload into p from public.care_events where id=x.job_id;
 begin update public.care_events set payload=p||'{"state":{"step":3},"status":"failed"}'::jsonb where id=x.job_id;raise exception 'Terminal unknown state was overwritten';exception when insufficient_privilege then null;end;
end $queued$;
select set_config('request.jwt.claim.sub',outsider::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true) from sim_fixture;
do $scope$
declare x sim_fixture%rowtype;changed integer;
begin
 select * into x from sim_fixture;
 update public.care_events set payload=payload||'{"state":{"step":3},"status":"failed"}'::jsonb where id=x.job_id;
 get diagnostics changed=row_count;perform pg_temp.sim_assert(changed=0,'another coordinator cannot mutate the job');
 perform pg_temp.sim_assert(not exists(select 1 from public.care_events where id=x.job_id),'another coordinator cannot read the scoped job');
end $scope$;
reset role;
select 'SIM database guard rollback regression passed; no calls or persistent fixtures' as result;
rollback;
