#!/usr/bin/env node
/**
 * Reproduce the synthetic demonstration and its held-out evaluation.
 * This script never reads patient records, invokes a network service or uploads
 * any data. Output is deterministic and belongs in the ignored outputs folder.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEMO_DATE, generateCohort, createEngine, evaluateRobustness } from '../lib/engine.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => !['--metrics-only', '--help', '-h'].includes(arg))) {
  console.error('Usage: node scripts/evaluate.mjs [--metrics-only]');
  process.exitCode = 1;
} else if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/evaluate.mjs [--metrics-only]');
  console.log('Default: write aggregate evaluation, daily observations, senior profiles and evaluation-only planted labels to outputs/.');
  console.log('--metrics-only: write only outputs/evaluation.json; no cohort or label files are written.');
} else {
  const metricsOnly = args.includes('--metrics-only');
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const outputDirectory = path.join(projectRoot, 'outputs');
  const cohort = generateCohort();
  const engine = createEngine(cohort);
  const { caseResults, ...metrics } = engine.metrics();
  const metadata = {
    schemaVersion: 1,
    synthetic: true,
    demonstrationDate: DEMO_DATE,
    ...cohort.metadata,
    seniorCount: cohort.seniors.length,
    plantedCaseCount: cohort.groundTruth.length,
  };
  const robustness = evaluateRobustness();
  const evaluation = { metadata, metrics, robustness };
  await mkdir(outputDirectory, { recursive: true });
  const writeJson = async (name, value) => {
    const destination = path.join(outputDirectory, name);
    await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    // Verify the written JSON rather than merely reporting a successful write.
    JSON.parse(await readFile(destination, 'utf8'));
    return destination;
  };
  const written = [await writeJson('evaluation.json', evaluation)];
  if (!metricsOnly) {
    const observationsPath = path.join(outputDirectory, 'synthetic-cohort.jsonl');
    await writeFile(observationsPath, `${cohort.records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
    const observations = (await readFile(observationsPath, 'utf8')).trimEnd().split('\n');
    if (observations.length !== cohort.records.length) throw new Error('Observation export did not preserve the cohort record count.');
    JSON.parse(observations[0]);
    JSON.parse(observations.at(-1));
    written.push(observationsPath);
    written.push(await writeJson('synthetic-seniors.json', { metadata, seniors: cohort.seniors }));
    written.push(await writeJson('ground-truth.json', {
      metadata,
      purpose: 'Evaluation only. Planted labels and case outcomes are never inputs to model fitting or risk scoring.',
      labels: cohort.groundTruth,
      heldOutCaseResults: caseResults,
    }));
  }
  const percentage = (value) => `${(value * 100).toFixed(1)}%`;
  console.log(`Synthetic cohort: ${cohort.seniors.length} seniors, ${cohort.metadata.days} days, ${cohort.records.length.toLocaleString('en-IN')} observations; seed ${cohort.metadata.seed}.`);
  console.log(`Held-out evaluation: ${metrics.heldOutSeniors} seniors, ${metrics.evaluatedSeniorDays.toLocaleString('en-IN')} senior-days, fixed high-risk threshold ${metrics.threshold}.`);
  console.log(`Precision ${percentage(metrics.precision)} | recall ${percentage(metrics.recall)} | F1 ${percentage(metrics.f1)} | mean lead ${metrics.meanLeadDays.toFixed(1)} days before planted escalation (not an acute event).`);
  console.log(`Planted cases detected: ${metrics.detectedCases}/${metrics.totalCases}. Counts: TP ${metrics.truePositives}, FP ${metrics.falsePositives}, FN ${metrics.falseNegatives}, TN ${metrics.trueNegatives}.`);
  console.log(`Mean detection delay after onset: ${metrics.meanOnsetDetectionDelayDays.toFixed(1)} days. Rules-only recall ${percentage(metrics.ablation.rulesOnly.recall)} versus rules+model ${percentage(metrics.recall)}.`);
  console.log(`Robustness: ${robustness.runCount} seeded/phrase-variant runs; precision ${percentage(robustness.ranges.precision.min)}–${percentage(robustness.ranges.precision.max)}, recall ${percentage(robustness.ranges.recall.min)}–${percentage(robustness.ranges.recall.max)}; language probes ${robustness.languageProbes.passed}/${robustness.languageProbes.total}.`);
  console.log('Synthetic validation only; these results do not establish clinical performance or prediction before an acute event.');
  for (const destination of written) console.log(`Wrote ${path.relative(projectRoot, destination)}`);
}
