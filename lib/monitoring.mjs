import {mergeSeniorRecords,medicationAnalysis} from './analytics.mjs';
import {medicationCounts} from './personal-baseline.mjs';
const dayMs=86400000;
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
/** Calendar-complete chart data. Gaps remain null; no generated healthy values. */
export function monitoringSnapshot(senior,records,asOfDate,windowDays=30){
 if(![7,30,90].includes(windowDays))throw Object.assign(Error('Choose 7, 30 or 90 days.'),{status:400});
 const end=Date.parse(asOfDate+'T00:00:00Z');
 if(!Number.isFinite(end)||new Date(end).toISOString().slice(0,10)!==asOfDate)throw Object.assign(Error('Use a valid monitoring date.'),{status:400});
 const merged=mergeSeniorRecords({...senior,asOfDate},records),byDate=new Map(merged.map(r=>[r.date,r]));
 const points=Array.from({length:windowDays},(_,index)=>{const date=new Date(end-(windowDays-1-index)*dayMs).toISOString().slice(0,10);const r=byDate.get(date);const hasMedication=!!r?.medication;const m=hasMedication?medicationCounts(r.medication):null;
  return {date,observed:!!r,systolic:number(r?.vitals?.systolic),diastolic:number(r?.vitals?.diastolic),glucose:number(r?.vitals?.glucose),spo2:number(r?.vitals?.spo2),weight:number(r?.vitals?.weight),taken:m?m.invalid?0:m.taken:null,missed:m?m.invalid?0:Math.max(0,m.prescribed-m.taken):null,unknown:m?m.invalid?m.scheduled:m.unresolved:null,hasMedication};});
 const windowRecords=points.flatMap(p=>byDate.has(p.date)?[byDate.get(p.date)]:[]),medication=medicationAnalysis(windowRecords),last=points.at(-1);
 return {period:{from:points[0].date,to:asOfDate,days:windowDays},observedDays:points.filter(p=>p.observed).length,missingDays:points.filter(p=>!p.observed).length,points,medication:{...medication,loggedDays:points.filter(p=>p.hasMedication).length,unloggedDays:points.filter(p=>!p.hasMedication).length,currentMissedStreak:last?.hasMedication?medication.currentMissedStreak:0},basis:'Dated recorded observations; missing values are not interpolated.',synthetic:senior.dataProvenance?.synthetic===true||senior.dataProvenance?.kind==='synthetic'};
}

export {medicationBuckets} from './medication-chart-data.mjs';
