import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATE, generateCohort, createEngine, extractCues, IsolationForest, evaluateRobustness } from '../lib/engine.mjs';

const cohort = generateCohort();
const engine = createEngine(cohort);

test('synthetic cohort spans 200 identities and 90 calendar days with missing data', () => {
  assert.equal(cohort.seniors.length, 200);
  assert.equal(new Set(cohort.records.map((record) => record.date)).size, 90);
  assert.ok(cohort.records.length < 18000 && cohort.records.length > 17000);
  assert.ok(cohort.records.some((record) => Object.values(record.vitals).includes(null)));
  assert.ok(cohort.records.some((record) => /[\u0900-\u097f]/u.test(record.note)));
  assert.equal(cohort.records.at(-1).date, DEMO_DATE);
  assert.ok(cohort.seniors.some((senior) => !senior.familyConsent));
});

test('seed reproduces synthetic observations, labels and model output', () => {
  const second = generateCohort();
  assert.deepEqual(second.seniors, cohort.seniors);
  assert.deepEqual(second.groundTruth, cohort.groundTruth);
  assert.deepEqual(second.records.slice(0, 20), cohort.records.slice(0, 20));
  assert.equal(createEngine(second).scoreSenior('S001').score, engine.scoreSenior('S001').score);
});

test('NLP recognises English, Hindi and code-mixed decline cues', () => {
  assert.ok(extractCues('Had a fall yesterday. Feeling confused.').some((cue) => cue.cue === 'fall'));
  assert.ok(extractCues('भूख नहीं लग रही और कल गिर गई थी।').some((cue) => cue.cue === 'low_appetite'));
  assert.ok(extractCues('Dawai bhool gayi. Neend nahi aa rahi.').some((cue) => cue.cue === 'missed_medication'));
  assert.ok(extractCues('Khana kam khaya. Bhookh nahi lagti.').some((cue) => cue.cue === 'low_appetite'));
});

test('NLP suppresses common negation and conditional mentions', () => {
  for (const note of ['No pain or confusion. No fall.', 'Dard nahi hai.', 'दर्द नहीं है।', 'If chest pain develops, call the team.', 'No breathlessness.']) {
    assert.deepEqual(extractCues(note), [], note);
  }
  assert.deepEqual(extractCues(''), []);
  assert.deepEqual(extractCues(null), []);
});

test('Isolation Forest identifies a remote outlier without labels', () => {
  const points = Array.from({ length: 150 }, (_, index) => [Math.sin(index * 0.93) * Math.cos(index * 0.31) * 0.3, Math.cos(index * 0.61) * Math.sin(index * 0.17) * 0.2]);
  const forest = new IsolationForest().fit(points);
  assert.ok(forest.score([8, 9]) > forest.score([0, 0]) + 0.15);
});

test('scores rank active planted decline and explain changes from personal baseline', () => {
  const ranked = engine.rankSeniors();
  assert.equal(ranked.length, 200);
  assert.ok(ranked[0].score >= 60);
  assert.ok(ranked.every((senior, index) => index === 0 || ranked[index - 1].urgencyRank <= senior.urgencyRank));
  assert.ok(ranked.every((senior, index) => index === 0 || ranked[index - 1].urgencyRank !== senior.urgencyRank || (ranked[index - 1].score ?? -1) >= (senior.score ?? -1)));
  const activeIds = new Set(cohort.groundTruth.filter((label) => label.endDate === DEMO_DATE).map((label) => label.seniorId));
  assert.ok(ranked.slice(0, 15).filter((senior) => activeIds.has(senior.id)).length >= 12);
  const detail = engine.scoreSenior('S001');
  assert.ok(detail.reasons.some((reason) => /baseline|usual|check-in/i.test(reason.detail)));
  assert.ok(detail.trend.length >= 7);
  assert.ok(Number.isFinite(detail.anomalyScore));
  assert.ok(detail.confidence >= 0 && detail.confidence <= 100);
});

test('ingested serious note increases priority without changing historical model baseline', () => {
  const before = engine.scoreSenior('S101');
  const after = engine.scoreSenior('S101', DEMO_DATE, [{ seniorId: 'S101', date: DEMO_DATE, note: 'Fell this morning. Chest pain and feeling confused.', source: 'Coordinator call' }]);
  assert.ok(after.score > before.score);
  assert.equal(after.level, 'high');
  assert.deepEqual(after.baseline, before.baseline);
  assert.match(after.action, /now|urgent/);
  assert.equal(engine.scoreSenior('S101').score, before.score);
});

test('partial vitals ingestion preserves medicine and note evidence', () => {
  const prior = engine.scoreSenior('S101');
  const after = engine.scoreSenior('S101', DEMO_DATE, [{ seniorId: 'S101', date: DEMO_DATE, vitals: { spo2: 88 } }]);
  assert.equal(after.latest.vitals.spo2, 88);
  assert.deepEqual(after.latest.medication, prior.latest.medication);
  assert.ok(after.reasons.some((reason) => /oxygen/i.test(reason.title)));
  assert.match(after.action, /urgent/);
});

test('severe isolated diastolic reading is routed for high-priority human review', () => {
  const after = engine.scoreSenior('S101', DEMO_DATE, [{ seniorId: 'S101', date: DEMO_DATE, vitals: { systolic: 170, diastolic: 125 } }]);
  assert.equal(after.level, 'high');
  assert.match(after.action, /now.*urgent/);
  assert.ok(after.reasons.some((reason) => /170\/125/.test(reason.detail)));
});

test('a glucose reading below 70 is flagged for verification and human clinical review', () => {
  const after = engine.scoreSenior('S101', DEMO_DATE, [{ seniorId: 'S101', date: DEMO_DATE, vitals: { glucose: 68 } }]);
  assert.equal(after.level, 'high');
  assert.match(after.action, /urgent/);
  assert.ok(after.reasons.some((reason) => /68 mg\/dL/.test(reason.detail)));
});

test('sequential same-day updates retain earlier notes and independent signal types', () => {
  const result = engine.scoreSenior('S101', DEMO_DATE, [
    { seniorId: 'S101', date: DEMO_DATE, note: 'Chest pain reported during morning call.' },
    { seniorId: 'S101', date: DEMO_DATE, vitals: { systolic: 142 } },
    { seniorId: 'S101', date: DEMO_DATE, medication: { taken: 1, prescribed: 3 } },
    { seniorId: 'S101', date: DEMO_DATE, note: 'Evening note: no pain now.' },
  ]);
  assert.match(result.latest.note, /morning call/);
  assert.match(result.latest.note, /Evening note/);
  assert.equal(result.latest.vitals.systolic, 142);
  assert.equal(result.latest.medication.taken, 1);
  // Corrections are retained as chronological evidence; a later negative
  // statement does not silently retract a previously reported serious event.
  assert.ok(result.cues.some((cue) => cue.cue === 'chest_pain'));
  assert.equal(result.level, 'high');
});

test('missing recent observations lower confidence and create a contact task', () => {
  const result = engine.scoreSenior('S077');
  assert.ok(result.dataFreshness.ageDays >= 3);
  assert.ok(result.confidence < 60);
  assert.ok(result.reasons.some((reason) => reason.source === 'data'));
  assert.match(result.action, /Call/);
});

test('metrics are computed on 50 held-out seniors and do not expose fabricated percentages', () => {
  const metrics = engine.metrics();
  assert.equal(metrics.heldOutSeniors, 50);
  assert.equal(metrics.evaluatedSeniorDays, 3000);
  assert.equal(metrics.truePositives + metrics.falsePositives + metrics.falseNegatives + metrics.trueNegatives, 3000);
  assert.equal(metrics.precision, Math.round(metrics.truePositives / (metrics.truePositives + metrics.falsePositives) * 1000) / 1000);
  assert.equal(metrics.totalCases, cohort.groundTruth.filter((label) => label.split === 'held-out').length);
  assert.equal(new Set(cohort.groundTruth.filter((label) => label.split === 'held-out').map((label) => label.pattern)).size, 4);
  assert.ok(metrics.precision > 0.8);
  assert.ok(metrics.caseRecall >= 0.7);
  assert.ok(metrics.meanLeadDays >= 1);
  assert.match(metrics.leadTimeLabel, /escalation/);
  assert.ok(metrics.meanOnsetDetectionDelayDays >= 0);
  assert.equal(metrics.perPattern.length, 4);
  assert.ok(metrics.ablation.rulesOnly.recall <= metrics.ablation.rulesPlusModel.recall);
  assert.equal(metrics.ablation.rulesPlusModel.recall, metrics.recall);
});

test('an immediate reading outranks score100 cases that only require review today', () => {
  const ranked = engine.rankSeniors(DEMO_DATE, [{ seniorId: 'S101', date: DEMO_DATE, vitals: { glucose: 68 } }]);
  const urgentAt = ranked.findIndex((senior) => senior.id === 'S101');
  assert.equal(ranked[urgentAt].urgency, 'immediate');
  const todayHundreds = ranked.map((senior, index) => ({senior,index})).filter(({senior}) => senior.score === 100 && senior.urgency !== 'immediate');
  assert.ok(todayHundreds.length > 0);
  assert.ok(todayHundreds.every(({index}) => index > urgentAt));
});

test('blank recent signal records remain unknown rather than stable low risk', () => {
  const blank = structuredClone(cohort);
  for (const record of blank.records) if (record.seniorId === 'S101' && record.date >= '2026-10-25') {
    record.vitals = { systolic:null,diastolic:null,glucose:null,spo2:null,weight:null };
    delete record.medication; record.activity=null;record.sleep=null;record.note='';
  }
  const result=createEngine(blank).scoreSenior('S101');
  assert.equal(result.score,null);assert.equal(result.level,'unknown');assert.equal(result.urgency,'unknown');
  assert.equal(result.confidence,0);
  assert.doesNotMatch(JSON.stringify(result.reasons), /stable|normal|healthy/iu);
  assert.match(result.action,/confirm wellbeing|missing observations/);
});

test('serious observed information stays high even when other signals are absent', () => {
  const sparse=structuredClone(cohort);
  for(const record of sparse.records) if(record.seniorId==='S101'&&record.date>='2026-10-25') {record.vitals={};delete record.medication;record.activity=null;record.sleep=null;record.note='';}
  const result=createEngine(sparse).scoreSenior('S101',DEMO_DATE,[{seniorId:'S101',date:DEMO_DATE,note:'Chest pain now.'}]);
  assert.equal(result.level,'high');assert.equal(result.urgency,'immediate');assert.ok(result.score>=60);assert.ok(result.confidence<20);
});

test('large downward personal blood-pressure change produces a human-review flag', () => {
  const records=['2026-10-25','2026-10-26','2026-10-27'].map(date=>({seniorId:'S101',date,vitals:{systolic:80}}));
  const result=engine.scoreSenior('S101',DEMO_DATE,records);
  assert.equal(result.level,'high');assert.ok(result.score>=60);
  assert.ok(result.reasons.some(reason=>/fallen.*baseline/iu.test(reason.title)));
  assert.doesNotMatch(JSON.stringify(result.reasons),/Stable against/);
});

test('early warmup priority has no fitted reference or anomaly score from future data', () => {
  const before=engine.scoreSenior('S101','2026-08-02');
  const changed=structuredClone(cohort);
  for(const record of changed.records)if(record.seniorId==='S101'&&record.date>='2026-08-04'&&record.date<='2026-08-28')record.vitals.systolic=190;
  const after=createEngine(changed).scoreSenior('S101','2026-08-02');
  assert.equal(before.level,'unknown');assert.equal(before.score,null);assert.equal(before.warmup,true);
  assert.equal(before.anomalyScore,null);assert.ok(Object.values(before.baseline).every(value=>value===null));
  assert.deepEqual(after.baseline,before.baseline);assert.equal(after.score,before.score);assert.deepEqual(after.reasons,before.reasons);
});

test('core multilingual extraction recognises reduced sleep, memory trouble and explicit other-person attribution', () => {
  assert.ok(extractCues('नींद कम आई।').some(cue=>cue.cue==='poor_sleep'));
  assert.ok(extractCues('Yaad nahi aa raha kya kiya.').some(cue=>cue.cue==='confusion'));
  assert.ok(extractCues('I cannot remember where I am.').some(cue=>cue.cue==='confusion'));
  assert.ok(!extractCues('My daughter fell yesterday but I am fine.').some(cue=>cue.cue==='fall'));
  assert.ok(extractCues('My mother fell yesterday.').some(cue=>cue.cue==='fall'));
  assert.ok(extractCues('My daughter said I fell yesterday.').some(cue=>cue.cue==='fall'));
  assert.deepEqual(extractCues('Neend kam nahi aayi. No pain or confusion.'),[]);
});

test('cohort configuration controls seed, calendar window, size and alternative phrase probes', () => {
  const sample=generateCohort({seed:7,endDate:'2026-06-30',seniorCount:40,days:60,languageVariant:'held-out-phrases'});
  assert.equal(sample.seniors.length,40);assert.equal(sample.metadata.days,60);assert.equal(sample.metadata.endDate,'2026-06-30');
  assert.equal(new Set(sample.records.map(record=>record.date)).size,60);
  const local=createEngine(sample);assert.equal(local.scoreSenior('S001').asOfDate,'2026-06-30');
  assert.equal(local.metrics().evaluatedSeniorDays,300);
  assert.notDeepEqual(sample.records.slice(0,2),generateCohort({seed:8,endDate:'2026-06-30',seniorCount:40,days:60}).records.slice(0,2));
  assert.throws(()=>generateCohort({endDate:'2026-02-31'}),/Invalid cohort/);
});

test('repeat evaluation exposes seed/phrase ranges without claiming independent clinical accuracy', () => {
  const result=evaluateRobustness({seeds:[91,92],languageVariants:['standard','held-out-phrases'],seniorCount:40,days:60});
  assert.equal(result.runCount,4);
  assert.equal(new Set(result.runs.map(run=>run.seed)).size,2);
  assert.equal(new Set(result.runs.map(run=>run.languageVariant)).size,2);
  assert.ok(result.runs.every(run=>run.evaluatedSeniorDays===300));
  assert.match(result.limitations,/not a sequestered blind NLP dataset/);
  assert.equal(result.languageProbes.passed,result.languageProbes.total);
  assert.ok(result.ranges.recall.min<=result.ranges.recall.max);
});

test('help and sensor inputs share immediate triage and explain why without a stable fallback',()=>{
  for(const record of [
    {seniorId:'S101',date:DEMO_DATE,note:'I need help.'},
    {seniorId:'S101',date:DEMO_DATE,sensor:{fallDetected:true}},
  ]) {
    const result=engine.scoreSenior('S101',DEMO_DATE,[record]);
    assert.equal(result.urgency,'immediate');assert.equal(result.level,'high');
    assert.ok(result.triageEvidence.length>0);
    assert.doesNotMatch(JSON.stringify(result.reasons),/Stable against/);
  }
});

test('elapsed calendar time is measured from the requested date beyond the cohort end',()=>{
  const result=engine.scoreSenior('S101','2026-11-01');
  assert.equal(result.asOfDate,'2026-11-01');assert.ok(result.dataFreshness.ageDays>=5);
  assert.equal(result.level,'unknown');assert.equal(result.score,null);
});
