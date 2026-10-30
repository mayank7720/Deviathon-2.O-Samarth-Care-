begin;

do $setup$ declare c uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); stamp text:='2000-01-01T00:00:00Z';begin
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 select id,'phone-rollback-'||id||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from(values(c),(s),(f)) u(id);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,status,is_admin,created_at) values
 (c::text,'primary',c::text,'phone-test@example.invalid','Rollback phone coordinator','coordinator','','["S999997"]','active',0,stamp),
 (s::text,'primary',s::text,'senior-test@example.invalid','Rollback phone senior','senior','S999997','["S999997"]','active',0,stamp),
 (f::text||'-a','primary',f::text,'family-test@example.invalid','Rollback shared family','family','S999997','["S999997"]','active',0,stamp),
 (f::text||'-b','primary',f::text,'family-test@example.invalid','Rollback shared family','family','S999998','["S999998"]','active',0,stamp);
 insert into public.care_profiles(owner,senior_id,name,profile,updated_at) values
 ('workspace:primary','S999997','Rollback phone senior','{"id":"S999997","name":"Rollback phone senior","dataProvenance":{"kind":"recorded","synthetic":false}}',stamp),
 ('workspace:primary','S999998','Rollback second senior','{"id":"S999998","name":"Rollback second senior","dataProvenance":{"kind":"recorded","synthetic":false}}',stamp);
 insert into public.care_account_contacts(user_id,phone,sms_consent,call_consent,recipient_confirmed) values(c,'+19990000003',true,true,true),(s,'+19990000001',true,true,true),(f,'+19990000002',true,true,true);
 insert into public.care_consents(owner,senior_id,family_allowed,actor_id,updated_at) values('workspace:primary','S999997',true,c::text,stamp),('workspace:primary','S999998',true,c::text,stamp);
 perform set_config('test.phone.coord',c::text,true);perform set_config('test.phone.senior',s::text,true);perform set_config('test.phone.family',f::text,true);
end $setup$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.phone.coord'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $check$ declare p jsonb; r jsonb; second jsonb; ident text; rows_count integer;begin
 p:=jsonb_build_object('eventId',repeat('a',64),'sender','+19990000001','kind','help','language','en','message','HELP: rollback test only','receivedAt',now(),'nonce','rollback-phone-nonce-00000001');
 r:=public.care_phone_support('receive',p);if r->>'matched'<>'true' then raise exception 'Registered senior was not matched';end if;
 ident:=r->>'id';perform set_config('test.phone.request',ident,true);
 second:=public.care_phone_support('receive',p||jsonb_build_object('nonce','rollback-phone-nonce-00000002'));
 if second->>'id'<>ident or second->>'replayed'<>'true' then raise exception 'Replay was not deduplicated';end if;

 declare unrelated uuid:=gen_random_uuid(); original jsonb; request_source text; staff_text text; family_text text;begin
 select z->>'requestId' into request_source from jsonb_array_elements(public.care_phone_support('list','{}')->'requests') z where z->>'id'=ident;
 select e.payload into original from public.care_events e where e.id=request_source;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(unrelated::text,'workspace:primary','care_request','S999997',original||jsonb_build_object('requestId',unrelated,'action','Unrelated website request'),'2000-01-01T00:00:00Z');
 perform public.care_phone_support('outbound','{}');
 if exists(select 1 from public.care_notification_routes where source_id=unrelated::text and job_id is not null) then raise exception 'Phone worker drained unrelated notification';end if;
 if not exists(select 1 from public.care_notification_routes n where n.source_id=request_source and n.job_id is not null) then raise exception 'Phone alert did not queue';end if;
 if (select count(*) from public.care_notification_routes where source_id=request_source and recipient_role='family')<>1 then raise exception 'Family phone notice missing or duplicated';end if;
 select e.payload->>'text' into staff_text from public.care_notification_routes n join public.care_events e on e.id=n.job_id where n.source_id=request_source and n.recipient_role='coordinator';
 select e.payload->>'text' into family_text from public.care_notification_routes n join public.care_events e on e.id=n.job_id where n.source_id=request_source and n.recipient_role='family';
 if staff_text is null or strpos(staff_text,'Rollback phone senior (S999997)')=0 or strpos(staff_text,'+19990000001')=0 or strpos(staff_text,'help requested; reason unconfirmed')=0 or strpos(staff_text,' IST.')=0 then raise exception 'Staff SMS lacks senior identity, reported issue, caller or time';end if;
 if family_text is null or strpos(family_text,'Rollback phone senior (S999997)')=0 or strpos(family_text,'help requested; reason unconfirmed')=0 or strpos(family_text,'+19990000001')>0 then raise exception 'Family SMS issue, identity or privacy failed';end if;
 if char_length(staff_text)>160 or char_length(family_text)>160 or strpos(staff_text,'HELP: rollback test only')>0 or strpos(family_text,'HELP: rollback test only')>0 then raise exception 'Raw note leaked or SMS exceeds one segment';end if;
 perform set_config('test.phone.family_job',(select job_id from public.care_notification_routes where source_id=request_source and recipient_role='family'),true);
 -- Even a valid route cannot authorize client-written text or another senior.
 begin
  insert into public.care_events(id,owner,kind,senior_id,payload,created_at)
   select id,owner,kind,senior_id,payload||jsonb_build_object('text','Invented private message'),created_at from public.care_events where id=current_setting('test.phone.family_job');
  raise exception 'Forged contextual alert was accepted';exception when invalid_parameter_value or insufficient_privilege then null;
 end;
 begin
  insert into public.care_events(id,owner,kind,senior_id,payload,created_at)
   select 'cccccccc-cccc-cccc-cccc-cccccccccccc',owner,kind,senior_id,payload||jsonb_build_object('id','cccccccc-cccc-cccc-cccc-cccccccccccc','requestHash',repeat('c',64)),created_at from public.care_events where id=current_setting('test.phone.family_job');
  raise exception 'Unbound contextual route was accepted';exception when invalid_parameter_value or insufficient_privilege then null;
 end;
 begin
  update public.care_events set payload=payload||jsonb_build_object('text','Changed private message','state',jsonb_build_object('step',1)) where id=current_setting('test.phone.family_job');
  raise exception 'Contextual message text was mutable';exception when invalid_parameter_value or insufficient_privilege then null;
 end;
 end;
 perform public.care_phone_support('acknowledge',jsonb_build_object('id',ident));
 perform public.care_phone_support('called',jsonb_build_object('id',ident));
 perform public.care_phone_support('acknowledge',jsonb_build_object('id',ident));
 r:=public.care_phone_support('list','{}');
 if not exists(select 1 from jsonb_array_elements(r->'requests') e where e->>'id'=ident and e->>'status'='called') then raise exception 'Contact attempt regressed';end if;
 perform public.care_phone_support('close',jsonb_build_object('id',ident,'outcome','A human recorded the agreed support outcome.'));
 p:=p||jsonb_build_object('eventId',repeat('b',64),'sender','+19990000002','nonce','rollback-phone-nonce-00000003');
 r:=public.care_phone_support('receive',p);if r->>'matched'<>'false' then raise exception 'Shared family number was guessed';end if;
 p:=p||jsonb_build_object('eventId',repeat('c',64),'sender','+19990000999','nonce','rollback-phone-nonce-00000004');
 r:=public.care_phone_support('receive',p);if r->>'matched'<>'false' then raise exception 'Unknown number was guessed';end if;
 r:=public.care_phone_support('contact',jsonb_build_object('seniorId','S999997'));if r#>>'{coordinator,phone}'<>'+19990000003' then raise exception 'Assigned contact incorrect';end if;
end $check$;
do $sms_analysis$ declare p jsonb; r jsonb; found_analysis jsonb;begin
 p:=jsonb_build_object('eventId',repeat('d',64),'sender','+19990000001','kind','help','language','en','message','I fell yesterday.','receivedAt',now(),'nonce','rollback-sms-analysis-00000001',
  'analysis',jsonb_build_object('version','sms-understanding-v1','method','local-assertion-rules','intent','help','urgency','immediate','externalServiceUsed',false,
   'cues',jsonb_build_array(jsonb_build_object('cue','fall','evidence','I fell yesterday')),'reasons',jsonb_build_array('A fall mentioned')));
 r:=public.care_phone_support('receive',p);
 select z->'analysis' into found_analysis from jsonb_array_elements(public.care_phone_support('list','{}')->'requests') z where z->>'id'=r->>'id';
 if found_analysis is distinct from p->'analysis' then raise exception 'SMS analysis was not saved and returned';end if;
 if not exists(select 1 from public.care_events e where e.id='phone-signal:'||(r->>'id') and e.payload#>>'{record,smsAnalysis,urgency}'='immediate') then raise exception 'SMS evidence was not dated in care history';end if;
 p:=p||jsonb_build_object('eventId',repeat('f',64),'nonce','rollback-sms-model-00000001','analysis',p->'analysis'||jsonb_build_object('version','sms-understanding-v2','method','local-rules-and-intent-ml','classifier',jsonb_build_object('modelId','sms-intent-v2','mode','shadow','accepted',false)));
 r:=public.care_phone_support('receive',p);
 select z->'analysis' into found_analysis from jsonb_array_elements(public.care_phone_support('list','{}')->'requests') z where z->>'id'=r->>'id';
 if found_analysis#>>'{classifier,mode}' is distinct from 'shadow' or found_analysis#>>'{classifier,accepted}' is distinct from 'false' then raise exception 'Model review-only provenance was not retained';end if;
 begin
  perform public.care_phone_support('receive',p||jsonb_build_object('eventId',repeat('e',64),'analysis',p->'analysis'||jsonb_build_object('intent','callback')));
  raise exception 'Mismatched SMS intent was accepted';exception when invalid_parameter_value then null;
 end;
end $sms_analysis$;
reset role;
update public.care_phone_requests set created_at=clock_timestamp()-interval '3 minutes' where event_id in (repeat('b',64),repeat('c',64));
select private.care_phone_escalate();
do $escalation$ begin if (select count(*) from public.care_phone_requests where escalated_at is not null)<2 then raise exception 'Overdue unmatched callers did not escalate';end if;end $escalation$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.phone.family'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $denied$ begin
 begin perform public.care_phone_support('list','{}');raise exception 'Family read incoming queue';exception when insufficient_privilege then null;end;
 begin perform public.care_phone_support('acknowledge',jsonb_build_object('id',current_setting('test.phone.request')));raise exception 'Family acknowledged a staff request';exception when insufficient_privilege then null;end;
 perform public.care_phone_support('contact',jsonb_build_object('seniorId','S999997'));
end $denied$;

-- Family notices must use current sharing and channel consent, including after
-- a request was received. Every fixture and any queued SMS roll back below.
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.phone.coord'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
update public.care_consents set family_allowed=false where owner='workspace:primary' and senior_id='S999997';
set local role authenticated;
do $no_sharing$ declare r jsonb; request_source text;begin
 r:=public.care_phone_support('receive',jsonb_build_object('eventId',repeat('1',64),'sender','+19990000001','kind','callback','language','en','message','CALL ME','receivedAt',now(),'nonce','rollback-family-sharing-00000001'));
 select z->>'requestId' into request_source from jsonb_array_elements(public.care_phone_support('list','{}')->'requests') z where z->>'id'=r->>'id';
 if exists(select 1 from public.care_notification_routes n where n.source_id=request_source and n.recipient_role='family') then raise exception 'Family notified without sharing consent';end if;
 perform public.care_phone_support('outbound','{}');
 if exists(select 1 from public.care_notification_routes n where n.senior_id='S999997' and n.recipient_role='family' and n.status='queued') then raise exception 'Revoked family sharing left a queued notification';end if;
end $no_sharing$;
reset role;
update public.care_consents set family_allowed=true where owner='workspace:primary' and senior_id='S999997';
update public.care_account_contacts set sms_consent=false where user_id=current_setting('test.phone.family')::uuid;
set local role authenticated;
do $no_sms_consent$ declare r jsonb; request_source text;begin
 r:=public.care_phone_support('receive',jsonb_build_object('eventId',repeat('2',64),'sender','+19990000001','kind','callback','language','en','message','CALL ME','receivedAt',now(),'nonce','rollback-family-channel-00000001'));
 select z->>'requestId' into request_source from jsonb_array_elements(public.care_phone_support('list','{}')->'requests') z where z->>'id'=r->>'id';
 perform public.care_phone_support('outbound','{}');
 if not exists(select 1 from public.care_notification_routes n where n.source_id=request_source and n.recipient_role='family' and n.status='awaiting_contact' and n.job_id is null) then raise exception 'Missing family SMS permission was not retained as awaiting contact';end if;
end $no_sms_consent$;

reset role;
update public.care_account_contacts set sms_consent=true where user_id=current_setting('test.phone.family')::uuid;
update public.care_profiles set name=repeat('आशा वर्मा ',12) where owner='workspace:primary' and senior_id='S999997';
do $context_fixtures$ declare kind text;begin
 foreach kind in array array['serious_alert','followup','weekly_summary'] loop
  perform private.care_route_notice('S999997',current_setting('test.phone.family'),'family',kind,'rollback-context-'||kind);
 end loop;
 foreach kind in array array['support_request','staff_alert','care_message','escalation'] loop
  perform private.care_route_notice('S999997',current_setting('test.phone.coord'),'coordinator',kind,'rollback-context-'||kind);
 end loop;
end $context_fixtures$;
set local role authenticated;
do $unicode_snapshot$ declare route_key text; value text;begin
 select id into route_key from public.care_notification_routes where senior_id='S999997' and recipient_role='family' and status='awaiting_contact' limit 1;
 value:=private.care_routed_sms_text(route_key);
 if char_length(value)>70 or strpos(value,'आशा')=0 or strpos(value,'(S999997)')=0 then raise exception 'Unicode identity does not fit one SMS';end if;
 for route_key in select id from public.care_notification_routes where senior_id='S999997' and source_id like 'rollback-context-%' loop
  value:=private.care_routed_sms_text(route_key);
  if char_length(value)>70 or strpos(value,'आशा')=0 or strpos(value,'(S999997)')=0 then raise exception 'Unicode contextual template is not bounded';end if;
 end loop;
 perform public.care_phone_support('outbound','{}');
 -- Renaming a profile must not prevent the immutable already-queued message
 -- from being claimed. Consent is still checked independently at claim time.
end $unicode_snapshot$;
reset role;
update public.care_profiles set name='Updated senior name' where owner='workspace:primary' and senior_id='S999997';
set local role authenticated;
do $claim_snapshot$ declare job_id text;begin
 select n.job_id into job_id from public.care_notification_routes n where n.senior_id='S999997' and n.recipient_role='family' and n.status='queued' limit 1;
 if job_id is null then raise exception 'Consented family callback alert did not queue';end if;
 update public.care_events set payload=payload||jsonb_build_object('status','processing','state',jsonb_build_object('step',1),'leaseHash',repeat('a',64),'leaseExpiresAt',to_char(clock_timestamp()+interval '10 minutes','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=job_id;
end $claim_snapshot$;

-- Reported-issue labels, privacy, priorities and segment limits.
reset role;
do $issue_checks$
declare sample jsonb; staff_text text; family_text text; staff_route text; family_route text; saved_sender text;
begin
 if private.care_sms_reported_issue('{"cues":[{"cue":"pain"},{"cue":"chest_pain"},{"cue":"loneliness"}]}','help',false)<>'chest pain, loneliness' then raise exception 'Specific concern did not replace duplicate general pain';end if;
 if private.care_sms_reported_issue('{"cues":[{"cue":"invented","label":"Diagnosis and private details"}]}','help',false)<>'help requested; reason unconfirmed' then raise exception 'Untrusted issue label entered SMS';end if;
 if private.care_sms_reported_issue('{"cues":null,"reasons":["The sender reports feeling unwell."]}','callback',false)<>'feeling unwell' then raise exception 'Generic unwellness was lost';end if;
 if private.care_sms_reported_issue(null,'callback',false)<>'callback requested; reason unconfirmed' then raise exception 'Missing analysis invented a symptom';end if;
 if has_function_privilege('anon','private.care_sms_reported_issue(jsonb,text,boolean)','execute') or has_function_privilege('authenticated','private.care_sms_reported_issue(jsonb,text,boolean)','execute') then raise exception 'Issue formatter unexpectedly exposed';end if;
 -- Retain the fixture caller so existing recipient bindings remain untouched.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.phone.coord'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
 select sender into saved_sender from public.care_phone_requests where id=current_setting('test.phone.request')::uuid;
 select id into staff_route from public.care_notification_routes where source_id=(select request_id::text from public.care_phone_requests where id=current_setting('test.phone.request')::uuid) and recipient_role='coordinator';
 select id into family_route from public.care_notification_routes where source_id=(select request_id::text from public.care_phone_requests where id=current_setting('test.phone.request')::uuid) and recipient_role='family';
 for sample in select value from jsonb_array_elements('[
  {"urgency":"immediate","cues":[{"cue":"chest_pain","label":"Do not copy this private free text"},{"cue":"breathlessness"}]},
  {"urgency":"immediate","cues":[{"cue":"extra_dose"}]},
  {"urgency":"today","cues":[{"cue":"medicine_question"},{"cue":"mobility_help"}]},
  {"urgency":"today","cues":[{"cue":"loneliness"},{"cue":"poor_sleep"}]},
  {"urgency":"prompt","cues":[]}
 ]'::jsonb) loop
  sample:=sample||jsonb_build_object('version','sms-understanding-v2');
  update public.care_phone_requests set analysis=sample,sender='+123456789012345' where id=current_setting('test.phone.request')::uuid;
  update public.care_profiles set name='Rollback phone senior' where senior_id='S999997' and owner='workspace:primary';
  staff_text:=private.care_routed_sms_text(staff_route);family_text:=private.care_routed_sms_text(family_route);
  if char_length(staff_text)>160 or char_length(family_text)>160 or strpos(staff_text,'Reported: ')=0 or strpos(family_text,'Reported: ')=0 then raise exception 'ASCII alert issue or SMS budget failed';end if;
  if strpos(family_text,'+123456789012345')>0 or strpos(staff_text,'private free text')>0 or strpos(family_text,'private free text')>0 then raise exception 'Raw notes or staff-only caller leaked';end if;
  if sample->>'urgency'='immediate' and (strpos(staff_text,'URGENT.')=0 or strpos(family_text,'URGENT.')=0) then raise exception 'Immediate review priority missing';end if;
  if sample#>>'{cues,0,cue}'='chest_pain' and (strpos(staff_text,'chest pain')=0 or strpos(staff_text,'breathing trouble')=0 or strpos(family_text,'chest pain')=0 or strpos(family_text,'breathing trouble')=0) then raise exception 'Actual reported concerns missing';end if;
  update public.care_profiles set name=repeat('किरण ',18)||U&'\202E' where senior_id='S999997' and owner='workspace:primary';
  staff_text:=private.care_routed_sms_text(staff_route);family_text:=private.care_routed_sms_text(family_route);
  if char_length(staff_text)>70 or char_length(family_text)>70 or strpos(staff_text,'S999997')=0 or strpos(family_text,'S999997')=0 then raise exception 'Unicode alert budget or identity failed';end if;
  if strpos(staff_text,U&'\202E')>0 or strpos(family_text,U&'\202E')>0 then raise exception 'Bidi character entered SMS';end if;
 end loop;
 update public.care_phone_requests set sender=saved_sender where id=current_setting('test.phone.request')::uuid;
end $issue_checks$;

rollback;
