import test from 'node:test';import assert from 'node:assert/strict';
import {queueReportDraft,handleReportRoute} from '../lib/report-routes.mjs';
test('weekly draft recipients include scope-based family links exactly once and exclude revoked or unrelated links',async()=>{
 const saved=[];const db={workflow:async(op,p)=>{if(op==='members_get')return[{user_id:'family-a',role:'family',senior_id:'',scope_json:'["S001"]',status:'active'},{user_id:'family-a',role:'family',senior_id:'S001',scope_json:'[]',status:'active'},{user_id:'family-b',role:'family',senior_id:'S002',scope_json:'[]',status:'active'},{user_id:'family-c',role:'family',senior_id:'S001',scope_json:'[]',status:'revoked'}];if(op==='delivery_put'){saved.push(p);return{created:true};}throw Error(op);}};
 const count=await queueReportDraft({db,context:{owner:'workspace:primary'},senior:{id:'S001',familyConsent:true},report:{text:'Verified example summary',period:{from:'2026-10-24',to:'2026-10-30'},language:'en'},id:'report:test',createdAt:'2026-10-30T12:00:00Z'});
 assert.equal(count,1);assert.equal(saved[0].userId,'family-a');assert.equal(saved[0].status,'pending_review');assert.equal(saved[0].channel,'in_app');assert.equal(saved[0].payload.summary.clinicalPrediction,false);
 assert.equal(await queueReportDraft({db,context:{},senior:{id:'S001',familyConsent:false},report:{},id:'report:none'}),0);
});

test('an existing completed draft can prepare review copies for newly linked family without another model run',async()=>{
 const writes=[],lookups=[];
 const db={prepare:sql=>({bind:(...args)=>({first:async()=>{lookups.push(args);return{id:'saved-report',senior_id:'S001',created_at:'2026-10-31T00:00:00Z',payload:{report:{text:'Recorded supported update.',period:{from:'2026-10-24',to:'2026-10-30'},generation:{llmUsed:true,provider:'n8n'}}}};}})}),workflow:async(op,p)=>{if(op==='members_get')return[{user_id:'family-new',role:'family',senior_id:'S001',scope_json:'[]',status:'active'}];if(op==='delivery_put'){writes.push(p);return{created:true};}throw Error(op);}};
 const base={path:'reports',request:new Request('https://care.example/api/reports',{method:'POST'}),body:{action:'prepare-sharing',reportId:'saved-report',idempotencyKey:'11111111-1111-4111-8111-111111111111'},db,context:{owner:'workspace:primary',session:{role:'coordinator',scope:['S001']}},getSenior:async id=>{assert.equal(id,'S001');return{id,familyConsent:true};}};
 const r=await handleReportRoute(base);assert.equal(r.status,200);assert.equal((await r.json()).deliveriesQueued,1);
 assert.equal(lookups[0][2],'generated_report');assert.equal(writes[0].sourceId,'saved-report');assert.equal(writes[0].status,'pending_review');assert.equal(writes[0].payload.summary.generation.llmUsed,true);
 const denied=await handleReportRoute({...base,getSenior:async()=>({id:'S001',familyConsent:false})});assert.equal(denied.status,403);assert.equal(writes.length,1);
 const family=await handleReportRoute({...base,context:{...base.context,session:{role:'family',scope:['S001']}}});assert.equal(family.status,403);
});
