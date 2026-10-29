import {extractCues,classifyTriage,compareTriage} from './triage.mjs';
import {mergeDailyObservations} from './observation-merge.mjs';
const DAY=86400000;
const emptyBaseline=()=>Object.fromEntries(['systolic','diastolic','glucose','spo2','weight','activity','sleep'].map(key=>[key,null]));
/** New care records never inherit a fictional person's readings or fitted baseline. */
export function scoreRecordedSenior(profile,date,records=[]){
 const own=records.filter(r=>r?.seniorId===profile.id&&r.date<=date),daily=mergeDailyObservations(own,{seniorId:profile.id,asOfDate:date});
 const recent=daily.filter(r=>(Date.parse(date)-Date.parse(r.date))/DAY<3),latest=daily.at(-1)||null;
 const cues=[...new Map(recent.flatMap(r=>extractCues(r.note)).map(c=>[c.cue,c])).values()];
 const triage=classifyTriage({cues},own.filter(r=>(Date.parse(date)-Date.parse(r.date))/DAY<3));
 const concern=triage.immediateReview||cues.length>0;
 const score=triage.immediateReview?60:concern?30:null,level=triage.immediateReview?'high':concern?'medium':'unknown';
 const reasons=[...triage.triageEvidence.map(item=>({title:'A reported concern needs review',detail:item.detail,source:'notes'})),...cues.filter(c=>!triage.triageEvidence.some(t=>t.detail===c.evidence)).map(c=>({title:c.label,detail:c.evidence,source:'notes'})),{title:'Personal reference not established',detail:'Only this senior’s submitted observations are available. No synthetic history or population baseline has been assigned.',source:'data'}].slice(0,5);
 const fields=recent.reduce((n,r)=>n+Object.values(r.vitals||{}).filter(Number.isFinite).length+Number(!!r.note)+Number(!!r.medication),0);
 return {...profile,baseline:emptyBaseline(),asOfDate:date,score,level,warmup:true,cues,reasons,action:triage.immediateReview?triage.triageAction:concern?'Contact the senior to review the reported change and agree a follow-up.':'Record an initial check-in and establish this senior’s personal reference.',
 ...classifyTriage({cues,score,level,warmup:true},own.filter(r=>(Date.parse(date)-Date.parse(r.date))/DAY<3)),
 anomalyScore:null,confidence:Math.min(100,Math.round(fields/27*100)),latest,lastCheckIn:latest?.date||null,adherence:latest?.medication?.prescribed>0?Math.round(latest.medication.taken/latest.medication.prescribed*100):null,
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
