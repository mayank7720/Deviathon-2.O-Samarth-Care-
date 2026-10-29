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
