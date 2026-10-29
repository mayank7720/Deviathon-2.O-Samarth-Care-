-- Qualify event payload columns against the routing RPC's JSON argument.
do $$declare definition text;before_text text:=$before$update public.care_events set payload=payload||jsonb_build_object('status','cancelled','state',jsonb_build_object('step',(payload#>>'{state,step}')::integer+1),'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=oldjob.id;$before$;after_text text:=$after$update public.care_events e set payload=e.payload||jsonb_build_object('status','cancelled','state',jsonb_build_object('step',(e.payload#>>'{state,step}')::integer+1),'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where e.id=oldjob.id;$after$;begin
 definition:=pg_get_functiondef('private.care_notification_routing(text,jsonb)'::regprocedure);
 if strpos(definition,before_text)=0 then raise exception 'Unexpected routing column guard';end if;
 execute replace(definition,before_text,after_text);
end $$;
