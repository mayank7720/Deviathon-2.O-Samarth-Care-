import test from 'node:test';
import assert from 'node:assert/strict';
import {personalReference,persistentChanges,medicationCounts} from '../lib/personal-baseline.mjs';
import {createEngine,generateCohort,IsolationForest,MODEL_INFO} from '../lib/engine.mjs';
import {careModel} from '../lib/model-runtime.mjs';

const rows=Array.from({length:30},(_,i)=>({seniorId:'R',date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),vitals:{systolic:120+(i%3-1),diastolic:78,glucose:100,spo2:98,weight:65},activity:4000,sleep:7,medication:{prescribed:2,taken:2},note:'Routine check-in.'}));
const profile={id:'R',name:'Synthetic test senior',baseline:{systolic:195,diastolic:120,glucose:300,spo2:88,weight:40,activity:100,sleep:2}};
const sample=records=>({seniors:[profile],records,groundTruth:[],metadata:{startDate:'2026-01-01',endDate:'2026-02-07',days:38}});
const recent=Array.from({length:7},(_,i)=>({...rows[i],date:`2026-02-0${i+1}`,vitals:{...rows[i].vitals}}));

test('measured references use robust medians, variation floors and field-level support',()=>{
  const reference=personalReference(rows);
  assert.equal(reference.baseline.systolic,120);
  assert.equal(reference.scales.systolic,6);
  assert.equal(reference.support.systolic.observations,30);
  const sparse=personalReference(rows.map(row=>({...row,vitals:{weight:65}})));
  assert.equal(sparse.baseline.systolic,null);
  assert.equal(sparse.scales.systolic,null);
  assert.equal(sparse.support.systolic.supported,false);
  const robust=personalReference(rows.map((row,i)=>({...row,vitals:{systolic:i===0?250:120}})));
  assert.equal(robust.baseline.systolic,120);
  assert.equal(robust.scales.systolic,6);
});
test('unknown doses do not enter adherence as missed medication',()=>{
  const records=[...rows,...recent.map(row=>({...row,medication:{prescribed:3,taken:null}}))];
  const result=createEngine(sample(records)).scoreSenior('R');
  assert.equal(result.adherence,null);
  assert.ok(!result.reasons.some(reason=>reason.source==='medication'));
  const pending=recent.map(row=>({...row,medication:{prescribed:2,taken:0,doses:[{status:'pending'},{status:'unknown'}]}}));
  const pendingResult=createEngine(sample([...rows,...pending])).scoreSenior('R');
  assert.equal(pendingResult.adherence,null);
  assert.ok(!pendingResult.reasons.some(reason=>reason.source==='medication'));
  const partial=medicationCounts({prescribed:3,taken:1,doses:[{status:'taken'},{status:'missed'},{status:'pending'}]});
  assert.equal(partial.prescribed,2);assert.equal(partial.taken,1);assert.equal(partial.unresolved,1);
});
test('missing measured personal baseline never falls back to a hidden profile prior',()=>{
  const records=[...rows.map(row=>({...row,vitals:{},activity:null,sleep:null})),...recent];
  const result=createEngine(sample(records)).scoreSenior('R');
  assert.ok(Object.values(result.baseline).every(value=>value===null));
  assert.equal(result.score,null);
  assert.equal(result.level,'unknown');
  assert.equal(result.anomalyScore,null);
});
test('absolute vital review rules never describe an unsupported personal reference as null',()=>{
  const noOxygen=rows.map(row=>({...row,vitals:{...row.vitals,spo2:null}}));
  const result=createEngine(sample([...noOxygen,...recent.map(row=>({...row,vitals:{...row.vitals,spo2:91}}))])).scoreSenior('R');
  assert.equal(result.baseline.spo2,null);assert.ok(result.score>=30);
  assert.match(JSON.stringify(result.reasons),/reference is not established/);
  assert.doesNotMatch(JSON.stringify(result.reasons),/null|usual range/);
});
test('duplicate same-day baseline entries cannot overweight that date',()=>{
  const originals=[...rows,...recent];
  const duplicate=Array.from({length:100},()=>({...rows[0],vitals:{...rows[0].vitals,systolic:160}}));
  const expected=createEngine(sample(originals)).scoreSenior('R');
  const result=createEngine(sample([...rows,...duplicate,...recent])).scoreSenior('R');
  assert.equal(result.baseline.systolic,expected.baseline.systolic);
  assert.equal(result.baselineSupport.systolic.observations,30);
});
test('persistent changes need repeated observed days and independent domains',()=>{
  const reference=personalReference(rows);
  const bpOnly=recent.map(row=>({...row,vitals:{...row.vitals,systolic:140,diastolic:94}}));
  const only=persistentChanges(bpOnly,reference,'2026-02-07');
  assert.ok(only.changes.length>=2);assert.equal(only.corroborated,false);assert.equal(only.points,0);
  const corroborated=persistentChanges(bpOnly.map(row=>({...row,sleep:5.5})),reference,'2026-02-07');
  assert.equal(corroborated.corroborated,true);assert.ok(corroborated.points>0);
  const smallShift=persistentChanges(recent.map(row=>({...row,sleep:6.2,vitals:{...row.vitals,systolic:130}})),reference,'2026-02-07');
  assert.equal(smallShift.corroborated,true,'Repeated moderate deviations across two domains deserve a human review signal');
  const spike=persistentChanges(recent.map((row,i)=>i===6?{...row,sleep:3,vitals:{...row.vitals,systolic:170}}:row),reference,'2026-02-07');
  assert.equal(spike.corroborated,false);assert.equal(spike.points,0);
  assert.equal(persistentChanges(bpOnly.slice(0,2),reference,'2026-02-07').points,0);
  assert.equal(persistentChanges(bpOnly,reference,'2026-02-12').points,0);
});
test('stale severe records request a fresh observation without becoming current immediate evidence',()=>{
  const result=createEngine(sample([...rows,{...rows.at(-1),date:'2026-01-31',vitals:{spo2:88},note:'Chest pain now.'}])).scoreSenior('R','2026-02-07');
  assert.equal(result.urgency,'unknown');assert.equal(result.score,null);
  assert.ok(result.dataFreshness.ageDays>=7);
  assert.match(result.action,/confirm wellbeing|missing observations/);
});
test('forest training and scoring reject malformed non-finite feature arrays',()=>{
  assert.throws(()=>new IsolationForest().fit([[1,2],[3]]),/equal-length/);
  assert.throws(()=>new IsolationForest().fit([[1,NaN]]),/finite/);
  const forest=new IsolationForest().fit([[1,2],[2,3]]);
  assert.throws(()=>forest.score([1,Infinity]),/finite/);
});
test('impossible calendar entries and future urgent signals cannot affect present scoring',()=>{
  const engine=createEngine(sample([...rows,...recent]));
  const before=engine.scoreSenior('R','2026-03-02');
  const after=engine.scoreSenior('R','2026-03-02',[{seniorId:'R',date:'2026-02-31',note:'Chest pain now.'},{seniorId:'R',date:'2026-03-03',vitals:{spo2:88}}]);
  assert.equal(after.urgency,before.urgency);assert.equal(after.score,before.score);assert.deepEqual(after.cues,before.cues);
});
test('calibration excludes evaluation identities and model revisions invalidate score cache keys',()=>{
  const metrics=createEngine(generateCohort()).metrics({includeAblation:false});
  const calibration=metrics.model.calibration;
  assert.equal(calibration.evaluationIdentities,50);
  assert.equal(calibration.fitIdentities+calibration.calibrationIdentities,150);
  assert.ok(calibration.samples>=30);assert.ok(calibration.threshold>0&&calibration.threshold<1);
  assert.ok(calibration.observedTailFraction<=.025);
  assert.ok(careModel({}).dataRevision.includes(MODEL_INFO.version));
});
