-- Retrieve an approved update from this recipient's durable inbox, rather than
-- exposing a pending model draft or private clinical observations.
create function private.care_family_summary(sid text,as_of_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item public.care_deliveries%rowtype; summary jsonb;
begin
 if not private.care_actor_enabled() or not private.care_has(sid,array['family','senior']) then raise insufficient_privilege;end if;
 if private.care_has(sid,array['family']) and not private.care_family_allowed(sid) then raise insufficient_privilege;end if;
 select d.* into item from public.care_deliveries d
 where d.owner='workspace:primary' and d.user_id=auth.uid()::text and d.senior_id=sid and d.kind='weekly_summary' and d.channel='in_app'
 and d.status in ('delivered','read') and d.payload#>>'{summary,text}' is not null
 and d.payload#>>'{summary,period,to}'<=as_of_date::text
 and exists(select 1 from public.care_memberships m where m.user_id=auth.uid()::text and m.status='active' and m.role=d.recipient_role and (m.senior_id=sid or m.scope_json::jsonb ? sid))
 order by d.payload#>>'{summary,period,to}' desc,d.delivered_at desc nulls last,d.created_at desc,d.id limit 1;
 if item.id is null then return jsonb_build_object('summary',null);end if;
 summary:=item.payload->'summary';
 return jsonb_build_object('summary',jsonb_build_object('text',summary->>'text','period',summary->'period','method',summary->>'method','requiresHumanReview',false),'approvedAt',item.delivered_at);
end $$;
create function public.care_family_summary(sid text,as_of_date date) returns jsonb language sql security invoker set search_path='' as $$select private.care_family_summary(sid,as_of_date)$$;
revoke all on function private.care_family_summary(text,date),public.care_family_summary(text,date) from public,anon;
grant execute on function private.care_family_summary(text,date),public.care_family_summary(text,date) to authenticated;
