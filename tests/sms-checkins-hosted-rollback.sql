-- Synthetic users and phone numbers only. This file always rolls back.
begin;
do $setup$ declare c uuid:=gen_random_uuid();s uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();f uuid:=gen_random_uuid();stamp text:='2000-01-01T00:00:00Z';begin
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 select id,'checkin-rollback-'||id||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from(values(c),(s),(s2),(f)) x(id);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,status,is_admin,created_at) values
 (c::text,'primary',c::text,'checkin-c@example.invalid','Checkin fixture coordinator','coordinator','','["S999995","S999996"]','active',0,stamp),
 (s::text,'primary',s::text,'checkin-s@example.invalid','Checkin fixture senior','senior','S999995','["S999995"]','active',0,stamp),
 (s2::text,'primary',s2::text,'checkin-s2@example.invalid','Checkin fixture senior two','senior','S999996','["S999996"]','active',0,stamp),
 (f::text,'primary',f::text,'checkin-f@example.invalid','Checkin fixture family','family','S999995','["S999995"]','active',0,stamp);
 insert into public.care_profiles(owner,senior_id,name,profile,updated_at) values
 ('workspace:primary','S999995','Checkin fixture senior','{"id":"S999995","name":"Checkin fixture senior"}',stamp),
 ('workspace:primary','S999996','Checkin fixture senior two','{"id":"S999996","name":"Checkin fixture senior two"}',stamp);
 insert into public.care_account_contacts(user_id,phone,sms_consent,call_consent,recipient_confirmed) values(c,'+19990000013',true,true,true),(s,'+19990000011',true,true,true),(s2,'+19990000012',true,true,true),(f,'+19990000014',true,true,true);
 insert into public.care_consents(owner,senior_id,family_allowed,actor_id,updated_at) values('workspace:primary','S999995',true,c::text,stamp);
 perform set_config('test.checkin.c',c::text,true);perform set_config('test.checkin.s',s::text,true);perform set_config('test.checkin.s2',s2::text,true);
end $setup$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.checkin.c'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $create$ declare p jsonb;r jsonb;again jsonb;begin
 r:=public.care_sms_checkin('eligible',jsonb_build_object('senderHash',encode(extensions.digest('+19990000011','sha256'),'hex'),'nonce','checkin-masked-lookup-00001'));
 if r->>'eligible'<>'true' then raise exception 'Masked saved sender not eligible';end if;
 again:=public.care_sms_checkin('eligible',jsonb_build_object('senderHash',repeat('0',64),'nonce','checkin-masked-lookup-00001'));
 if again->>'eligible'<>'false' then raise exception 'Unknown sender was eligible';end if;
 p:=jsonb_build_object('seniorId','S999995','language','en','consentConfirmed',true,'windowHours',4,'idempotencyKey','checkin-rollback-create-001',
  'sendAt',((now() at time zone 'Asia/Kolkata')::date+1+time '10:00') at time zone 'Asia/Kolkata');
 r:=public.care_sms_checkin('create',p);again:=public.care_sms_checkin('create',p);
 if again->>'id'<>r->>'id' or again->>'duplicate'<>'true' then raise exception 'Question was not idempotent';end if;
 perform set_config('test.checkin.id',r->>'id',true);
 again:=public.care_sms_checkin('create',p||jsonb_build_object('seniorId','S999996','language','hi','idempotencyKey','checkin-rollback-hindi-00001'));
 perform public.care_sms_checkin('cancel',jsonb_build_object('id',again->>'id'));
 if not exists(select 1 from jsonb_array_elements(public.care_sms_checkin('list','{}')->'checkins') v
  where v->>'id'=again->>'id' and v->>'deliveryStatus'='cancelled' and length(v->>'prompt')<=160 and v->>'prompt' like '%Kaise hain%') then raise exception 'Hindi prompt or cancellation failed';end if;
 begin perform public.care_sms_checkin('create',p||jsonb_build_object('idempotencyKey','checkin-rollback-quiet-00001','sendAt',((now() at time zone 'Asia/Kolkata')::date+1+time '23:00') at time zone 'Asia/Kolkata'));raise exception 'Quiet schedule accepted';exception when raise_exception then if sqlerrm='Quiet schedule accepted' then raise;end if;end;
 begin perform public.care_sms_checkin('create',p||'{"idempotencyKey":"checkin-rollback-create-002"}'::jsonb);raise exception 'A duplicate open question was accepted';exception when raise_exception then if sqlerrm='A duplicate open question was accepted' then raise;end if;end;
 begin perform public.care_sms_checkin('create',p||'{"seniorId":"S999994"}'::jsonb);raise exception 'Foreign senior scope allowed';exception when insufficient_privilege then null;end;
 -- Direct table access remains denied, even to care staff.
 begin perform count(*) from public.care_sms_checkins;raise exception 'Direct questionnaire read allowed';exception when insufficient_privilege then null;end;
end $create$;
reset role;
update public.care_sms_checkins set send_at=clock_timestamp()-interval '1 minute',due_at=clock_timestamp()+interval '4 hours' where id=current_setting('test.checkin.id')::uuid;
set local role authenticated;
do $claim$ declare r jsonb;q jsonb;begin
 if extract(hour from clock_timestamp() at time zone 'Asia/Kolkata') between 8 and 19 then
  r:=public.care_sms_checkin('claim',jsonb_build_object('id',current_setting('test.checkin.id'),'nonce','checkin-rollback-claim-00001'));
  q:=r->'job';perform set_config('test.checkin.lease',q->>'leaseToken',true);
  begin perform public.care_sms_checkin('receipt',jsonb_build_object('id',q->>'id','leaseToken',gen_random_uuid(),'providerId',q->>'id','status','delivered','nonce','checkin-rollback-bad-lease-001'));raise exception 'Unleased receipt accepted';exception when insufficient_privilege then null;end;
  if length(q->>'text')>160 or q->>'channel'<>'sms' or q->>'phone'<>'+19990000011' then raise exception 'Incorrect or unbounded recipient prompt';end if;
  perform public.care_sms_checkin('receipt',jsonb_build_object('id',q->>'id','leaseToken',q->>'leaseToken','providerId',q->>'id','status','sent','nonce','checkin-rollback-receipt-001'));
  begin perform public.care_sms_checkin('receipt',jsonb_build_object('id',q->>'id','leaseToken',q->>'leaseToken','providerId',q->>'id','status','accepted','nonce','checkin-rollback-receipt-002'));raise exception 'Receipt moved backward';exception when invalid_parameter_value then null;end;
 else
  begin perform public.care_sms_checkin('claim',jsonb_build_object('id',current_setting('test.checkin.id'),'nonce','checkin-rollback-quiet-00001'));raise exception 'Quiet hours bypassed';exception when raise_exception then if sqlerrm='Quiet hours bypassed' then raise;end if;end;
 end if;
end $claim$;
reset role;
-- This is a fixture delivery state, not a real carrier receipt.
update public.care_sms_checkins set started_at=clock_timestamp()-interval '1 minute',delivery_status='sent' where id=current_setting('test.checkin.id')::uuid;
set local role authenticated;
do $reply$ declare p jsonb;r jsonb;again jsonb;entries jsonb;begin
 p:=jsonb_build_object('eventId',repeat('1',64),'sender','+19990000011','choice','3','code',null,'message','3','receivedAt',clock_timestamp(),'nonce','checkin-rollback-reply-00001');
 r:=public.care_sms_checkin('receive',p);
 if r->>'resolution'<>'matched' then raise exception 'Unique registered senior reply not matched: %',r->>'resolution';end if;
 begin perform public.care_sms_checkin('receive',p||jsonb_build_object('eventId',repeat('9',64),'choice','1','nonce','checkin-rollback-forged-001'));raise exception 'Choice disagreed with saved text';exception when invalid_parameter_value then null;end;
 again:=public.care_sms_checkin('receive',p||'{"nonce":"checkin-rollback-reply-00002"}');
 if again->>'id'<>r->>'id' or again->>'replayed'<>'true' then raise exception 'Physical reply not deduplicated';end if;
 r:=public.care_sms_checkin('receive',p||jsonb_build_object('eventId',repeat('2',64),'nonce','checkin-rollback-reply-00003'));
 if r->>'resolution'<>'duplicate' then raise exception 'Repeated answer was not preserved as duplicate';end if;
 entries:=public.care_sms_checkin('list','{}')->'checkins';
 if not exists(select 1 from jsonb_array_elements(entries) v where v->>'id'=current_setting('test.checkin.id') and v->>'answer'='3' and v->>'followupId' is not null and v->>'deliveryStatus'='sent') then raise exception 'Answer, follow-up or delivery separation missing';end if;
end $reply$;
reset role;
do $stored$ declare ident text:=current_setting('test.checkin.id');begin
 if (select count(*) from public.care_events where kind='signal' and id='sms-checkin-signal:'||ident)<>1 then raise exception 'Signal duplicated or missing';end if;
 if (select count(*) from public.care_events where kind='care_request' and payload->>'smsCheckinId'=ident)<>1 then raise exception 'Follow-up duplicated';end if;
 if not exists(select 1 from public.care_notification_routes n join public.care_sms_checkins c on c.followup_id::text=n.source_id where c.id=ident::uuid and n.recipient_role='family') then raise exception 'Consented family notice missing';end if;
 -- Changed binding must not attach replies to the old recipient snapshot.
 update public.care_account_contacts set revision=revision+1 where user_id=current_setting('test.checkin.s')::uuid;
end $stored$;
set local role authenticated;
do $changed$ declare r jsonb;begin
 r:=public.care_sms_checkin('receive',jsonb_build_object('eventId',repeat('3',64),'sender','+19990000011','choice','1','code',null,'message','1','receivedAt',clock_timestamp(),'nonce','checkin-rollback-reply-00004'));
 if r->>'resolution'<>'binding_changed' then raise exception 'Changed phone binding trusted';end if;
end $changed$;
reset role;
-- Shared number: even one open question requires its explicit code.
update public.care_account_contacts set phone='+19990000011' where user_id=current_setting('test.checkin.s2')::uuid;
do $new_question$ declare ident uuid;begin
 insert into public.care_sms_checkins(request_key,senior_id,recipient_id,contact_id,phone,code,language,prompt,requires_code,send_at,due_at,created_by,started_at,delivery_status)
  select 'shared-fixture-question',senior_id,recipient_id,regexp_replace(contact_id,'-[0-9]+$','-1'),phone,'AB12CD',language,prompt,true,
   clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 hours',created_by,clock_timestamp()-interval '1 minute','sent'
   from public.care_sms_checkins where id=current_setting('test.checkin.id')::uuid returning id into ident;
 perform set_config('test.checkin.id',ident::text,true);
end $new_question$;
set local role authenticated;
do $shared$ declare p jsonb;r jsonb;begin
 p:=jsonb_build_object('eventId',repeat('4',64),'sender','+19990000011','choice','2','code',null,'message','2','receivedAt',clock_timestamp(),'nonce','checkin-rollback-reply-00005');
 r:=public.care_sms_checkin('receive',p);if r->>'resolution'<>'needs_code' then raise exception 'Shared phone was guessed';end if;
 r:=public.care_sms_checkin('receive',p||jsonb_build_object('eventId',repeat('5',64),'nonce','checkin-rollback-reply-00006','code','AB12CD','message','AB12CD 2'));if r->>'resolution'<>'matched' then raise exception 'Coded shared reply did not match: %',r->>'resolution';end if;
 r:=public.care_sms_checkin('receive',p||jsonb_build_object('eventId',repeat('6',64),'nonce','checkin-rollback-reply-00007','sender','+19990000999','code','AB12CD','message','AB12CD 2'));if r->>'resolution'<>'unmatched' then raise exception 'A code granted another phone access';end if;
end $shared$;
reset role;
update public.care_sms_checkins set answer=null,answered_at=null,due_at=clock_timestamp()-interval '2 minutes' where id=current_setting('test.checkin.id')::uuid;
-- The scheduler has no user JWT and must create only one persisted task.
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select private.care_sms_checkin_sweep();
select private.care_sms_checkin_sweep();
reset role;
do $overdue$ begin
 if not exists(select 1 from public.care_sms_checkins where id=current_setting('test.checkin.id')::uuid and answer is null and overdue_at is not null and overdue_task_id is not null) then raise exception 'No-response task missing or false answer inserted';end if;
end $overdue$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.checkin.c'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $late_stop$ declare p jsonb;r jsonb;begin
 p:=jsonb_build_object('eventId',repeat('7',64),'sender','+19990000011','choice','3','code','AB12CD','message','AB12CD 3','receivedAt',clock_timestamp(),'nonce','checkin-rollback-reply-00008');
 r:=public.care_sms_checkin('receive',p);if r->>'resolution'<>'late' then raise exception 'Late reply treated as current response';end if;
 r:=public.care_sms_checkin('receive',p||jsonb_build_object('eventId',repeat('8',64),'nonce','checkin-rollback-reply-00009','choice','stop','code',null,'message','STOP'));if r->>'resolution'<>'stop' then raise exception 'STOP not processed';end if;
end $late_stop$;
reset role;
do $optout$ begin
 if exists(select 1 from public.care_account_contacts where phone='+19990000011' and sms_consent) then raise exception 'Opt-out did not revoke shared SMS permission';end if;
 if (select count(*) from public.care_sms_checkins where id=current_setting('test.checkin.id')::uuid and answer is null)<>1 then raise exception 'Late reply or STOP changed wellbeing';end if;
end $optout$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.checkin.s'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $household$ begin
 begin perform public.care_sms_checkin('list','{}');raise exception 'Senior accessed staff management';exception when insufficient_privilege then null;end;
end $household$;
reset role;
select 'SMS check-in rollback checks passed' as result;
rollback;
