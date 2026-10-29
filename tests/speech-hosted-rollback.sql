-- Synthetic direct-REST-equivalent provenance regression. All data rolls back.
begin;
create temporary table speech_fixture(actor uuid,other_actor uuid,family uuid,ticket text,draft jsonb,review jsonb,signal jsonb) on commit drop;
grant select,update on speech_fixture to authenticated;
do $setup$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();f uuid:=gen_random_uuid();ticket text:=gen_random_uuid()::text;secret text;raw text;t jsonb;p jsonb;stamp text:=now()::text;clock_ms numeric:=floor(extract(epoch from now())*1000);
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='samarth_speech_secret';
 if secret is null then raise exception 'Missing private speech pairing';end if;
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) select x,'speech-rollback-'||x||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from (values(a),(b),(f)) ids(x);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) values
 (a::text,'primary',a::text,'speech-rollback-'||a||'@example.invalid','Synthetic speech coordinator','coordinator','','["S001"]',0,'active',stamp),
 (b::text,'primary',b::text,'speech-rollback-'||b||'@example.invalid','Synthetic other coordinator','coordinator','','["S001"]',0,'active',stamp),
 (f::text,'primary',f::text,'speech-rollback-'||f||'@example.invalid','Synthetic family','family','S001','["S001"]',0,'active',stamp);
 t:=jsonb_build_object('version',1,'ticketId',ticket,'seniorId','S001','actorId',a,'origin','http://127.0.0.1:5173','model','faster-whisper:base','language','hi','languageProbability',0.8,'durationSeconds',4,'audioSha256',repeat('a',64),'text','Synthetic transcript: a friendly check-in was requested.','segments',jsonb_build_array(jsonb_build_object('start',0,'end',4,'text','Synthetic fixture only.')),'createdAt',clock_ms,'expiresAt',clock_ms+86400000,'externalServiceUsed',false);
 raw:=t::text;
 p:=jsonb_build_object('transcription',t,'receipt',jsonb_build_object('payload',raw,'signature',encode(extensions.hmac(convert_to(E'speech-receipt\n'||raw,'UTF8'),convert_to(secret,'UTF8'),'sha256'),'hex')),'consentConfirmed',true,'actorId',a,'status','awaiting_review');
 insert into speech_fixture values(a,b,f,ticket,p,
 jsonb_build_object('ticketId',ticket,'action','approve','editedText','Synthetic human-reviewed check-in request.','note','Synthetic review regression','actorId',a,'originalAudioSha256',repeat('a',64),'createdAt',stamp),
 jsonb_build_object('type','note','record',jsonb_build_object('seniorId','S001','date',to_char(now() at time zone 'Asia/Kolkata','YYYY-MM-DD'),'note','Synthetic human-reviewed check-in request.','source','local-whisper-reviewed','transcription',jsonb_build_object('ticketId',ticket,'model','faster-whisper:base','audioSha256',repeat('a',64),'reviewedBy',a))));
end $setup$;
set local role authenticated;
select set_config('request.jwt.claim.sub',actor::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) from speech_fixture;
do $guard$
declare x speech_fixture%rowtype; shadow_key text;
begin
 select * into x from speech_fixture;
 foreach shadow_key in array array['kind','owner','senior_id','created_at','sequence'] loop
  begin
   insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('speech-shadow:'||gen_random_uuid(),'workspace:primary','audit','S001',jsonb_build_object(shadow_key,'signal'),now()::text);
   raise exception 'Payload metadata shadow accepted: %',shadow_key;
  exception when invalid_parameter_value then null;end;
 end loop;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('speech-draft:'||x.ticket,'workspace:primary','speech_draft','S001',jsonb_set(x.draft,'{receipt,signature}',to_jsonb(repeat('0',64))),now()::text);raise exception 'Forged signature accepted';exception when insufficient_privilege then null;end;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('speech-draft:'||x.ticket,'workspace:primary','speech_draft','S001',jsonb_set(x.draft,'{transcription,text}','"Words changed outside signed receipt"'),now()::text);raise exception 'Unsigned words accepted';exception when invalid_parameter_value then null;end;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('speech-signal:'||x.ticket,'workspace:primary','signal','S001',x.signal,now()::text);raise exception 'Unreviewed signal accepted';exception when invalid_parameter_value then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('speech-draft:'||x.ticket,'workspace:primary','speech_draft','S001',x.draft,now()::text);
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('speech-draft:'||x.ticket,'workspace:primary','speech_draft','S001',x.draft,now()::text);raise exception 'Receipt replay accepted';exception when unique_violation then null;end;
 -- No UPDATE/DELETE policy exposes append-only speech records.
 update public.care_events set payload=x.draft||'{"status":"approved"}' where id='speech-draft:'||x.ticket;
 if found then raise exception 'Draft update was permitted';end if;
 delete from public.care_events where id='speech-draft:'||x.ticket;
 if found then raise exception 'Draft deletion was permitted';end if;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('speech-review:'||x.ticket,'workspace:primary','speech_review','S001',x.review||jsonb_build_object('actorId',x.other_actor),now()::text);raise exception 'Forged reviewer accepted';exception when invalid_parameter_value then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('speech-review:'||x.ticket,'workspace:primary','speech_review','S001',x.review,now()::text);
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('speech-signal:'||x.ticket,'workspace:primary','signal','S001',jsonb_set(x.signal,'{record,note}','"Unapproved extra words"'),now()::text);raise exception 'Different approved words accepted';exception when invalid_parameter_value then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('speech-signal:'||x.ticket,'workspace:primary','signal','S001',x.signal,now()::text);
 if (select count(*) from public.care_events where id in ('speech-draft:'||x.ticket,'speech-review:'||x.ticket,'speech-signal:'||x.ticket))<>3 then raise exception 'Approved workflow did not save exactly three events';end if;
end $guard$;
select set_config('request.jwt.claim.sub',family::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',family,'role','authenticated')::text,true) from speech_fixture;
do $family$
declare x speech_fixture%rowtype;
begin
 select * into x from speech_fixture;
 if exists(select 1 from public.care_events where id in ('speech-draft:'||x.ticket,'speech-review:'||x.ticket)) then raise exception 'Family read staff transcript drafts';end if;
 begin insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values('speech-review:'||gen_random_uuid()::text,'workspace:primary','speech_review','S001',x.review||jsonb_build_object('actorId',x.family),now()::text);raise exception 'Family reviewed staff transcript';exception when insufficient_privilege then null;end;
end $family$;
reset role;
rollback;
select 'Speech provenance, review, replay and scope checks passed; all fixtures rolled back.' as verification;
