import {canManageCare} from './access.mjs';
import { DEMO_DATE, extractCues } from "./engine.mjs";
import { analyzeSenior, trainFeedbackModel } from "./analytics.mjs";
import { classifyTriage, compareTriage } from "./triage.mjs";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const reply = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: HEADERS });
class AnalysisRouteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const check = (condition, status, message) => {
  if (!condition) throw new AnalysisRouteError(status, message);
};
const staff = (session) =>
  session?.role === "coordinator" || session?.role === "operations";
const canView = (session, id) =>
  (session?.scope || []).includes("*") ||
  (session?.scope || []).includes(id) ||
  session?.seniorId === id;
const sensibleDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(Date.parse(`${value}T00:00:00Z`)).toISOString().slice(0,10) === value;
const previousDays = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000)
    .toISOString()
    .slice(0, 10);
const latest = (rows, predicate) => rows.filter(predicate).at(-1);
const finite = Number.isFinite;
const hash = (value) => {
  let result = 2166136261;
  for (const char of JSON.stringify(value))
    result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return (result >>> 0).toString(16).padStart(8, "0");
};
const currentPolicy = (rows) => {
  const saved = latest(rows, (row) => row.kind === "alert_policy");
  return {
    minimumScore: finite(saved?.minimumScore)
      ? Math.max(30, Math.min(60, saved.minimumScore))
      : 30,
    cooldownHours: finite(saved?.cooldownHours)
      ? Math.max(1, Math.min(72, saved.cooldownHours))
      : 24,
    urgentBypass: true,
    highPriorityBypass: true,
    deduplication:
      "One alert per senior per demonstration date. New urgent evidence reopens a previously handled alert.",
    cooldown:
      "Only non-urgent scores below 60 can be quieted after a recent acknowledged or resolved alert. High-priority and urgent signals always bypass cooldown and minimum-score filtering.",
  };
};

function severeReadings(vitals = {}) {
  return {
    ...(finite(vitals.systolic) && vitals.systolic >= 180
      ? { systolic: vitals.systolic }
      : {}),
    ...(finite(vitals.diastolic) && vitals.diastolic >= 120
      ? { diastolic: vitals.diastolic }
      : {}),
    ...(finite(vitals.glucose) && (vitals.glucose < 70 || vitals.glucose >= 300)
      ? { glucose: vitals.glucose }
      : {}),
    ...(finite(vitals.spo2) && vitals.spo2 < 90 ? { spo2: vitals.spo2 } : {}),
  };
}
function urgentRecord(record, parent = {}) {
  const triage = classifyTriage({}, { ...record, mood: parent.mood ?? record?.mood, helpRequested: parent.helpRequested ?? record?.helpRequested });
  const cues = extractCues(record?.note).filter(cue => ['chest_pain','breathlessness','fall'].includes(cue.cue));
  return { urgent: triage.urgency === 'immediate', cues, readings: severeReadings(record?.vitals), sensorFall: triage.triageEvidence.some(item=>item.id==='sensor-fall'), helpRequested:triage.triageEvidence.some(item=>item.id==='help-request'), triage };
}
function factsFor(senior, rows, asOfDate) {
  const cutoff = previousDays(asOfDate,2);
  const recentSignalRows = rows.filter(row=>row.kind==='signal' && row.seniorId===senior.id && sensibleDate(row.record?.date) && row.record.date>=cutoff && row.record.date<=asOfDate);
  const submitted = recentSignalRows.map(row=>({row,facts:urgentRecord(row.record,row)})).filter(({facts})=>facts.urgent);
  const freshLatest = sensibleDate(senior.latest?.date) && senior.latest.date>=cutoff && senior.latest.date<=asOfDate;
  const latestRecord = freshLatest ? senior.latest : {};
  const triage=classifyTriage({...senior,immediateReview:senior.immediateReview===true || senior.urgency==='immediate'},[latestRecord,...recentSignalRows.map(row=>({...row.record,mood:row.mood,helpRequested:row.helpRequested}))]);
  const readings = freshLatest ? severeReadings(senior.latest?.vitals) : {};
  const cues = (senior.cues || []).filter(cue=>['chest_pain','breathlessness','fall'].includes(cue.cue));
  const helpRequested = triage.triageEvidence.some(item=>item.id==='help-request');
  const sensorFall = triage.triageEvidence.some(item=>item.id==='sensor-fall');
  return {urgent:triage.urgency==='immediate',helpRequested,sensorFall,readings,cues,triage,
    fingerprint:hash({seniorId:senior.id,date:asOfDate,readings,cues:cues.map(cue=>({cue:cue.cue,evidence:cue.evidence})),submitted:submitted.map(({row,facts})=>({id:row.id,recordDate:row.record.date,readings:facts.readings,cues:facts.cues.map(cue=>cue.cue),sensorFall:facts.sensorFall,helpRequested:facts.helpRequested}))}),
  };
}

function titleFor(facts, senior) {
  if (!facts.urgent && (senior.level === "unknown" || senior.score === null)) return "A wellbeing check-in is needed to fill missing observations";
  if (facts.helpRequested) return "The senior has requested a prompt check-in";
  if (facts.sensorFall || facts.cues.some((cue) => cue.cue === "fall"))
    return "Review a reported possible fall";
  if (
    facts.cues.some((cue) => ["chest_pain", "breathlessness"].includes(cue.cue))
  )
    return "A check-in reports symptoms needing prompt review";
  if (Object.keys(facts.readings).length)
    return "Verify a reading and arrange prompt clinical review";
  return senior.level === "high" || senior.score >= 60
    ? "Several wellbeing changes need a care-team review"
    : "An everyday routine needs a check-in";
}

/** Internal complete alert state. Caller must sanitize for non-staff roles. */
export function buildAlerts({
  seniors,
  rows,
  policy = currentPolicy(rows),
  now = Date.now(),
  asOfDate = DEMO_DATE,
}) {
  const alerts = [],
    suppressed = [];
  for (const senior of seniors) {
    const facts = factsFor(senior, rows, asOfDate);
    const unknown = senior.level === "unknown" || senior.score === null;
    const high = senior.score >= 60 || senior.level === "high";
    if (!facts.urgent && !high && !unknown && senior.score < policy.minimumScore) continue;
    const id = `A-${senior.id}-${asOfDate}`;
    const state = latest(
      rows,
      (row) => row.kind === "alert_state" && row.alertId === id,
    );
    const seen = rows.find(row=>row.kind==='alert_seen' && row.alertId===id);
    const earliestAck = rows.find(row=>row.kind==='alert_state' && row.alertId===id && (row.firstAcknowledgedAt || row.status==='acknowledged' || row.status==='resolved'));
    const firstSeenAt = seen?.firstSeenAt || seen?.createdAt || state?.firstSeenAt || new Date(now).toISOString();
    const firstAcknowledgedAt = earliestAck?.firstAcknowledgedAt || earliestAck?.createdAt || null;
    let status = ["open", "acknowledged", "snoozed", "resolved"].includes(
      state?.status,
    )
      ? state.status
      : "open";
    const changedUrgent =
      facts.urgent &&
      !!state &&
      (state.fingerprint !== facts.fingerprint || state.status === "snoozed");
    if (
      changedUrgent ||
      (status === "snoozed" &&
        (!state.snoozedUntil || Date.parse(state.snoozedUntil) <= now))
    )
      status = "open";
    const previous =
      !state && !facts.urgent && !high && !unknown
        ? latest(
            rows,
            (row) =>
              row.kind === "alert_state" &&
              row.seniorId === senior.id &&
              row.alertId !== id &&
              ["acknowledged", "resolved"].includes(row.status) &&
              Number.isFinite(Date.parse(row.createdAt)) &&
              now - Date.parse(row.createdAt) >= 0 &&
              now - Date.parse(row.createdAt) < policy.cooldownHours * 3600000,
          )
        : null;
    const alert = {
      id,
      seniorId: senior.id,
      name: senior.name,
      city: senior.city,
      date: asOfDate,
      score: senior.score,
      level: facts.urgent || high ? "high" : unknown ? "unknown" : "medium",
      urgency:facts.triage.urgency, urgencyRank:facts.triage.urgencyRank,
      urgent: facts.urgent,
      title: titleFor(facts, senior),
      reasons: senior.reasons || [],
      action: facts.urgent || unknown ? facts.triage.triageAction : senior.action,
      status,
      fingerprint: facts.fingerprint,
      reopened: changedUrgent,
      helpRequested: facts.helpRequested,
      snoozedUntil: status === "snoozed" ? state.snoozedUntil : null,
      outcome: status === "resolved" ? state.outcome || "" : "",
      createdAt:firstSeenAt,firstSeenAt,firstAcknowledgedAt,firstSeenPersisted:!!seen || !!state?.firstSeenAt,
      updatedAt: state?.createdAt || null,
    };
    if (previous) {
      suppressed.push({
        ...alert,
        reason: "Coordinator cooldown after a previous handled alert.",
        cooldownUntil: new Date(
          Date.parse(previous.createdAt) + policy.cooldownHours * 3600000,
        ).toISOString(),
      });
    } else alerts.push(alert);
  }
  alerts.sort(compareTriage);
  return { alerts, suppressed, policy };
}

function familyAlert(alert) {
  return {
    id: alert.id,
    seniorId: alert.seniorId,
    name: alert.name,
    date: alert.date,
    level: "high",
    title: "A care-team follow-up is needed",
    reasons: [
      {
        title: "A change in everyday wellbeing",
        detail:
          "The coordinator will review the change with your family member and agree the next step.",
      },
    ],
    action:
      "Contact the care coordinator if you can help with a check-in. This flag does not name a condition.",
    status: alert.status,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
  };
}
function seniorAlert(alert) {
  return {
    id: alert.id,
    seniorId: alert.seniorId,
    date: alert.date,
    title: alert.helpRequested
      ? "Your request for a call has been received"
      : "Your care team would like to check in",
    message:
      "Please speak with your care coordinator about how you are feeling. If you need help now, contact your agreed support person.",
    status: alert.status,
    createdAt: alert.createdAt,
  };
}

export async function handleAnalysisRoute(options) {
  const {
    path,
    request,
    body = {},
    db,
    context,
    rows = [],
    cohort,
    engine,
    getSenior,
    storeMutation,
    asOfDate = DEMO_DATE,
    cachedSeniors,
    cachedSummary,
    onMutation,
  } = options;
  const analysisMatch = path.match(/^analysis\/(S\d{3,6})$/);
  const summaryMatch = path.match(/^summaries\/(S\d{3,6})$/);
  const alertMatch = path.match(/^alerts\/(A-S\d{3,6}-\d{4}-\d{2}-\d{2})$/);
  if (
    !analysisMatch &&
    !summaryMatch &&
    !alertMatch &&
    !["alerts", "alerts/policy", "feedback/model"].includes(path)
  )
    return null;
  try {
    check(context?.session, 401, "Sign in to a care workspace role.");
    const session = context.session;
    check(sensibleDate(asOfDate),400,"Use a valid analysis calendar date.");
    if (analysisMatch && request.method === "GET") {
      check(
        staff(session),
        403,
        "Detailed analytics are available to the care team.",
      );
      const senior = await getSenior(analysisMatch[1]);
      const observations = [
        ...(cohort?.records || []).filter((record) => record.seniorId === senior.id),
        ...rows
          .filter((row) => row.kind === "signal" && row.seniorId === senior.id)
          .map((row) => row.record),
      ];
      return reply({
        analysis: analyzeSenior({ ...senior, asOfDate }, observations, {
          feedback: rows.filter(
            (row) => row.kind === "feedback" && canView(session, row.seniorId),
          ),
        }),
      });
    }
    if (summaryMatch && request.method === "GET") {
      check(
        staff(session) ||
          (["family", "senior"].includes(session.role) &&
            (session.seniorId === summaryMatch[1] || session.role === 'family' && session.scope?.includes(summaryMatch[1]))),
        403,
        "This summary is outside your assigned access.",
      );
      const senior = await getSenior(summaryMatch[1]);
      check(
        session.role !== "family" || senior.familyConsent === true,
        403,
        "Family sharing consent is not enabled.",
      );
      if(db?.backend==='supabase'&&['family','senior'].includes(session.role)) {
        const approved=typeof db.familySummary==='function'?await db.familySummary(senior.id,asOfDate):null;
        if(approved?.summary?.text&&approved.summary.period?.to<=asOfDate) {
          const saved=approved.summary;
          return reply({status:'approved',summary:{text:saved.text,period:saved.period,method:saved.method||'Reviewed care-team update',requiresHumanReview:false},approvedAt:approved.approvedAt||null,currentPeriodPending:saved.period.to<asOfDate});
        }
        return reply({status:'pending_review',summary:null,message:'Your care team has not shared an approved weekly update for this period yet.',period:{from:new Date(Date.parse(asOfDate+'T00:00:00Z')-6*86400000).toISOString().slice(0,10),to:asOfDate,days:7},canRequest:session.role==='family'});
      }
      let cached = typeof cachedSummary === 'function' ? await cachedSummary(senior.id,asOfDate) : cachedSummary instanceof Map ? cachedSummary.get(senior.id) : cachedSummary?.[senior.id] ?? cachedSummary;
      cached = cached?.summary || cached?.familySummary || cached;
      if (cached && typeof cached.text === 'string' && cached.period?.to === asOfDate) {
        const summary={text:cached.text,method:cached.method || 'local extractive',period:cached.period,requiresHumanReview:cached.requiresHumanReview!==false,externalServiceUsed:false};
        return reply({summary,cached:true});
      }
      const observations = [...(cohort?.records || []).filter(record=>record.seniorId===senior.id),...rows.filter(row=>row.kind==='signal' && row.seniorId===senior.id).map(row=>row.record)];
      return reply({ summary: analyzeSenior({ ...senior, asOfDate }, observations).summary });
    }
    if (path === "feedback/model" && request.method === "GET") {
      check(
        staff(session),
        403,
        "Only the care team can review alert feedback.",
      );
      const model = trainFeedbackModel(
        rows.filter(
          (row) => row.kind === "feedback" && canView(session, row.seniorId),
        ),
      );
      const { predictUsefulAlert, applySupplement, ...metadata } = model;
      return reply({ model: metadata });
    }
    if (path === "alerts/policy" && request.method === "POST") {
      check(
        session.isAdmin === true,
        403,
        "Only the workspace owner can change alert policy.",
      );
      check(
        Number.isInteger(body.minimumScore) &&
          body.minimumScore >= 30 &&
          body.minimumScore <= 60,
        400,
        "Minimum score must be a whole number from 30 to 60.",
      );
      check(
        Number.isInteger(body.cooldownHours) &&
          body.cooldownHours >= 1 &&
          body.cooldownHours <= 72,
        400,
        "Cooldown must be a whole number from 1 to 72 hours.",
      );
      await storeMutation(
        db,
        context.owner,
        "alert_policy",
        "",
        { minimumScore: body.minimumScore, cooldownHours: body.cooldownHours },
        session.name,
      );
      return reply({
        ok: true,
        policy: currentPolicy([
          ...rows,
          {
            kind: "alert_policy",
            minimumScore: body.minimumScore,
            cooldownHours: body.cooldownHours,
          },
        ]),
      });
    }
    if (path === "alerts/policy" && request.method === "GET") {
      check(staff(session), 403, "Only the care team can review alert policy.");
      return reply({ policy: currentPolicy(rows) });
    }
    if (
      (path === "alerts" && request.method === "GET") ||
      (alertMatch && request.method === "PATCH")
    ) {
      check(
        staff(session) || ["family", "senior"].includes(session.role),
        403,
        "This role cannot access care alerts.",
      );
      if(path==='alerts' && request.method==='GET' && db?.backend==='supabase' && ['family','senior'].includes(session.role)) {
        // RLS intentionally hides raw clinical and alert-state events. Missing
        // safe fields must not be reinterpreted as a new alert or an open state.
        const alerts=[];let consented=0;
        for(const id of session.role==='family'?session.scope:[session.seniorId]) {
          const linked=await getSenior(id);
          if(session.role==='family'&&linked.familyConsent!==true)continue;
          consented++;
          const cached=linked.careAlert;
          const valid=cached && cached.seniorId===id && cached.date===asOfDate && cached.id===`A-${id}-${asOfDate}` && ['open','acknowledged','snoozed','resolved'].includes(cached.status) && (session.role!=='family' || cached.level==='high');
          if(valid)alerts.push(session.role==='family'?familyAlert(cached):seniorAlert(cached));
        }
        check(session.role!=='family'||consented>0,403,'Family sharing consent is not enabled.');
        return reply({alerts,counts:{total:alerts.length,open:alerts.filter(alert=>alert.status==='open').length,acknowledged:alerts.filter(alert=>alert.status==='acknowledged').length,snoozed:alerts.filter(alert=>alert.status==='snoozed').length,resolved:alerts.filter(alert=>alert.status==='resolved').length,suppressed:0,unknown:0}});
      }
      const cacheRows = typeof cachedSeniors === 'function' ? await cachedSeniors(asOfDate) : cachedSeniors instanceof Map ? [...cachedSeniors.values()] : Array.isArray(cachedSeniors) ? cachedSeniors : cachedSeniors?.seniors || null;
      let candidates;
      if (cacheRows) candidates=cacheRows;
      else if (cohort?.seniors) candidates=cohort.seniors;
      else if (!staff(session) && session.seniorId) candidates=[{id:session.seniorId}];
      else if (!session.scope.includes('*')) candidates=session.scope.map(id=>({id}));
      else candidates=await engine.rankSeniors(asOfDate,rows.filter(row=>row.kind==='signal').map(row=>row.record));
      const annotated=[];
      const candidateIds=new Set();
      for (const candidate of candidates) {
        const id=candidate.id || candidate.seniorId || candidate.senior_id;
        if(typeof id!=='string' || !/^S\d{3,6}$/.test(id) || candidateIds.has(id))continue;
        candidateIds.add(id);
        if(!canView(session,id))continue;
        if(session.role==='senior' && id!==session.seniorId || session.role==='family'&&!session.scope.includes(id))continue;
        annotated.push(await getSenior(id));
      }
      const collection=buildAlerts({seniors:annotated,rows,asOfDate});
      if (alertMatch) {
        check(
          canManageCare(session),
          403,
          "Only a care coordinator can update an alert.",
        );
        const alert = [...collection.alerts, ...collection.suppressed].find(
          (item) => item.id === alertMatch[1],
        );
        check(alert, 404, "Alert not found within your assigned care scope.");
        check(
          ["open", "acknowledged", "snoozed", "resolved"].includes(body.status),
          400,
          "Choose open, acknowledged, snoozed or resolved.",
        );
        check(
          !(alert.urgent && body.status === "snoozed"),
          409,
          "An urgent report cannot be snoozed. Contact the senior and document the outcome.",
        );
        let snoozedUntil = null;
        if (body.status === "snoozed") {
          check(
            Number.isInteger(body.snoozeHours) &&
              body.snoozeHours >= 1 &&
              body.snoozeHours <= 24,
            400,
            "Snooze must be from 1 to 24 whole hours.",
          );
          snoozedUntil = new Date(
            Date.now() + body.snoozeHours * 3600000,
          ).toISOString();
        }
        const outcome =
          typeof body.outcome === "string" ? body.outcome.trim() : "";
        check(
          outcome.length <= 1000,
          400,
          "Outcome must be 1,000 characters or fewer.",
        );
        if (body.status === "resolved")
          check(
            outcome.length >= 5,
            400,
            "Record an outcome of at least five characters before resolving.",
          );
        const state = {
          alertId: alert.id,
          status: body.status,
          fingerprint: alert.fingerprint,
          snoozedUntil,
          outcome,
          firstSeenAt: alert.firstSeenAt,
          firstAcknowledgedAt: alert.firstAcknowledgedAt || (['acknowledged','resolved'].includes(body.status) ? new Date().toISOString() : null),
        };
        await storeMutation(
          db,
          context.owner,
          "alert_state",
          alert.seniorId,
          state,
          session.name,
        );
        if(typeof onMutation==='function')await onMutation({kind:'alert_state',seniorId:alert.seniorId,asOfDate});
        return reply({
          ok: true,
          alert: {
            ...alert,
            ...state,
            reopened: false,
            updatedAt: new Date().toISOString(),
          },
        });
      }
      let alerts = collection.alerts;
      let suppressed = collection.suppressed;
      if (session.role === "family") {
        const linked = await getSenior(session.seniorId);
        check(
          linked.familyConsent === true,
          403,
          "Family sharing consent is not enabled.",
        );
        alerts = alerts
          .filter(
            (alert) =>
              alert.seniorId === session.seniorId && alert.level === "high",
          )
          .map(familyAlert);
        suppressed = [];
      } else if (session.role === "senior") {
        alerts = alerts
          .filter((alert) => alert.seniorId === session.seniorId)
          .map(seniorAlert);
        suppressed = [];
      }
      const counts = {
        total: alerts.length,
        open: alerts.filter((alert) => alert.status === "open").length,
        acknowledged: alerts.filter((alert) => alert.status === "acknowledged")
          .length,
        snoozed: alerts.filter((alert) => alert.status === "snoozed").length,
        resolved: alerts.filter((alert) => alert.status === "resolved").length,
        suppressed: suppressed.length,
        unknown:alerts.filter(alert=>alert.level==='unknown').length,
      };
      return reply({
        alerts,
        counts,
        policy: staff(session) ? collection.policy : undefined,
        suppressed: staff(session) ? suppressed : undefined,
      });
    }
    return reply(
      { error: "This method is not supported for this route." },
      405,
    );
  } catch (error) {
    return reply(
      {
        error: error?.status
          ? error.message
          : "Unable to load the requested care analysis.",
      },
      error?.status || 500,
    );
  }
}
