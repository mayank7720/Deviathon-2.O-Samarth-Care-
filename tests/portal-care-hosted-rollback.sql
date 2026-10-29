-- Run as database owner after the migration. Every fixture and event rolls back.
begin;
do $$
declare coord uuid:=gen_random_uuid(); fam uuid:=gen_random_uuid(); peer uuid:=gen_random_uuid(); senior uuid:=gen_random_uuid(); stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 select id,'portal-rollback-'||id||'@example.invalid','authenticated','authenticated',now(),now(),now(),'{}','{}' from (values(coord),(fam),(peer),(senior)) u(id);
 insert into public.care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,status,is_admin,created_at) values
 (coord::text,'primary',coord::text,'portal-rollback-'||coord||'@example.invalid','Rollback care coordinator','coordinator','','["S999997"]','active',0,stamp),
 (fam::text,'primary',fam::text,'portal-rollback-'||fam||'@example.invalid','Rollback family','family','S999997','["S999997"]','active',0,stamp),
 (peer::text,'primary',peer::text,'portal-rollback-'||peer||'@example.invalid','Rollback second family','family','S999997','["S999997"]','active',0,stamp),
 (senior::text,'primary',senior::text,'portal-rollback-'||senior||'@example.invalid','Rollback senior','senior','S999997','["S999997"]','active',0,stamp);
 insert into public.care_consents(owner,senior_id,family_allowed,actor_id,updated_at) values('workspace:primary','S999997',true,coord::text,stamp);
 perform set_config('test.portal.coord',coord::text,true);perform set_config('test.portal.family',fam::text,true);perform set_config('test.portal.peer',peer::text,true);perform set_config('test.portal.senior',senior::text,true);perform set_config('test.portal.date',private.care_history_current_date()::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.portal.coord'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$
declare id text:=gen_random_uuid()::text; msg text:=gen_random_uuid()::text; stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); p jsonb;
begin
 p:=jsonb_build_object('requestId',id,'seniorId','S999997','action','Arrange a wellbeing call','details','Shared with this household','dueDate',current_setting('test.portal.date'),'priority','today','status','requested','revision',1,'createdBy',auth.uid()::text,'createdByRole','coordinator','createdByName','Rollback care coordinator','assignedTo',null,'assignedToName',null,'createdAt',stamp,'updatedAt',stamp,'actorId',auth.uid()::text,'actorName','Rollback care coordinator');
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(id,'workspace:primary','care_request','S999997',p,stamp);
 perform set_config('test.portal.request',id,true);
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(msg,'workspace:primary','communication','S999997',jsonb_build_object('seniorId','S999997','senderId',auth.uid()::text,'senderRole','coordinator','recipientId',current_setting('test.portal.family'),'recipientRole','family','channel','in_app','body','Please share a convenient call time.','status','delivered_in_app'),stamp);
 perform set_config('test.portal.message',msg,true);
 if (select count(*) from jsonb_array_elements(public.care_conversation_recipients('S999997')) r where r->>'userId' in (current_setting('test.portal.family'),current_setting('test.portal.peer'),current_setting('test.portal.senior')))<>3 then raise exception 'Recipient directory did not return assigned household members';end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.portal.peer'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$begin
 if exists(select 1 from public.care_events where id=current_setting('test.portal.message')) then raise exception 'Targeted message leaked to another family member';end if;
 begin
  insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','communication_read','S999997',jsonb_build_object('messageId',current_setting('test.portal.message'),'userId',auth.uid()::text),now()::text);
  raise exception 'A non-recipient was allowed to forge a read receipt';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.portal.family'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$declare p jsonb;reply_id text:=gen_random_uuid()::text;stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');begin
 select payload into p from public.care_events where id=current_setting('test.portal.request');
 if p is null then raise exception 'Family cannot see shared follow-up';end if;
 p:=p||jsonb_build_object('status','completed','revision',2,'reply','I have read this','outcome','Self-reported completion','updatedAt',stamp,'actorId',auth.uid()::text,'actorName','Rollback family');
 begin
  insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','care_request_state','S999997',p,stamp);
  raise exception 'Family was allowed to close a staff follow-up';
 exception when insufficient_privilege then null;end;
 p:=p||jsonb_build_object('status','acknowledged','outcome','');
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','care_request_state','S999997',p,stamp);
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','communication_read','S999997',jsonb_build_object('messageId',current_setting('test.portal.message'),'userId',auth.uid()::text),stamp);
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(reply_id,'workspace:primary','communication','S999997',jsonb_build_object('seniorId','S999997','senderId',auth.uid()::text,'senderRole','family','recipientId',current_setting('test.portal.coord'),'recipientRole','coordinator','channel','in_app','body','Tomorrow morning is convenient.','status','delivered_in_app'),stamp);
 perform set_config('test.portal.reply',reply_id,true);
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.portal.coord'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$declare p jsonb;stamp text:=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');begin
 select payload into p from public.care_events where kind='care_request_state' and payload->>'requestId'=current_setting('test.portal.request');
 p:=p||jsonb_build_object('status','completed','revision',3,'outcome','Coordinator recorded the agreed next contact.','updatedAt',stamp,'actorId',auth.uid()::text,'actorName','Rollback care coordinator');
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','care_request_state','S999997',p,stamp);
 begin
  insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','care_request_state','S999997',p,stamp);
  raise exception 'A duplicate request revision was accepted';
 exception when unique_violation then null;end;
 insert into public.care_events(id,owner,kind,senior_id,payload,created_at) values(gen_random_uuid()::text,'workspace:primary','communication_read','S999997',jsonb_build_object('messageId',current_setting('test.portal.reply'),'userId',auth.uid()::text),stamp);
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.portal.family'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$begin
 if not exists(select 1 from public.care_events where kind='communication_read' and payload->>'messageId'=current_setting('test.portal.reply')) then raise exception 'Message sender cannot see recipient acknowledgement';end if;
end $$;
reset role;
update public.care_consents set family_allowed=false where owner='workspace:primary' and senior_id='S999997';
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.portal.family'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$begin
 if exists(select 1 from public.care_events where senior_id='S999997' and kind in ('communication','care_request','care_request_state','checkin')) then raise exception 'Revoked family consent did not remove shared access';end if;
 if public.care_conversation_recipients('S999997')<>'[]'::jsonb then raise exception 'Revoked family can still enumerate care contacts';end if;
end $$;
rollback;
