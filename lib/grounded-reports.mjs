/** Evidence-locked weekly reports. Models choose supported statements; they cannot invent facts. */
import { extractCues } from './triage.mjs';
import {medicationCounts} from './personal-baseline.mjs';
import {compareObservations} from './observation-merge.mjs';

const DAY=86400000;
const finite=Number.isFinite;
const round=(value,digits=1)=>finite(value)?Math.round(value*10**digits)/10**digits:null;
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&finite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const addDays=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
const unique=values=>[...new Set(values)];
const dayWord=count=>count===1?'day':'days';
const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
const safeKind=value=>['synthetic','user_recorded','imported_recorded'].includes(value)?value:'unspecified';
const check=(ok,message)=>{if(!ok)throw new ReportError(message);};
export class ReportError extends Error {constructor(message,status=400){super(message);this.name='ReportError';this.status=status;}}

export const REPORT_COPY=Object.freeze({
  en:{openings:{warm:'Here is a gentle update from the available wellbeing entries.',plain:'This update summarises the recorded wellbeing entries.'},closings:{supportive:'A familiar conversation and an agreed care plan can help the team understand what support is needed.',brief:'Please share any new concerns with the care coordinator.'},actions:{routine:'Continue the agreed check-ins and care plan.',checkin:'Arrange a check-in to clarify changes and collect missing information.',prompt:'Contact the senior promptly, verify the report, and agree the next step with the care team.'},limitation:'This update describes available records. It is not a diagnosis or a prediction of illness.'},
  hi:{openings:{warm:'उपलब्ध रोज़मर्रा की जानकारी से यह छोटा, सहज अपडेट है।',plain:'यह अपडेट दर्ज की गई सेहत और दिनचर्या की जानकारी का सार है।'},closings:{supportive:'अपनों से बातचीत और तय देखभाल योजना से टीम को ज़रूरी सहायता समझने में मदद मिल सकती है।',brief:'कोई नई परेशानी हो तो केयर कोऑर्डिनेटर को बताएँ।'},actions:{routine:'तय समय पर संपर्क और देखभाल योजना जारी रखें।',checkin:'बदलाव समझने और छूटी जानकारी लेने के लिए बात करने का समय तय करें।',prompt:'वरिष्ठ सदस्य से जल्द संपर्क करें, जानकारी की पुष्टि करें और देखभाल टीम के साथ अगला कदम तय करें।'},limitation:'यह अपडेट उपलब्ध जानकारी का वर्णन है। यह बीमारी का निदान या भविष्यवाणी नहीं है।'}
});

/** Local evidence includes source references; providerFacts deliberately excludes identifiers and notes. */
export function createReportFacts(senior,records,asOfDate,{days=7,dataKind}={}) {
  check(senior&&typeof senior.id==='string','A scored senior is required.');
  check(validDate(asOfDate),'Use a real as-of calendar date.');
  check(Number.isInteger(days)&&days>=3&&days<=14,'Report windows must be 3–14 days.');
  const from=addDays(asOfDate,1-days),daily=new Map(),evidence=[];
  const ordered=(Array.isArray(records)?records:[]).map((record,index)=>({record,index})).filter(({record})=>record&&record.seniorId===senior.id&&validDate(record.date)&&record.date>=from&&record.date<=asOfDate).sort((a,b)=>compareObservations(a.record,b.record));
  for(const {index,record} of ordered) {
    if(!record||record.seniorId!==senior.id||!validDate(record.date)||record.date<from||record.date>asOfDate)continue;
    const values={};
    for(const [name,range] of Object.entries({systolic:[50,280],diastolic:[25,180],glucose:[20,700],spo2:[40,100],weight:[20,250]})) {
      const value=record.vitals?.[name];if(finite(value)&&value>=range[0]&&value<=range[1])values[name]=value;
    }
    const activity=record.sensor?.steps??record.lifestyle?.steps??record.activity;
    const sleep=record.lifestyle?.sleepHours??record.sleep;
    if(finite(activity)&&activity>=0&&activity<=50000)values.activity=activity;
    if(finite(sleep)&&sleep>=0&&sleep<=24)values.sleep=sleep;
    const medication=record.medication;
    if(medication&&typeof medication==='object') {
      const counts=medicationCounts(medication);
      if(counts.scheduled>0||counts.invalid)values.medication=counts;
    }
    const cues=typeof record.note==='string'?unique(extractCues(record.note).map(cue=>cue.cue)):[];
    const sensor={...(record.sensor?.fallDetected===true?{possibleFall:true}:{}),...(finite(record.sensor?.inactiveMinutes)&&record.sensor.inactiveMinutes>=0&&record.sensor.inactiveMinutes<=1440?{inactiveMinutes:record.sensor.inactiveMinutes}:{})};
    if(Object.keys(sensor).length)values.sensor=sensor;
    if(!Object.keys(values).length&&!cues.length)continue;
    const id=`E${String(evidence.length+1).padStart(3,'0')}`;
    evidence.push({id,date:record.date,sourceRecordId:typeof record.id==='string'?record.id:`input-row:${index}`,sourceIndex:index,fields:Object.keys(values),cues});
    const prior=daily.get(record.date)||{date:record.date,values:{},sources:{},cues:new Map()};
    for(const [key,value] of Object.entries(values)){
      if(key==='sensor'&&prior.values.sensor?.possibleFall){prior.values.sensor={...value,possibleFall:true};prior.sources.sensor=unique([...(prior.sources.sensor||[]),id]);}
      else {prior.values[key]=value;prior.sources[key]=[id];}
    }
    for(const cue of cues)prior.cues.set(cue,unique([...(prior.cues.get(cue)||[]),id]));
    daily.set(record.date,prior);
  }
  const rows=[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)),statements=[];
  const add=(id,kind,values,sourceIds,en,hi)=>statements.push({id,kind,values,sourceIds:unique(sourceIds),text:{en,hi}});
  const allSources=evidence.map(row=>row.id),observedDays=rows.length;
  add('coverage','coverage',{observedDays,windowDays:days,missingDays:days-observedDays},allSources,`Usable wellbeing entries were recorded on ${observedDays} of ${days} days; ${days-observedDays} ${dayWord(days-observedDays)} ${days-observedDays===1?'has':'have'} no usable entry.`,`काम की जानकारी ${days} में से ${observedDays} दिनों पर दर्ज है; ${days-observedDays} दिनों की जानकारी उपलब्ध नहीं है।`);
  for(const [field,label,unit,hiLabel,hiUnit,digits] of [
    ['systolic','Systolic blood-pressure readings','mmHg','सिस्टोलिक रक्तचाप की रीडिंग','mmHg',1],
    ['diastolic','Diastolic blood-pressure readings','mmHg','डायस्टोलिक रक्तचाप की रीडिंग','mmHg',1],
    ['glucose','Recorded blood-sugar readings','mg/dL','दर्ज रक्त शर्करा की रीडिंग','mg/dL',1],
    ['spo2','Recorded oxygen-saturation readings','%','दर्ज ऑक्सीजन सैचुरेशन की रीडिंग','%',1],
    ['weight','Recorded weight','kg','दर्ज वज़न','kg',1],
    ['activity','Recorded activity','steps/day','दर्ज गतिविधि','कदम/दिन',0],
    ['sleep','Recorded sleep duration','hours/night','दर्ज नींद की अवधि','घंटे/रात',1]
  ]) {
    const selected=rows.filter(row=>finite(row.values[field]));if(!selected.length)continue;
    const numbers=selected.map(row=>row.values[field]),average=round(mean(numbers),digits),minimum=round(Math.min(...numbers),digits),maximum=round(Math.max(...numbers),digits),sources=selected.flatMap(row=>row.sources[field]);
    add(field,'measurement',{average,minimum,maximum,observedDays:selected.length,unit},sources,`${label} averaged ${average} ${unit} across ${selected.length} logged ${dayWord(selected.length)} (range ${minimum}–${maximum} ${unit}).`,`${hiLabel} का औसत ${average} ${hiUnit} है; ${selected.length} दिनों की रेंज ${minimum}–${maximum} ${hiUnit} है।`);
    const baseline=senior.warmup?null:senior.baseline?.[field];
    if(finite(baseline)) {
      const change=round(average-baseline,digits),direction=change>0?'above':change<0?'below':'equal to';
      add(`${field}_baseline`,'personal_comparison',{average,baseline,change,unit},sources,`The logged ${field==='activity'?'activity':field==='sleep'?'sleep':field} average was ${Math.abs(change)} ${unit} ${direction} the personal reference of ${baseline} ${unit}.`,`दर्ज ${hiLabel} का औसत व्यक्तिगत संदर्भ ${baseline} ${hiUnit} से ${Math.abs(change)} ${hiUnit} ${change>0?'ऊपर':change<0?'नीचे':'के बराबर'} है।`);
    }
  }
  const medicineRows=rows.filter(row=>row.values.medication);
  if(medicineRows.length) {
    const resolvedRows=medicineRows.filter(row=>!row.values.medication.invalid&&row.values.medication.prescribed>0);
    const taken=resolvedRows.reduce((sum,row)=>sum+row.values.medication.taken,0),scheduled=resolvedRows.reduce((sum,row)=>sum+row.values.medication.prescribed,0),missed=scheduled-taken;
    if(scheduled>0)add('medication','medication',{taken,scheduled,missed,adherencePercent:round(taken/scheduled*100,1),loggedDays:resolvedRows.length},resolvedRows.flatMap(row=>row.sources.medication),`On ${resolvedRows.length} ${dayWord(resolvedRows.length)} with resolved medication logs, ${taken} of ${scheduled} resolved logged doses were recorded as taken; ${missed} were not recorded as taken. Pending outcomes and missing days are excluded.`,`दवा के ${resolvedRows.length} दिनों के स्पष्ट लॉग में ${scheduled} ज्ञात नतीजों वाली खुराकों में ${taken} ली हुई दर्ज हैं; ${missed} ली हुई दर्ज नहीं हैं। लंबित नतीजे और बिना लॉग के दिन इसमें शामिल नहीं हैं।`);
    const unresolved=medicineRows.reduce((sum,row)=>sum+(row.values.medication.invalid?row.values.medication.scheduled:row.values.medication.unresolved),0);
    if(unresolved>0)add('medication_unknown','data_quality',{unresolvedDoses:unresolved},medicineRows.filter(row=>row.values.medication.unresolved>0||row.values.medication.invalid).flatMap(row=>row.sources.medication),`${unresolved} scheduled medication dose outcomes remain unknown and are excluded from adherence.`,`${unresolved} तय दवा खुराकों के नतीजे अज्ञात हैं और अनुपालन गणना में शामिल नहीं हैं।`);
    const invalid=medicineRows.filter(row=>row.values.medication.invalid);
    if(invalid.length)add('medication_quality','data_quality',{inconsistentDays:invalid.length},invalid.flatMap(row=>row.sources.medication),`${invalid.length} medication log days contain inconsistent totals or statuses; the care team should correct the records.`,`${invalid.length} दिनों के दवा लॉग में कुल संख्या या स्थिति में असंगति है; देखभाल टीम रिकॉर्ड की जाँच करे।`);
  }
  const cueNames={pain:['pain','दर्द'],poor_sleep:['reduced or disturbed sleep','कम या बाधित नींद'],low_appetite:['eating less','कम खाना'],loneliness:['loneliness','अकेलापन'],confusion:['confusion','उलझन'],fall:['a possible fall','संभावित गिरना'],missed_medication:['missed medication','दवा छूटना'],fatigue:['tiredness','थकान'],chest_pain:['chest discomfort','सीने में परेशानी'],breathlessness:['breathing difficulty','साँस लेने में परेशानी']};
  for(const [cue,[en,hi]] of Object.entries(cueNames)) {
    const selected=rows.filter(row=>row.cues.has(cue));if(!selected.length)continue;
    add(`cue_${cue}`,'reported_cue',{cue,reportedDays:selected.length},selected.flatMap(row=>row.cues.get(cue)),`Check-in notes mention ${en} on ${selected.length} recorded ${dayWord(selected.length)}; the care team should verify this report.`,`चेक-इन में ${selected.length} दर्ज दिनों पर ${hi} का उल्लेख है; देखभाल टीम को इसकी पुष्टि करनी चाहिए।`);
  }
  const possibleFalls=rows.filter(row=>row.values.sensor?.possibleFall);
  if(possibleFalls.length)add('sensor_possible_fall','sensor',{reportedDays:possibleFalls.length},possibleFalls.flatMap(row=>row.sources.sensor),`A device reported a possible fall on ${possibleFalls.length} ${dayWord(possibleFalls.length)}. This is an unconfirmed sensor signal.`,`डिवाइस ने ${possibleFalls.length} दिनों पर संभावित गिरने का संकेत दिया। यह सेंसर की अपुष्ट सूचना है।`);
  const priority=['high','medium','low','unknown'].includes(senior.level)?senior.level:'unknown';
  const requiredAction=senior.urgency==='immediate'?'prompt':priority==='unknown'||priority==='high'||priority==='medium'||observedDays<days?'checkin':'routine';
  return {version:'samarth.report-facts.v1',period:{from,to:asOfDate,days},dataKind:safeKind(dataKind??senior.dataProvenance?.kind),priority,requiredAction,statements,evidence,localSubjectReference:senior.id,limitations:['Describes recorded observations; not a diagnosis or future-event prediction.','Missing days do not imply usual wellbeing or medicine adherence.','Note and sensor cues need human verification.'],derivedHealthData:true};
}

/** Explicit whitelist; direct identity, raw note text and source IDs cannot pass through. */
export function providerReportFacts(facts) {
  check(facts?.version==='samarth.report-facts.v1','Unsupported report facts.');
  return {version:facts.version,period:{...facts.period},dataKind:facts.dataKind,priority:facts.priority,requiredAction:facts.requiredAction,statements:facts.statements.map(({id,kind,values,sourceIds,text})=>({id,kind,values:structuredClone(values),sourceIds:[...sourceIds],text:{...text}})),limitations:[...facts.limitations],privacy:'Masked derived health aggregates; no direct identifiers or raw notes. These values remain sensitive.'};
}
export function reportPlanSchema(facts,language='en') {
  check(['en','hi'].includes(language),'Choose English or Hindi.');
  return {type:'object',additionalProperties:false,required:['version','language','opening','highlights','nextStep','closing'],properties:{version:{type:'integer',enum:[1]},language:{type:'string',enum:[language]},opening:{type:'string',enum:['warm','plain']},highlights:{type:'array',minItems:1,maxItems:10,items:{type:'object',additionalProperties:false,required:['factId'],properties:{factId:{type:'string',enum:facts.statements.map(f=>f.id)}}}},nextStep:{type:'string',enum:[facts.requiredAction]},closing:{type:'string',enum:['supportive','brief']}}};
}
export function validateGeneratedReport(candidate,facts,{language='en'}={}) {
  const errors=[];
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))return {valid:false,errors:['Expected a structured report plan.']};
  const fields=['version','language','opening','highlights','nextStep','closing'];
  if(Object.keys(candidate).some(key=>!fields.includes(key)))errors.push('Unconstrained report text or unsupported fields are not accepted.');
  if(candidate.version!==1||candidate.language!==language||!REPORT_COPY[language])errors.push('Report version or language does not match the request.');
  if(!['warm','plain'].includes(candidate.opening)||!['supportive','brief'].includes(candidate.closing))errors.push('Use supported introductory and closing language.');
  if(candidate.nextStep!==facts.requiredAction)errors.push('A model cannot reduce the required human follow-up.');
  const ids=[];
  if(!Array.isArray(candidate.highlights)||candidate.highlights.length<1||candidate.highlights.length>10)errors.push('Select between one and ten evidence-backed statements.');
  else for(const item of candidate.highlights) {
    if(!item||typeof item!=='object'||Object.keys(item).some(key=>key!=='factId')||!facts.statements.some(fact=>fact.id===item.factId))errors.push('Each highlight must select an existing fact ID without new text or numbers.');
    else ids.push(item.factId);
  }
  if(new Set(ids).size!==ids.length)errors.push('Duplicate highlights are not accepted.');
  if(!ids.includes('coverage'))errors.push('Every report must disclose missing information.');
  const required=facts.statements.filter(f=>['cue_fall','cue_chest_pain','cue_breathlessness','sensor_possible_fall','medication_unknown','medication_quality'].includes(f.id)).map(f=>f.id);
  if(required.some(id=>!ids.includes(id)))errors.push('A report cannot omit a recorded immediate-review cue or medication uncertainty.');
  if(errors.length)return {valid:false,errors};
  const copy=REPORT_COPY[language],selected=ids.map(id=>facts.statements.find(f=>f.id===id));
  return {valid:true,errors:[],report:{version:'samarth.grounded-report.v1',language,period:{...facts.period},dataKind:facts.dataKind,text:[copy.openings[candidate.opening],...selected.map(f=>f.text[language]),copy.actions[candidate.nextStep],copy.closings[candidate.closing],copy.limitation].join(' '),highlights:selected.map(f=>({factId:f.id,text:f.text[language],evidenceIds:[...f.sourceIds]})),nextStep:copy.actions[candidate.nextStep],requiresHumanReview:true,clinicalPrediction:false,grounding:{mode:'evidence-locked statements',selectedFacts:ids,totalAvailableFacts:facts.statements.length,unconstrainedModelTextAccepted:false}}};
}
export function deterministicReportPlan(facts,language='en') {
  const urgent=facts.statements.filter(f=>['cue_fall','cue_chest_pain','cue_breathlessness','sensor_possible_fall','medication_unknown','medication_quality'].includes(f.id));
  const ids=unique(['coverage',...urgent.map(f=>f.id),...['medication','sleep','activity','weight','systolic','glucose','spo2'].filter(id=>facts.statements.some(f=>f.id===id))]).slice(0,10);
  return {version:1,language,opening:'warm',highlights:ids.map(factId=>({factId})),nextStep:facts.requiredAction,closing:'supportive'};
}
export async function generateGroundedReport({senior,records,asOfDate,language='en',provider,dataKind,providerName='configured model',model='configured model',allowExternalProcessing=false}) {
  const facts=createReportFacts(senior,records,asOfDate,{dataKind});
  let plan,reason=null,llmUsed=false;
  if(typeof provider==='function'&&allowExternalProcessing) {
    try {
      const candidate=await provider({facts:providerReportFacts(facts),schema:reportPlanSchema(facts,language),language,instruction:'Select a warm, plain-language weekly report using only the supplied fact IDs. Always include coverage and immediate-review facts. Do not add text, numbers, diagnoses, certainty, or facts. Preserve the required nextStep.'});
      const checked=validateGeneratedReport(candidate,facts,{language});
      if(!checked.valid)throw new ReportError('The model output did not pass evidence validation.');
      plan=candidate;llmUsed=true;
    }catch{reason='Model output was unavailable or failed evidence validation; a measured-data report was used.';}
  } else reason=typeof provider==='function'?'External model processing has not been enabled.':'No report model is configured.';
  plan??=deterministicReportPlan(facts,language);
  const checked=validateGeneratedReport(plan,facts,{language});
  check(checked.valid,'Unable to render an evidence-backed report.');
  return {...checked.report,method:llmUsed?'LLM-guided evidence-locked weekly report':'Computed evidence report (no LLM)',generation:{llmUsed,provider:llmUsed?String(providerName).slice(0,80):null,model:llmUsed?String(model).slice(0,120):null,fallbackReason:reason},facts,evidence:structuredClone(facts.evidence)};
}
