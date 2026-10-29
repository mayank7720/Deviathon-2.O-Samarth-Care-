#!/usr/bin/env node
/** Synthetic upgrade evaluation only; scenario labels never enter production scoring. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { generateRealisticCohort, createRealisticEngine } from '../lib/realistic-cohort.mjs';
import { MODEL_INFO } from '../lib/engine.mjs';
import { auditCohort } from '../lib/data-quality.mjs';

const DAY = 86400000;
const round = (value, digits = 3) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
const ratio = (numerator, denominator) => denominator ? round(numerator / denominator) : null;
const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index++) {
  const name = args[index];
  if (name === '--help') options.help = true;
  else if (['--baseline', '--report', '--output'].includes(name) && args[index + 1] && !args[index + 1].startsWith('--')) options[name.slice(2)] = args[++index];
  else throw new Error('Use --baseline FILE, --report FILE, --output FILE or --help.');
}
if (options.help) {
  console.log('node scripts/evaluate-algorithm-upgrade.mjs [--baseline before.json] [--report realistic-evaluation.json] [--output outputs/algorithm-upgrade.json]');
  process.exit(0);
}
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const cohort = generateRealisticCohort();
const engine = createRealisticEngine(cohort);
const identities = cohort.seniors.filter((_, index) => index % 4 === 3);
const heldOutIds = new Set(identities.map(senior => senior.id));
const episodes = cohort.groundTruth.filter(episode => heldOutIds.has(episode.seniorId));
const dateAt = day => new Date(Date.parse(cohort.metadata.startDate + 'T00:00:00Z') + day * DAY).toISOString().slice(0, 10);
const within = (episode, date) => episode && date >= episode.onsetDate && date <= episode.endDate;
const clinicalPerformance = { precision: null, recall: null, f1: null, specificity: null, reason: 'Authored positive scenarios are partial; other days are unlabelled and no independent patient outcomes are available.' };
const thresholds = [30, 60];
const buckets = thresholds.map(threshold => ({ threshold, evaluatedSeniorDays: 0, scenarioDays: 0, coveredScenarioDays: 0, flaggedSeniorDays: 0, unlabelledFlaggedSeniorDays: 0, unknownSeniorDays: 0, first: new Map() }));
let immediateReviewSeniorDays = 0, anyHumanReviewSeniorDays = 0;
for (const senior of identities) {
  const episode = episodes.find(value => value.seniorId === senior.id);
  for (let day = 30; day < cohort.metadata.days; day++) {
    const date = dateAt(day), score = engine.scoreSenior(senior.id, date);
    const actual = within(episode, date);
    if (score.immediateReview) immediateReviewSeniorDays++;
    if (score.immediateReview || score.score != null && score.score >= 30) anyHumanReviewSeniorDays++;
    for (const bucket of buckets) {
      const flagged = score.score != null && score.score >= bucket.threshold;
      bucket.evaluatedSeniorDays++;
      if (score.score == null) bucket.unknownSeniorDays++;
      if (actual) bucket.scenarioDays++;
      if (flagged) {
        bucket.flaggedSeniorDays++;
        if (actual) {
          bucket.coveredScenarioDays++;
          if (!bucket.first.has(senior.id)) bucket.first.set(senior.id, date);
        } else bucket.unlabelledFlaggedSeniorDays++;
      }
    }
  }
}
const thresholdReports = buckets.map(({ first, ...counts }) => {
  const cases = episodes.map(episode => {
    const firstFlagDate = first.get(episode.seniorId) || null;
    return {
      seniorId: episode.seniorId, pattern: episode.pattern, onsetDate: episode.onsetDate,
      authoredEscalationDate: episode.escalationDate || episode.criticalDate,
      firstFlagDate,
      delayAfterOnsetDays: firstFlagDate ? (Date.parse(firstFlagDate) - Date.parse(episode.onsetDate)) / DAY : null,
      daysBeforeAuthoredEscalation: firstFlagDate ? (Date.parse(episode.escalationDate || episode.criticalDate) - Date.parse(firstFlagDate)) / DAY : null,
    };
  });
  const detected = cases.filter(value => value.firstFlagDate);
  return {
    ...counts,
    dailyScenarioCoverage: ratio(counts.coveredScenarioDays, counts.scenarioDays),
    detectedCases: detected.length, totalCases: cases.length, caseCoverage: ratio(detected.length, cases.length),
    meanDelayAfterOnsetDays: detected.length ? round(detected.reduce((sum, value) => sum + value.delayAfterOnsetDays, 0) / detected.length, 2) : null,
    meanDaysBeforeAuthoredEscalation: detected.length ? round(detected.reduce((sum, value) => sum + value.daysBeforeAuthoredEscalation, 0) / detected.length, 2) : null,
    flaggedDaysPer100SeniorDays: ratio(counts.flaggedSeniorDays * 100, counts.evaluatedSeniorDays),
    unlabelledFlaggedDaysPer100SeniorDays: ratio(counts.unlabelledFlaggedSeniorDays * 100, counts.evaluatedSeniorDays),
    cases, clinicalPerformance,
  };
});
const sameCohort = report => report?.metadata && ['seed', 'days', 'startDate', 'endDate', 'seniorCount', 'languageVariant', 'generator'].every(key => report.metadata[key] === cohort.metadata[key]);
let reusable = null;
const reportPath = options.report || 'outputs/realistic-evaluation.json';
try {
  const candidate = await readJson(reportPath);
  if (sameCohort(candidate) && candidate.metrics?.model?.version === MODEL_INFO.version) reusable = candidate;
  else if (options.report) throw new Error('The supplied report does not match this model version and synthetic cohort.');
} catch (error) {
  if (options.report || error.code !== 'ENOENT') throw error;
}
const high = thresholdReports.find(value => value.threshold === 60);
if (reusable && (reusable.metrics.truePositives !== high.coveredScenarioDays || reusable.metrics.unlabelledHighSeniorDays !== high.unlabelledFlaggedSeniorDays || reusable.metrics.detectedCases !== high.detectedCases))
  throw new Error('Existing evaluation metrics are stale for the current source. Rerun scripts/evaluate-realistic.mjs or select a current report.');
const metrics = reusable ? reusable.metrics : engine.metrics();
const calibration = metrics.model?.calibration || null;
const counts = values => values.reduce((result, value) => ({ ...result, [value]: (result[value] || 0) + 1 }), {});
const describe = seniors => ({
  identities: seniors.length,
  ageRange: seniors.length ? [Math.min(...seniors.map(value => value.age)), Math.max(...seniors.map(value => value.age))] : null,
  ageBands: counts(seniors.map(value => value.age < 70 ? '60-69' : value.age < 80 ? '70-79' : '80+')),
  gender: counts(seniors.map(value => value.gender)),
  profileLanguage: counts(seniors.map(value => value.language)),
  cities: counts(seniors.map(value => value.city)),
});
const demographicWarnings = [];
const allGenders = new Set(cohort.seniors.map(value => value.gender));
for (const gender of allGenders) if (!identities.some(value => value.gender === gender)) demographicWarnings.push('Evaluation identities contain no ' + gender + ' profiles; results do not establish generalisation across genders.');
const sourceFiles = ['engine.mjs', 'personal-baseline.mjs', 'triage.mjs', 'realistic-cohort.mjs', 'analytics.mjs', 'motion-monitor.mjs', 'model-runtime.mjs', 'recorded-seniors.mjs'];
const hash = createHash('sha256');
for (const file of sourceFiles) hash.update(file).update(await readFile(new URL('../lib/' + file, import.meta.url)));
hash.update(await readFile(new URL(import.meta.url)));
const robustnessRuns = [];
for (const run of reusable?.robustness?.runs || []) {
  if (run.seed === cohort.metadata.seed) {
    const review = thresholdReports.find(value => value.threshold === 30);
    robustnessRuns.push({ ...run, reviewDailyScenarioCoverage: review.dailyScenarioCoverage, reviewDetectedCases: review.detectedCases, reviewTotalCases: review.totalCases, reviewMeanDelayAfterOnsetDays: review.meanDelayAfterOnsetDays });
    continue;
  }
  // The existing report already measured high flags over all held-out days.
  // Only score labelled windows to add review coverage, not repeat full metrics.
  const sample = generateRealisticCohort({ seed: run.seed });
  const sampleEngine = createRealisticEngine(sample);
  let scenarioDays = 0, coveredDays = 0;
  const delays = [];
  for (const episode of sample.groundTruth.filter(value => value.split === 'held-out')) {
    let first = null;
    for (let ms = Math.max(Date.parse(episode.onsetDate), Date.parse(sample.metadata.startDate) + 30 * DAY); ms <= Date.parse(episode.endDate); ms += DAY) {
      const date = new Date(ms).toISOString().slice(0, 10);
      const score = sampleEngine.scoreSenior(episode.seniorId, date);
      scenarioDays++;
      if (score.score != null && score.score >= 30) { coveredDays++; first ??= date; }
    }
    if (first) delays.push((Date.parse(first) - Date.parse(episode.onsetDate)) / DAY);
  }
  robustnessRuns.push({ ...run, reviewDailyScenarioCoverage: ratio(coveredDays, scenarioDays), reviewDetectedCases: delays.length, reviewTotalCases: sample.groundTruth.filter(value => value.split === 'held-out').length, reviewMeanDelayAfterOnsetDays: delays.length ? round(delays.reduce((a, b) => a + b, 0) / delays.length, 2) : null });
}
const report = {
  schemaVersion: 1, modelVersion: MODEL_INFO.version, modelSourceSha256: hash.digest('hex'),
  metadata: cohort.metadata,
  evaluation: {
    from: dateAt(30), to: cohort.metadata.endDate, identities: identities.length,
    heldOutRule: 'Every fourth synthetic identity is excluded from fitting and calibration; evaluation uses days 31 onward.',
    baselineRule: 'Each held-out senior may use their own first 30 days as a personal reference.',
    thresholds: thresholdReports,
    immediateReviewSeniorDays, anyHumanReviewSeniorDays,
    anyHumanReviewDaysPer100SeniorDays: ratio(anyHumanReviewSeniorDays * 100, high.evaluatedSeniorDays),
    interpretation: 'Flagged senior-days measure potential review burden, not unique notifications or false alarms. Immediate-review rules are reported separately from numeric thresholds. Lead is relative to an authored escalation deadline, not an observed emergency.',
  },
  calibration,
  demographics: { development: describe(cohort.seniors.filter(value => !heldOutIds.has(value.id))), evaluation: describe(identities), warnings: demographicWarnings },
  ablation: metrics.ablation || null,
  quality: reusable?.quality || auditCohort(cohort),
  clinicalPerformance,
  reuse: { existingRealisticMetrics: !!reusable, robustnessRuns: robustnessRuns.length ? robustnessRuns : null },
  limitations: [
    'Synthetic authored scenarios are correlated and small; no patient-level diagnostic performance is established.',
    'Calibration uses development baseline distributions only and is not a medical false-positive rate.',
    'Scenario daily coverage, case coverage, review burden and delay answer different questions; unlabelled flags are not labelled false positives.',
    'Before/after comparisons are development evidence, not a fresh independent validation set; do not tune parameters against the held-out results.',
    ...demographicWarnings,
  ],
};
if (options.baseline) {
  const before = await readJson(options.baseline);
  if (!sameCohort(before) || before.metrics?.threshold !== 60 || before.metrics?.scenarioReviewCoverage?.threshold !== 30)
    throw new Error('Baseline comparison requires the same generator, seed, identities, dates, language variant and 30/60 thresholds.');
  const previous = before.metrics;
  const beforeThresholds = [
    { threshold: 30, dailyScenarioCoverage: previous.scenarioReviewCoverage.dailyCoverage, detectedCases: previous.scenarioReviewCoverage.detectedCases, totalCases: previous.scenarioReviewCoverage.totalCases, meanDelayAfterOnsetDays: previous.scenarioReviewCoverage.meanOnsetDetectionDelayDays, flaggedDaysPer100SeniorDays: null },
    { threshold: 60, dailyScenarioCoverage: previous.recall, detectedCases: previous.detectedCases, totalCases: previous.totalCases, meanDelayAfterOnsetDays: previous.meanOnsetDetectionDelayDays, flaggedDaysPer100SeniorDays: ratio((previous.truePositives + previous.unlabelledHighSeniorDays) * 100, previous.evaluatedSeniorDays) },
  ];
  report.comparison = {
    beforeModelVersion: previous.model?.version || 'unversioned earlier checkpoint',
    sameSyntheticCohort: true, thresholdsUnchanged: true,
    before: beforeThresholds,
    beforeRobustness: before.robustness?.runs || null,
    after: thresholdReports.map(({ cases, clinicalPerformance, ...value }) => value),
    baselineReviewBurdenNote: 'The earlier report did not retain total threshold-30 flagged days; its review-burden field stays null.',
    clinicalPerformance,
  };
}
const output = resolve(options.output || 'outputs/algorithm-upgrade.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  modelVersion: report.modelVersion, thresholdSummary: thresholdReports.map(({ threshold, dailyScenarioCoverage, detectedCases, totalCases, meanDelayAfterOnsetDays, flaggedDaysPer100SeniorDays, unlabelledFlaggedDaysPer100SeniorDays }) => ({ threshold, dailyScenarioCoverage, detectedCases, totalCases, meanDelayAfterOnsetDays, flaggedDaysPer100SeniorDays, unlabelledFlaggedDaysPer100SeniorDays })),
  calibration, demographicWarnings, qualityPassed: report.quality.passed,
  comparisonIncluded: !!report.comparison, clinicalPerformance,
}, null, 2));
if (!report.quality.passed) process.exitCode = 1;
