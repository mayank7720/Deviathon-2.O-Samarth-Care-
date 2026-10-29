import test from 'node:test';
import assert from 'node:assert/strict';
import reference from '../data/reference/synthea-calibration.json' with {type:'json'};
import {generateRealisticCohort,createRealisticEngine,REALISTIC_DATA_INFO} from '../lib/realistic-cohort.mjs';
import {auditCohort} from '../lib/data-quality.mjs';

const cohort=generateRealisticCohort();
test('reference aggregates have reproducible provenance and never claim observed patient outcomes',()=>{
  assert.match(reference.source.archiveSha256,/^[a-f0-9]{64}$/);
  assert.equal(reference.source.synthetic,true);
  assert.equal(reference.distributions.systolic.people,296);
  assert.equal(reference.distributions.glucose.people,220);
  assert.equal(reference.distributions.spo2.available,false);
  assert.match(REALISTIC_DATA_INFO.authoredAssumptions.join(' '),/not an Indian geriatric/);
  assert.ok(!Object.hasOwn(reference,'patients'));
});
test('reference-informed simulation is reproducible and preserves the required cohort window',()=>{
  const second=generateRealisticCohort();
  assert.deepEqual(cohort,second);
  assert.equal(cohort.seniors.length,200);
  assert.equal(new Set(cohort.records.map(r=>r.date)).size,90);
  assert.equal(cohort.metadata.actualObservations,cohort.records.length);
  assert.equal(cohort.metadata.scenarioFraction,.08);
  assert.ok(cohort.records.every(r=>r.provenance.synthetic===true));
  assert.ok(cohort.records.some(r=>r.medication===undefined));
  assert.ok(cohort.records.filter(r=>r.vitals.glucose==null).length>cohort.records.length*.4);
});
test('structured doses, adherence text and pressure measurements pass consistency checks',()=>{
  const quality=auditCohort(cohort);
  assert.equal(quality.passed,true,JSON.stringify(quality.issueExamples));
  assert.equal(quality.hardErrors,0);
  assert.equal(quality.counts.largeWeightJumps,0);
  assert.ok(quality.temporal.meanWithinPersonLagOneSystolicCorrelation>.4);
  assert.ok(quality.temporal.maximumWeightChangeKgPerDay<=.31);
  assert.ok(cohort.records.some(r=>r.medication?.doses?.some(d=>d.status==='missed')));
  assert.ok(cohort.records.some(r=>r.medication?.doses?.[0].status==='missed'&&r.medication.doses.at(-1).status==='taken'));
});
test('a reported fall occurs on one dated incident instead of recurring every note day',()=>{
  const ids=new Set();
  for(const event of cohort.events){
    assert.ok(!ids.has(event.seniorId));ids.add(event.seniorId);
    const incidents=cohort.records.filter(r=>r.seniorId===event.seniorId&&r.incidentId);
    assert.equal(incidents.length,1);
    assert.equal(incidents[0].date,event.date);
    assert.equal(incidents[0].sensor.confirmed,false);
    assert.match(incidents[0].note,/fell today|आज गिर|Aaj gir/);
    const later=cohort.records.filter(r=>r.seniorId===event.seniorId&&r.date>event.date);
    assert.ok(later.every(r=>!r.incidentId));
  }
});
test('incidental concerning measurements are kept without declaring unlabelled days healthy',()=>{
  assert.ok(cohort.records.some(r=>r.vitals.glucose<70&&!cohort.groundTruth.some(g=>g.seniorId===r.seniorId&&r.date>=g.onsetDate&&r.date<=g.endDate)));
  assert.ok(cohort.records.every(r=>!Object.hasOwn(r,'simulationContext')&&!Object.hasOwn(r,'groundTruth')));
  assert.equal(cohort.metadata.unlabelledDaysAreNotNegative,true);
  const metrics=createRealisticEngine(cohort).metrics();
  assert.equal(metrics.precision,null);
  assert.equal(metrics.f1,null);
  assert.equal(metrics.falsePositives,null);
  assert.equal(metrics.trueNegatives,null);
  assert.ok(metrics.unlabelledHighSeniorDays>0);
  assert.equal(metrics.clinicalPerformance.recall,null);
  assert.ok(metrics.recall>=0&&metrics.recall<=1);
  assert.match(metrics.recallLabel,/authored review scenarios/);
  assert.equal(metrics.scenarioReviewCoverage.threshold,30);
  assert.ok(metrics.scenarioReviewCoverage.dailyCoverage>=metrics.recall);
  assert.equal(metrics.scenarioReviewCoverage.totalCases,metrics.totalCases);
  assert.equal(metrics.ablation.rulesOnly.precision,null);
});
test('baseline warm-up and personal observation support are still enforced by the unchanged model',()=>{
  const engine=createRealisticEngine(cohort);
  const initial=engine.scoreSenior('S050',cohort.metadata.startDate);
  assert.equal(initial.warmup,true);
  assert.equal(initial.score,null);
  assert.equal(initial.anomalyScore,null);
  const normal=engine.scoreSenior('S050');
  assert.equal(normal.asOfDate,cohort.metadata.endDate);
  assert.ok(normal.reasons.length>0);
});
test('quality audit detects malformed dates, duplicate observations, impossible pressure and contradictory doses',()=>{
  const record={seniorId:'S001',date:'2026-10-27',vitals:{systolic:100,diastolic:130,spo2:105},medication:{prescribed:2,taken:1,doses:[{status:'taken'},{status:'taken'}]},note:'All scheduled doses were recorded as taken today.'};
  const result=auditCohort({seniors:[{id:'S001'}],records:[record,{...record,date:'2026-02-30'},record]});
  assert.equal(result.passed,false);
  assert.ok(result.counts.duplicateSeniorDays>0);
  assert.ok(result.counts.invalidDates>0);
  assert.ok(result.counts.outOfRangeValues>0);
  assert.ok(result.counts.pressureOrder>0);
  assert.ok(result.counts.doseLogMismatch>0);
  assert.ok(result.counts.contradictoryMedicineNotes>0);
});
test('alternate seed/calendar/size remain deterministic and do not copy the reference identities',()=>{
  const options={seed:7,seniorCount:20,days:60,endDate:'2026-11-01'};
  const one=generateRealisticCohort(options),two=generateRealisticCohort(options);
  assert.deepEqual(one,two);
  assert.equal(one.seniors.length,20);
  assert.equal(one.metadata.endDate,'2026-11-01');
  assert.equal(auditCohort(one).passed,true);
  assert.throws(()=>generateRealisticCohort({scenarioFraction:.9}));
  const alternate=generateRealisticCohort({...options,languageVariant:'held-out-phrases'});
  assert.deepEqual(alternate.records.map(r=>r.vitals),one.records.map(r=>r.vitals));
  assert.ok(alternate.records.some((r,i)=>r.note!==one.records[i].note));
});
