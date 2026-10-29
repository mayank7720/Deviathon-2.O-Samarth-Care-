import { verifyN8nEnvelope } from './n8n-integration.mjs';
import { providerReportFacts,reportPlanSchema,validateGeneratedReport } from './grounded-reports.mjs';

const check=(value,status,message)=>{if(!value)throw Object.assign(new Error(message),{status});};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
async function boundedBody(request) {
  const length=request.headers.get('content-length');
  check(!length||/^\d+$/.test(length)&&Number(length)<=131072,413,'The integration body is too large.');
  if(!request.body)return '';
  const reader=request.body.getReader(),chunks=[];let total=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>131072){await reader.cancel();throw Object.assign(new Error('The integration body is too large.'),{status:413});}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder().decode(bytes);
}
/** All dependencies are trusted server capabilities. None can be supplied by an HTTP caller. */
export function createN8nHooksHandler({loadConfig,claimNonce,getJob,claimReport,completeReport,failReport,now=()=>Date.now()}) {
  for(const capability of [loadConfig,claimNonce,getJob,claimReport,completeReport])check(typeof capability==='function',503,'The integration server capabilities are not configured.');
  return async request=>{
    try {
      const url=new URL(request.url),path=url.pathname.replace(/\/$/,'');
      const claim=path.endsWith('/claim'),callback=path.endsWith('/callback');
      check(claim||callback,404,'Integration route not found.');
      check(!url.search,400,'Integration hooks do not accept query parameters.');
      check(request.method==='POST',405,'Use POST for integration hooks.');
      check(request.headers.get('content-type')?.includes('application/json'),415,'Use application/json.');
      const raw=await boundedBody(request),env=await loadConfig();
      const {envelope}=await verifyN8nEnvelope(request,raw,env,{now:now(),expectedKind:claim?'weekly_report.request':['weekly_report.completed','weekly_report.failed'],claimNonce});
      const job=await getJob(envelope.jobId);
      check(job&&job.localFacts&&job.localFacts.version==='samarth.report-facts.v1',404,'Report job not found.');
      check(Number.isFinite(Number(job.expiresAt))&&Number(job.expiresAt)>now(),410,'This report job has expired.');
      check(['awaiting_n8n','claimed'].includes(job.status),409,'This report job is no longer awaiting a result.');
      check(typeof envelope.factsHash==='string'&&/^[a-f0-9]{64}$/.test(envelope.factsHash)&&envelope.factsHash===job.factsHash,409,'The result does not match the saved evidence.');
      check(['en','hi'].includes(job.language),400,'The saved report language is invalid.');
      if(claim) {
        check(envelope.language===job.language,409,'The request does not match the saved language.');
        check(job.status==='awaiting_n8n'&&await claimReport(envelope.jobId,{factsHash:job.factsHash,language:job.language}),409,'This report job was already claimed. Inspect its execution; do not run inference twice.');
        return reply({claimed:true,kind:'weekly_report.request',jobId:envelope.jobId,language:job.language,factsHash:job.factsHash,facts:providerReportFacts(job.localFacts),schema:reportPlanSchema(job.localFacts,job.language)});
      }
      check(job.status==='claimed',409,'This report job has not been claimed by an accepted workflow.');
      if(envelope.kind==='weekly_report.failed') {
        check(Object.keys(envelope).every(key=>['version','kind','jobId','factsHash','failureCode'].includes(key)),400,'The failure callback contains unsupported fields.');
        check(['model_error','invalid_output','workflow_error','callback_rejected'].includes(envelope.failureCode),400,'Use a supported failure code without provider error text.');
        check(typeof failReport==='function',503,'Durable report failure storage is not configured.');
        const failure=await failReport(envelope.jobId,{factsHash:job.factsHash,failureCode:envelope.failureCode});
        check(failure?.failed===true,409,'This report job already has a terminal result.');
        return reply({accepted:true,jobId:envelope.jobId,status:'failed',failureCode:envelope.failureCode},202);
      }
      check(Object.keys(envelope).every(key=>['version','kind','jobId','factsHash','plan','model'].includes(key)),400,'The report callback contains unsupported fields.');
      const validated=validateGeneratedReport(envelope.plan,job.localFacts,{language:job.language});
      check(validated.valid,422,'The model output failed the saved evidence checks.');
      const model=typeof envelope.model==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$/.test(envelope.model)?envelope.model:'configured model';
      const report={...validated.report,method:'LLM-guided evidence-locked weekly report',generation:{llmUsed:true,provider:'n8n',model,fallbackReason:null},status:'pending_review',requiresHumanReview:true,facts:job.localFacts,factsHash:job.factsHash,evidence:structuredClone(job.localFacts.evidence)};
      const completion=await completeReport(envelope.jobId,report);
      check(completion?.completed===true,409,'This report job has already been completed.');
      return reply({accepted:true,jobId:envelope.jobId,status:'pending_review',reportId:typeof completion?.reportId==='string'?completion.reportId:envelope.jobId},202);
    } catch(error) {
      const known=Number.isInteger(error?.status)&&error.status>=400&&error.status<600;
      return reply({error:known?error.message:'The integration request could not be completed.'},known?error.status:500);
    }
  };
}
