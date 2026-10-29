import {canManageCare} from './access.mjs';
import { generateGroundedReport } from './grounded-reports.mjs';
import { createN8nReportRequest,dispatchN8nReport,n8nConfiguration } from './n8n-integration.mjs';
import { workflow } from './workflow-store.mjs';
import {REPORT_JOB_LIFETIME_MS,reportJobView,settleReportJob,retryReportJob} from './report-job-lifecycle.mjs';

const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
function check(ok,status,message){if(!ok)throw Object.assign(new Error(message),{status});}
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
const visible=(session,id)=>session.scope?.includes('*')||session.scope?.includes(id)||session.seniorId===id;
const jobStatus=job=>reportJobView(job).status;
const pendingView=(job,extra={})=>({...extra,language:job.language,...reportJobView(job),jobId:job.jobId,method:['failed','timed_out'].includes(job.status)?'Report generation did not complete':'Awaiting the configured n8n model'});
export async function queueReportDraft({db,context,senior,report,id,createdAt}) {
  if(!senior.familyConsent)return 0;
  const members=await workflow(db,'members_get',{workspaceId:context.workspaceId||'primary'});
  let count=0;
  for(const member of members.filter(m=>m.role==='family'&&m.senior_id===senior.id)) {
    const summary={text:report.text,period:report.period,language:report.language,method:report.method,requiresHumanReview:true,clinicalPrediction:false};
    const result=await workflow(db,'delivery_put',{id:`report-delivery:${id}:${member.user_id}`,owner:context.owner,seniorId:senior.id,recipientRole:'family',userId:member.user_id,kind:'weekly_summary',channel:'in_app',status:'pending_review',payload:{title:'Weekly wellbeing report for review',body:report.text,summary,reportId:id},sourceId:id,createdAt});
    if(result.created)count++;
  }
  return count;
}
export async function handleReportRoute({path,request,body={},db,context,rows=[],cohort,getSenior,event,asOfDate,env={}}) {
  if(!['reports','integrations/status'].includes(path))return null;
  try {
    const {session,owner}=context;
    check(['coordinator','operations'].includes(session.role),403,'Reports are available to the assigned care team.');
    if(path==='integrations/status'&&request.method==='GET') {
      let configured=false,reason='The n8n workspace and model credentials have not been connected.';
      try{n8nConfiguration(env);configured=true;reason='Configured; generate a report to inspect its actual execution.';}catch(error){reason=error.message;}
      return reply({n8n:{configured,reason},reports:{local:true,llmConfigured:configured,privacy:'Only masked computed facts are sent to n8n; raw notes and direct identifiers stay in the care store.'},sensors:{supportedInput:'Explicitly enabled phone motion sessions; unconfirmed candidates require human verification.'}});
    }
    const selected=new URL(request.url).searchParams.get('seniorId');
    if(request.method==='GET') {
      if(selected)await getSenior(selected);
      const settledRows=await Promise.all(rows.map(async r=>r.kind==='report_job'&&['awaiting_n8n','claimed'].includes(r.status)&&Number(r.expiresAt)<=Date.now()?{...r,...await settleReportJob(db,{id:r.id,owner,job:r})}:r));
      const reports=settledRows.filter(r=>['generated_report','report_job'].includes(r.kind)&&visible(session,r.seniorId)&&(!selected||r.seniorId===selected)&&(r.kind!=='report_job'||r.status!=='completed')).slice(-100).reverse().map(r=>r.kind==='generated_report'?{id:r.id,seniorId:r.seniorId,createdAt:r.createdAt,status:r.status,...r.report}:pendingView(r,{id:r.id,seniorId:r.seniorId,createdAt:r.createdAt}));
      return reply({reports});
    }
    check(request.method==='POST',405,'Use GET or POST for reports.');
    check(canManageCare(session),403,'Only a care coordinator can generate a report.');
    check(uuid(body.idempotencyKey),400,'A new report needs an idempotency key.');
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
    const senior=await getSenior(body.seniorId),id=`report:${context.userId||session.userId}:${body.idempotencyKey}`;
    const existing=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(id,owner,body.mode==='n8n'?'report_job':'generated_report').first();
    if(existing){
      check(existing.senior_id===senior.id,409,'This report key is already bound to another senior.');
      let saved=typeof existing.payload==='string'?JSON.parse(existing.payload):existing.payload;
      if(body.mode==='n8n')saved=await settleReportJob(db,{id,owner,job:saved});
      check((saved.language||saved.report?.language)===body.language,409,'This report key is already bound to another language.');
      if(body.mode==='n8n'){
        if(saved.status==='completed'&&typeof saved.reportId==='string'){
          const completed=await db.prepare('SELECT id,senior_id,payload,created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?').bind(saved.reportId,owner,'generated_report').first();
          if(completed){const value=typeof completed.payload==='string'?JSON.parse(completed.payload):completed.payload;return reply({report:{id:completed.id,seniorId:completed.senior_id,createdAt:completed.created_at,...value.report},repeated:true});}
        }
        return reply({report:pendingView(saved,{id,seniorId:senior.id,createdAt:existing.created_at}),job:{jobId:saved.jobId,status:jobStatus(saved)},repeated:true});
      }
      return reply({report:{id,seniorId:senior.id,createdAt:existing.created_at,...saved.report},repeated:true});
    }
    const records=[...cohort.records.filter(r=>r.seniorId===senior.id),...rows.filter(r=>r.kind==='signal'&&r.seniorId===senior.id).map(r=>({...r.record,id:r.id}))];
    const createdAt=new Date().toISOString(),dataKind=senior.dataProvenance?.kind==='recorded'||cohort.metadata?.synthetic===false?'imported_recorded':'synthetic';
    if(body.mode==='n8n') {
      n8nConfiguration(env);
      const job=await createN8nReportRequest({jobId:body.idempotencyKey,senior,records,asOfDate,language:body.language,dataKind});
      await event(db,owner,'report_job',senior.id,{status:'awaiting_n8n',jobId:job.envelope.jobId,language:body.language,date:asOfDate,expiresAt:Date.now()+REPORT_JOB_LIFETIME_MS,...job},id).run();
      const dispatched=await dispatchN8nReport(job.envelope,env);
      return reply({job:dispatched,report:{id,seniorId:senior.id,status:'awaiting_n8n',method:'Awaiting the configured n8n model',createdAt}},202);
    }
    const result=await generateGroundedReport({senior,records,asOfDate,language:body.language,dataKind});
    const report={...(result.report||result),status:'pending_review',requiresHumanReview:true};
    await event(db,owner,'generated_report',senior.id,{status:'pending_review',report},id).run();
    const deliveriesQueued=await queueReportDraft({db,context,senior,report,id,createdAt});
    return reply({report:{id,seniorId:senior.id,createdAt,...report},deliveriesQueued},201);
  } catch(error){return reply({error:error.status?error.message:'The report could not be generated from the available evidence.'},error.status||500);}
}
