-- Keep database envelopes authoritative even for direct REST event insertion.
create function private.care_operations_envelope() returns trigger language plpgsql security invoker set search_path='' as $$
declare p jsonb:=new.payload; stamp text:=to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');field text;
begin
 if new.kind not in ('care_assignment','care_followup') then return new;end if;
 if p ?| array['kind','owner','payload','senior_id','created_at','sequence','history','historyComplete'] then raise invalid_parameter_value using message='Care payload cannot override the database event envelope';end if;
 if jsonb_typeof(p->'revision') is distinct from 'number' or jsonb_typeof(p->'updatedAt') is distinct from 'string' then raise invalid_parameter_value using message='Care revision and timestamps have invalid types';end if;
 if new.kind='care_followup' then
  if p->>'id' is distinct from p->>'caseId' or jsonb_typeof(p->'createdAt') is distinct from 'string' then raise invalid_parameter_value using message='Care case identity or creation timestamp is invalid';end if;
  foreach field in array array['action','note','category','status','assignedTo','caseId','id','seniorId'] loop
   if jsonb_typeof(p->field) is distinct from 'string' then raise invalid_parameter_value using message='Care text fields must contain text';end if;
  end loop;
  if p ? 'outcome' and jsonb_typeof(p->'outcome') is distinct from 'string' then raise invalid_parameter_value;end if;
  if p->'revision'='1'::jsonb then p:=jsonb_set(p,'{createdAt}',to_jsonb(stamp));end if;
 end if;
 -- These timestamps record receipt by this service, not proof of the contact time.
 new.created_at:=stamp;
 new.payload:=jsonb_set(p,'{updatedAt}',to_jsonb(stamp));
 return new;
end $$;
revoke all on function private.care_operations_envelope() from public,anon,authenticated;
-- Name sorts before care_operations_guard so type checks precede its casts.
create trigger care_operations_envelope before insert on public.care_events for each row execute function private.care_operations_envelope();
