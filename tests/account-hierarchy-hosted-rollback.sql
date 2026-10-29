-- Synthetic contact bindings only. Every mutation is rolled back; no job is sent.
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select owner_user_id from public.care_workspaces where id='primary'),'role','authenticated')::text,true);
select set_config('samarth_test.coordinator_id',(select a->>'userId' from jsonb_array_elements(public.care_account_directory()) a where a->'roles' ? 'coordinator'),true);
select set_config('samarth_test.family_id',(select a->>'userId' from jsonb_array_elements(public.care_account_directory()) a where a->'roles' ? 'family'),true);
select set_config('samarth_test.senior1_id',(select a->>'userId' from jsonb_array_elements(public.care_account_directory()) a where a->'roles' ? 'senior' and a->'seniorIds' ? 'S001'),true);
set local role authenticated;
do $$ declare family_id uuid; accounts jsonb; contacts jsonb; contact jsonb; stamp text; begin
 accounts:=public.care_account_directory();
 if jsonb_array_length(accounts)<>5 or (select count(*) from jsonb_array_elements(accounts)a where a->'roles' ? 'operations')<>1 or (select count(*) from jsonb_array_elements(accounts)a where a->'roles' ? 'coordinator')<>1 or (select count(*) from jsonb_array_elements(accounts)a where a->'roles' ? 'family')<>1 or (select count(*) from jsonb_array_elements(accounts)a where a->'roles' ? 'senior')<>2 then raise exception 'Expected five configured showcase accounts across four roles';end if;
 select (a->>'userId')::uuid into family_id from jsonb_array_elements(accounts) a where a->'roles' ? 'family';
 perform public.care_set_account_phone(family_id,'+19990000001',true,false,true);
 contacts:=public.care_account_phone_contacts();
 if (select count(*) from jsonb_array_elements(contacts) c where c->>'userId'=family_id::text and c->>'role'='family' and c->>'seniorId' in ('S001','S002'))<>2 then raise exception 'Family mobile did not route to both linked seniors';end if;
 if exists(select 1 from jsonb_array_elements(contacts)c where c->'callConsent'='true') then raise exception 'SMS permission incorrectly granted calls';end if;
 perform public.care_update_account_channels(family_id,false,true,true);
 if exists(select 1 from jsonb_array_elements(public.care_account_phone_contacts())c where c->'smsConsent'='true') then raise exception 'Channel-only update did not disable SMS';end if;
 perform public.care_set_account_phone(family_id,'+19990000002',false,true,true);
 if exists(select 1 from jsonb_array_elements(public.care_account_phone_contacts())c where c->>'phone'='+19990000001') then raise exception 'Old mobile remains routable';end if;
 perform public.care_set_account_phone(family_id,null,false,false,false);
 if exists(select 1 from jsonb_array_elements(public.care_account_phone_contacts())c where c->>'userId'=family_id::text) then raise exception 'Removed mobile remains routable';end if;
 perform public.care_set_account_phone(auth.uid(),'+19990000003',true,false,true);
 select c into contact from jsonb_array_elements(public.care_account_phone_contacts()) c where c->>'role'='operations' and c->>'seniorId'='S001';
 if contact is null then raise exception 'Operations recipient missing';end if;
 stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','workspace:primary','telephony_job','S001',jsonb_build_object(
 'id','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','seniorId','S001','contactId',contact->>'id','recipientRole','operations','channel','sms','template','checkin','language','en',
 'text','Samarth Care: Please share a short wellbeing update with your care coordinator. This is not an emergency service.',
 'status','queued','requestHash',repeat('a',64),'state',jsonb_build_object('step',0),'createdAt',stamp,'expiresAt',to_char(clock_timestamp()+interval '30 minutes','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'asOfDate','2026-10-29','requestedBy',auth.uid(),'externalDelivery',false,'deliveredToHandset',false,'humanRead',false),stamp);
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('samarth_test.coordinator_id'),'role','authenticated','user_metadata',jsonb_build_object('is_admin',true,'role','operations'))::text,true);
set local role authenticated;
do $$ begin
 if private.care_admin() then raise exception 'Coordinator became admin';end if;
 begin perform public.care_account_directory();raise exception 'Coordinator read admin directory';exception when insufficient_privilege then null;end;
 if not private.care_has('S001',array['coordinator']) or private.care_has('S003',array['coordinator']) then raise exception 'Coordinator assignment boundary failed';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('samarth_test.family_id'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if not private.care_has('S001',array['family']) or not private.care_has('S002',array['family']) or private.care_has('S003',array['family']) then raise exception 'Family linkage boundary failed';end if;
 begin perform public.care_account_phone_contacts();raise exception 'Family read phone directory';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('samarth_test.senior1_id'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if not private.care_has('S001',array['senior']) or private.care_has('S002',array['senior']) then raise exception 'Senior identity isolation failed';end if;
end $$;
reset role;
rollback;
