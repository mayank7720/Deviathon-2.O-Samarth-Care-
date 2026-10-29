import test from 'node:test';
import assert from 'node:assert/strict';
import {createCohortSplit} from '../lib/evaluation-split.mjs';
import {generateRealisticCohort} from '../lib/realistic-cohort.mjs';

const seniors=generateRealisticCohort().seniors;
const identities=plan=>[...plan.fitIds,...plan.calibrationIds,...plan.evaluationIds];
test('stratified split assigns every identity once with exact requested role sizes',()=>{
 const plan=createCohortSplit(seniors);
 assert.deepEqual([plan.fitIds.length,plan.calibrationIds.length,plan.evaluationIds.length],[120,30,50]);
 assert.equal(new Set(identities(plan)).size,200);
 assert.deepEqual(identities(plan).sort(),seniors.map(profile=>profile.id).sort());
 for(const stratum of plan.strata)assert.equal(stratum.fit+stratum.calibration+stratum.evaluation,stratum.total);
});

test('profile stratification preserves available representation across roles',()=>{
 const plan=createCohortSplit(seniors),byId=new Map(seniors.map(profile=>[profile.id,profile]));
 for(const stratum of plan.strata){
  assert.ok(Math.abs(stratum.evaluation-stratum.total*.25)<1);
  assert.ok(Math.abs(stratum.calibration-(stratum.total-stratum.evaluation)*.2)<1);
 }
 for(const ids of [plan.fitIds,plan.calibrationIds,plan.evaluationIds]){
  const profiles=ids.map(id=>byId.get(id)),men=profiles.filter(profile=>profile.gender==='Male').length,diabetes=profiles.filter(profile=>profile.conditions.includes('Diabetes history')).length;
  assert.ok(men>0&&men<profiles.length,'each role represents both available genders');
  assert.ok(Math.abs(men/profiles.length-.5)<.1);
  assert.ok(Math.abs(diabetes/profiles.length-.325)<.1);
  for(const [low,high] of [[60,70],[70,80],[80,121]])assert.ok(profiles.some(profile=>profile.age>=low&&profile.age<high));
 }
});

test('stable IDs and seed reproduce the plan independently of profile input order',()=>{
 const plan=createCohortSplit(seniors,{seed:104});
 assert.deepEqual(createCohortSplit([...seniors].reverse(),{seed:104}),plan);
 assert.deepEqual(createCohortSplit([...seniors].sort((a,b)=>a.city.localeCompare(b.city)),{seed:104}),plan);
 assert.notDeepEqual(createCohortSplit(seniors,{seed:105}).evaluationIds,plan.evaluationIds);
});

test('labels, notes, signals and unrelated profile fields cannot influence split selection',()=>{
 const altered=seniors.map(profile=>({id:profile.id,age:profile.age,gender:profile.gender,conditions:profile.conditions,groundTruth:{pattern:'changed',split:'evaluation'},note:'Severe changes',vitals:{spo2:60},baseline:{systolic:250},name:'Other name',city:'Other city',risk:100}));
 assert.deepEqual(createCohortSplit(altered),createCohortSplit(seniors));
});

test('largest remainder produces exact exhaustive plans for small and uneven cohorts',()=>{
 for(let count=0;count<=201;count++){
  const profiles=Array.from({length:count},(_,index)=>({id:'person-'+index,gender:index%3===0?'Female':index%3===1?'Male':null,age:index%7===0?null:60+index%30,conditions:index%5===0?['Diabetes history']:[]}));
  const plan=createCohortSplit(profiles),evaluation=Math.round(count*.25),calibration=Math.round((count-evaluation)*.2);
  assert.deepEqual([plan.fitIds.length,plan.calibrationIds.length,plan.evaluationIds.length],[count-evaluation-calibration,calibration,evaluation]);
  assert.equal(new Set(identities(plan)).size,count);
 }
});

test('legacy modulo reproduces the original array-index holdout and FNV calibration',()=>{
 const hash=id=>{let value=2166136261;for(const character of id)value=Math.imul(value^character.charCodeAt(0),16777619)>>>0;return value;};
 const plan=createCohortSplit(seniors,{strategy:'legacy-modulo'});
 assert.deepEqual(plan.evaluationIds,seniors.filter((_,index)=>index%4===3).map(profile=>profile.id).sort());
 assert.deepEqual(plan.calibrationIds,seniors.filter((profile,index)=>index%4!==3&&hash(profile.id)%5===0).map(profile=>profile.id).sort());
 assert.ok(plan.evaluationIds.every(id=>seniors.find(profile=>profile.id===id).gender==='Male'));
});

test('invalid or duplicate stable identities and unsupported plans are rejected',()=>{
 assert.throws(()=>createCohortSplit(null),/array/);
 assert.throws(()=>createCohortSplit([{id:'S1'},{id:'S1'}]),/unique/);
 for(const id of [null,'',' S1'])assert.throws(()=>createCohortSplit([{id}]),/stable ID/);
 assert.throws(()=>createCohortSplit([],{strategy:'labels'}),/stratified-v1/);
 for(const seed of [-1,1.5,Infinity,4294967296])assert.throws(()=>createCohortSplit([],{seed}),/unsigned/);
});
