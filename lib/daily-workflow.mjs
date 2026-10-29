import { workflow } from './workflow-store.mjs';
import {canManageCare} from './access.mjs';
import { analyzeSenior } from './analytics.mjs';
import { safeFamily,safeSenior,careState,pendingSummary } from './care-state.mjs';
import { buildAlerts } from './analysis-routes.mjs';
import { compareTriage } from './triage.mjs';
import {refreshScoreHistory} from './history.mjs';

/** Durable signal projections survive a failed request and repair on daily retry. */
async function repairScoreHistory({db,context,cohort,engine,rows,runtime}) {
  if(typeof db.historyDirty!=='function'||typeof db.historyScores!=='function')return {repaired:0,hasMore:false};
  const pending=await db.historyDirty({limit:20});
  if(!Array.isArray(pending?.pending))throw Object.assign(new Error('Score history repair returned an invalid queue.'),{status:503});
  const allowed=id=>context.session.scope?.includes('*')||context.session.scope?.includes(id);
  let repaired=0;
  for(const item of pending.pending){
    if(!allowed(item.seniorId)||!cohort.seniors.some(s=>s.id===item.seniorId))throw Object.assign(new Error('Score history repair is outside the assigned care scope.'),{status:403});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(item.from||'')||typeof item.watermark!=='string'||!/^\d+$/.test(item.watermark))throw Object.assign(new Error('Score history repair has an invalid observation cursor.'),{status:503});
    // Future-dated entries are never pulled into a replay. Their dirty marker
    // remains for a later eligible daily job.
    if(item.from>runtime.date)continue;
    await refreshScoreHistory({db,engine,rows,seniorId:item.seniorId,from:item.from,to:runtime.date,cohortStart:cohort.metadata?.startDate||runtime.cohortStart,watermark:item.watermark});
    repaired++;
  }
  if(!pending.pending.length)return {repaired,hasMore:pending.hasMore===true};
  const remaining=await db.historyDirty({limit:1});
  if(!Array.isArray(remaining?.pending))throw Object.assign(new Error('Score history repair could not confirm its remaining queue.'),{status:503});
  return {repaired,hasMore:remaining.hasMore===true||remaining.pending.length>0};
}

export async function revisionFor(rows,date,consents=[],dataRevision='legacy') {
  const bytes=new TextEncoder().encode(JSON.stringify([dataRevision,date,...rows.filter(r=>['signal','consent','alert_state','alert_seen','task'].includes(r.kind)).map(r=>[r.id,r.updatedAt||r.createdAt,r.allowed,r.status,r.record]),consents.map(c=>[c.senior_id,!!c.allowed,c.updated_at]).sort((a,b)=>a[0].localeCompare(b[0]))]));
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return `care-v7-${[...digest].map(b=>b.toString(16).padStart(2,'0')).join('')}`;
}
export async function loadScores({db,context,cohort,engine,rows,runtime,consents=[],force=false}) {
  const {owner,session}=context;
  const isStaff=['coordinator','operations'].includes(session.role);
  const allowed=id=>session.scope?.includes('*')||session.scope?.includes(id)||session.seniorId===id;
  const selected=cohort.seniors.filter(s=>allowed(s.id));
  if(!isStaff&&db.backend==='supabase') {
    const ids=session.role==='family'?(session.scope||[]).filter(id=>id!=='*'):[session.seniorId];
    const entries=await Promise.all(ids.map(seniorId=>workflow(db,'score_get',{owner,seniorId,date:runtime.date})));
    return entries.filter(Boolean).map(row=>row.payload);
  }
  const revision=await revisionFor(rows,runtime.date,consents,runtime.dataRevision);
  const cached=!force?await workflow(db,'scores_get',{owner,date:runtime.date,revision,limit:250}):[];
  const selectedIds=new Set(selected.map(s=>s.id));
  const scopedCache=cached.filter(row=>selectedIds.has(row.senior_id));
  if(scopedCache.length===selected.length&&selected.every(s=>scopedCache.some(r=>r.senior_id===s.id)))return scopedCache.map(r=>r.payload).sort(compareTriage);
  const extra=rows.filter(r=>r.kind==='signal').map(r=>({...r.record,id:r.id,recordedAt:r.createdAt||r.created_at||r.record?.recordedAt,mood:r.mood??r.record?.mood,helpRequested:r.helpRequested??r.record?.helpRequested}));
  const scores=selected.map(s=>{
    const scored=engine.scoreSenior(s.id,runtime.date,extra);
    const saved=consents.find(c=>c.senior_id===s.id);
    const changes=rows.filter(r=>r.kind==='consent'&&r.seniorId===s.id);
    const familyConsent=saved?!!saved.allowed:changes.length?!!changes.at(-1).allowed:!!s.familyConsent;
    const result={...scored,familyConsent,careState:careState(s.id,rows,runtime.date),reviewed:false};
    result.reviewed=result.careState.status!=='unreviewed';
    const observations=[...cohort.records.filter(r=>r.seniorId===s.id),...extra.filter(r=>r.seniorId===s.id)];
    const weeklySummary=analyzeSenior(result,observations,{asOfDate:runtime.date}).summary;
    return {...result,familySafe:safeFamily(result,runtime.date,weeklySummary),seniorSafe:{...safeSenior(result,runtime.date),summary:pendingSummary(runtime.date,weeklySummary)},weeklySummary};
  }).sort(compareTriage);
  // A read-only operations role never writes cache rows. Staff coordinator jobs persist them.
  if(canManageCare(session))await workflow(db,'scores_put',{owner,date:runtime.date,revision,scores:scores.map(s=>({seniorId:s.id,payload:s})),computedAt:new Date().toISOString()});
  return scores;
}

function weekKey(date){const day=Math.floor(Date.parse(date+'T00:00:00Z')/86400000);return Math.floor((day+3)/7);}
export async function queueDeliveries({db,context,scores,rows,runtime,consents=[]}) {
  const {owner}=context,now=new Date().toISOString();
  const members=await workflow(db,'members_get',{workspaceId:context.session.workspaceId||'primary'});
  const {alerts}=buildAlerts({seniors:scores,rows,asOfDate:runtime.date});
  let queued=0,seenChanged=false;
  for(const alert of alerts) {
    if(!rows.some(r=>r.kind==='alert_seen'&&r.alertId===alert.id)) {
      const id=`seen:${owner}:${alert.id}`;
      const seen=await workflow(db,'alert_seen_put',{id,owner,seniorId:alert.seniorId,alertId:alert.id,firstSeenAt:now});
      rows.push({id,kind:'alert_seen',seniorId:alert.seniorId,...seen,createdAt:seen.firstSeenAt});seenChanged=true;
    }
  }
  for(const senior of scores)for(const member of members) {
    const scope=typeof member.scope_json==='string'?JSON.parse(member.scope_json):member.scope_json||[];
    if(member.role==='family'&&(!(member.senior_id===senior.id||scope.includes(senior.id))||!senior.familyConsent))continue;
    if(member.role==='senior')continue;
    if(['coordinator','operations'].includes(member.role)&&!scope.includes('*')&&!scope.includes(senior.id))continue;
    const alert=alerts.find(a=>a.seniorId===senior.id&&a.level==='high'&&a.status==='open');
    const messages=[];
    if(alert)messages.push({kind:'serious_alert',sourceId:`${alert.id}:${alert.fingerprint}`,payload:{title:'Care-team follow-up is needed',body:'A change needs prompt human review. Open your care inbox for the next step.',seniorId:senior.id}});
    if(member.role==='family')messages.push({kind:'weekly_summary',sourceId:`week:${weekKey(runtime.date)}:${senior.id}`,payload:{title:'Your weekly family update',body:senior.weeklySummary.text,summary:senior.weeklySummary,seniorId:senior.id}});
    for(const message of messages) {
      const channels=['in_app'];
      const subscriptions=await workflow(db,'push_get',{owner,userId:member.user_id});
      if(subscriptions.length)channels.push('web_push');
      for(const channel of channels){
        // A duplicate or renewed membership must not resend the same message.
        const id=`${owner}:${message.sourceId}:${member.user_id}:${member.role}:${channel}`;
        const result=await workflow(db,'delivery_put',{id,owner,seniorId:senior.id,recipientRole:member.role,userId:member.user_id,...message,channel,status:message.kind==='weekly_summary'?'pending_review':'queued',createdAt:now});
        if(result?.created)queued++;
      }
    }
  }
  if(seenChanged&&canManageCare(context.session)) {
    for(const senior of scores) {
      senior.careState=careState(senior.id,rows,runtime.date);
      senior.familySafe=safeFamily(senior,runtime.date,senior.weeklySummary);
      senior.seniorSafe={...safeSenior(senior,runtime.date),summary:pendingSummary(runtime.date,senior.weeklySummary)};
    }
    await workflow(db,'scores_put',{owner,date:runtime.date,revision:await revisionFor(rows,runtime.date,consents,runtime.dataRevision),scores:scores.map(s=>({seniorId:s.id,payload:s})),computedAt:now});
  }
  return {queued,alerts:alerts.length};
}
export async function runDaily(options) {
  const {db,context,runtime}=options,owner=context.owner,id=`daily:${owner}:${runtime.date}`,now=new Date().toISOString();
  if(typeof db.notificationRouting==='function')await db.notificationRouting('reconcile');
  const revision=await revisionFor(options.rows,runtime.date,options.consents,runtime.dataRevision);
  const existing=await workflow(db,'job_get',{owner,id});
  const previous=typeof existing?.result_json==='string'?JSON.parse(existing.result_json):existing?.result_json;
  if(existing?.status==='completed'&&previous?.revision===revision&&!options.force) {
    const scores=await loadScores(options);
    const history=await repairScoreHistory(options);
    return {job:{id,status:'already_completed',date:runtime.date},deliveriesQueued:0,scores,history};
  }
  await workflow(db,'job_put',{id,owner,date:runtime.date,status:'running',createdAt:now});
  try {
    const scores=await loadScores({...options,force:true});
    const history=await repairScoreHistory(options);
    const result={...await queueDeliveries({...options,scores}),revision:await revisionFor(options.rows,runtime.date,options.consents,runtime.dataRevision),history};
    await workflow(db,'job_put',{id,owner,date:runtime.date,status:'completed',result,createdAt:now,completedAt:new Date().toISOString()});
    return {job:{id,status:'completed',date:runtime.date},deliveriesQueued:result.queued,scores,history};
  } catch(error) {
    await workflow(db,'job_put',{id,owner,date:runtime.date,status:'failed',result:{error:'Daily processing failed; retry is safe.'},createdAt:now,completedAt:new Date().toISOString()});throw error;
  }
}
