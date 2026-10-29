import {generateCohort,createEngine,DEMO_DATE,MODEL_INFO} from './engine.mjs';
import {generateRealisticCohort,createRealisticEngine} from './realistic-cohort.mjs';
const models=new Map();
/** Application defaults; explicit legacy mode remains available for reproducing its benchmark. */
export function showcaseEnvironment(env={}) {
  return {...env,SAMARTH_DATA_MODE:env.SAMARTH_DATA_MODE||'reference-informed',SAMARTH_COHORT_END:env.SAMARTH_COHORT_END||'2026-10-29'};
}
export function careModel(env={}) {
  const realistic=env.SAMARTH_DATA_MODE==='reference-informed';
  const splitStrategy=env.SAMARTH_MODEL_SPLIT||(realistic?'stratified-v1':'legacy-modulo');
  const endDate=env.SAMARTH_COHORT_END||DEMO_DATE,key=`${realistic?'reference-informed':'legacy'}:${endDate}:${splitStrategy}`;
  if(!models.has(key)) {
    const cohort=realistic?generateRealisticCohort({endDate}):generateCohort({endDate});
    const engine=realistic?createRealisticEngine(cohort,{splitStrategy}):createEngine(cohort,{splitStrategy});
    models.set(key,{cohort,engine,dataRevision:`${cohort.metadata?.generator||'legacy'}:${endDate}:${MODEL_INFO.version}:${splitStrategy}`});
  }
  return models.get(key);
}
