-- Keep deployed v1 receivers compatible while persisting the trained model's
-- provenance and review-only status. No membership, contact or RLS change.
alter table public.care_phone_requests drop constraint care_phone_analysis_object;
alter table public.care_phone_requests add constraint care_phone_analysis_object check (
 analysis is null or coalesce(jsonb_typeof(analysis)='object'
 and analysis->>'version' in ('sms-understanding-v1','sms-understanding-v2'),false));

do $sms_model$
declare source text; old_version text; old_method text;begin
 source:=pg_get_functiondef('private.care_phone_support(text,jsonb)'::regprocedure);
 old_version:='coalesce(payload#>>''{analysis,version}'','''')<>''sms-understanding-v1''';
 old_method:='coalesce(payload#>>''{analysis,method}'','''')<>''local-assertion-rules''';
 if strpos(source,old_version)=0 or strpos(source,old_method)=0 then
  raise exception 'SMS validation changed; review the migration against the current function';
 end if;
 source:=replace(source,old_version,'coalesce(payload#>>''{analysis,version}'','''') not in (''sms-understanding-v1'',''sms-understanding-v2'')');
 source:=replace(source,old_method,'coalesce(payload#>>''{analysis,method}'','''') not in (''local-assertion-rules'',''local-rules-and-intent-ml'')');
 execute source;
end $sms_model$;
