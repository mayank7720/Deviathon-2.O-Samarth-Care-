-- Administrator-run synthetic regression; every fixture and event is rolled back.
begin;
create temporary table care_ops_fixture(admin_id uuid,coordinator_id uuid,family_id uuid,case_id text,assignment jsonb,counts jsonb,case_payload jsonb,city_revision integer) on commit drop;
grant select,update on care_ops_fixture to authenticated;
create function pg_temp.ops_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'Care operations regression: %',label;end if;end$$;
do $setup$
declare a uuid:=gen_random_uuid();c uuid:=gen_random_uuid();f uuid:=gen_random_uuid();assignment jsonb;counts jsonb;city text;ledger jsonb;stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');caseid text:=gen_random_uuid()::text;
begin
 select entry||'{"source":"recorded"}'::jsonb into assignment from private.care_planning s,jsonb_array_elements(s.snapshot->'assignments') entry where entry->>'seniorId'='S001';
 assignment:=assignment-'revision';city:=assignment->>'city';
 select coalesce((select e.payload->'assignment' from public.care_events e where e.kind='care_assignment' and e.senior_id='S001' and e.payload->>'entryType'='assignment' order by (e.payload->>'revision')::integer desc limit 1),assignment) into assignment;
 select jsonb_object_agg(person->>'id',to_jsonb((select count(*) from private.care_planning s2,jsonb_array_elements(s2.snapshot->'assignments') entry where entry->>'counsellorId'=person->>'id'))) into counts from private.care_planning s,jsonb_array_elements(s.snapshot->'directory') person where person->>'city'=city and person->>'role'='counsellor';
 select e.payload into ledger from public.care_events e where e.kind='care_assignment' and e.payload->>'entryType'='assignment' and e.payload->>'city'=city order by (e.payload->>'revision')::integer desc limit 1;
 counts:=coalesce(ledger->'capacityCounts',counts);
 insert into care_ops_fixture values(a,c,f,caseid,assignment,counts,jsonb_build_object('id',caseid,'caseId',caseid,'seniorId','S001','category','companionship','action','Arrange a fictional friendly check-in','note','Synthetic regression with no real contact','assignedTo',assignment->>'counsellorId','status','open','revision',1,'actor',a,'createdAt',stamp,'updatedAt',stamp,'externalDelivery',false),coalesce((ledger->>'revision')::integer,0)+1);
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) select id,'ops-rollback-'||id::text||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from (values(a),(c),(f)) x(id);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values
 (a::text,'primary',a::text,'ops-rollback-'||a||'@example.invalid','Synthetic operations test admin','coordinator','','["*"]',1,'active',stamp),
 (c::text,'primary',c::text,'ops-rollback-'||c||'@example.invalid','Synthetic scoped test coordinator','coordinator','','["S001"]',0,'active',stamp),
 (f::text,'primary',f::text,'ops-rollback-'||f||'@example.invalid','Synthetic test family','family','S001','["S001"]',0,'active',stamp);
end $setup$;
set local role authenticated;
select set_config('request.jwt.claim.sub',admin_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true) from care_ops_fixture;
do $assignment_guard$
declare x care_ops_fixture%rowtype;p jsonb;
begin
 select * into x from care_ops_fixture;
 p:=jsonb_build_object('entryType','assignment','assignment',x.assignment,'city',x.assignment->>'city','revision',x.city_revision,'capacityCounts','{}'::jsonb,'actor',x.admin_id,'updatedAt',now());
 begin insert into public.care_events values('care-assignment-city:'||replace(x.assignment->>'city',' ','%20')||':'||x.city_revision,'workspace:primary','care_assignment','S001',p,now()::text);raise exception 'Forged capacity accepted';exception when invalid_parameter_value then null;end;
 p:=p||jsonb_build_object('capacityCounts',x.counts);
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-assignment-city:'||replace(x.assignment->>'city',' ','%20')||':'||x.city_revision,'workspace:primary','care_assignment','S001',p,now()::text);
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('different-envelope-bypass','workspace:primary','care_assignment','S001',p,now()::text);raise exception 'Forged assignment identity accepted';exception when invalid_parameter_value then null;end;
 begin perform 1 from private.care_planning;raise exception 'Client read private planning validation seed';exception when insufficient_privilege then null;end;
end $assignment_guard$;
select set_config('request.jwt.claim.sub',coordinator_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',coordinator_id,'role','authenticated')::text,true) from care_ops_fixture;
do $scoped_guard$
declare x care_ops_fixture%rowtype;p jsonb;
begin
 select * into x from care_ops_fixture;
 p:=jsonb_build_object('entryType','assignment','assignment',x.assignment,'city',x.assignment->>'city','revision',x.city_revision+1,'capacityCounts',x.counts,'actor',x.coordinator_id,'updatedAt',now());
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-assignment-city:'||replace(x.assignment->>'city',' ','%20')||':'||(x.city_revision+1),'workspace:primary','care_assignment','S001',p,now()::text);raise exception 'Scoped coordinator changed assignment';exception when insufficient_privilege then null;end;
 -- Coordinator can record its own scoped case, but cannot forge another actor.
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-case:'||x.case_id||':1','workspace:primary','care_followup','S001',x.case_payload,now()::text);raise exception 'Forged case actor accepted';exception when insufficient_privilege then null;end;
 update care_ops_fixture set case_payload=case_payload||jsonb_build_object('actor',x.coordinator_id);
 select case_payload into p from care_ops_fixture;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-case:'||x.case_id||':1','workspace:primary','care_followup','S001',p||'{"kind":"care_assignment","entryType":"assignment"}',now()::text);raise exception 'Payload shadowed database kind';exception when invalid_parameter_value then null;end;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-case:'||x.case_id||':1','workspace:primary','care_followup','S001',p||'{"updatedAt":123}',now()::text);raise exception 'Numeric timestamp accepted';exception when invalid_parameter_value then null;end;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-case:'||x.case_id||':1','workspace:primary','care_followup','S001',p||'{"revision":"1"}',now()::text);raise exception 'String revision accepted';exception when invalid_parameter_value then null;end;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-case:'||x.case_id||':1','workspace:primary','care_followup','S001',p||'{"id":"different-case"}',now()::text);raise exception 'Mismatched case identity accepted';exception when invalid_parameter_value then null;end;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-case:'||x.case_id||':1','workspace:primary','care_followup','S001',p||'{"note":1234567890123}',now()::text);raise exception 'Numeric action evidence accepted';exception when invalid_parameter_value then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-case:'||x.case_id||':1','workspace:primary','care_followup','S001',p,now()::text);
 select payload into p from public.care_events where id='care-case:'||x.case_id||':1';
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-case:'||x.case_id||':3','workspace:primary','care_followup','S001',p||'{"status":"resolved","revision":3,"outcome":"Skipped a revision"}',now()::text);raise exception 'Skipped case revision accepted';exception when unique_violation then null;end;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-case:'||x.case_id||':2','workspace:primary','care_followup','S001',p||'{"status":"contact_confirmed","revision":2,"contactChannel":"phone","contactResult":"no_answer"}',now()::text);raise exception 'Unanswered contact called confirmed';exception when invalid_parameter_value then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-case:'||x.case_id||':2','workspace:primary','care_followup','S001',p||'{"status":"contact_attempted","revision":2,"contactChannel":"phone","contactResult":"no_answer"}',now()::text);
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('care-case:'||x.case_id||':3','workspace:primary','care_followup','S001',p||'{"status":"resolved","revision":3}',now()::text);raise exception 'Resolution without outcome accepted';exception when invalid_parameter_value then null;end;
end $scoped_guard$;
select set_config('request.jwt.claim.sub',family_id::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',family_id,'role','authenticated')::text,true) from care_ops_fixture;
select pg_temp.ops_assert((select count(*)=0 from public.care_events where kind in ('care_assignment','care_followup')),'family cannot read staff case or assignment details');
reset role;
select 'PASS: admin assignment guard, unforgeable counts, scoped case writes, actor identity, sequential revisions, explicit contact/result/outcome and family denial; rolled back' as regression_result;
rollback;
