import test from 'node:test';import assert from 'node:assert/strict';
import {scoreRecordedSenior,workspaceCareModel} from '../lib/recorded-seniors.mjs';
const profile={id:'S100001',name:'Fictional onboarding test',age:72,city:'Pune',language:'Hindi',dataProvenance:{kind:'recorded',synthetic:false}};
test('new senior starts with unknown priority, no invented observations or baseline',()=>{
 const result=scoreRecordedSenior(profile,'2026-10-29');
 assert.equal(result.score,null);assert.equal(result.latest,null);assert.equal(result.lastCheckIn,null);assert.deepEqual(result.trend,[]);
 assert.ok(Object.values(result.baseline).every(value=>value===null));assert.equal(result.model.trainingSamples,0);assert.equal(result.anomalyScore,null);
});
test('recorded senior uses only own dated input and preserves urgent reported help',()=>{
 const result=scoreRecordedSenior(profile,'2026-10-29',[
 {seniorId:'S100001',date:'2026-10-29',note:'Please help me, I fell today.'},
 {seniorId:'S001',date:'2026-10-29',vitals:{spo2:80}},
 {seniorId:'S100001',date:'2026-10-30',note:'No fall, feeling fine.'}]);
 assert.equal(result.level,'high');assert.equal(result.urgency,'immediate');assert.equal(result.latest.date,'2026-10-29');assert.equal(result.current.spo2,null);assert.ok(result.triageEvidence.some(item=>item.id==='help-request'));
});
test('scoped recorded profiles extend workspace without fitting them into synthetic evaluation',async()=>{
 const senior={id:'S001'},engine={scoreSenior:id=>({id,score:12}),metrics:()=>({synthetic:true})},base={cohort:{seniors:[senior],records:[],metadata:{synthetic:true}},engine,dataRevision:'demo'};
 const result=await workspaceCareModel({recordedProfiles:async()=>[profile]},base);
 assert.equal(base.cohort.seniors.length,1);assert.equal(result.cohort.seniors.length,2);assert.equal(result.engine.scoreSenior('S001').score,12);assert.equal(result.engine.scoreSenior('S100001','2026-10-29').score,null);
 assert.equal(result.engine.metrics().synthetic,true);assert.deepEqual(result.cohort.records,[]);
});

const dateAt=day=>new Date(Date.parse('2026-09-01T00:00:00Z')+day*86400000).toISOString().slice(0,10);
const measuredHistory=()=>Array.from({length:40},(_,day)=>({id:`own-${day}`,seniorId:profile.id,date:dateAt(day),vitals:{systolic:120,diastolic:80,spo2:98,weight:70,glucose:100},activity:4000,sleep:7,medication:{taken:2,prescribed:2},note:'Routine felt usual.'}));

test('recorded senior graduates from warm-up using their own first 30 measured days',()=>{
 const records=measuredHistory();
 const early=scoreRecordedSenior(profile,dateAt(29),records);
 assert.equal(early.warmup,true);assert.equal(early.score,null);
 const established=scoreRecordedSenior({...profile,baseline:{systolic:190}},dateAt(39),records);
 assert.equal(established.warmup,false);assert.equal(established.score,0);assert.equal(established.baseline.systolic,120);
 assert.equal(established.baselineSupport.systolic.observations,30);assert.equal(established.model.status,'personal_reference_ready');
 assert.equal(established.anomalyScore,null);assert.equal(established.model.trees,0);assert.equal(established.dataProvenance.synthetic,false);
 assert.ok(established.trend.every(point=>Number.isFinite(point.score)));
});

test('established recorded senior receives explainable sustained personal-change flags',()=>{
 const records=measuredHistory();
 for(const row of records.slice(-7)){row.vitals.systolic=145;row.activity=2200;row.sleep=5;}
 const changed=scoreRecordedSenior(profile,dateAt(39),records);
 assert.equal(changed.warmup,false);assert.ok(changed.score>=30);assert.equal(changed.changeDetection.corroborated,true);
 assert.ok(changed.reasons.some(reason=>reason.source==='personal_change'));
 assert.equal(changed.baseline.systolic,120);assert.equal(changed.baseline.activity,4000);
});

test('calendar age, duplicate entries and fictional profile values cannot manufacture baseline support',()=>{
 const rows=Array.from({length:40},(_,index)=>({seniorId:profile.id,date:dateAt(index<35?0:39),vitals:{systolic:120,diastolic:80}}));
 const result=scoreRecordedSenior({...profile,baseline:{systolic:120,diastolic:80}},dateAt(39),rows);
 assert.equal(result.warmup,true);assert.equal(result.score,null);assert.ok(Object.values(result.baseline).every(value=>value===null));
 const sparse=measuredHistory().map(row=>({...row,vitals:{systolic:120},activity:null,sleep:null}));
 assert.equal(scoreRecordedSenior(profile,dateAt(39),sparse).warmup,true);
});

test('recorded personal scoring excludes other seniors, future data, synthetic rows and invalid dates',()=>{
 const records=measuredHistory(),before=scoreRecordedSenior(profile,dateAt(39),records);
 const excluded=[
  {seniorId:'S001',date:dateAt(39),vitals:{spo2:70}},
  {seniorId:profile.id,date:dateAt(40),vitals:{spo2:70}},
  {seniorId:profile.id,date:dateAt(39),vitals:{spo2:70},provenance:{synthetic:true}},
  {seniorId:profile.id,date:'2026-09-99',vitals:{spo2:70}},
 ];
 const after=scoreRecordedSenior(profile,dateAt(39),[...records,...excluded]);
 assert.deepEqual(after,before);assert.throws(()=>scoreRecordedSenior(profile,'2026-02-31',records),/Invalid observation date/);
});

test('a missing taken count is not reported as an adherence percentage during warm-up',()=>{
 const result=scoreRecordedSenior(profile,dateAt(0),[{seniorId:profile.id,date:dateAt(0),medication:{prescribed:2}}]);
 assert.equal(result.adherence,null);assert.equal(result.confidence,0);
});
