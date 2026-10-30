begin;

select set_config('test.policy.admin',(select user_id from public.care_memberships where role='operations' and is_admin=1 and status='active' limit 1),true);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.policy.admin'),'role','authenticated','iat',extract(epoch from now())::bigint)::text,true);
do $$declare v jsonb;r integer;begin
 v:=public.care_call_automation('list');r:=(v#>>'{control,revision}')::integer;
 if v#>>'{control,callingPolicy,start}'<>'08:00' or v#>>'{control,callingPolicy,restrictHours}'<>'true' then raise exception 'Initial policy not preserved';end if;
 perform public.care_call_automation('policy',jsonb_build_object('revision',r,'callsEnabled',true,'restrictHours',false,'start','08:00','end','20:00','helpOutsideHours',false));
 begin perform public.care_call_automation('policy',jsonb_build_object('revision',r,'callsEnabled',false,'restrictHours',false,'start','08:00','end','20:00','helpOutsideHours',false));raise exception 'Stale update accepted';exception when raise_exception then if sqlerrm not like '%controls changed%' then raise;end if;end;
end $$;
reset role;
do $$begin if not private.care_call_window_open('2026-10-31T02:00:00+05:30',false) then raise exception 'All-day blocked';end if;end $$;
update private.care_call_auto_control set restrict_hours=true,window_start='22:00',window_end='06:00';
do $$begin if not private.care_call_window_open('2026-10-31T02:00:00+05:30',false) or private.care_call_window_open('2026-10-31T12:00:00+05:30',false) or private.care_call_window_open('2026-10-31T06:00:00+05:30',false) then raise exception 'Overnight bounds incorrect';end if;end $$;
update private.care_call_auto_control set window_start='08:00',window_end='20:00',help_outside_hours=true;
do $$begin if not private.care_call_window_open('2026-10-31T02:00:00+05:30',true) or private.care_call_window_open('2026-10-31T02:00:00+05:30',false) then raise exception 'Help exemption incorrect';end if;end $$;
update private.care_call_auto_control set calls_enabled=false;
do $$begin if private.care_call_window_open('2026-10-31T12:00:00+05:30',true) then raise exception 'Master pause bypassed';end if;end $$;
set local role anon;
do $$begin begin perform public.care_call_automation('policy','{}');raise exception 'Anonymous policy access';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'PASS: Operations revision controls, default preservation, all-day, overnight, HELP exception, master pause and anonymous denial; no carrier requests' as result;
rollback;
