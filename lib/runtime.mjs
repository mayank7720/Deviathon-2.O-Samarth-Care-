import { DEMO_DATE } from './engine.mjs';
import { workflow } from './workflow-store.mjs';

export const COHORT_START='2026-07-30';
export const TIMEZONE='Asia/Kolkata';
export function indiaDate(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}
export function validDate(value) {return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export async function readRuntime(db,owner,{now=new Date(),schedulerConfigured=false,cohortStart=COHORT_START,cohortEnd=DEMO_DATE,dataRevision='legacy'}={}) {
  const saved=await workflow(db,'runtime_get',{owner});
  const mode=saved?.mode==='live'?'live':'replay';
  const date=mode==='live'?indiaDate(now):saved?.as_of_date||cohortEnd;
  const job=await workflow(db,'job_get',{owner,id:`daily:${owner}:${date}`});
  return {mode,date,timezone:TIMEZONE,cohortStart,cohortEnd,dataRevision,schedulerConfigured,jobStatus:job?{status:job.status,completedAt:job.completed_at}:null};
}
export async function setRuntime(db,owner,input,options={}) {
  if(!['replay','live'].includes(input.mode)||input.mode==='replay'&&(!validDate(input.date)||input.date<(options.cohortStart||COHORT_START)||input.date>(options.cohortEnd||DEMO_DATE))) {
    const error=new Error('Choose live mode or a valid replay date inside the synthetic history.');error.status=400;throw error;
  }
  await workflow(db,'runtime_set',{owner,mode:input.mode,date:input.mode==='live'?indiaDate():input.date,timezone:TIMEZONE,updatedAt:new Date().toISOString()});
  return readRuntime(db,owner,options);
}
