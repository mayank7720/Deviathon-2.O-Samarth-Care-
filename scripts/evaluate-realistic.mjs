#!/usr/bin/env node
/** Reproduce the reference-informed synthetic cohort and partial-label report. */
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {generateRealisticCohort,createRealisticEngine} from '../lib/realistic-cohort.mjs';
import {auditCohort} from '../lib/data-quality.mjs';

const flags=new Set(process.argv.slice(2));
if([...flags].some(flag=>!['--metrics-only','--help'].includes(flag)))throw new Error('Use --metrics-only or --help.');
if(flags.has('--help'))console.log('node scripts/evaluate-realistic.mjs [--metrics-only]');
else {
  const cohort=generateRealisticCohort(),quality=auditCohort(cohort),engine=createRealisticEngine(cohort,{splitStrategy:'legacy-modulo'});
  const runs=[];
  for(const seed of [1042026,1042027,1042028]){
    const sample=seed===cohort.metadata.seed?cohort:generateRealisticCohort({seed});
    const m=(seed===cohort.metadata.seed?engine:createRealisticEngine(sample,{splitStrategy:'legacy-modulo'})).metrics();
    runs.push({seed,observations:sample.records.length,scenarioDailyCoverage:m.recall,detectedCases:m.detectedCases,totalCases:m.totalCases,unlabelledHighSeniorDays:m.unlabelledHighSeniorDays,meanOnsetDetectionDelayDays:m.meanOnsetDetectionDelayDays,meanLeadDays:m.meanLeadDays,clinicalPrecision:null,clinicalRecall:null});
  }
  const report={metadata:cohort.metadata,quality,metrics:engine.metrics(),robustness:{runs,limitations:'Three independently seeded synthetic scenarios; not independent patient validation. Parameters and templates remain authored in this repository.'}};
  await mkdir('outputs',{recursive:true});
  await writeFile('outputs/realistic-evaluation.json',JSON.stringify(report,null,2)+'\n');
  if(!flags.has('--metrics-only')){
    await writeFile('outputs/realistic-cohort.jsonl',cohort.records.map(record=>JSON.stringify(record)).join('\n')+'\n');
    await writeFile('outputs/realistic-seniors.json',JSON.stringify({metadata:cohort.metadata,seniors:cohort.seniors},null,2)+'\n');
    await writeFile('outputs/realistic-scenario-annotations.json',JSON.stringify({metadata:cohort.metadata,scenarios:cohort.groundTruth,incidents:cohort.events},null,2)+'\n');
  }
  JSON.parse(await readFile('outputs/realistic-evaluation.json','utf8'));
  if(!quality.passed)throw new Error(`Data-quality checks failed: ${quality.hardErrors} hard inconsistencies.`);
  console.log(JSON.stringify({generator:cohort.metadata.generator,observations:cohort.records.length,qualityPassed:quality.passed,hardErrors:quality.hardErrors,scenarioDailyCoverage:report.metrics.recall,scenarioCasesDetected:report.metrics.detectedCases,scenarioCases:report.metrics.totalCases,unlabelledHighSeniorDays:report.metrics.unlabelledHighSeniorDays,clinicalPrecision:null,clinicalRecall:null,reason:'Partial synthetic scenario annotations do not establish clinical accuracy.',runs},null,2));
}
