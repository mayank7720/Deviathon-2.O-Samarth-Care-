import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSenior, forecastRisk, mergeSeniorRecords, redactForSummary, trainFeedbackModel, extractAnalyticCues } from '../lib/analytics.mjs';
import { generateCohort, createEngine, DEMO_DATE, extractCues } from '../lib/engine.mjs';

const cohort = generateCohort();
const engine = createEngine(cohort);
const senior = engine.scoreSenior('S001');
const day = (index) => `2026-10-${String(index).padStart(2, '0')}`;
const simpleSenior = (overrides = {}) => ({
  id: 'DEMO', score: 20, level: 'low', confidence: 90,
  baseline: { systolic: 125, diastolic: 78, glucose: 105, spo2: 98, weight: 65, activity: 4000, sleep: 7.5 },
  trend: Array.from({ length: 14 }, (_, index) => ({ date: day(14 + index), score: 20 + index })),
  ...overrides,
});
const simpleRecords = () => Array.from({ length: 7 }, (_, index) => ({
  seniorId: 'DEMO', date: day(21 + index),
  vitals: { systolic: 126, diastolic: 79, glucose: 107, spo2: 97.8, weight: 65 },
  medication: { taken: 3, prescribed: 3 }, activity: 4050, sleep: 7.5,
  note: 'No pain or confusion. Spoke with family today.',
}));

test('analytics provides nine domains, substantive model cards and a supported local summary', () => {
  const result = analyzeSenior(senior, cohort.records);
  assert.equal(result.domains.length, 9);
  assert.equal(result.modelCards.length, 6);
  assert.ok(result.domains.every((entry) => ['high', 'medium', 'low', 'unknown'].includes(entry.level)));
  assert.equal(result.summary.method, 'local extractive');
  assert.equal(result.summary.externalServiceUsed, false);
  assert.match(result.summary.text, /recorded check-in/);
  assert.equal(result.dataQuality.asOfDate, DEMO_DATE);
  assert.ok(result.nlp.cues.length);
  assert.ok(result.patterns.length);
});

test('same-day partial overlays preserve independent signals and dated note evidence', () => {
  const rows = simpleRecords();
  const merged = mergeSeniorRecords(simpleSenior(), [...rows,
    { seniorId: 'DEMO', date: DEMO_DATE, vitals: { spo2: 88 } },
    { seniorId: 'DEMO', date: DEMO_DATE, lifestyle: { meals: 1, mood: 'low' }, note: 'Had a fall this morning.' },
    { seniorId: 'DEMO', date: DEMO_DATE, lifestyle: { waterGlasses: 3 }, note: 'No pain now.' },
  ]);
  const latest = merged.at(-1);
  assert.equal(latest.vitals.spo2, 88);
  assert.equal(latest.vitals.systolic, 126);
  assert.equal(latest.medication.taken, 3);
  assert.equal(latest.lifestyle.meals, 1);
  assert.equal(latest.lifestyle.waterGlasses, 3);
  assert.match(latest.note, /Spoke with family/);
  assert.match(latest.note, /fall/);
  assert.match(latest.note, /No pain now/);
  const result = analyzeSenior(simpleSenior(), merged);
  assert.equal(result.domains.find((entry) => entry.id === 'oxygen').level, 'high');
  assert.equal(result.sensor.fallSuspected, true);
});

test('future entries, other seniors and invalid calendar dates do not leak into analysis', () => {
  const result = analyzeSenior(simpleSenior(), [
    ...simpleRecords(),
    { seniorId: 'OTHER', date: DEMO_DATE, note: 'Had a fall. Confused and breathless.' },
    { seniorId: 'DEMO', date: '2026-10-28', note: 'Had a fall.' },
    { seniorId: 'DEMO', date: '2026-02-31', note: 'Had a fall.' },
  ]);
  assert.equal(result.sensor.fallSuspected, false);
  assert.equal(result.dataQuality.observedDays, 7);
  assert.deepEqual(result.nlp.cues, []);
});

test('missing entries remain unknown and do not imply normal medicine adherence', () => {
  const result = analyzeSenior(simpleSenior(), []);
  assert.ok(result.domains.every((entry) => entry.level === 'unknown' && entry.score === null));
  assert.equal(result.medication.adherence, null);
  assert.equal(result.dataQuality.coveragePercent, 0);
  assert.equal(result.dataQuality.level, 'high');
  assert.ok(result.patterns.some((entry) => entry.id === 'missing-checkin'));
  assert.match(result.summary.text, /0 recorded/);
  assert.doesNotMatch(result.summary.text, /100%|stable|healthy/);
});

test('a personal baseline changes interpretation of the same absolute activity', () => {
  const rows = simpleRecords().map((record) => ({ ...record, activity: 2400 }));
  const lowerBaseline = analyzeSenior(simpleSenior({ baseline: { ...simpleSenior().baseline, activity: 2500 } }), rows);
  const higherBaseline = analyzeSenior(simpleSenior({ baseline: { ...simpleSenior().baseline, activity: 6000 } }), rows);
  assert.equal(lowerBaseline.domains.find((entry) => entry.id === 'activity').level, 'low');
  assert.equal(higherBaseline.domains.find((entry) => entry.id === 'activity').level, 'high');
});

test('Hinglish and Hindi appetite, loneliness and sleep changes appear as dated evidence', () => {
  const rows = simpleRecords();
  rows[5].note = 'Bhookh nahi lagti. Akela mehsoos ho raha hai. Neend nahi aati.';
  rows[6].note = 'भूख नहीं लग रही। आज अकेलापन है।';
  const result = analyzeSenior(simpleSenior(), rows);
  assert.ok(result.nlp.languages.includes('Hindi'));
  assert.ok(result.nlp.languages.includes('Hinglish'));
  assert.equal(result.nlp.cues.find((cue) => cue.cue === 'low_appetite').mentions, 2);
  assert.equal(result.domains.find((entry) => entry.id === 'nutrition').level, 'high');
  assert.ok(result.patterns.some((entry) => entry.id === 'persistent-cues'));
});

test('supplementary NLP preserves truthful Hindi reduced-sleep wording and common negation', () => {
  const hindi = extractAnalyticCues('नींद कम आई।');
  assert.ok(hindi.some((cue) => cue.cue === 'poor_sleep' && cue.evidence === 'नींद कम आई'));
  assert.ok(extractAnalyticCues('Neend kam aayi.').some((cue) => cue.cue === 'poor_sleep'));
  assert.deepEqual(extractAnalyticCues('नींद कम नहीं आई।'), []);
  assert.deepEqual(extractAnalyticCues('Neend kam nahi aayi.'), []);
  for(const text of ['नींद कम आई।','Yaad nahi aa raha kya kiya.','My daughter fell yesterday but I am fine.'])assert.deepEqual(extractAnalyticCues(text),extractCues(text));
});

test('core and supplementary analysis share immediate triage instead of separate urgency rules',()=>{
  const extra={seniorId:'S101',date:DEMO_DATE,sensor:{fallDetected:true}};
  const scored=engine.scoreSenior('S101',DEMO_DATE,[extra]);
  const result=analyzeSenior(scored,[...cohort.records,extra]);
  assert.equal(result.urgency,scored.urgency);assert.equal(result.urgencyRank,scored.urgencyRank);
  assert.equal(result.immediateReview,true);
});

test('analysis honours explicit as-of date instead of letting a stale latest observation freeze the clock',()=>{
  const result=analyzeSenior({...simpleSenior(),asOfDate:'2026-11-03'},simpleRecords());
  assert.equal(result.dataQuality.asOfDate,'2026-11-03');
  assert.ok(result.dataQuality.daysSinceCheckIn>=7);
  assert.equal(result.dataQuality.observedDays,0);
});

test('lifestyle and submitted sensor steps override legacy activity fields without fabricating a device', () => {
  const rows = simpleRecords().map((record) => ({ ...record, lifestyle: { steps: 1500, sleepHours: 5, waterGlasses: 2, meals: 1, mood: 'low', painScore: 8 } }));
  rows.at(-1).sensor = { steps: 500, inactiveMinutes: 230, impactG: 3, postureChange: true };
  const result = analyzeSenior(simpleSenior(), rows);
  assert.equal(result.domains.find((entry) => entry.id === 'activity').level, 'high');
  assert.equal(result.domains.find((entry) => entry.id === 'sleep').level, 'high');
  assert.equal(result.domains.find((entry) => entry.id === 'mood').level, 'high');
  assert.equal(result.sensor.fallSuspected, true);
  assert.equal(result.sensor.inactivity.flagged, true);
  assert.match(result.sensor.source, /no live device connection/);
  assert.match(result.sensor.limitations, /not validated fall detection/);
});

test('impact alone is insufficient for the sensor fall-review rule', () => {
  const rows = simpleRecords(); rows.at(-1).sensor = { impactG: 4, postureChange: false, inactiveMinutes: 60 };
  const result = analyzeSenior(simpleSenior(), rows);
  assert.equal(result.sensor.fallSuspected, false);
  assert.equal(result.sensor.inactivity.flagged, false);
});

test('hydration without an older personal reference is reported without invented needs', () => {
  const rows = simpleRecords().map((record) => ({ ...record, lifestyle: { waterGlasses: 2 } }));
  const result = analyzeSenior(simpleSenior(), rows);
  const nutrition = result.domains.find((entry) => entry.id === 'nutrition');
  assert.ok(nutrition.evidence.some((evidence) => /no personal hydration reference/.test(evidence)));
  assert.doesNotMatch(nutrition.action, /drink\s+\d|dehydrat|litres|liters/iu);
});

test('logged missed-dose streaks stop across unobserved days', () => {
  const rows = [21, 22, 24, 25, 26].map((index) => ({ seniorId: 'DEMO', date: day(index), medication: { taken: 1, prescribed: 3 } }));
  const result = analyzeSenior(simpleSenior(), rows);
  assert.equal(result.medication.longestMissedStreak, 3);
  assert.equal(result.medication.missedDays, 5);
  assert.equal(result.medication.missedDoses, 10);
  assert.equal(result.medication.adherence, 33.3);
});

test('explicit dose logs identify recurring timing gaps and exact-name schedule duplicates only', () => {
  const rows = simpleRecords();
  for (const index of [5, 6]) rows[index].medication = { doses: [
    { name: 'Example tablet', scheduledTime: '08:00', status: 'missed' },
    { name: 'Example tablet', scheduledTime: '08:00', status: 'missed' },
    { name: 'Different tablet', scheduledTime: '08:00', status: 'taken' },
  ] };
  const result = analyzeSenior(simpleSenior(), rows);
  assert.equal(result.medication.timingPatterns.length, 1);
  assert.equal(result.medication.timingPatterns[0].days, 2);
  assert.equal(result.medication.scheduleOverlaps.length, 2);
  assert.equal(result.medication.interactionCheck.available, false);
  assert.match(result.medication.interactionCheck.reason, /No drug-interaction database/);
  assert.ok(result.patterns.some((entry) => entry.id === 'schedule-overlap'));
});

test('dose timing analysis remains empty when only daily totals are supplied', () => {
  const result = analyzeSenior(simpleSenior(), simpleRecords());
  assert.deepEqual(result.medication.timingPatterns, []);
  assert.deepEqual(result.medication.scheduleOverlaps, []);
});

test('linear projection uses calendar dates and keeps a nonzero band on a perfect trend', () => {
  const trend = Array.from({ length: 10 }, (_, index) => ({ date: day(18 + index), score: 20 + 2 * index }));
  const projection = forecastRisk(trend);
  assert.equal(projection.slopePerDay, 2);
  assert.equal(projection.points.length, 3);
  assert.equal(projection.points[0].date, '2026-10-28');
  assert.equal(projection.points[0].score, 40);
  assert.ok(projection.points.every((point) => point.lower < point.score && point.upper > point.score));
  assert.match(projection.limitations, /not calibrated medical confidence/);
});

test('forecast requires support, filters future points and clamps its descriptive range', () => {
  assert.deepEqual(forecastRisk([{ date: DEMO_DATE, score: 80 }]).points, []);
  assert.equal(forecastRisk([]).confidenceLabel, 'insufficient data');
  const trend = [21, 22, 23, 24, 25, 26, 27].map((index) => ({ date: day(index), score: 70 + (index - 21) * 5 }));
  trend.push({ date: '2026-10-28', score: 0 });
  const projection = forecastRisk(trend, { asOfDate: DEMO_DATE });
  assert.equal(projection.slopePerDay, 5);
  assert.ok(projection.points.every((point) => point.score <= 100 && point.upper <= 100 && point.lower >= 0));
});

test('summary redaction whitelists aggregates and excludes identity and free text', () => {
  const result = redactForSummary({ ...senior, email: 'private@example.test', secret: 'do not share', note: 'private note', unknown: { phone: '123' } });
  const serialized = JSON.stringify(result);
  for (const value of [senior.name, senior.id, 'private@example.test', 'private note', 'do not share', senior.phone]) assert.ok(!serialized.includes(value), value);
  assert.equal(result.priority, senior.level);
  assert.ok(result.recordedRiskTrend.length <= 7);
  assert.match(result.limitation, /remain sensitive/);
});

const feedbackExamples = () => Array.from({ length: 60 }, (_, index) => ({
  seniorId: `PERSON-${index}`, useful: index % 2 === 0,
  score: index % 2 === 0 ? 70 + index % 20 : 10 + index % 20,
  anomalyScore: index % 2 === 0 ? 0.75 : 0.4,
  reasonCount: index % 2 === 0 ? 4 : 1, confidence: 80,
}));

test('feedback model requires enough labelled snapshots and both useful classes', () => {
  assert.equal(trainFeedbackModel([]).trained, false);
  assert.equal(trainFeedbackModel(feedbackExamples().slice(0, 10)).trained, false);
  assert.equal(trainFeedbackModel(feedbackExamples().map((example) => ({ ...example, useful: true }))).trained, false);
  assert.equal(trainFeedbackModel(Array.from({ length: 30 }, (_, index) => ({ useful: index % 2 === 0 }))).trained, false);
});

test('logistic feedback fitting has a separate holdout, useful workflow target and meaningful prediction', () => {
  const examples = feedbackExamples();
  const model = trainFeedbackModel(examples);
  assert.equal(model.trained, true);
  assert.ok(model.trainingExamples >= 12 && model.holdoutExamples >= 4);
  assert.equal(model.trainingExamples + model.holdoutExamples, examples.length);
  assert.ok(model.trainingGroups.every((group) => !model.holdoutGroups.includes(group)));
  assert.ok(model.metrics.accuracy > 0.8);
  assert.ok(model.predictUsefulAlert(examples[0]) > model.predictUsefulAlert(examples[1]));
  assert.match(model.target, /useful-alert/);
  assert.match(model.limitations, /not.*disease probability/);
});

test('repeated feedback from one senior never crosses the identity holdout boundary', () => {
  const examples = feedbackExamples().flatMap((example) => [example, { ...example, score: example.score + 1 }]);
  const model = trainFeedbackModel(examples);
  assert.equal(model.trained, true);
  assert.ok(model.trainingGroups.every((group) => !model.holdoutGroups.includes(group)));
  assert.equal(model.identityGrouped, true);
});

test('heldout labels cannot change fitted coefficients and useful likelihood never lowers urgent scores', () => {
  const examples = feedbackExamples();
  const first = trainFeedbackModel(examples);
  const heldout = new Set(first.holdoutGroups);
  const second = trainFeedbackModel(examples.map((example) => heldout.has(example.seniorId) ? { ...example, useful: !example.useful } : example));
  assert.deepEqual(second.weights, first.weights);
  assert.equal(second.intercept, first.intercept);
  const urgent = { ...simpleSenior(), score: 100, level: 'high', action: 'Contact the senior now.' };
  const supplemented = first.applySupplement(urgent);
  assert.equal(supplemented.score, 100);
  assert.equal(supplemented.level, 'high');
  assert.equal(supplemented.action, urgent.action);
  assert.ok(supplemented.usefulAlertLikelihood >= 0 && supplemented.usefulAlertLikelihood <= 1);
});

test('feedback model output is deterministic and excludes target labels from features', () => {
  const first = trainFeedbackModel(feedbackExamples());
  const second = trainFeedbackModel(feedbackExamples());
  assert.deepEqual(first.weights, second.weights);
  assert.ok(!first.featureNames.some((feature) => /useful|disease|diagnos/iu.test(feature)));
});
