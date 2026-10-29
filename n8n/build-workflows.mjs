import { writeFileSync,mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PREPARE_INGRESS=String.raw`const item=$input.first();
if(!item.binary?.data||typeof this.helpers?.getBinaryDataBuffer!=='function')throw new Error('Raw-body webhook input and the n8n binary helper are required.');
const bytes=await this.helpers.getBinaryDataBuffer(0,'data');
if(bytes.byteLength>131072)throw new Error('Integration payload is too large.');
const raw=Buffer.from(bytes).toString('utf8');
const h=item.json.headers||{},timestamp=String(h['x-samarth-timestamp']||''),nonce=String(h['x-samarth-nonce']||''),signature=String(h['x-samarth-signature']||'');
if(!/^\d{10}$/.test(timestamp)||!/^[A-Za-z0-9_-]{16,96}$/.test(nonce)||!/^[a-f0-9]{64}$/i.test(signature)||Math.abs(Date.now()-Number(timestamp)*1000)>300000)throw new Error('Invalid or expired integration signature.');
return [{json:{raw,timestamp,nonce,signature,signedText:timestamp+'\n'+nonce+'\n'+raw}}];`;
export const VERIFY_INGRESS=String.raw`const input=$input.first().json;
let difference=0;
if(typeof input.computedSignature!=='string'||input.computedSignature.length!==input.signature.length)throw new Error('Invalid integration signature.');
for(let i=0;i<input.signature.length;i++)difference|=input.signature.toLowerCase().charCodeAt(i)^input.computedSignature.toLowerCase().charCodeAt(i);
if(difference)throw new Error('Invalid integration signature.');
const envelope=JSON.parse(input.raw);
if(envelope.version!==1||typeof envelope.jobId!=='string'||!/^[A-Za-z0-9_-]{16,96}$/.test(envelope.jobId))throw new Error('Invalid integration job.');
return [{json:{...input,envelope}}];`;
export const VERIFY_VOICE_INGRESS=VERIFY_INGRESS.replace('return [{json:{...input,envelope}}];',String.raw`if(envelope.kind!=='voice_checkin.request'||!['hi','en'].includes(envelope.language)||Object.keys(envelope).some(key=>!['version','kind','jobId','language'].includes(key)))throw new Error('Voice dispatch accepts only a stored job reference and language, not contact details.');
return [{json:{...input,envelope}}];`);
export const VERIFY_REPORT_CLAIM=String.raw`const job=$input.first().json;
if(job.claimed!==true||job.kind!=='weekly_report.request'||typeof job.jobId!=='string'||!/^[A-Za-z0-9_-]{16,96}$/.test(job.jobId)||!job.facts||!job.schema||!/^[a-f0-9]{64}$/.test(job.factsHash)||!['en','hi'].includes(job.language))throw new Error('The server did not durably claim this report job.');
return [{json:job}];`;
export const PREPARE_MODEL=String.raw`const job=$input.first().json;
if(job.claimed!==true||job.kind!=='weekly_report.request'||!job.facts||!job.schema||!job.factsHash)throw new Error('The server did not claim a report job.');
if(!['en','hi'].includes(job.language))throw new Error('Unsupported report language.');
const model=String($vars.SAMARTH_REPORT_MODEL||'').trim(),protocol=String($vars.SAMARTH_REPORT_PROTOCOL||'openai');
if(!model||!['openai','ollama'].includes(protocol))throw new Error('Configure a report model and supported JSON protocol.');
const instruction='Choose a warm weekly report plan using only supplied fact IDs. Include coverage and every immediate-review cue. Preserve nextStep. Return only JSON matching the supplied schema; never add free text, numbers or diagnoses.';
const messages=[{role:'system',content:instruction},{role:'user',content:JSON.stringify({language:job.language,facts:job.facts,schema:job.schema})}];
const requestBody=protocol==='ollama'?{model,stream:false,messages,format:job.schema,options:{temperature:0.1}}:{model,temperature:0.1,messages,response_format:{type:'json_schema',json_schema:{name:'care_report_plan',strict:true,schema:job.schema}}};
return [{json:{job,model,protocol,requestBody}}];`;
export const VERIFY_PLAN=String.raw`const configured=$('Prepare model request').first().json,job=configured.job;
const response=$input.first().json;
const raw=response.choices?.[0]?.message?.content??response.message?.content;
if(typeof raw!=='string'||raw.length>16000)throw new Error('The model did not return a bounded JSON plan.');
const plan=JSON.parse(raw),allowed=['version','language','opening','highlights','nextStep','closing'];
if(!plan||Array.isArray(plan)||Object.keys(plan).some(k=>!allowed.includes(k))||plan.version!==1||plan.language!==job.language||!['warm','plain'].includes(plan.opening)||!['supportive','brief'].includes(plan.closing)||plan.nextStep!==job.facts.requiredAction)throw new Error('The model output failed report-plan validation.');
if(!Array.isArray(plan.highlights)||!plan.highlights.length||plan.highlights.length>10)throw new Error('The model output has invalid highlights.');
const ids=[];
for(const h of plan.highlights){if(!h||Object.keys(h).some(k=>k!=='factId')||!job.facts.statements.some(f=>f.id===h.factId))throw new Error('The model invented a report statement.');ids.push(h.factId);}
if(new Set(ids).size!==ids.length||!ids.includes('coverage'))throw new Error('The report omitted coverage or repeated evidence.');
for(const f of job.facts.statements.filter(f=>['cue_fall','cue_chest_pain','cue_breathlessness','sensor_possible_fall'].includes(f.id)))if(!ids.includes(f.id))throw new Error('The report omitted immediate-review evidence.');
return [{json:{jobId:job.jobId,factsHash:job.factsHash,plan,model:configured.model}}];`;
export const PREPARE_CALLBACK=String.raw`const plan=$('Validate model evidence').first().json;
const nonce=$input.first().json.callbackNonce,timestamp=String(Math.floor(Date.now()/1000));
if(typeof nonce!=='string'||nonce.length<16)throw new Error('A fresh callback nonce is required.');
const envelope={version:1,kind:'weekly_report.completed',jobId:plan.jobId,factsHash:plan.factsHash,plan:plan.plan,model:plan.model};
const raw=JSON.stringify(envelope);
return [{json:{raw,timestamp,nonce,signedText:timestamp+'\n'+nonce+'\n'+raw,jobId:plan.jobId}}];`;

export const PREPARE_FAILED_CALLBACK=String.raw`const job=$('Verify durable report claim').first().json;
const input=$input.first().json,nonce=input.failureNonce,timestamp=String(Math.floor(Date.now()/1000));
if(job.claimed!==true||typeof nonce!=='string'||nonce.length<16||!['model_error','invalid_output','workflow_error','callback_rejected'].includes(input.failureCode))throw new Error('A claimed job and bounded failure code are required.');
const raw=JSON.stringify({version:1,kind:'weekly_report.failed',jobId:job.jobId,factsHash:job.factsHash,failureCode:input.failureCode});
return [{json:{raw,timestamp,nonce,signedText:timestamp+'\n'+nonce+'\n'+raw,jobId:job.jobId}}];`;

const node=(name,type,typeVersion,parameters,x,y,extra={})=>({id:name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name,type,typeVersion,parameters,position:[x,y],...extra});
const code=(name,jsCode,x,y)=>node(name,'n8n-nodes-base.code',2,{jsCode},x,y);
const hmac=(name,field,x,y)=>node(name,'n8n-nodes-base.crypto',2,{action:'hmac',type:'SHA256',binaryData:false,value:'={{ $json.signedText }}',dataPropertyName:field,encoding:'hex'},x,y,{credentials:{crypto:{id:'SELECT_SAMARTH_HMAC_CREDENTIAL',name:'Samarth Care HMAC - select encrypted credential'}}});
const signedHeaders=source=>({parameters:[{name:'content-type',value:'application/json'},{name:'x-samarth-timestamp',value:`={{ $('${source}').first().json.timestamp }}`},{name:'x-samarth-nonce',value:`={{ $('${source}').first().json.nonce }}`},{name:'x-samarth-signature',value:['Prepare callback','Prepare failure callback'].includes(source)?'={{ $json.callbackSignature }}':`={{ $('${source}').first().json.signature }}`} ]});
const httpSigned=(name,path,source,x,y)=>node(name,'n8n-nodes-base.httpRequest',4.2,{method:'POST',url:`={{ $vars.SAMARTH_APP_ORIGIN + '${path}' }}`,sendHeaders:true,headerParameters:signedHeaders(source),sendBody:true,contentType:'raw',rawContentType:'application/json',body:`={{ $('${source}').first().json.raw }}`,options:{timeout:90000,redirect:{redirect:{followRedirects:false}},response:{response:{responseFormat:'json'}}}},x,y);
function connections(nodes){const c={};for(let i=0;i<nodes.length-1;i++)c[nodes[i].name]={main:[[{node:nodes[i+1].name,type:'main',index:0}]]};return c;}
function shell(name,nodes){return {name,nodes,connections:connections(nodes),settings:{executionOrder:'v1',saveDataErrorExecution:'none',saveDataSuccessExecution:'none',saveManualExecutions:false,saveExecutionProgress:false,executionTimeout:180},active:false,pinData:{},tags:[]};}

export function weeklyReportWorkflow() {
  const nodes=[
    node('Signed report webhook','n8n-nodes-base.webhook',2.1,{httpMethod:'POST',path:'samarth-weekly-report',responseMode:'responseNode',options:{rawBody:true}},0,0,{webhookId:'samarth-weekly-report-v1'}),
    code('Prepare ingress',PREPARE_INGRESS,220,0),hmac('Authenticate request','computedSignature',440,0),code('Verify request',VERIFY_INGRESS,660,0),
    httpSigned('Claim durable report job','/api/integrations/n8n/claim','Prepare ingress',880,0),
    code('Verify durable report claim',VERIFY_REPORT_CLAIM,1100,0),
    node('Acknowledge claimed report job','n8n-nodes-base.respondToWebhook',1.4,{respondWith:'json',enableResponseOutput:false,responseBody:"={{ JSON.stringify({accepted:true,jobId:$json.jobId,status:'processing',generationCompleted:false,executionId:$execution.id}) }}",options:{responseCode:202}},1320,0),
    code('Prepare model request',PREPARE_MODEL,1540,0),
    node('Generate report plan','n8n-nodes-base.httpRequest',4.2,{method:'POST',url:'={{ $vars.SAMARTH_LLM_CHAT_URL }}',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:'={{ JSON.stringify($json.requestBody) }}',options:{timeout:60000,redirect:{redirect:{followRedirects:false}},response:{response:{responseFormat:'json'}}}},1760,0,{credentials:{httpHeaderAuth:{id:'SELECT_REPORT_MODEL_CREDENTIAL',name:'Report model HTTP authentication - select credential'}}}),
    code('Validate model evidence',VERIFY_PLAN,1980,0),
    node('Fresh callback nonce','n8n-nodes-base.crypto',2,{action:'generate',encodingType:'uuid',dataPropertyName:'callbackNonce'},2200,0),
    code('Prepare callback',PREPARE_CALLBACK,2420,0),hmac('Sign report callback','callbackSignature',2640,0),
    httpSigned('Save pending review report','/api/integrations/n8n/callback','Prepare callback',2860,0),
  ];
  const workflow=shell('Samarth Care - evidence-locked weekly family report',nodes);
  const failures=[['Prepare model request','workflow_error'],['Generate report plan','model_error'],['Validate model evidence','invalid_output'],['Save pending review report','callback_rejected']];
  failures.forEach(([name,failureCode],index)=>{
    workflow.nodes.find(n=>n.name===name).onError='continueErrorOutput';
    const branch=code('Classify '+failureCode,`return [{json:{failureCode:'${failureCode}'}}];`,1650+index*235,360);
    workflow.nodes.push(branch);
    workflow.connections[name]??={main:[[]]};
    workflow.connections[name].main[1]=[{node:branch.name,type:'main',index:0}];
    workflow.connections[branch.name]={main:[[{node:'Fresh failure nonce',type:'main',index:0}]]};
  });
  const failureNodes=[
    node('Fresh failure nonce','n8n-nodes-base.crypto',2,{action:'generate',encodingType:'uuid',dataPropertyName:'failureNonce'},2530,360),
    code('Prepare failure callback',PREPARE_FAILED_CALLBACK,2750,360),
    hmac('Sign failure callback','callbackSignature',2970,360),
    httpSigned('Save failed report job','/api/integrations/n8n/callback','Prepare failure callback',3190,360)
  ];
  workflow.nodes.push(...failureNodes);
  Object.assign(workflow.connections,connections(failureNodes));
  workflow.nodes.push(node('Deployment notes','n8n-nodes-base.stickyNote',1,{width:680,height:300,content:'## Configure before publishing\nSelect encrypted Crypto v2 HMAC and model HTTP credentials. Set SAMARTH_APP_ORIGIN, SAMARTH_LLM_CHAT_URL, SAMARTH_REPORT_MODEL, SAMARTH_REPORT_PROTOCOL (openai or ollama). This HTTP model node needs its own credential; inspect the actual workspace Gateway credits if choosing a supported native model node instead. After a one-time durable server claim, HTTP 202 means processing only. The connected path continues through the model and signed callback; only that callback creates a pending-review report. Model, validation and callback errors send signed enum-only failures. Jobs time out durably; ambiguous claimed timeouts require inspection. Explicit terminal-failure retries allocate one new job. Do not retry an accepted execution automatically. Saved execution data is disabled; do not pin health aggregates.'},0,-370));
  return workflow;
}
export function voiceCheckinWorkflow() {
  const nodes=[
    node('Signed voice webhook','n8n-nodes-base.webhook',2.1,{httpMethod:'POST',path:'samarth-hindi-checkin',responseMode:'responseNode',options:{rawBody:true}},0,0,{webhookId:'samarth-hindi-checkin-v1'}),
    code('Prepare ingress',PREPARE_INGRESS,220,0),hmac('Authenticate request','computedSignature',440,0),code('Verify request',VERIFY_VOICE_INGRESS,660,0),
    httpSigned('Request real voice delivery','/api/integrations/n8n/voice-dispatch','Prepare ingress',880,0),
    node('Return provider acceptance','n8n-nodes-base.respondToWebhook',1.4,{respondWith:'json',responseBody:"={{ JSON.stringify({accepted:$json.accepted===true,jobId:$('Verify request').first().json.envelope.jobId,status:$json.status,providerReference:$json.providerId||$json.providerReference||null,externalDelivery:$json.externalDelivery===true}) }}",options:{responseCode:202}},1100,0)
  ];
  const workflow=shell('Samarth Care - Hindi or English telephone check-in dispatch',nodes);
  workflow.nodes.push(node('Real telephone requirements','n8n-nodes-base.stickyNote',1,{width:650,height:260,content:'## Actual calls require an enabled transport\nThe app checks consent, test-number allowlist, per-day limits and zero-spend budget, then calls the configured provider or user-owned SIM bridge. Four Hindi/English questions and signed answer callbacks are handled by the app/provider adapter. n8n success is acceptance, not proof the senior answered. This workflow is inactive until configured and tested; no carrier account or free calling allowance is included in n8n AI Builder credits.'},0,-300));
  return workflow;
}
export function writeWorkflows(){const folder=fileURLToPath(new URL('./workflows/',import.meta.url));mkdirSync(folder,{recursive:true});for(const [name,workflow] of [['weekly-grounded-report.json',weeklyReportWorkflow()],['hindi-voice-checkin.json',voiceCheckinWorkflow()]])writeFileSync(folder+name,JSON.stringify(workflow,null,2)+'\n');}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])writeWorkflows();
