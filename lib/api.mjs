import { DEMO_DATE } from "./engine.mjs";
import {careModel} from './model-runtime.mjs';
import {
  getAccessContext,
  handleAccessRoute,
  requireAccess,
  canAccessSenior,
  canManageCare,
  AccessError,
} from "./access.mjs";
import { handleAnalysisRoute } from "./analysis-routes.mjs";
import { handleCommunicationRoute } from "./communication-routes.mjs";
import { resolveSupabaseRequest,handleSupabaseAuthRoute,withSupabaseCookies } from './supabase-auth.mjs';
import { createSupabaseStore } from './supabase-store.mjs';
import { workflow,scanEvents,scanLatestEvents } from './workflow-store.mjs';
import { readRuntime,setRuntime } from './runtime.mjs';
import { loadScores,runDaily,queueDeliveries } from './daily-workflow.mjs';
import { handleDeliveryRoute,processDeliveries } from './delivery-routes.mjs';
import { safeSenior,operationsSummary,careState } from './care-state.mjs';
import { validatePhoneEvent } from './phone-gateway.mjs';
import { handleReportRoute } from './report-routes.mjs';
import { handleTelephonyRoute } from './telephony-routes.mjs';
import { validateMotionSummary } from './motion-monitor.mjs';
import {handleCareOperationsRoute} from './care-operations-routes.mjs';
import {handleSpeechRoute} from './speech-routes.mjs';
import {handleSimCallRoute} from './sim-call-routes.mjs';
import {handleAccountRoute} from './account-routes.mjs';
import {observationTime} from './observation-time.mjs';
import {handleHistoryRoute,refreshScoreHistory} from './history.mjs';
import {handlePortalCareRoute} from './portal-care-routes.mjs';
import {recordRequestResult} from './request-storage.mjs';
import {workspaceCareModel} from './recorded-seniors.mjs';

const writeHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...writeHeaders, ...headers },
  });
}
function assert(condition, status, message) {
  if (!condition) throw new ApiError(status, message);
}
async function readBoundedText(request,limit) {
  const length=request.headers.get('content-length');
  assert(!length||/^\d+$/.test(length)&&Number(length)<=limit,413,'Request payload is too large.');
  if(!request.body)return '';
  const reader=request.body.getReader(),chunks=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw new ApiError(413,'Request payload is too large.');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder().decode(bytes);
}
function staff(session) {
  assert(
    session.role === "coordinator" || session.role === "operations",
    403,
    "This action requires a care team role.",
  );
}
function coordinator(session) {
  assert(
    canManageCare(session),
    403,
    "Only the care coordinator can change care records.",
  );
}
function textInput(value, max = 1600) {
  assert(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    400,
    `Enter text between 1 and ${max} characters.`,
  );
  return value.trim();
}
function numeric(value, min, max, label) {
  assert(
    typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max,
    400,
    `${label} must be between ${min} and ${max}.`,
  );
  return value;
}
function event(db, owner, kind, seniorId, payload, id = crypto.randomUUID()) {
  return db
    .prepare(
      "INSERT INTO care_events (id, owner, kind, senior_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      owner,
      kind,
      seniorId,
      JSON.stringify(payload),
      new Date().toISOString(),
    );
}
async function storeMutation(db, owner, kind, seniorId, payload, actor, id) {
  await db.batch([
    event(db, owner, kind, seniorId, payload, id),
    event(db, owner, "audit", seniorId, {
      action: kind,
      actor,
      detail:
        kind === "signal"
          ? `${payload.type} recorded`
          : kind === "consent"
            ? `Family sharing ${payload.allowed ? "enabled" : "disabled"}`
            : `${kind} saved`,
    }),
  ]);
}
async function rowsFor(db, owner, seniorIds) {
  const [clinical,bridge] = await Promise.all([
    scanEvents(db,{owner,seniorIds,kinds:['signal','consent','task','feedback','audit','alert_policy','alert_state','alert_seen','communication','communication_read','ivr_session','voice_room','voice_signal','generated_report','report_job','telephony_job','telephony_contact','care_request','care_request_state','checkin'],limit:1000}),
    scanLatestEvents(db,{owner,seniorIds,kinds:['telephony_bridge'],limit:1}),
  ]);
  const rows=[...clinical,...bridge].sort((a,b)=>a.created_at.localeCompare(b.created_at)||(a.sequence??0)-(b.sequence??0));
  return rows.map((row) => {
    const payload=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
    const record=payload?.record&&typeof payload.record==='object'&&!Array.isArray(payload.record)?payload.record:{};
    return {
    ...row,
    ...payload,
    ...(row.kind==='signal'?{record:{...record,seniorId:row.senior_id,id:row.id,recordedAt:row.created_at}}:{}),
    // Event metadata belongs to the database, including for older malformed rows.
    id: row.id,
    kind: row.kind,
    owner,
    senior_id: row.senior_id,
    payload: row.payload,
    created_at: row.created_at,
    sequence: row.sequence,
    seniorId: row.senior_id,
    createdAt: row.created_at,
  };});
}
function signals(rows) {
  return rows.filter((row) => row.kind === "signal").map((row) => ({...row.record,id:row.id,recordedAt:row.createdAt,mood:row.mood??row.record?.mood,helpRequested:row.helpRequested??row.record?.helpRequested}));
}
function consentFor(senior, rows) {
  const changes = rows.filter(
    (row) => row.kind === "consent" && row.seniorId === senior.id,
  );
  return changes.length ? changes.at(-1).allowed : senior.familyConsent;
}
function tasksFor(rows) {
  return rows
    .filter((row) => row.kind === "task")
    .map(
      ({
        id,
        seniorId,
        action,
        status,
        note,
        outcome,
        createdAt,
        completedAt,
        updatedAt,
      }) => ({
        id,
        seniorId,
        action,
        status,
        note,
        outcome,
        createdAt,
        completedAt,
        updatedAt,
      }),
    );
}
function annotate(senior, rows) {
  return {
    ...senior,
    familyConsent: consentFor(senior, rows),
    reviewed: rows.some(
      (row) =>
        row.seniorId === senior.id &&
        (row.kind === "feedback" || row.kind === "task"),
    ),
    feedback:
      rows
        .filter((row) => row.seniorId === senior.id && row.kind === "feedback")
        .at(-1) ?? null,
  };
}
function statistics(seniors, tasks) {
  return {
    total: seniors.length,
    high: seniors.filter((s) => s.level === "high").length,
    medium: seniors.filter((s) => s.level === "medium").length,
    low: seniors.filter((s) => s.level === "low").length,
    unknown: seniors.filter((s) => s.level === "unknown").length,
    reviewed: seniors.filter((s) => s.reviewed).length,
    openTasks: tasks.filter((t) => t.status === "open").length,
  };
}
export async function handleApi(request, db, options = {}) {
  const startedAt=Date.now();
  const {env={}}=options;
  const endpoint=new URL(request.url).pathname;
  if(/^\/api\/telephony\/twilio\/(checkin|status)\/[a-f\d-]{36}\/[a-f\d]{64}$/i.test(endpoint)) {
    try {
      assert(request.method==='POST'&&request.headers.get('content-type')?.includes('application/x-www-form-urlencoded'),415,'Use the signed provider callback.');
      const raw=await readBoundedText(request,12000);
      assert(env.SUPABASE_URL&&env.SUPABASE_LEGACY_ANON_KEY,503,'The call callback is not configured.');
      const target=new URL('/functions/v1/voice-hooks/'+endpoint.split('/').slice(-3).join('/')+new URL(request.url).search,env.SUPABASE_URL);
      const response=await fetch(target,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':request.headers.get('x-twilio-signature')||'',apikey:env.SUPABASE_LEGACY_ANON_KEY,Authorization:`Bearer ${env.SUPABASE_LEGACY_ANON_KEY}`},body:raw,redirect:'manual',signal:AbortSignal.timeout(20000)});
      return new Response(await response.text(),{status:response.status,headers:{'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'}});
    }catch(error){return json({error:error.status?error.message:'The call callback is temporarily unavailable.'},error.status||503);}
  }
  if(/^\/api\/integrations\/n8n\/(claim|callback|voice-dispatch)$/.test(endpoint)) {
    try {
      assert(request.method==='POST'&&request.headers.get('content-type')?.includes('application/json'),415,'Use a signed JSON POST.');
      const raw=await readBoundedText(request,131072);
      assert(env.SUPABASE_URL&&env.SUPABASE_LEGACY_ANON_KEY,503,'The signed integration callback is not configured.');
      const target=new URL('/functions/v1/n8n-hooks/'+endpoint.split('/').at(-1),env.SUPABASE_URL);
      assert(target.protocol==='https:'&&target.hostname.endsWith('.supabase.co'),503,'The integration project URL is invalid.');
      const headers=new Headers({'content-type':'application/json',apikey:env.SUPABASE_LEGACY_ANON_KEY,Authorization:`Bearer ${env.SUPABASE_LEGACY_ANON_KEY}`});
      for(const key of ['x-samarth-timestamp','x-samarth-nonce','x-samarth-signature'])headers.set(key,request.headers.get(key)||'');
      const response=await fetch(target,{method:'POST',headers,body:raw,redirect:'manual',signal:AbortSignal.timeout(20000)});
      return new Response(await response.text(),{status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
    }catch(error){return json({error:error.status?error.message:'The signed integration callback is temporarily unavailable.'},error.status||503);}
  }
  if(env.SAMARTH_AUTH_MODE!=='supabase')return handleApiRequest(request,db,options);
  let cookies=[];
  try {
    const path=new URL(request.url).pathname.replace(/^\/api\/?/,'').replace(/\/$/,'');
    if(['auth/login','auth/register','auth/logout','auth/refresh','auth/password'].includes(path)) {
      const raw=await request.clone().text();
      assert(raw.length<=24000,413,'Authentication payload is too large.');
      let body;try{body=JSON.parse(raw);}catch{throw new ApiError(400,'Invalid JSON.');}
      return handleSupabaseAuthRoute(path,request,body,env);
    }
    const resolved=await resolveSupabaseRequest(request,env);cookies=resolved.cookies;
    const store=createSupabaseStore({env,accessToken:resolved.accessToken});
    const response=await handleApiRequest(request,store,{...options,local:false,identity:resolved.identity,authMode:'supabase'});
    return withSupabaseCookies(await recordRequestResult(store,request,response,startedAt),cookies);
  } catch(error) {return withSupabaseCookies(json({error:error.status?error.message:'Unable to open the care workspace.'},error.status||503),cookies);}
}

async function handleApiRequest(request, db, { local = false, env = {},identity=null,authMode='sites' } = {}) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
    if (path === "health")
      return json({
        ok: true,
        app: "Samarth Care",
        data: "synthetic",
        date: DEMO_DATE,
      });
    assert(
      db,
      503,
      "Database unavailable. Run npm run db:init, then restart the local preview.",
    );
    if (!["GET", "HEAD"].includes(request.method)) {
      assert(
        request.headers.get("content-type")?.includes("application/json"),
        415,
        "Send application/json.",
      );
      const origin = request.headers.get("origin");
      assert(
        !origin || origin === url.origin,
        403,
        "Cross-origin changes are not allowed.",
      );
      assert(
        !request.headers.get("sec-fetch-site") ||
          ["same-origin", "none"].includes(
            request.headers.get("sec-fetch-site"),
          ),
        403,
        "Cross-origin changes are not allowed.",
      );
    }
    let body;
    let rawBody;
    if (!["GET", "HEAD"].includes(request.method)) {
      const raw = await readBoundedText(request,path.startsWith('speech/')?131072:24000);
      rawBody=raw;
      assert(raw.length <= (path.startsWith('speech/')?131072:24000), 413, "Signal payload is too large.");
      try {
        body = JSON.parse(raw);
      } catch {
        throw new ApiError(400, "Invalid JSON.");
      }
      assert(
        body && typeof body === "object" && !Array.isArray(body),
        400,
        "Expected a JSON object.",
      );
    }
    const context = await getAccessContext(request, db, { local, env,identity,authMode });
    if(path==='phone/events') {
      // Supabase still uses the operator's verified coordinator session and RLS.
      // The local bridge uses its separate signed secret and fixed workspace.
      if(db.backend==='supabase'){requireAccess(context);coordinator(context.session);}
      const phone=await validatePhoneEvent(request,rawBody,env);
      const owner='workspace:primary',model=careModel(env),runtime=await readRuntime(db,owner,{cohortStart:model.cohort.metadata?.startDate,cohortEnd:model.cohort.metadata?.endDate,dataRevision:model.dataRevision});
      assert(phone.record.date>=runtime.cohortStart&&phone.record.date<=runtime.date,400,'The call observation date must be inside the available history and no later than the workspace date.');
      if(db.backend==='supabase')assert(canAccessSenior(context,phone.seniorId),403,'This senior is outside your assigned care scope.');
      try {
        await db.batch([
          event(db,owner,'signal',phone.seniorId,phone.payload,phone.callEventId),
          event(db,owner,'audit',phone.seniorId,{action:'phone_checkin',actor:'Signed telephone bridge',detail:'Four structured wellbeing answers received',callId:phone.callId},phone.eventId),
        ]);
      }catch(error){if(error.status===409||String(error.message).includes('UNIQUE constraint'))throw new ApiError(409,'This phone check-in has already been received.');throw error;}
      return json({ok:true,seniorId:phone.seniorId,recorded:true,externalCallPlaced:false},201);
    }
    const accessResponse = await handleAccessRoute(
      path,
      request,
      db,
      body,
      context,
    );
    if (accessResponse) return accessResponse;
    requireAccess(context);
    const { session, owner } = context;
    if(path==='system/status'&&request.method==='GET') {
      assert(session.role==='operations'&&session.isAdmin,403,'Only the Operations manager can view cloud operations.');
      assert(typeof db.systemStatus==='function',503,'Cloud operations require the connected database.');
      const status=await db.systemStatus();
      return json({...status,storage:{provider:'Supabase',writes:'Cloud database',requestMetadata:'Route category, result and timing; no request bodies or credentials',retentionDays:90}});
    }
    const accountResponse=await handleAccountRoute({path,request,body,db,context});
    if(accountResponse)return accountResponse;
    const { engine, cohort,dataRevision } = await workspaceCareModel(db,careModel(env));
    const clockOptions={schedulerConfigured:env.SAMARTH_SCHEDULER_CONFIGURED==='true',cohortStart:cohort.metadata?.startDate,cohortEnd:cohort.metadata?.endDate,dataRevision};
    const runtime=await readRuntime(db,owner,clockOptions);
    if(path==='runtime'&&request.method==='GET')return json({runtime});
    if(path==='runtime'&&request.method==='POST') {assert(session.isAdmin,403,'Only the workspace owner can change the clock.');return json({runtime:await setRuntime(db,owner,body,clockOptions)});}
    const asOfDate=runtime.date;
    const ids=cohort.seniors.filter(s=>canAccessSenior(context,s.id)).map(s=>s.id);
    const historyResponse=await handleHistoryRoute({path,request,db,context,runtime,cohort,engine});
    if(historyResponse)return historyResponse;
    let consents=await workflow(db,'consents_get',{owner});
    const rows = await rowsFor(db, owner,ids);
    // Persist authoritative consent separately from the bounded activity feed.
    // Family and senior requests never seed or modify sharing permissions.
    if(canManageCare(session)) {
      const seed=cohort.seniors.filter(s=>ids.includes(s.id)&&!consents.some(c=>c.senior_id===s.id)).map(s=>{
        const change=rows.filter(r=>r.kind==='consent'&&r.seniorId===s.id).at(-1);
        return {seniorId:s.id,allowed:change?change.allowed:s.familyConsent};
      });
      if(seed.length)await workflow(db,'consents_seed',{owner,consents:seed,updatedAt:new Date().toISOString()});
      consents=await workflow(db,'consents_get',{owner});
    }
    const deliveryResponse=await handleDeliveryRoute({path,request,body,db,context,env,consents});
    if(deliveryResponse)return deliveryResponse;
    const extra = signals(rows);
    if(path==='sensors/checkin'&&request.method==='POST') {
      assert(['coordinator','senior'].includes(session.role),403,'Only a senior or care coordinator can record a motion observation.');
      const id=session.role==='senior'?session.seniorId:body.seniorId;
      assert(canAccessSenior(context,id),403,'This senior is outside your assigned care scope.');
      const sensor=validateMotionSummary(body.observation);
      const record={seniorId:id,date:asOfDate,source:'browser-motion-unverified',sensor,...(sensor.fallDetected?{note:'Phone motion matched an illustrative possible fall pattern. A person must verify whether a fall occurred.'}:{})};
      await storeMutation(db,owner,'signal',id,{type:'sensor',record},session.name);
      return json({ok:true,recorded:true,confirmation:'unconfirmed'},201);
    }
    let cachedSeniors=await loadScores({db,context,cohort,engine,rows,runtime,consents});
    const getSenior = (id) => {
      assert(
        canAccessSenior(context, id),
        403,
        "This senior is outside your assigned care scope.",
      );
      assert(
        cohort.seniors.some((s) => s.id === id),
        404,
        "Senior not found.",
      );
      const score=cachedSeniors.find(s=>s.id===id);
      if(db.backend==='supabase'&&['family','senior'].includes(session.role)) {
        const consent=consents.find(c=>c.senior_id===id);
        if(!score)return {...safeSenior(cohort.seniors.find(s=>s.id===id)),familyConsent:!!consent?.allowed,summaryPending:true};
        return {...score,familyConsent:!!consent?.allowed};
      }
      return score||{...annotate(engine.scoreSenior(id,asOfDate,extra),rows),careState:careState(id,rows,asOfDate)};
    };
    const onMutation=async()=>{
      if(!canManageCare(session))return {processing:'scheduled'};
      try {
        const freshRows=await rowsFor(db,owner,ids);
        const scores=await loadScores({db,context,cohort,engine,rows:freshRows,runtime,consents,force:true});
        const previousIds=new Set(rows.filter(r=>r.kind==='signal').map(r=>r.id));
        const affected=new Map();
        for(const row of freshRows.filter(r=>r.kind==='signal'&&!previousIds.has(r.id))){
          if(row.record?.date&&(!affected.has(row.seniorId)||row.record.date<affected.get(row.seniorId)))affected.set(row.seniorId,row.record.date);
        }
        const dirty=affected.size&&typeof db.historyDirty==='function'?await db.historyDirty({limit:250}):{pending:[]};
        for(const [seniorId,changedDate] of affected){
          const pending=dirty.pending?.find(item=>item.seniorId===seniorId);
          const loadedWatermark=freshRows.filter(r=>r.kind==='signal'&&r.seniorId===seniorId).reduce((maximum,row)=>{const value=BigInt(row.sequence||0);return value>maximum?value:maximum;},0n);
          const acknowledge=pending&&/^\d+$/.test(pending.watermark||'')&&BigInt(pending.watermark)<=loadedWatermark;
          const from=pending?.from&&pending.from<changedDate?pending.from:changedDate;
          await refreshScoreHistory({db,engine,rows:freshRows,seniorId,from,to:asOfDate,cohortStart:runtime.cohortStart,...(acknowledge?{watermark:pending.watermark}:{})});
        }
        await queueDeliveries({db,context,scores,rows:freshRows,runtime,event,consents});
        await processDeliveries({db,context,env,consents});
        return {processing:'completed'};
      }catch {
        // The clinical write has committed. Preserve that success and let the
        // durable daily processor retry derived scores and delivery later.
        console.error('Care record saved; derived processing is pending retry.');
        return {processing:'pending'};
      }
    };
    if(path==='jobs/daily'&&request.method==='POST') {
      coordinator(session);
      const result=await runDaily({db,context,cohort,engine,rows,runtime,consents,event});
      const delivery=await processDeliveries({db,context,env,consents});
      return json({job:result.job,deliveriesQueued:result.deliveriesQueued,delivery});
    }
    const routeArguments = {
      path,
      request,
      body,
      db,
      context,
      rows,
      cohort,
      engine,
      getSenior,
      event,
      storeMutation,
      asOfDate,
      cachedSeniors,
      cachedSummary:Object.fromEntries(cachedSeniors.map(s=>[s.id,session.role==='family'?(s.familySafe?.summary||s.summary):session.role==='senior'?(s.seniorSafe?.summary||s.summary):(s.weeklySummary||s.summary)])),
      onMutation,
      rawBody,
      env,
    };
    const careOperationsResponse=await handleCareOperationsRoute(routeArguments);
    if(careOperationsResponse)return careOperationsResponse;
    const portalCareResponse=await handlePortalCareRoute(routeArguments);
    if(portalCareResponse)return portalCareResponse;
    const speechResponse=await handleSpeechRoute(routeArguments);
    if(speechResponse)return speechResponse;
    const simCallResponse=await handleSimCallRoute(routeArguments);
    if(simCallResponse)return simCallResponse;
    const reportResponse=await handleReportRoute(routeArguments);
    if(reportResponse)return reportResponse;
    const telephonyResponse=await handleTelephonyRoute(routeArguments);
    if(telephonyResponse)return telephonyResponse;
    const analysisResponse = await handleAnalysisRoute(routeArguments);
    if (analysisResponse) return analysisResponse;
    const communicationResponse =
      await handleCommunicationRoute(routeArguments);
    if (communicationResponse) return communicationResponse;
    if (path === "bootstrap" && request.method === "GET") {
      const base = {
        session,
        date: asOfDate,
        runtime,
        dataProvenance:cohort.metadata,
        dataNotice:
          "The historical cohort is synthetic. Access follows assigned care roles. Model reports use masked evidence; phone services depend on their configured device or provider.",
      };
      if (session.role === "family" || session.role === "senior") {
        const linked = (session.role === 'family' ? session.scope : [session.seniorId]).map(id=>getSenior(id));
        const allowed = linked.filter(senior=>session.role === 'senior' || senior.familyConsent);
        return json({
          ...base,
          seniors: allowed.map(senior=>session.role === 'family' ? (senior.familySafe||senior) : (senior.seniorSafe||safeSenior(senior))),
          stats: {},
          tasks: [],
          audit: [],
          metrics: {},
          consentDenied: !allowed.length,
          summaryPending:allowed.some(senior=>senior.summaryPending===true),
        });
      }
      const seniors = cachedSeniors;
      const tasks = tasksFor(rows).filter((t) =>
        canAccessSenior(context, t.seniorId),
      );
      const sharedFollowups=rows.filter(row=>row.kind==='care_request'&&canAccessSenior(context,row.seniorId)).map(row=>{
        const state=rows.filter(item=>item.kind==='care_request_state'&&item.requestId===row.requestId).sort((a,b)=>a.revision-b.revision).at(-1)||row;
        return {id:row.requestId,seniorId:row.seniorId,status:state.status,createdAt:row.createdAt,completedAt:state.status==='completed'?state.updatedAt:null};
      });
      return json({
        ...base,
        stats: statistics(seniors, tasks),
        seniors,
        tasks,
        sharedFollowups,
        metrics: engine.metrics(),
        operations: operationsSummary(
          seniors,
          [...tasks,...sharedFollowups],
          rows.filter(
            (row) => row.seniorId && canAccessSenior(context, row.seniorId),
          ),
          asOfDate,
        ),
        audit: rows
          .filter(
            (r) =>
              r.kind === "audit" &&
              (!r.seniorId
                ? session.isAdmin
                : canAccessSenior(context, r.seniorId)),
          )
          .slice(-60)
          .reverse(),
      });
    }
    const detail = path.match(/^seniors\/(S\d{3,6})$/);
    if (detail && request.method === "GET") {
      staff(session);
      const senior = getSenior(detail[1]);
      return json({
        senior,
        records: [
          ...cohort.records.filter((r) => r.seniorId === senior.id&&r.date<=asOfDate),
          ...extra.filter((r) => r.seniorId === senior.id&&r.date<=asOfDate),
        ].sort((a,b)=>a.date.localeCompare(b.date)||(a.observedAt||a.recordedAt||'').localeCompare(b.observedAt||b.recordedAt||'')),
        tasks: tasksFor(rows).filter((t) => t.seniorId === senior.id),
      });
    }
    if (path === "signals" && request.method === "POST") {
      coordinator(session);
      const senior = getSenior(body.seniorId);
      assert(
        ["vitals", "medication", "note", "lifestyle", "sensor"].includes(
          body.type,
        ),
        400,
        "Select vitals, medication, note, lifestyle or sensor data.",
      );
      const record = {
        seniorId: senior.id,
        ...observationTime(body,{asOfDate,cohortStart:runtime.cohortStart}),
        recordedAt:new Date().toISOString(),
        source: "coordinator",
      };
      const observationStamp =
        typeof record.date === "string"
          ? Date.parse(record.date + "T00:00:00Z")
          : NaN;
      assert(
        /^\d{4}-\d{2}-\d{2}$/.test(record.date) &&
          Number.isFinite(observationStamp) &&
          record.date >= runtime.cohortStart &&
          record.date <= asOfDate &&
          new Date(observationStamp).toISOString().slice(0, 10) === record.date,
        400,
        "Use a valid observation date no later than the workspace date.",
      );
      if (body.type === "vitals") {
        assert(
          body.vitals && typeof body.vitals === "object",
          400,
          "Enter at least one vital.",
        );
        const limits = {
          systolic: [60, 260],
          diastolic: [35, 180],
          glucose: [30, 600],
          spo2: [50, 100],
          weight: [20, 200],
        };
        record.vitals = {};
        for (const [key, range] of Object.entries(limits))
          if (body.vitals[key] != null)
            record.vitals[key] = numeric(body.vitals[key], ...range, key);
        assert(
          Object.keys(record.vitals).length,
          400,
          "Enter at least one vital.",
        );
        if (record.vitals.systolic && record.vitals.diastolic)
          assert(
            record.vitals.diastolic < record.vitals.systolic,
            400,
            "Diastolic pressure must be below systolic pressure.",
          );
      }
      if (body.type === "medication") {
        assert(
          body.medication && typeof body.medication === "object",
          400,
          "Enter medication counts.",
        );
        const prescribed = numeric(
          body.medication.prescribed,
          1,
          20,
          "Scheduled doses",
        );
        const taken = numeric(
          body.medication.taken,
          0,
          prescribed,
          "Taken doses",
        );
        assert(
          Number.isInteger(taken) && Number.isInteger(prescribed),
          400,
          "Dose counts must be whole numbers.",
        );
        record.medication = { taken, prescribed };
        if (body.medication.doses != null) {
          assert(
            Array.isArray(body.medication.doses) &&
              body.medication.doses.length <= 20,
            400,
            "Provide at most 20 dose entries.",
          );
          record.medication.doses = body.medication.doses.map((dose) => {
            assert(
              dose && ["taken", "missed", "unknown"].includes(dose.status),
              400,
              "Dose status must be taken, missed or unknown.",
            );
            assert(
              /^([01]\d|2[0-3]):[0-5]\d$/.test(dose.scheduledTime || ""),
              400,
              "Dose times use HH:MM.",
            );
            return {
              name: textInput(dose.name, 80),
              scheduledTime: dose.scheduledTime,
              status: dose.status,
            };
          });
        }
      }
      if (body.type === "note") record.note = textInput(body.note);
      if (body.type === "lifestyle") {
        assert(
          body.lifestyle && typeof body.lifestyle === "object",
          400,
          "Enter daily routine observations.",
        );
        const limits = {
          steps: [0, 50000],
          sleepHours: [0, 24],
          waterGlasses: [0, 40],
          meals: [0, 10],
          painScore: [0, 10],
        };
        record.lifestyle = {};
        for (const [key, range] of Object.entries(limits))
          if (body.lifestyle[key] != null)
            record.lifestyle[key] = numeric(body.lifestyle[key], ...range, key);
        if (body.lifestyle.mood != null) {
          assert(
            ["good", "okay", "low", "lonely"].includes(body.lifestyle.mood),
            400,
            "Choose a valid mood.",
          );
          record.lifestyle.mood = body.lifestyle.mood;
        }
        assert(
          Object.keys(record.lifestyle).length,
          400,
          "Enter at least one daily routine observation.",
        );
        if (record.lifestyle.steps != null)
          record.activity = record.lifestyle.steps;
        if (record.lifestyle.sleepHours != null)
          record.sleep = record.lifestyle.sleepHours;
        const cues = [];
        if (record.lifestyle.mood === "lonely") cues.push("Feeling lonely.");
        if (record.lifestyle.mood === "low")
          cues.push("Low mood reported; a supportive check-in was requested.");
        if (record.lifestyle.meals != null && record.lifestyle.meals < 2)
          cues.push("Eating less than usual.");
        if (record.lifestyle.painScore >= 4)
          cues.push("Pain mentioned during daily routine check-in.");
        if (cues.length) record.note = cues.join(" ");
      }
      if (body.type === "sensor") {
        assert(
          body.sensor && typeof body.sensor === "object",
          400,
          "Enter sensor observations.",
        );
        record.sensor = {};
        const limits = {
          steps: [0, 50000],
          inactiveMinutes: [0, 1440],
          impactG: [0, 20],
        };
        for (const [key, range] of Object.entries(limits))
          if (body.sensor[key] != null)
            record.sensor[key] = numeric(body.sensor[key], ...range, key);
        if (body.sensor.postureChange != null) {
          assert(
            typeof body.sensor.postureChange === "boolean",
            400,
            "Posture-change flag must be true or false.",
          );
          record.sensor.postureChange = body.sensor.postureChange;
        }
        if (body.sensor.fallDetected != null) {
          assert(
            typeof body.sensor.fallDetected === "boolean",
            400,
            "Fall flag must be true or false.",
          );
          record.sensor.fallDetected = body.sensor.fallDetected;
        }
        assert(
          Object.keys(record.sensor).length,
          400,
          "Enter at least one sensor observation.",
        );
        if (record.sensor.steps != null) record.activity = record.sensor.steps;
        if (
          record.sensor.fallDetected ||
          (record.sensor.impactG >= 2.5 && record.sensor.postureChange === true)
        )
          record.note =
            "Sensor reported a possible fall. A human must verify this unconfirmed device signal.";
      }
      await storeMutation(
        db,
        owner,
        "signal",
        senior.id,
        { type: body.type, record },
        session.name,
      );
      await onMutation();
      return json(
        {
          ok: true,
          senior: annotate(
            engine.scoreSenior(senior.id, asOfDate, [...extra, record]),
            rows,
          ),
        },
        201,
      );
    }
    if (path === "tasks" && request.method === "POST") {
      coordinator(session);
      const senior = getSenior(body.seniorId);
      const task = {
        seniorId: senior.id,
        createdByRole:session.role,
        actorId:session.userId,
        asOfDate,
        action: textInput(body.action, 250),
        note: body.note ? textInput(body.note, 1000) : "",
        status: "open",
        createdAt: new Date().toISOString(),
      };
      const id = crypto.randomUUID();
      await storeMutation(db, owner, "task", senior.id, task, session.name, id);
      await onMutation();
      return json({ task: { ...task, id } }, 201);
    }
    const taskMatch = path.match(/^tasks\/([a-f0-9-]{36})$/i);
    if (taskMatch && request.method === "PATCH") {
      coordinator(session);
      const task = rows.find((r) => r.id === taskMatch[1] && r.kind === "task");
      assert(task, 404, "Task not found.");
      getSenior(task.seniorId);
      assert(
        ["open", "completed"].includes(body.status),
        400,
        "Unknown task status.",
      );
      const next = {
        seniorId:task.seniorId,
        action:task.action,
        note:task.note||'',
        asOfDate:task.asOfDate||asOfDate,
        createdAt:task.createdAt,
        createdByRole:task.createdByRole||'coordinator',
        actorId:task.actorId||null,
        status: body.status,
        outcome: body.outcome ? textInput(body.outcome, 1000) : "",
        updatedAt: new Date().toISOString(),
        completedAt:
          body.status === "completed" ? new Date().toISOString() : null,
      };
      assert(body.status!=='completed'||next.outcome.length>=5,400,'Record an outcome of at least five characters before completing the action.');
      await db.batch([
        db
          .prepare(
            "UPDATE care_events SET payload = ? WHERE id = ? AND owner = ? AND kind = ?",
          )
          .bind(JSON.stringify(next), task.id, owner, "task"),
        event(db, owner, "audit", task.seniorId, {
          action: "task_updated",
          actor: session.name,
          detail: `Care action ${body.status}`,
        }),
      ]);
      await onMutation();
      return json({ task: {...next,id:task.id} });
    }
    if (path === "feedback" && request.method === "POST") {
      coordinator(session);
      getSenior(body.seniorId);
      assert(
        typeof body.useful === "boolean",
        400,
        "Choose whether this alert was useful.",
      );
      await storeMutation(
        db,
        owner,
        "feedback",
        body.seniorId,
        {
          useful: body.useful,
          note: body.note ? textInput(body.note, 1000) : "",
          snapshot: (() => {
            const senior = getSenior(body.seniorId);
            return {
              seniorId: senior.id,
              score: senior.score,
              anomalyScore: senior.anomalyScore,
              confidence: senior.confidence,
              reasonCount: senior.reasons.length,
            };
          })(),
        },
        session.name,
      );
      return json({
        ok: true,
        message:
          "Feedback saved. A separate useful-alert model can learn from enough balanced, reviewed examples; urgent care flags are never suppressed.",
      });
    }
    if (path === "consent" && request.method === "POST") {
      coordinator(session);
      getSenior(body.seniorId);
      assert(
        typeof body.allowed === "boolean",
        400,
        "Choose whether family sharing is allowed.",
      );
      await storeMutation(
        db,
        owner,
        "consent",
        body.seniorId,
        { allowed: body.allowed },
        session.name,
      );
      await workflow(db,'consent_put',{owner,seniorId:body.seniorId,allowed:body.allowed,updatedAt:new Date().toISOString()});
      consents=await workflow(db,'consents_get',{owner});
      await onMutation();
      return json({ ok: true, allowed: body.allowed });
    }
    if (path === "checkin" && request.method === "POST") {
      assert(
        session.role === "senior",
        403,
        "Use the senior demo role for the phone check-in.",
      );
      assert(
        ["good", "okay", "help"].includes(body.mood),
        400,
        "Choose a check-in response.",
      );
      assert(
        ["en", "hi"].includes(body.language),
        400,
        "Choose English or Hindi.",
      );
      const defaults = {
        en: {
          good: "Feeling well today, eating and sleeping normally.",
          okay: "Feeling a little lonely today. Would appreciate a call.",
          help: "I need help. Feeling dizzy and missed medicines today.",
        },
        hi: {
          good: "आज ठीक हूँ, खाना और नींद अच्छी है।",
          okay: "आज अकेलापन लग रहा है। बात करना चाहता हूँ।",
          help: "मदद चाहिए। चक्कर आ रहे हैं और दवा नहीं ली।",
        },
      };
      const record = {
        seniorId: session.seniorId,
        date: asOfDate,
        mood:body.mood,
        helpRequested:body.mood==='help',
        note: body.note
          ? textInput(body.note)
          : defaults[body.language][body.mood],
        source:
          body.channel === "phone-simulator"
            ? "phone-simulator"
            : "senior-checkin",
      };
      await storeMutation(
        db,
        owner,
        "signal",
        session.seniorId,
        { type: "note", record, mood: body.mood, language: body.language },
        session.name,
      );
      if (body.mood === "help")
        await storeMutation(
          db,
          owner,
          "task",
          session.seniorId,
          {
            action: "Call senior promptly: help requested during check-in",
            status: "open",
            note: "Synthetic phone check-in help request",
            asOfDate,
            createdAt: new Date().toISOString(),
          },
          "Check-in workflow",
        );
      return json(
        {
          ok: true,
          message:
            body.language === "hi"
              ? "आपका संदेश दर्ज हो गया है। आपकी देखभाल टीम इसे देखेगी।"
              : "Your check-in is saved for your care team to review.",
          simulated: record.source === "phone-simulator",
        },
        201,
      );
    }
    if (path === "export" && request.method === "GET") {
      staff(session);
      const seniors = cachedSeniors;
      const cell = (value) =>
        '"' +
        String(value ?? "")
          .replace(/^[=+@-]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      const csv = [
        [
          "Senior ID",
          "Synthetic name",
          "Age",
          "City",
          "Risk score",
          "Priority",
          "Recommended action",
        ],
        ...seniors.map((s) => [
          s.id,
          s.name,
          s.age,
          s.city,
          s.score,
          s.level,
          s.action,
        ]),
      ]
        .map((row) => row.map(cell).join(","))
        .join("\r\n");
      return new Response("\ufeff" + csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition":
            'attachment; filename="samarth-care-priorities.csv"',
          "cache-control": "no-store",
        },
      });
    }
    throw new ApiError(404, "Endpoint not found.");
  } catch (error) {
    const knownError =
      error instanceof ApiError ||
      error instanceof AccessError ||
      (Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status < 500);
    if (!knownError) console.error("Care API error:", error?.message);
    return json(
      {
        error: knownError
          ? error.message
          : "Unable to complete this action. Check that local database migrations have been applied.",
      },
      error.status ?? 500,
    );
  }
}
