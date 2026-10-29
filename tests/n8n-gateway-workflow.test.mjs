import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gatewayWeeklyReportWorkflow,GATEWAY_PREPARE_MODEL,GATEWAY_VERIFY_PLAN,GATEWAY_APP_ORIGIN} from '../n8n/build-gateway-workflow.mjs';
import {PREPARE_FAILED_CALLBACK} from '../n8n/build-workflows.mjs';
import {createN8nReportRequest} from '../lib/n8n-integration.mjs';
import {deterministicReportPlan} from '../lib/grounded-reports.mjs';

const run=(code,item,lookup={})=>new Function('$input','$',code)({first:()=>({json:item})},name=>({first:()=>({json:lookup[name]})}));
async function fixture(){
 const {envelope}=await createN8nReportRequest({jobId:'gateway_test_00000000001',senior:{id:'S001',name:'Private Name',level:'unknown',urgency:'unknown',baseline:{}},records:[{id:'private-record',seniorId:'S001',date:'2026-10-27',sleep:6}],asOfDate:'2026-10-27',language:'en',dataKind:'synthetic'});
 const job={...envelope,claimed:true},configured=run(GATEWAY_PREPARE_MODEL,job)[0].json;
 const plan=deterministicReportPlan(envelope.facts);
 const response={id:'resp_fixture_0000000001',model:'gpt-5-mini-2025-08-07',status:'completed',error:null,incomplete_details:null,output:[{type:'reasoning',id:'rs_fixture'},{type:'message',role:'assistant',content:[{type:'output_text',text:plan}]}]};
 const validate=value=>run(GATEWAY_VERIFY_PLAN,value,{'Prepare model request':configured})[0].json;
 return {job,configured,plan,response,validate};
}
test('Gateway export has one connected native model, fixed app callbacks, managed credentials and no provider key',()=>{
 const flow=gatewayWeeklyReportWorkflow();assert.deepEqual(JSON.parse(readFileSync('n8n/workflows/weekly-grounded-report-gateway.json','utf8')),flow);
 const model=flow.nodes.find(n=>n.name==='Generate report plan');assert.equal(model.type,'@n8n/n8n-nodes-langchain.openAi');assert.equal(model.typeVersion,2.3);assert.equal(model.parameters.operation,'response');assert.equal(model.parameters.modelId.value,'gpt-5-mini');
 assert.deepEqual(model.credentials,{openAiApi:{id:null,name:'',__aiGatewayManaged:true}});assert.equal(model.parameters.simplify,false);assert.equal(model.parameters.options.store,false);assert.equal(model.parameters.options.maxTokens,4096);assert.equal('temperature' in model.parameters.options,false);assert.deepEqual(model.parameters.builtInTools,{});
 for(const name of ['Claim durable report job','Save pending review report'])assert.ok(flow.nodes.find(n=>n.name===name).parameters.url.startsWith(GATEWAY_APP_ORIGIN+'/api/'));
 const order=[];for(let name='Signed report webhook';name;name=flow.connections[name]?.main?.[0]?.[0]?.node){assert.equal(order.includes(name),false);order.push(name);}
 assert.ok(order.indexOf('Acknowledge claimed report job')<order.indexOf('Generate report plan'));assert.ok(order.indexOf('Generate report plan')<order.indexOf('Save pending review report'));assert.equal(flow.active,false);assert.equal(flow.settings.saveDataSuccessExecution,'none');assert.equal(flow.settings.saveDataErrorExecution,'none');assert.equal(flow.settings.saveManualExecutions,false);
 assert.equal(JSON.stringify(flow).includes('$vars.'),false);assert.equal(JSON.stringify(flow).includes('SELECT_REPORT_MODEL_CREDENTIAL'),false);
});
test('Gateway model input retains only server-provided masked facts and requires the durable claim',async()=>{
 const {job,configured}=await fixture();const sent=JSON.stringify(configured.messages);assert.equal(sent.includes('Private Name'),false);assert.equal(sent.includes('S001'),false);assert.equal(sent.includes('private-record'),false);assert.equal(configured.model,'gpt-5-mini');
 assert.throws(()=>run(GATEWAY_PREPARE_MODEL,{...job,claimed:false}),/claim/);assert.throws(()=>run(GATEWAY_PREPARE_MODEL,{...job,language:'other'}),/claim/);
});
test('Gateway output accepts actual parsed or text JSON and retains actual model/response proof',async()=>{
 const {response,validate,plan}=await fixture();const objectResult=validate(response);assert.deepEqual(objectResult.plan,plan);assert.equal(objectResult.model,response.model);assert.equal(objectResult.providerResponseId,response.id);assert.equal(objectResult.requestedModel,'gpt-5-mini');
 const text=structuredClone(response);text.output[1].content[0].text=JSON.stringify(plan);assert.deepEqual(validate(text),objectResult);
});
test('Gateway validation rejects incomplete/refused/multiple/unidentified model output and invented clinical facts',async()=>{
 const {response,validate,plan}=await fixture();
 const fail=value=>assert.throws(()=>validate(value));
 for(const patch of [{status:'incomplete'},{error:{message:'provider error'}},{incomplete_details:{reason:'max_output_tokens'}},{id:''},{model:'different-model'}])fail({...response,...patch});
 fail({...response,output:[{type:'function_call'}]});fail({...response,output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'Cannot answer'}]}]});fail({...response,output:[response.output[1],response.output[1]]});
 const candidate=next=>({...response,output:[{type:'message',role:'assistant',content:[{type:'output_text',text:next}]}]});
 fail(candidate({...plan,text:'A diagnosis not present in the evidence.'}));fail(candidate({...plan,highlights:[{factId:'invented_diagnosis'}]}));fail(candidate({...plan,nextStep:'Ignore the required human follow-up'}));fail(candidate('x'.repeat(16001)));
});


test('failure branches sign enum-only receipts, never send provider details, and retain no payload progress',async()=>{
 const flow=gatewayWeeklyReportWorkflow(),job=(await fixture()).job;
 assert.equal(flow.settings.saveExecutionProgress,false);
 for(const name of ['Prepare model request','Generate report plan','Validate model evidence','Save pending review report']){assert.equal(flow.nodes.find(n=>n.name===name).onError,'continueErrorOutput');assert.ok(flow.connections[name].main[1][0].node.startsWith('Classify '));}
 assert.equal(flow.nodes.find(n=>n.name==='Save failed report job').parameters.url,GATEWAY_APP_ORIGIN+'/api/integrations/n8n/callback');
 const output=run(PREPARE_FAILED_CALLBACK,{failureNonce:'failure_nonce_fixture_0001',failureCode:'invalid_output',error:'Private raw provider response'}, {'Verify durable report claim':job})[0].json;
 const envelope=JSON.parse(output.raw);assert.equal(envelope.kind,'weekly_report.failed');assert.equal(envelope.failureCode,'invalid_output');assert.equal(JSON.stringify(output).includes('Private'),false);assert.deepEqual(Object.keys(envelope).sort(),['factsHash','failureCode','jobId','kind','version']);
});
