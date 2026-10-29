import {generateCohort,createEngine,DEMO_DATE} from './engine.mjs';
import {generateRealisticCohort,createRealisticEngine} from './realistic-cohort.mjs';
const models=new Map();
/** Application defaults; explicit legacy mode remains available for reproducing its benchmark. */
export function showcaseEnvironment(env={}) {
  return {...env,SAMARTH_DATA_MODE:env.SAMARTH_DATA_MODE||'reference-informed',SAMARTH_COHORT_END:env.SAMARTH_COHORT_END||'2026-10-29'};
}
export function careModel(env={}) {
  const realistic=env.SAMARTH_DATA_MODE==='reference-informed';
  const endDate=env.SAMARTH_COHORT_END||DEMO_DATE,key=`${realistic?'reference-informed':'legacy'}:${endDate}`;
  if(!models.has(key)) {
    const cohort=realistic?generateRealisticCohort({endDate}):generateCohort({endDate});
    const engine=realistic?createRealisticEngine(cohort):createEngine(cohort);
    models.set(key,{cohort,engine,dataRevision:`${cohort.metadata?.generator||'legacy'}:${endDate}`});
  }
  return models.get(key);
}
