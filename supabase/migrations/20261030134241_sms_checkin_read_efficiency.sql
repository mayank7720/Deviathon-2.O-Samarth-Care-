-- A queue poll or masked eligibility lookup is read-only. HMAC and current
-- staff access are checked by the API; replaying a read cannot dispatch a job.
-- Avoid accumulating thousands of nonce rows from an idle ten-second poll.
do $read_efficiency$ declare source text;needle text;replacement text;begin
 source:=pg_get_functiondef('private.care_sms_checkin(text,jsonb)'::regprocedure);
 needle:=$before$  insert into private.care_phone_nonces(id) values(payload->>'nonce');
  return jsonb_build_object('eligible',$before$;
 replacement:=$after$  return jsonb_build_object('eligible',$after$;
 if strpos(source,needle)=0 then raise exception 'Review changed SMS eligibility before optimizing reads';end if;
 source:=replace(source,needle,replacement);
 needle:=$before$ if action='outbound' then
  insert into private.care_phone_nonces(id) values(payload->>'nonce');$before$;
 replacement:=$after$ if action='outbound' then$after$;
 if strpos(source,needle)=0 then raise exception 'Review changed SMS queue before optimizing reads';end if;
 execute replace(source,needle,replacement);
end $read_efficiency$;
