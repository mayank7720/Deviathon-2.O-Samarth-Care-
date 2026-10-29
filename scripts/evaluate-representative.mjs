#!/usr/bin/env node
/** Frozen, profile-only identity splits; labels are used only after scoring. */
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {generateRealisticCohort,createRealisticEngine} from '../lib/realistic-cohort.mjs';
import {auditCohort} from '../lib/data-quality.mjs';
import {MODEL_INFO} from '../lib/engine.mjs';

const args=process.argv.slice(2);
if(args.includes('--help')){console.log('node scripts/evaluate-representative.mjs [--output FILE]');process.exit(0);}
if(args.length&&!(args.length===2&&args[0]==='--output'&&args[1]))throw new Error('Use --output FILE or --help.');
const round=value=>Number.isFinite(value)?Math.round(value*1000)/1000:null;
const counts=values=>values.reduce((out,value)=>({...out,[value]:(out[value]||0)+1}),{});
const summarizeProfiles=profiles=>({identities:profiles.length,gender:counts(profiles.map(p=>p.gender)),ageBands:counts(profiles.map(p=>p.age<70?'60-69':p.age<80?'70-79':'80+')),diabetesHistory:profiles.filter(p=>p.conditions.includes('Diabetes history')).length});
function evaluate(cohort,strategy) {
  const engine=createRealisticEngine(cohort,{splitStrategy:strategy,splitSeed:104}),plan=engine.evaluationSplit;
  const selected=cohort.seniors.filter(profile=>plan.evaluationIds.includes(profile.id));
  const episodes=cohort.groundTruth.filter(episode=>plan.evaluationIds.includes(episode.seniorId));
  const thresholdResults=[30,60].map(threshold=>({threshold,seniorDays:0,flags:0,unlabelledFlags:0,unknown:0,annotatedDays:0,coveredDays:0,cases:episodes.map(episode=>({seniorId:episode.seniorId,pattern:episode.pattern,onsetDate:episode.onsetDate,firstFlagDate:null,delayAfterOnsetDays:null}))}));
  const subgroups=new Map();
  for(const profile of selected) {
    const subgroupLabels=[`gender:${profile.gender}`,`age:${profile.age<70?'60-69':profile.age<80?'70-79':'80+'}`,`diabetes-history:${profile.conditions.includes('Diabetes history')?'recorded':'not-recorded'}`];
    for(const label of subgroupLabels){if(!subgroups.has(label))subgroups.set(label,{group:label,identities:0,seniorDays:0,reviewFlags:0,highFlags:0,annotatedDays:0,reviewCoveredDays:0,highCoveredDays:0});subgroups.get(label).identities++;}
    const episode=episodes.find(item=>item.seniorId===profile.id);
    for(let day=30;day<cohort.metadata.days;day++) {
      const date=new Date(Date.parse(cohort.metadata.startDate+'T00:00:00Z')+day*86400000).toISOString().slice(0,10);
      const scored=engine.scoreSenior(profile.id,date),actual=!!episode&&date>=episode.onsetDate&&date<=episode.endDate;
      for(const label of subgroupLabels){const group=subgroups.get(label);group.seniorDays++;group.reviewFlags+=Number(scored.score!==null&&scored.score>=30);group.highFlags+=Number(scored.score!==null&&scored.score>=60);group.annotatedDays+=Number(actual);group.reviewCoveredDays+=Number(actual&&scored.score>=30);group.highCoveredDays+=Number(actual&&scored.score>=60);}
      for(const result of thresholdResults){
        const flagged=scored.score!==null&&scored.score>=result.threshold;result.seniorDays++;result.flags+=Number(flagged);result.unknown+=Number(scored.score===null);result.annotatedDays+=Number(actual);result.coveredDays+=Number(actual&&flagged);result.unlabelledFlags+=Number(!actual&&flagged);
        if(actual&&flagged){const entry=result.cases.find(item=>item.seniorId===profile.id);if(!entry.firstFlagDate){entry.firstFlagDate=date;entry.delayAfterOnsetDays=(Date.parse(date)-Date.parse(episode.onsetDate))/86400000;}}
      }
    }
  }
  const metrics=engine.metrics();
  return {strategy,splitSeed:104,cohortSeed:cohort.metadata.seed,split:plan,profiles:Object.fromEntries(['fit','calibration','evaluation'].map(role=>[role,summarizeProfiles(cohort.seniors.filter(profile=>plan[role+'Ids'].includes(profile.id)))])),calibration:metrics.model.calibration,thresholds:thresholdResults.map(result=>{const detected=result.cases.filter(item=>item.firstFlagDate);return {...result,detectedCases:detected.length,totalCases:result.cases.length,dailyScenarioCoverage:result.annotatedDays?round(result.coveredDays/result.annotatedDays):null,flaggedDaysPer100SeniorDays:round(result.flags/result.seniorDays*100),meanDelayAfterOnsetDays:detected.length?round(detected.reduce((n,item)=>n+item.delayAfterOnsetDays,0)/detected.length):null};}),subgroups:[...subgroups.values()],ablation:metrics.ablation,clinicalPerformance:{precision:null,recall:null,f1:null,specificity:null,reason:'Synthetic positive scenarios are partial; unlabelled days are not confirmed negatives.'}};
}
const runs=[];
for(const seed of [1042026,1042027,1042028]){
  const cohort=generateRealisticCohort({seed});
  const quality=auditCohort(cohort);if(!quality.passed)throw new Error('Synthetic data quality failed.');
  for(const strategy of ['legacy-modulo','stratified-v1'])runs.push(evaluate(cohort,strategy));
}
const sourceFiles=['lib/engine.mjs','lib/personal-baseline.mjs','lib/evaluation-split.mjs','lib/initial-review.mjs','lib/triage.mjs','lib/realistic-cohort.mjs','lib/observation-merge.mjs','scripts/evaluate-representative.mjs'];
const hash=createHash('sha256');for(const path of sourceFiles)hash.update(path).update((await readFile(new URL('../'+path,import.meta.url),'utf8')).replaceAll('\r\n','\n'));
const report={schemaVersion:1,modelVersion:MODEL_INFO.version,modelSourceSha256:hash.digest('hex'),purpose:'Compare identical current algorithms across the legacy and profile-stratified identity splits. This is not an old-model/new-model accuracy comparison.',policy:{splitSeed:104,cohortSeeds:[1042026,1042027,1042028],thresholds:[30,60],labelUse:'Labels are read only after split assignment and scoring; no model or split seed search.',profileStrata:['gender','age band','recorded diabetes history']},runs,limitations:['All records and scenarios are synthetic, with no independent clinical outcomes.','A representative profile mix does not establish representative clinical outcomes or calibrated precision.','Different split strategies evaluate different seniors/cases; their coverage cannot be read as a performance gain.','The fixed representative split has only two authored scenarios; repeated generator seeds preserve those case identities and are not independent cases.','Daily observations are correlated. Unlabelled flags measure workload and cannot establish false alarms.']};
const previous=JSON.parse(await readFile(new URL('../docs/evaluation/personal-risk-v2.json',import.meta.url),'utf8'));
if(previous.modelVersion!=='personal-risk-v2'||previous.metadata.seed!==1042026||previous.metadata.endDate!=='2026-10-27')throw new Error('The fixed earlier checkpoint is incompatible.');
report.historicalComparison={before:{modelVersion:previous.modelVersion,sourceSha256:previous.modelSourceSha256,thresholds:previous.evaluation.thresholds.map(({threshold,coveredScenarioDays,scenarioDays,dailyScenarioCoverage,detectedCases,totalCases,meanDelayAfterOnsetDays,flaggedDaysPer100SeniorDays,unlabelledFlaggedSeniorDays})=>({threshold,coveredScenarioDays,scenarioDays,dailyScenarioCoverage,detectedCases,totalCases,meanDelayAfterOnsetDays,flaggedDaysPer100SeniorDays,unlabelledFlaggedSeniorDays}))},after:runs.find(run=>run.strategy==='legacy-modulo'&&run.cohortSeed===1042026).thresholds,meaning:'The earlier v2 snapshot and current legacy-modulo run retain the same cohort, identity roles and numeric thresholds. New language rules change cue features and refit/calibrate the forest. An average delay among detected cases is not directly comparable when the detected-case set changes.'};
const output=resolve(args[1]||'outputs/representative-evaluation.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({modelVersion:report.modelVersion,runs:runs.map(run=>({strategy:run.strategy,seed:run.cohortSeed,profiles:run.profiles.evaluation,thresholds:run.thresholds.map(({threshold,dailyScenarioCoverage,detectedCases,totalCases,meanDelayAfterOnsetDays,flaggedDaysPer100SeniorDays})=>({threshold,dailyScenarioCoverage,detectedCases,totalCases,meanDelayAfterOnsetDays,flaggedDaysPer100SeniorDays}))})),clinicalPerformanceEstablished:false},null,2));
