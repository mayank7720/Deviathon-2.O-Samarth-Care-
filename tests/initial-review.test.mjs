import test from 'node:test';
import assert from 'node:assert/strict';
import {initialReview} from '../lib/initial-review.mjs';
import {createEngine} from '../lib/engine.mjs';
import {scoreRecordedSenior} from '../lib/recorded-seniors.mjs';
const profile={id:'S001',baseline:{},name:'Synthetic initial-review fixture'};
const date='2026-01-10';
test('baseline collection preserves nonurgent notes, absolute review readings and missed-dose evidence',()=>{
  for(const data of [{note:'Feeling confused and eating less.'},{vitals:{spo2:91}},{vitals:{systolic:170,diastolic:110}},{medication:{taken:0,prescribed:2}}]) {
    const record={...data,seniorId:'S001',date};
    const cohort={seniors:[profile],records:[record],groundTruth:[],metadata:{startDate:'2026-01-01',endDate:date,days:10}};
    const ordinary=createEngine(cohort).scoreSenior('S001',date),recorded=scoreRecordedSenior(profile,date,[record]);
    for(const result of [ordinary,recorded]) {
      assert.equal(result.warmup,true);assert.equal(result.score,30);assert.equal(result.urgency,'today');assert.equal(result.anomalyScore,null);
      assert.ok(Object.values(result.baseline).every(value=>value===null));assert.match(result.action,/today/);
    }
  }
});
test('routine and unknown doses do not invent concern during reference collection',()=>{
  for(const row of [{note:'No pain or confusion.'},{medication:{taken:0,prescribed:2,doses:[{status:'pending'},{status:'unknown'}]}}])assert.equal(initialReview([row]).score,null);
  const urgent=initialReview([{note:'Pressure in my chest now.'}]);
  assert.equal(urgent.score,60);assert.equal(urgent.urgency,'immediate');
});
