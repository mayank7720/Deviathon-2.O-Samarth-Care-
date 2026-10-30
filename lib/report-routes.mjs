import {canManageCare} from './access.mjs';
import { generateGroundedReport } from './grounded-reports.mjs';
import { createN8nReportRequest,dispatchN8nReport,n8nConfiguration } from './n8n-integration.mjs';
import { workflow,scanEvents } from './workflow-store.mjs';
import {REPORT_JOB_LIFETIME_MS,reportJobView,settleReportJob,retryReportJob} from './report-job-lifecycle.mjs';
import {reportPeriodEnd,prepareReportEvidence,validateReportAction} from './report-management.mjs';

const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
function check(ok,status,message){if(!ok)throw Object.assign(new Error(message),{status});}
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
const visible=(session,id)=>session.scope?.includes('*')||session.scope?.includes(id)||session.seniorId===id;
const jobStatus=job=>reportJobView(job).status;
const pendingView=(job,extra={})=>({...extra,period:job.localFacts?.period,language:job.language,...reportJobView(job),jobId:job.jobId,method:['failed','timed_out'].includes(job.status)?'Report generation did not complete':'Awaiting the configured n8n model'});
export async function queueReportDraft({db,context,senior,report,id,createdAt}) {
  if(!senior.familyConsent)return 0;
  const members=await workflow(db,'members_get',{workspaceId:context.workspaceId||'primary'});
  let count=0;
  const recipients=new Map();
  for(const m of members){let scope;try{scope=typeof m.scope_json==='string'?JSON.parse(m.scope_json):m.scope_json||[];}catch{scope=[];}if(!Array.isArray(scope))scope=[];if(m.role==='family'&&(!m.status||m.status==='active')&&(m.senior_id===senior.id||scope.includes(senior.id)))recipients.set(m.user_id,m);}
  for(const member of recipients.values()) {
    const summary={text:report.text,period:report.period,language:report.language,method:report.method,generation:report.generation,requiresHumanReview:true,clinicalPrediction:false};
    const result=await workflow(db,'delivery_put',{id:`report-delivery:${id}:${member.user_id}`,owner:context.owner,seniorId:senior.id,recipientRole:'family',userId:member.user_id,kind:'weekly_summary',channel:'in_app',status:'pending_review',payload:{title:'Weekly wellbeing report for review',body:report.text,summary,reportId:id},sourceId:id,createdAt});
    if(result.created)count++;
  }
  return count;
}
export async function handleReportRoute({path,request,body={},db,context,rows=[],cohort,engine,getSenior,event,asOfDate,env={}}) {
  if(!['reports','reports/preview','reports/manage','integrations/status'].includes(path))return null;
  try {
    const {session,owner}=context;
    check(['coordinator','operations'].includes(session.role),403,'Reports are available to the assigned care team.');
    if(path==='integrations/status') {
      check(request.method==='GET',405,'Use GET for integration status.');
      let configured=false,reason='The n8n workspace and model credentials have not been connected.';
      try{n8nConfiguration(env);configured=true;reason='Configured; generate a report to inspect its actual execution.';}catch(error){reason=error.message;}
      return reply({n8n:{configured,reason,executionVerified:false},reports:{local:true,llmConfigured:configured,privacy:'Only masked computed facts are sent to n8n; raw notes and direct identifiers stay in the care store.'},sensors:{supportedInput:'Explicitly enabled phone motion sessions; unconfirmed candidates require human verification.'}});
    }
    const url=new URL(request.url),selected=url.searchParams.get('seniorId');
    if(path==='reports/manage'){
      check(request.method==='POST',405,'Use POST for saved report actions.');
      check(canManageCare(session),403,'Only the assigned care team can manage a report.');
      check(typeof db.reportManagement==='function',503,'Report management needs the connected cloud workspace.');
      const input=validateReportAction(body),{action,...payload}=input;
      return reply(await db.reportManagement(action,payload));
    }
    const reportRecords=id=>[...(cohort?.records||[]).filter(r=>r.seniorId===id),...rows.filter(r=>r.kind==='signal'&&r.seniorId===id).map(r=>({...r.record,id:r.id,_submitted:true}))];
    const dataKindFor=senior=>senior.dataProvenance?.kind==='recorded'||cohort?.metadata?.synthetic===false?'imported_recorded':'synthetic';
    if(path==='reports/preview'){
      check(request.method==='GET',405,'Use GET to inspect report evidence.');
      const senior=await getSenior(selected),endDate=reportPeriodEnd(url.searchParams.get('endDate'),asOfDate,cohort?.metadata?.startDate);
      const evidence=await prepareReportEvidence({senior,records:reportRecords(senior.id),endDate,asOfDate,cohortStart:cohort?.metadata?.startDate,engine,dataKind:dataKindFor(senior)});
      return reply({preview:evidence.preview});
    }
    if(request.method==='GET') {
      if(selected)await getSenior(selected);
      if(typeof db.scanEvents==='function'){
        const saved=await scanEvents(db,{owner,seniorIds:selected?[selected]:session.scope?.includes('*')?null:session.scope,kinds:['generated_report','report_job'],limit:300,ascending:false});
        rows=saved.map(r=>({...r,...(typeof r.payload==='string'?JSON.parse(r.payload):r.payload),id:r.id,kind:r.kind,seniorId:r.senior_id,createdAt:r.created_at})).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      }
      const settledRows=await Promise.all(rows.map(async r=>r.kind==='report_job'&&['awaiting_n8n','claimed'].includes(r.status)&&Number(r.expiresAt)<=Date.now()?{...r,...await settleReportJob(db,{id:r.id,owner,job:r})}:r));
      const reports=settledRows.filter(r=>['generated_report','report_job'].includes(r.kind)&&visible(session,r.seniorId)&&(!selected||r.seniorId===selected)&&(r.kind!=='report_job'||r.status!=='completed')).slice(-100).reverse().map(r=>r.kind==='generated_report'?{id:r.id,seniorId:r.seniorId,createdAt:r.createdAt,status:r.status,...r.report}:pendingView(r,{id:r.id,seniorId:r.seniorId,createdAt:r.createdAt}));
      const management=selected&&typeof db.reportManagement==='function'?await db.reportManagement('list',{seniorId:selected}):{families:[],reviews:[],sharingConsent:false};
      const reviewById=new Map((management.reviews||[]).map(r=>[r.reportId,r]));
      return reply({reports:reports.map(r=>({...r,review:reviewById.get(r.id)||{revision:0,state:'pending',archived:false,note:'',checks:{},recipients:[],history:[]}})),families:management.families||[],sharingConsent:management.sharingConsent===true,managementAvailable:typeof db.reportManagement==='function'});
    }
    check(request.method==='POST',405,'Use GET or POST for reports.');
    check(canManageCare(session),403,'Only a care coordinator can generate a report.');
    check(uuid(body.idempotencyKey),400,'A new report needs an idempotency key.');
    if(body.action==='prepare-sharing'){
      check(typeof body.reportId==='string',400,'Choose a saved review draft.');
      const row=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(body.reportId,owner,'generated_report').first();
      check(row,404,'Saved report not found.');
      const senior=await getSenior(row.senior_id),saved=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;
      check(senior.familyConsent===true,403,'Family sharing is paused for this senior.');
      check(typeof saved.report?.text==='string'&&saved.report.text.trim(),409,'A completed draft is required before preparing family sharing.');
      const deliveriesQueued=await queueReportDraft({db,context,senior,report:saved.report,id:row.id,createdAt:row.created_at});
      return reply({ok:true,deliveriesQueued,message:deliveriesQueued?'Family review copies prepared. Review and approve before sharing.':'No new family copy was needed. Check the current family links and existing review copies.'});
    }
    if(body.action==='retry') {
      n8nConfiguration(env);
      check(typeof body.reportId==='string',400,'Choose a saved report job to retry.');
      const prior=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(body.reportId,owner,'report_job').first();
      check(prior,404,'Report job not found.');await getSenior(prior.senior_id);
      const original=typeof prior.payload==='string'?JSON.parse(prior.payload):prior.payload;
      const saved=await settleReportJob(db,{id:prior.id,owner,job:original});
      const retry=await retryReportJob(db,{id:prior.id,owner,job:{...saved,seniorId:prior.senior_id},retryId:`report:${context.userId||session.userId}:${body.idempotencyKey}`,jobId:body.idempotencyKey});
      if(retry.created)await dispatchN8nReport(retry.job.envelope,env);
      return reply({report:pendingView(retry.job,{id:retry.id,seniorId:retry.seniorId,createdAt:retry.createdAt}),repeated:!retry.created},retry.created?202:200);
    }
    check(['en','hi'].includes(body.language)&&['local','n8n'].includes(body.mode),400,'Choose English or Hindi and a configured report mode.');
    check(body.newVersion===undefined||typeof body.newVersion==='boolean',400,'Use the explicit new-version control.');
    const currentSenior=await getSenior(body.seniorId),endDate=reportPeriodEnd(body.endDate,asOfDate,cohort?.metadata?.startDate),id=`report:${context.userId||session.userId}:${body.idempotencyKey}`;
    const records=reportRecords(currentSenior.id),prepared=await prepareReportEvidence({senior:currentSenior,records,endDate,asOfDate,cohortStart:cohort?.metadata?.startDate,engine,dataKind:dataKindFor(currentSenior)}),senior=prepared.subject;
    const existing=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(id,owner,body.mode==='n8n'?'report_job':'generated_report').first();
    if(existing){
      check(existing.senior_id===senior.id,409,'This report key is already bound to another senior.');
      let saved=typeof existing.payload==='string'?JSON.parse(existing.payload):existing.payload;
      if(body.mode==='n8n')saved=await settleReportJob(db,{id,owner,job:saved});
      check((saved.language||saved.report?.language)===body.language,409,'This report key is already bound to another language.');
      check((saved.date||saved.report?.period?.to)===endDate,409,'This report key is already bound to a different reporting week.');
      if(body.mode==='n8n'){
        if(saved.status==='completed'&&typeof saved.reportId==='string'){
          const completed=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(saved.reportId,owner,'generated_report').first();
          if(completed){const value=typeof completed.payload==='string'?JSON.parse(completed.payload):completed.payload;return reply({report:{id:completed.id,seniorId:completed.senior_id,createdAt:completed.created_at,...value.report},repeated:true});}
        }
        return reply({report:pendingView(saved,{id,seniorId:senior.id,createdAt:existing.created_at}),job:{jobId:saved.jobId,status:jobStatus(saved)},repeated:true});
      }
      return reply({report:{id,seniorId:senior.id,createdAt:existing.created_at,...saved.report},repeated:true});
    }
    check(prepared.facts.evidence.length>0,409,'No usable evidence is recorded in this week. Record an update or choose another week.');
    if(!body.newVersion){
      const matching=rows.filter(r=>r.seniorId===senior.id&&(r.kind==='generated_report'&&r.report?.generation?.llmUsed===(body.mode==='n8n')&&r.report?.factsHash===prepared.factsHash&&r.report?.language===body.language||body.mode==='n8n'&&r.kind==='report_job'&&r.factsHash===prepared.factsHash&&r.language===body.language&&['awaiting_n8n','claimed'].includes(r.status)&&Number(r.expiresAt)>Date.now())).at(-1);
      if(matching)return reply({repeated:true,report:matching.kind==='report_job'?pendingView(matching,{id:matching.id,seniorId:senior.id,createdAt:matching.createdAt}):{id:matching.id,seniorId:senior.id,createdAt:matching.createdAt,...matching.report}});
    }
    const createdAt=new Date().toISOString(),dataKind=dataKindFor(senior);
    if(body.mode==='n8n') {
      n8nConfiguration(env);
      const job=await createN8nReportRequest({jobId:body.idempotencyKey,senior,records,asOfDate:endDate,language:body.language,dataKind});
      await event(db,owner,'report_job',senior.id,{status:'awaiting_n8n',jobId:job.envelope.jobId,language:body.language,date:endDate,expiresAt:Date.now()+REPORT_JOB_LIFETIME_MS,...job},id).run();
      const dispatched=await dispatchN8nReport(job.envelope,env);
      return reply({job:dispatched,report:{id,seniorId:senior.id,status:'awaiting_n8n',method:'Awaiting the configured n8n model',createdAt}},202);
    }
    const result=await generateGroundedReport({senior,records,asOfDate:endDate,language:body.language,dataKind});
    const report={...(result.report||result),factsHash:prepared.factsHash,status:'pending_review',requiresHumanReview:true};
    await event(db,owner,'generated_report',senior.id,{status:'pending_review',report},id).run();
    const deliveriesQueued=await queueReportDraft({db,context,senior,report,id,createdAt});
    return reply({report:{id,seniorId:senior.id,createdAt,...report},deliveriesQueued},201);
  } catch(error){return reply({error:error.status?error.message:'The report could not be generated from the available evidence.'},error.status||500);}
}
