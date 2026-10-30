-- A short issue label comes only from saved, assertion-aware cue IDs. Never
-- copy raw notes, caller-supplied labels or diagnostic/model prose into SMS.
create function private.care_sms_reported_issue(analysis jsonb,request_kind text,compact boolean default false)
returns text language sql immutable set search_path='' as $$
 with catalog(cue,label,short_label,priority) as (values
  ('chest_pain','chest pain','Chest pain',100),
  ('breathlessness','breathing trouble','Breathing trouble',100),
  ('fainting','fainting','Fainting',98),
  ('speech_change','speech difficulty','Speech difficulty',97),
  ('fall','a fall','A fall',95),
  ('extra_dose','an extra medicine dose','Extra dose',94),
  ('confusion','confusion','Confusion',90),
  ('mobility_help','difficulty standing or walking','Mobility help',85),
  ('fluid_intake','trouble drinking fluids','Fluid intake help',75),
  ('pain','pain or discomfort','Pain',70),
  ('dizziness','dizziness','Dizziness',65),
  ('vomiting','vomiting','Vomiting',65),
  ('fever_report','feeling feverish','Feeling feverish',65),
  ('swelling','swelling','Swelling',60),
  ('loose_stools','loose stools','Loose stools',60),
  ('urinary_discomfort','urinary discomfort','Urinary discomfort',60),
  ('missed_medication','missed medicine','Missed medicine',55),
  ('medicine_supply','medicine refill help','Medicine refill',50),
  ('medicine_question','a medicine schedule question','Medicine question',45),
  ('low_appetite','low appetite','Low appetite',40),
  ('poor_sleep','poor sleep','Poor sleep',35),
  ('fatigue','tiredness or weakness','Weakness',30),
  ('loneliness','loneliness','Loneliness',25),
  ('care_access','visit or transport help','Visit/transport help',20)
 ), observed as (
  select distinct item->>'cue' as cue
  from jsonb_array_elements(case when jsonb_typeof(analysis->'cues')='array' then analysis->'cues' else '[]'::jsonb end) item
 ), chosen as (
  select c.* from catalog c join observed o using(cue)
  where c.cue<>'pain' or not exists(select 1 from observed where cue='chest_pain')
  order by c.priority desc,c.cue limit case when compact then 1 else 2 end
 )
 select coalesce((select string_agg(case when compact then short_label else label end,', ' order by priority desc,cue) from chosen),
  case when analysis->'reasons' ? 'The sender reports feeling unwell.' then case when compact then 'Feeling unwell' else 'feeling unwell' end
   when request_kind='help' then case when compact then 'Help; confirm reason' else 'help requested; reason unconfirmed' end
   else case when compact then 'Call; confirm reason' else 'callback requested; reason unconfirmed' end end)
$$;
revoke all on function private.care_sms_reported_issue(jsonb,text,boolean) from public,anon,authenticated,service_role;

create or replace function private.care_routed_sms_text(route_key text) returns text
language plpgsql stable security definer set search_path='' as $$
declare notice public.care_notification_routes%rowtype; phone_request public.care_phone_requests%rowtype;
 label text; prefix text:='Samarth Care: '; suffix text; topic text; compact_topic text;
 limit_chars integer:=160; budget integer; compact boolean; urgent boolean;
begin
 select * into notice from public.care_notification_routes where id=route_key;
 if not found or not private.care_actor_enabled()
  or not private.care_has(notice.senior_id,array['coordinator','operations'])
  or not private.care_route_member(notice.user_id::text,notice.senior_id,notice.recipient_role)
  then raise insufficient_privilege;end if;
 if notice.recipient_role='senior' then return private.care_sms_text(notice.kind,'en','senior');end if;
 select name into label from public.care_profiles where owner='workspace:primary' and senior_id=notice.senior_id;
 label:=trim(regexp_replace(regexp_replace(regexp_replace(coalesce(label,'Senior'),
  U&'[^\0001-\FFFF]','','g'),U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]','','g'),'[[:cntrl:][:space:]]+',' ','g'));
 if label='' then label:='Senior';end if;
 compact:=label !~ '^[A-Za-z0-9 .''-]*$';
 select * into phone_request from public.care_phone_requests where senior_id=notice.senior_id
  and (request_id::text=notice.source_id or notice.source_id='phone:'||id::text) limit 1;
 if phone_request.id is not null then
  urgent:=coalesce(phone_request.analysis->>'urgency'='immediate',false);
  topic:=private.care_sms_reported_issue(phone_request.analysis,phone_request.kind,false);
  compact_topic:=private.care_sms_reported_issue(phone_request.analysis,phone_request.kind,true);
  if notice.recipient_role in ('coordinator','operations') then
   suffix:=' ('||notice.senior_id||'). '||case when urgent then 'URGENT. ' else '' end||'Reported: '||topic||'. '
    ||to_char(phone_request.received_at at time zone 'Asia/Kolkata','DD/MM HH24:MI')||' IST. Call '||phone_request.sender||case when urgent then ' now.' else '; verify identity.' end;
   if compact then suffix:=' ('||notice.senior_id||'). '||compact_topic||'. Call '||phone_request.sender||'.';end if;
  else
   suffix:=' ('||notice.senior_id||'). '||case when urgent then 'URGENT. ' else '' end||'Reported: '||topic||'. '
    ||case when urgent then 'Check on them now; contact care team.' else 'Please check on them and contact the care team.' end;
   if compact then suffix:=' ('||notice.senior_id||'). '||compact_topic||'. Contact care team.';end if;
  end if;
 else
  topic:=case notice.kind when 'support_request' then 'Support requested' when 'staff_alert' then 'Review needed'
   when 'care_message' then 'New care message' when 'escalation' then 'Overdue care request'
   when 'serious_alert' then 'Care follow-up needed' when 'weekly_summary' then 'Reviewed weekly update ready'
   else 'Care update' end;
  suffix:=' ('||notice.senior_id||'). '||topic||'. '||case when notice.recipient_role='family' then 'Please contact the care team or open your care inbox.' else 'Open your care queue for details.' end;
  if compact then
   compact_topic:=case notice.kind when 'support_request' then 'Support request' when 'staff_alert' then 'Review needed'
    when 'care_message' then 'Care message' when 'escalation' then 'Overdue request'
    when 'serious_alert' then 'Follow-up needed' when 'weekly_summary' then 'Weekly update ready' else 'Care update' end;
   suffix:=' ('||notice.senior_id||'). '||compact_topic||'. Open inbox.';
  end if;
 end if;
 if compact then prefix:='Samarth: ';limit_chars:=70;end if;
 budget:=limit_chars-char_length(prefix)-char_length(suffix);
 if budget<4 then raise check_violation using message='The care alert exceeds one SMS segment';end if;
 if char_length(label)>budget then label:=left(label,budget-1)||'.';end if;
 return prefix||label||suffix;
end $$;
-- Existing text snapshots and receipts remain immutable. The replacement
-- retains caller scope, recipient linkage and family-sharing checks.
