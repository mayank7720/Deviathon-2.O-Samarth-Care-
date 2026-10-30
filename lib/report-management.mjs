import {createReportFacts,providerReportFacts} from './grounded-reports.mjs';
import {integrationHash} from './n8n-integration.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export const reportDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function reportPeriodEnd(value,asOfDate,cohortStart){
 const date=value||asOfDate;
 if(!reportDate(date)||date>asOfDate||cohortStart&&date<cohortStart)fail('Choose a real week-ending date within the available history, no later than the workspace date.');
 return date;
}
export async function prepareReportEvidence({senior,records,endDate,asOfDate,cohortStart,engine,dataKind}){
 let subject=senior;
 if(endDate!==asOfDate){
  subject=engine?.scoreSenior?{...engine.scoreSenior(senior.id,endDate,records.filter(r=>r.source==='user_recorded'||r._submitted===true)),familyConsent:senior.familyConsent}:{...senior,level:'unknown',urgency:'review',baseline:{},warmup:true};
 }
 if(cohortStart&&endDate<new Date(Date.parse(cohortStart+'T00:00:00Z')+29*86400000).toISOString().slice(0,10))subject={...subject,warmup:true};
 const facts=createReportFacts(subject,records,endDate,{dataKind}),factsHash=await integrationHash(providerReportFacts(facts));
 const coverage=facts.statements.find(s=>s.id==='coverage')?.values||{};
 return {subject,facts,factsHash,preview:{period:facts.period,dataKind:facts.dataKind,observedDays:coverage.observedDays||0,missingDays:coverage.missingDays||0,evidenceEntries:facts.evidence.length,factsHash,
  domains:[['Vitals',['systolic','diastolic','glucose','spo2','weight']],['Medication',['medication']],['Notes & cues',[]],['Activity & sleep',['activity','sleep']],['Sensors',['sensor']]].map(([label,fields])=>({label,entries:facts.evidence.filter(e=>label==='Notes & cues'?e.cues.length>0:e.fields.some(f=>fields.includes(f))).length})),
  statements:facts.statements.map(s=>({id:s.id,kind:s.kind,text:s.text})),warnings:[...(facts.evidence.length===0?['No usable observations in this week. Record an update before generating a summary.']:[]),...(coverage.missingDays>0?[`${coverage.missingDays} days have no usable entries. Missing days remain unknown.`]:[])]}};
}
export function validateReportAction(body){
 const common=['action','reportId','revision','idempotencyKey','note','checks','recipientIds'];
 if(!body||typeof body!=='object'||Object.keys(body).some(k=>!common.includes(k))||!['note','review','reject','reopen','archive','restore','share','withdraw'].includes(body.action)||typeof body.reportId!=='string'||!/^[A-Za-z0-9:_-]{1,240}$/u.test(body.reportId)||!Number.isSafeInteger(body.revision)||body.revision<0||!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/iu.test(body.idempotencyKey||''))fail('Use a saved report, current revision and a valid management action.');
 if(body.note!==undefined&&(typeof body.note!=='string'||body.note.length>2000))fail('Keep internal review notes within 2,000 characters.');
 if(['reject','withdraw'].includes(body.action)&&(!body.note||body.note.trim().length<5))fail('Record a reason in at least five characters.');
 if(body.action==='review'&&(!body.checks||Object.keys(body.checks).some(k=>!['evidence','uncertainty','noDiagnosis'].includes(k))||!['evidence','uncertainty','noDiagnosis'].every(k=>body.checks[k]===true)))fail('Complete all three review checks before marking the summary reviewed.');
 if(body.action==='share'&&(!Array.isArray(body.recipientIds)||body.recipientIds.length<1||body.recipientIds.length>20||new Set(body.recipientIds).size!==body.recipientIds.length||body.recipientIds.some(id=>typeof id!=='string'||!(/^[a-f\d-]{36}$/iu.test(id)))))fail('Choose one to twenty eligible linked family accounts.');
 return {...body,...(body.note!==undefined?{note:body.note.trim()}:{})};
}
