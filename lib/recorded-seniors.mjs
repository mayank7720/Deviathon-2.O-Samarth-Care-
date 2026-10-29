import {compareTriage} from './triage.mjs';
import {createEngine} from './engine.mjs';
import {mergeDailyObservations,observationRecords} from './observation-merge.mjs';
import {SIGNALS,personalReference,signalValue,validMedication,medicationCounts} from './personal-baseline.mjs';
import {initialReview} from './initial-review.mjs';
const DAY=86400000;
const emptyBaseline=()=>Object.fromEntries(['systolic','diastolic','glucose','spo2','weight','activity','sleep'].map(key=>[key,null]));
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
/** New care records never inherit a fictional person's readings or fitted baseline. */
export function scoreRecordedSenior(profile,date,records=[]){
 if(!validDate(date))throw new Error('Invalid observation date');
 const own=observationRecords(records.filter(r=>r?.seniorId===profile.id&&r.provenance?.synthetic!==true&&r.dataProvenance?.synthetic!==true&&r.synthetic!==true),{seniorId:profile.id,asOfDate:date}),daily=mergeDailyObservations(own,{seniorId:profile.id,asOfDate:date});
 const startDate=daily[0]?.date,elapsed=startDate?(Date.parse(date)-Date.parse(startDate))/DAY:0;
 const baselineRows=startDate?daily.filter(r=>(Date.parse(r.date)-Date.parse(startDate))/DAY<30):[];
 const reference=personalReference(baselineRows);
 const referenceReady=elapsed>=30&&baselineRows.length>=7&&Object.values(reference.support).filter(item=>item.supported).length>=2;
 if(referenceReady){
  // A single senior cannot supply identity-separated forest calibration. Run
  // measured personal rules and repeated-change detection without borrowing a
  // synthetic cohort or claiming a fitted anomaly model. No process-wide cache
  // retains care records; the temporary engine belongs to this score request.
  const engine=createEngine({seniors:[{...profile,baseline:emptyBaseline()}],records:own,groundTruth:[],metadata:{startDate,endDate:date,days:elapsed+1,seniorCount:1,dataType:'Submitted care observations',synthetic:false}},{modelEnabled:false});
  const scored=engine.scoreSenior(profile.id,date);
  return {...scored,model:{...scored.model,name:'Measured personal-baseline rules and repeated changes',trainingSamples:0,status:'personal_reference_ready',limitation:'No independent cohort is available to fit and calibrate an anomaly model for this recorded senior.'},dataProvenance:{...profile.dataProvenance,kind:'recorded',synthetic:false}};
 }
 const recent=daily.filter(r=>(Date.parse(date)-Date.parse(r.date))/DAY<3),latest=daily.at(-1)||null;
 const fields=recent.reduce((n,r)=>n+Object.keys(SIGNALS).filter(key=>signalValue(r,key)!==null).length+Number(!!r.note)+Number(validMedication(r.medication)),0);
 const latestDoses=medicationCounts(latest?.medication);
 return {...profile,baseline:emptyBaseline(),asOfDate:date,warmup:true,
 ...initialReview(recent,own.filter(r=>(Date.parse(date)-Date.parse(r.date))/DAY<3)),
 anomalyScore:null,confidence:Math.min(100,Math.round(fields/27*100)),latest,lastCheckIn:latest?.date||null,adherence:validMedication(latest?.medication)?Math.round(latestDoses.taken/latestDoses.prescribed*100):null,
 current:{...emptyBaseline(),...latest?.vitals,activity:latest?.activity??null,sleep:latest?.sleep??null},
 dataFreshness:{ageDays:latest?Math.max(0,Math.round((Date.parse(date)-Date.parse(latest.date))/DAY)):null,observedSignals:fields,expectedSignals:27,sufficientSupport:false,label:'Personal reference pending'},
 model:{name:'Recorded-signal rules; personal model pending',status:'not_fitted_for_this_senior',trainingSamples:0,trees:0,features:0},
 trend:daily.filter(r=>(Date.parse(date)-Date.parse(r.date))/DAY<14).map(r=>({date:r.date,score:null})),dataProvenance:{...profile.dataProvenance,kind:'recorded',synthetic:false}};
}
export async function workspaceCareModel(db,base){
 if(typeof db.recordedProfiles!=='function')return base;
 const profiles=await db.recordedProfiles();
 if(!Array.isArray(profiles))throw Object.assign(new Error('The senior directory could not be loaded.'),{status:503});
 const fresh=profiles.filter(p=>/^S\d{3,6}$/.test(p.id||'')&&!base.cohort.seniors.some(s=>s.id===p.id)&&p.dataProvenance?.kind==='recorded');
 if(!fresh.length)return base;
 const byId=new Map(fresh.map(p=>[p.id,{...p,conditions:p.conditions||[],family:p.family||{},baseline:emptyBaseline(),phone:'Not assigned',coordinator:p.coordinator||'Awaiting care assignment'}]));
 const cohort={...base.cohort,seniors:[...base.cohort.seniors,...byId.values()],metadata:{...base.cohort.metadata,recordedSeniorCount:fresh.length}};
 const scoreSenior=(id,date,extras=[])=>byId.has(id)?scoreRecordedSenior(byId.get(id),date,extras):base.engine.scoreSenior(id,date,extras);
 return {...base,cohort,engine:{...base.engine,cohort,scoreSenior,rankSeniors:(date,extras=[])=>cohort.seniors.map(s=>scoreSenior(s.id,date,extras)).sort(compareTriage)},dataRevision:base.dataRevision+':recorded:'+fresh.map(p=>p.id+':'+p.updatedAt).sort().join('|')};
}
