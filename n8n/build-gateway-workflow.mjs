import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {weeklyReportWorkflow,VERIFY_PLAN} from './build-workflows.mjs';

export const GATEWAY_APP_ORIGIN='https://swasthsync.vercel.app';
export const GATEWAY_MODEL='gpt-5-mini';
export const GATEWAY_PREPARE_MODEL=String.raw`const job=$input.first().json;
if(job.claimed!==true||job.kind!=='weekly_report.request'||!job.facts||!job.schema||!/^[a-f0-9]{64}$/.test(job.factsHash)||!['en','hi'].includes(job.language))throw new Error('The server did not claim a supported report job.');
const instruction='Choose a warm weekly report plan using only supplied fact IDs. Include coverage and every immediate-review cue. Preserve nextStep. Return only JSON matching the supplied schema; never add free text, numbers or diagnoses.';
const messages=[{type:'text',role:'system',content:instruction},{type:'text',role:'user',content:JSON.stringify({language:job.language,facts:job.facts,schema:job.schema})}];
return [{json:{job,model:'gpt-5-mini',messages}}];`;

const originalValidation=VERIFY_PLAN.slice(VERIFY_PLAN.indexOf('const plan=JSON.parse(raw)'));
export const GATEWAY_VERIFY_PLAN=String.raw`const configured=$('Prepare model request').first().json,job=configured.job;
const response=$input.first().json;
if(response.status!=='completed'||response.error!=null||response.incomplete_details!=null)throw new Error('The model response did not complete successfully.');
if(typeof response.id!=='string'||!/^resp_[A-Za-z0-9_-]{8,115}$/.test(response.id)||typeof response.model!=='string'||!/^gpt-5-mini(?:-[A-Za-z0-9.-]+)?$/.test(response.model)||response.model.length>120)throw new Error('The model response is missing its actual model or response identity.');
if(!Array.isArray(response.output)||response.output.length>20||response.output.some(item=>!item||!['message','reasoning'].includes(item.type)))throw new Error('The model returned unsupported output.');
const messages=response.output.filter(item=>item.type==='message');
if(messages.length!==1||messages[0].role!=='assistant'||!Array.isArray(messages[0].content)||messages[0].content.length!==1||messages[0].content[0]?.type!=='output_text')throw new Error('The model must return one JSON plan without refusals or tool calls.');
const content=messages[0].content[0].text;
const raw=typeof content==='string'?content:content&&typeof content==='object'&&!Array.isArray(content)?JSON.stringify(content):null;
if(typeof raw!=='string'||raw.length>16000)throw new Error('The model did not return a bounded JSON plan.');
`+originalValidation.replace(
  'return [{json:{jobId:job.jobId,factsHash:job.factsHash,plan,model:configured.model}}];',
  'return [{json:{jobId:job.jobId,factsHash:job.factsHash,plan,model:response.model,providerResponseId:response.id,requestedModel:configured.model}}];',
);

export function gatewayWeeklyReportWorkflow(){
  const workflow=weeklyReportWorkflow();
  workflow.name='Samarth Care - Gateway credits evidence-locked weekly report';
  const find=name=>workflow.nodes.find(node=>node.name===name);
  find('Prepare model request').parameters.jsCode=GATEWAY_PREPARE_MODEL;
  const generate=find('Generate report plan');
  generate.type='@n8n/n8n-nodes-langchain.openAi';
  generate.typeVersion=2.3;
  generate.credentials={openAiApi:{id:null,name:'',__aiGatewayManaged:true}};
  generate.parameters={
    resource:'text',operation:'response',
    modelId:{__rl:true,mode:'id',value:GATEWAY_MODEL},
    responses:{values:[
      {type:'text',role:'system',content:'={{ $json.messages[0].content }}'},
      {type:'text',role:'user',content:'={{ $json.messages[1].content }}'},
    ]},
    simplify:false,hideTools:'hide',builtInTools:{},
    options:{store:false,maxTokens:4096,maxToolsIterations:1,parallelToolCalls:false,
      textFormat:{textOptions:{type:'json_schema',name:'care_report_plan',schema:'={{ JSON.stringify($json.job.schema) }}',strict:true}}},
  };
  find('Validate model evidence').parameters.jsCode=GATEWAY_VERIFY_PLAN;
  for(const [name,path] of [['Claim durable report job','/api/integrations/n8n/claim'],['Save pending review report','/api/integrations/n8n/callback'],['Save failed report job','/api/integrations/n8n/callback']])find(name).parameters.url=GATEWAY_APP_ORIGIN+path;
  find('Deployment notes').parameters.content='## Gateway credits setup\nThe inspected showcase workspace offered Gateway credits with $2.00 remaining and GPT-5-MINI. Recheck the current balance before execution; no top-up is requested. This native OpenAI v2.3 node uses the managed credential marker, GPT-5-MINI, no tools, a bounded output and store:false. Select the existing encrypted Crypto HMAC credential on all signing nodes. App URLs are fixed to the public Samarth Care site; no n8n variables or provider API key are required. Only a durably claimed report receives HTTP 202 processing. Model or evidence-validation errors send a signed failure receipt. A missed callback reaches a durable deadline; a claimed timeout requires execution inspection before another model request. The connected model and signed callback must finish before a pending-review report exists. The application strictly validates the plan against saved evidence. The node preserves actual model/response IDs internally; the existing callback sends the actual model and the app retains its n8n execution reference. Do not claim provider-side strict enforcement merely from the node option: current request-builder source omits that flag. Execution-data saving is disabled; do not pin health aggregates. Import this path instead of the generic HTTP template, not alongside the same webhook path.';
  return workflow;
}

export function writeGatewayWorkflow(){
  const folder=fileURLToPath(new URL('./workflows/',import.meta.url));mkdirSync(folder,{recursive:true});
  writeFileSync(folder+'weekly-grounded-report-gateway.json',JSON.stringify(gatewayWeeklyReportWorkflow(),null,2)+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])writeGatewayWorkflow();
