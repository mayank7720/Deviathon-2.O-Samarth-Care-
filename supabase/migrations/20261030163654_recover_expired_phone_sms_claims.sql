-- A cloud receipt can fail after Android accepted the message. Allow the
-- existing bounded claim-recovery path to see expired phone-only leases.
-- The relay first GETs the same gateway message ID before any enqueue.
do $recovery$
declare source text; before_filter text; after_filter text;
begin
 source:=pg_get_functiondef('private.care_phone_support(text,jsonb)'::regprocedure);
 before_filter:='e.payload->>''channel''=''sms'' and e.payload->>''status''=''queued''';
 after_filter:='e.payload->>''channel''=''sms'' and (e.payload->>''status''=''queued'' or (e.payload->>''status''=''processing'' and (e.payload->>''leaseExpiresAt'')::timestamptz<=clock_timestamp())) and (e.payload->>''expiresAt'')::timestamptz>clock_timestamp()';
 if strpos(source,before_filter)=0 or strpos(substr(source,strpos(source,before_filter)+length(before_filter)),before_filter)>0 then
  raise exception 'Unexpected phone-only SMS queue reader';
 end if;
 execute replace(source,before_filter,after_filter);
end $recovery$;
