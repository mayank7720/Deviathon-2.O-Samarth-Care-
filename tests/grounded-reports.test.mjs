import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportFacts,providerReportFacts,deterministicReportPlan,validateGeneratedReport,generateGroundedReport,reportPlanSchema } from '../lib/grounded-reports.mjs';

const senior={id:'S001',name:'Private Meera',email:'private@example.test',level:'medium',urgency:'today',baseline:{sleep:7,activity:4000,systolic:130,weight:60}};
const records=[
  {id:'private-source-1',seniorId:'S001',date:'2026-10-21',sleep:6,activity:3000,vitals:{systolic:140,weight:59},medication:{taken:2,prescribed:3},note:'Feeling lonely. Call 9876543210.'},
  {id:'private-source-2',seniorId:'S001',date:'2026-10-22',sleep:4,activity:2000,vitals:{systolic:150},medication:{taken:1,prescribed:3}},
  {id:'private-source-3',seniorId:'S001',date:'2026-10-27',sleep:5,medication:{taken:0,prescribed:3}},
  {seniorId:'S001',date:'2026-10-25'},
  {seniorId:'S002',date:'2026-10-26',sleep:20,note:'Chest pain.'},
  {seniorId:'S001',date:'2026-10-28',sleep:18,note:'Chest pain.'},
  {seniorId:'S001',date:'2026-02-30',sleep:10}
];
const make=()=>createReportFacts(senior,records,'2026-10-27',{dataKind:'synthetic'});

test('facts compute exact observed aggregates and exclude blank, foreign, future and invalid records',()=>{
  const facts=make();
  assert.deepEqual(facts.period,{from:'2026-10-21',to:'2026-10-27',days:7});
  assert.deepEqual(facts.statements.find(f=>f.id==='coverage').values,{observedDays:3,windowDays:7,missingDays:4});
  assert.equal(facts.statements.find(f=>f.id==='sleep').values.average,5);
  assert.deepEqual(facts.statements.find(f=>f.id==='medication').values,{taken:3,scheduled:9,missed:6,adherencePercent:33.3,loggedDays:3});
  assert.equal(facts.statements.some(f=>f.id==='cue_chest_pain'),false);
  assert.equal(facts.evidence.length,3);
});
test('same-day independent submissions are merged while dose totals are counted once',()=>{
  const facts=createReportFacts(senior,[records[0],{id:'later',seniorId:'S001',date:'2026-10-21',vitals:{spo2:97},medication:{taken:3,prescribed:3}}],'2026-10-27');
  assert.equal(facts.statements.find(f=>f.id==='medication').values.taken,3);
  assert.equal(facts.statements.find(f=>f.id==='medication').values.scheduled,3);
  assert.equal(facts.statements.find(f=>f.id==='systolic').values.average,140);
  assert.equal(facts.statements.find(f=>f.id==='spo2').values.average,97);
});
test('external whitelist strips direct identifiers, raw notes and private record references',()=>{
  const facts=make(),masked=providerReportFacts(facts),serialized=JSON.stringify(masked);
  for(const secret of ['S001','Private Meera','private@example.test','9876543210','private-source-1','Feeling lonely'])assert.equal(serialized.includes(secret),false,secret);
  assert.equal(facts.evidence[0].sourceRecordId,'private-source-1');
  assert.equal(masked.statements.some(f=>f.id==='cue_loneliness'),true);
  assert.match(masked.privacy,/remain sensitive/);
});
test('warm-up never claims a personal baseline and malformed readings never become facts',()=>{
  const facts=createReportFacts({...senior,warmup:true},[{seniorId:'S001',date:'2026-10-27',vitals:{systolic:10000,spo2:-2},sleep:30,medication:{taken:4,prescribed:3}}],'2026-10-27');
  assert.equal(facts.statements.length,1);assert.equal(facts.statements[0].values.observedDays,0);
  assert.equal(facts.statements.some(f=>f.kind==='personal_comparison'),false);
  assert.throws(()=>createReportFacts(senior,[],'2026-02-30'),/calendar/);
});
test('a model selects only verified statements and cannot inject prose, figures, diagnoses or unknown fact IDs',()=>{
  const facts=make(),plan=deterministicReportPlan(facts);
  assert.equal(validateGeneratedReport(plan,facts).valid,true);
  for(const altered of [
    {...plan,text:'The senior has diabetes with 99% certainty.'},
    {...plan,highlights:[{factId:'coverage',text:'All 7 days were normal.'}]},
    {...plan,highlights:[{factId:'invented-improvement'}]},
    {...plan,highlights:[{factId:'sleep'}]},
    {...plan,nextStep:'routine'},
    {...plan,opening:'You are healthy.'},
    {...plan,highlights:[{factId:'coverage'},{factId:'coverage'}]},
  ])assert.equal(validateGeneratedReport(altered,facts).valid,false);
  assert.deepEqual(reportPlanSchema(facts).properties.nextStep.enum,['checkin']);
});
test('immediate-review evidence cannot be omitted or softened by the model',()=>{
  const facts=createReportFacts({...senior,level:'high',urgency:'immediate'},[{seniorId:'S001',date:'2026-10-27',note:'I fell and I have chest pain.'}],'2026-10-27');
  const plan=deterministicReportPlan(facts);
  assert.equal(plan.nextStep,'prompt');
  assert.equal(validateGeneratedReport(plan,facts).valid,true);
  assert.equal(validateGeneratedReport({...plan,highlights:[{factId:'coverage'}]},facts).valid,false);
});
test('actual provider output produces a traceable bilingual LLM-guided report after validation',async()=>{
  let called=0;
  const report=await generateGroundedReport({senior,records,asOfDate:'2026-10-27',language:'hi',allowExternalProcessing:true,dataKind:'synthetic',providerName:'test model transport',model:'model-for-test',provider:async({facts,language,schema})=>{called++;assert.equal(JSON.stringify(facts).includes('Private Meera'),false);assert.equal(language,'hi');assert.equal(schema.additionalProperties,false);return deterministicReportPlan(facts,'hi');}});
  assert.equal(called,1);assert.equal(report.generation.llmUsed,true);assert.match(report.text,/जानकारी/);assert.equal(report.requiresHumanReview,true);assert.equal(report.clinicalPrediction,false);
  assert.equal(report.highlights.every(h=>h.evidenceIds.every(id=>report.evidence.some(e=>e.id===id))),true);
});
test('missing, disabled or hallucinating models never masquerade as successful LLM generation',async()=>{
  let called=0;
  const disabled=await generateGroundedReport({senior,records,asOfDate:'2026-10-27',provider:async()=>{called++;},allowExternalProcessing:false});
  assert.equal(called,0);assert.equal(disabled.generation.llmUsed,false);
  const invalid=await generateGroundedReport({senior,records,asOfDate:'2026-10-27',provider:async()=>({text:'Everything is normal. No follow-up needed.'}),allowExternalProcessing:true});
  assert.equal(invalid.generation.llmUsed,false);assert.match(invalid.method,/no LLM/);assert.match(invalid.text,/3 of 7 days/);assert.match(invalid.text,/6 were not recorded as taken/);
});
