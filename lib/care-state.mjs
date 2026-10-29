import { indiaDate } from './runtime.mjs';

export function careState(id,rows,date) {
  const firstSeen=rows.find(r=>r.seniorId===id&&r.kind==='alert_seen'&&r.alertId===`A-${id}-${date}`);
  const states=rows.filter(r=>r.seniorId===id&&r.kind==='alert_state'&&r.alertId===`A-${id}-${date}`);
  const state=states.at(-1);
  const tasks=rows.filter(r=>r.seniorId===id&&r.kind==='task'&&(r.asOfDate?r.asOfDate===date:Number.isFinite(Date.parse(r.createdAt))&&indiaDate(new Date(r.createdAt))===date));
  const completed=tasks.filter(t=>t.status==='completed').at(-1);
  const acknowledgedAt=state?.firstAcknowledgedAt||(['acknowledged','resolved'].includes(state?.status)?state.createdAt:null);
  const humanWork=tasks.some(t=>t.status==='open'&&(t.createdByRole==='coordinator'||t.startedAt||acknowledgedAt));
  return {status:humanWork?'in_progress':state?.status==='resolved'||completed?'resolved':acknowledgedAt?'acknowledged':'unreviewed',acknowledgedAt:acknowledgedAt||null,completedAt:state?.status==='resolved'?state.createdAt:completed?.completedAt||null,firstSeenAt:firstSeen?.firstSeenAt||firstSeen?.createdAt||state?.firstSeenAt||null,updatedAt:state?.createdAt||null};
}
function safeAlert(senior,date) {if(!date)return null;const state=senior.careState||{};return {id:`A-${senior.id}-${date}`,seniorId:senior.id,date,status:state.status==='resolved'?'resolved':state.acknowledgedAt?'acknowledged':'open',createdAt:state.firstSeenAt||null,updatedAt:state.updatedAt||null,helpRequested:senior.helpRequested===true||senior.triageEvidence?.some(e=>e.id==='help-request')===true};}
export function safeFamily(senior,date,weeklySummary) {
  const state=senior.careState||{status:'unreviewed'};
  const attention=senior.level==='high';
  const pending=pendingSummary(date,weeklySummary);
  return {id:senior.id,name:senior.name,age:senior.age,city:senior.city,language:senior.language,score:senior.score,level:senior.level,urgency:senior.urgency,familyConsent:senior.familyConsent,careState:state,lastCheckIn:senior.lastCheckIn,trend:senior.trend?.slice(-7)||[],latest:{date:senior.latest?.date,activity:senior.latest?.activity,sleep:senior.latest?.sleep,medication:senior.latest?.medication},action:senior.level==='unknown'?'A fresh check-in is needed because information is incomplete.':attention?(state.status==='unreviewed'?'A change needs a coordinator review.':'Your coordinator has recorded a response. Contact the care team for the next step.'):'Continue regular check-ins with your care team.',weeklySummary:pending.text,summary:pending,careAlert:attention?{...safeAlert(senior,date),name:senior.name,level:'high'}:null,seriousAlert:attention?{title:'Care-team follow-up is needed',message:'A change from the usual routine needs prompt human review. This is a wellbeing flag, not a diagnosis.'}:null};
}
export function pendingSummary(date,draft) {return {text:'Your weekly update is awaiting care-team review. Approved updates appear in your care inbox.',method:'pending care-team review',period:draft?.period||{from:date,to:date,days:7},requiresHumanReview:true,externalServiceUsed:false};}
export function safeSenior(senior,date) {return {id:senior.id,name:senior.name,age:senior.age,city:senior.city,language:senior.language,lastCheckIn:senior.lastCheckIn,latest:{date:senior.latest?.date},familyConsent:senior.familyConsent,careState:senior.careState,careAlert:['high','unknown'].includes(senior.level)?safeAlert(senior,date):null};}

export function operationsSummary(seniors,tasks,rows,date) {
  const average=a=>a.length?Math.round(a.reduce((s,v)=>s+v,0)/a.length):null;
  const median=a=>{const sorted=[...a].sort((x,y)=>x-y),middle=Math.floor(sorted.length/2);return sorted.length?sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2:null;};
  const elapsed=(a,b)=>a&&b&&Number.isFinite(Date.parse(a))&&Number.isFinite(Date.parse(b))&&Date.parse(b)>=Date.parse(a)?(Date.parse(b)-Date.parse(a))/60000:null;
  const unique=new Map();
  for(const row of rows.filter(r=>r.kind==='alert_seen'||r.kind==='alert_state')){const prev=unique.get(row.alertId)||{};unique.set(row.alertId,{...prev,seniorId:row.seniorId,firstSeenAt:prev.firstSeenAt||row.firstSeenAt,firstAcknowledgedAt:prev.firstAcknowledgedAt||row.firstAcknowledgedAt,status:row.status||prev.status});}
  const alerts=[...unique.values()];
  const group=ids=>{const set=new Set(ids);const a=alerts.filter(r=>set.has(r.seniorId));const times=a.map(r=>elapsed(r.firstSeenAt,r.firstAcknowledgedAt)).filter(Number.isFinite);const done=tasks.filter(t=>set.has(t.seniorId)&&t.status==='completed');return {alerts:a.length,acknowledged:times.length,resolved:a.filter(r=>r.status==='resolved').length,meanFirstResponseMinutes:average(times),medianFirstResponseMinutes:median(times),completedTasks:done.length,meanCompletionMinutes:average(done.map(t=>elapsed(t.createdAt,t.completedAt)).filter(Number.isFinite)),openTasks:tasks.filter(t=>set.has(t.seniorId)&&!['completed','cancelled'].includes(t.status)).length};};
  const all=group(seniors.map(s=>s.id));
  return {...all,meanResponseMinutes:all.meanFirstResponseMinutes,cities:[...new Set(seniors.map(s=>s.city))].map(city=>{const selected=seniors.filter(s=>s.city===city);return {city,total:selected.length,high:selected.filter(s=>s.level==='high').length,medium:selected.filter(s=>s.level==='medium').length,...group(selected.map(s=>s.id))};}),byCity:[...new Set(seniors.map(s=>s.city))].map(city=>({city,...group(seniors.filter(s=>s.city===city).map(s=>s.id))})),byTeam:[{team:'Primary care team',...all}],feedbackCount:rows.filter(r=>r.kind==='feedback').length,usefulFeedback:rows.filter(r=>r.kind==='feedback'&&r.useful).length,asOfDate:date};
}
