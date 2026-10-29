/** Reference-informed synthetic longitudinal signals. Never observed patients. */
import { createEngine,DEMO_DATE } from './engine.mjs';
import reference from '../data/reference/synthea-calibration.json' with { type: 'json' };

const DAY=86400000;
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const round=(v,precision=1)=>Math.round(v*10**precision)/10**precision;
function seeded(seed){let state=seed>>>0;return()=>{state+=0x6D2B79F5;let x=Math.imul(state^(state>>>15),1|state);x^=x+Math.imul(x^(x>>>7),61|x);return((x^(x>>>14))>>>0)/4294967296;};}
const normal=random=>Math.sqrt(-2*Math.log(Math.max(.000001,random())))*Math.cos(2*Math.PI*random());
const referenceValue=(key,z,fallback)=>{const r=reference.distributions[key];return r?.available?r.median+z*(r.p90-r.p10)/2.563:fallback;};
function phase(day,episode,startMs){
  if(!episode)return 0;
  const onset=Math.round((Date.parse(episode.onsetDate)-startMs)/DAY),end=Math.round((Date.parse(episode.declineEndDate||episode.endDate)-startMs)/DAY);
  if(day<onset)return 0;
  if(day<=end)return Math.min(1,(day-onset+1)/9);
  return Math.max(0,1-(day-end)/14);
}
const familiarNotes={en:['Enjoyed a usual breakfast and spoke with family.','A routine check-in was completed. Appetite and rest felt usual.','Plans a short walk with company today.','Reading and listening to music at home.'],hi:['आज खाना और दिनचर्या सामान्य रही। परिवार से बात हुई।','नियमित हालचाल पूछा गया। भूख और आराम सामान्य रहे।','आज घर पर संगीत सुना और पढ़ाई की।'],hinglish:['Aaj routine usual tha. Family se baat hui.','Khana aur neend usual thi. Thodi der walk ki.']};
const firstNames=['Meera','Rajesh','Kamala','Arun','Sunita','Mohan','Lakshmi','Suresh','Asha','Vijay','Savita','Prakash','Usha','Anil','Shanti','Ramesh','Leela','Harish','Padma','Dinesh'];
const surnames=['Sharma','Nair','Desai','Kapoor','Rao','Iyer','Joshi','Singh','Mehta','Patel'];
function fictionalProfile(index){
  const diabetic=index%4===1||index%11===0,surname=surnames[Math.floor(index/20)%surnames.length];
  return {id:`S${String(index+1).padStart(3,'0')}`,name:`${firstNames[index%20]} ${surname}${index>=200?' '+(Math.floor(index/200)+1):''}`,age:62+(index*7%27),gender:index%2?'Male':'Female',city:['Delhi','Pune','Bengaluru','Mumbai','Jaipur'][index%5],language:index%3?'Hindi':'English',coordinator:['Ananya Verma','Kavya Menon','Rohan Shah'][index%3],phone:`+91 ••••• •${String(1000+index).slice(-4)}`,family:{name:['Riya','Aditya','Neha','Rahul'][index%4]+' '+surname,relation:index%2?'Son':'Daughter'},familyConsent:index%7!==6,conditions:[...(diabetic?['Diabetes history']:[]),...(index%3===0?['Blood-pressure monitoring']:[]),...(index%8===0?['Joint discomfort history']:[])]};
}

export const REALISTIC_DATA_INFO=Object.freeze({
  id:'reference-informed-v1',synthetic:true,
  title:'Reference-informed synthetic senior care scenarios',
  source:reference.source,
  basis:'Blood pressure, non-diabetes glucose and body-weight reference distributions come from per-person medians in the public MITRE Synthea sample at observation age 60-110. Every identity and daily signal below is newly simulated.',
  authoredAssumptions:['Eight percent of identities receive deliberately planted review scenarios for stress testing; this is not a prevalence estimate.','Daily serial correlation, measurement schedules, symptom wording, medication-taking, activity and sleep are authored assumptions.','The reference is synthetic US EHR data, not an Indian geriatric or longitudinal home-care outcomes cohort.','SpO2 and treatment-history subgroups are illustrative because compatible reference observations are unavailable.'],
  validation:'Data-quality and synthetic identity-held-out checks; no patient-outcome validation or diagnostic probabilities.'
});

/**
 * Backwards compatible independent mode: legacy benchmark remains unchanged.
 * Root callers can select this generator for the public demonstration.
 */
export function generateRealisticCohort({seed=1042026,endDate=DEMO_DATE,seniorCount=200,days=90,languageVariant='standard',scenarioFraction=.08}={}){
  if(!Number.isFinite(scenarioFraction)||scenarioFraction<0||scenarioFraction>.25)throw new Error('Scenario fraction must be from 0 to 0.25.');
  if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('Seed must be an unsigned 32-bit integer.');
  if(!Number.isInteger(seniorCount)||seniorCount<1||seniorCount>10000)throw new Error('Senior count must be from 1 to 10000.');
  if(!Number.isInteger(days)||days<45||days>730)throw new Error('Choose 45-730 days including baseline warm-up.');
  if(!['standard','held-out-phrases'].includes(languageVariant))throw new Error('Choose a supported phrase variant.');
  if(typeof endDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||!Number.isFinite(Date.parse(endDate))||new Date(endDate+'T00:00:00Z').toISOString().slice(0,10)!==endDate)throw new Error('Choose a real cohort end date.');
  const random=seeded(seed^0x5EED2026),startMs=Date.parse(endDate+'T00:00:00Z')-(days-1)*DAY;
  const dateAt=day=>new Date(startMs+day*DAY).toISOString().slice(0,10);
  const count=Math.round(seniorCount*scenarioFraction),records=[],groundTruth=[],events=[];
  const seniors=Array.from({length:seniorCount},(_,index)=>{
    const original=fictionalProfile(index);
    const diabetes=original.conditions.includes('Diabetes history'),pressureHistory=original.conditions.includes('Blood-pressure monitoring');
    const body=normal(random),pressure=normal(random);
    const baseline={
      systolic:round(clamp(referenceValue('systolic',pressure,125)+(pressureHistory?15:0)+(original.age-70)*.18,100,165)),
      diastolic:round(clamp(referenceValue('diastolic',pressure*.5+normal(random)*.5,78),60,100)),
      glucose:round(diabetes?clamp(133+normal(random)*14,100,185):clamp(referenceValue('glucose',normal(random),90),72,115)),
      spo2:round(97.2+random()*1.2),weight:round(clamp(referenceValue('weight',body,70),48,115)),
      activity:Math.round(clamp(4400-(original.age-65)*65+normal(random)*800,1100,7000)),sleep:round(clamp(7.2+normal(random)*.5,5.5,8.7))
    };
    const profile={...original,baseline,dataProvenance:{kind:'synthetic',generator:REALISTIC_DATA_INFO.id,referenceSha256:reference.source.archiveSha256}};
    let episode=null;
    if(index<count){
      const pattern=['multisignal','medication','appetite','mobility'][Math.floor(index/4)%4];
      const active=Math.floor(index/4)%2?index%4>=2:index%4<2;
      const onset=active?Math.max(31,days-15)+(index%4):Math.max(31,Math.floor(days*.43))+(index*3%12);
      const end=active?days-1:Math.min(days-16,onset+12+index%5);
      if(end>=onset){episode={seniorId:profile.id,pattern,onsetDate:dateAt(onset),criticalDate:dateAt(Math.min(days-1,onset+10)),escalationDate:dateAt(Math.min(days-1,onset+10)),escalationMeaning:'Authored review deadline, not an observed acute event.',declineEndDate:dateAt(end),endDate:dateAt(Math.min(days-1,end+13)),labelMeaning:'Review scenario includes persistent changes during gradual recovery; it is not a disease label.',split:index%4===3?'held-out':'development'};groundTruth.push(episode);}
    }
    const language=index%3===0?'en':index%3===1?'hi':'hinglish';
    let pressureState=0,glucoseState=0,activityState=0,sleepState=0,weightState=0,priorWeight=baseline.weight,priorDoses=null;
    const fallDate=episode?.pattern==='mobility'?dateAt(Math.min(days-1,Math.round((Date.parse(episode.onsetDate)-startMs)/DAY)+3)):null;
    if(fallDate)events.push({id:`incident-${profile.id}-${fallDate}`,seniorId:profile.id,date:fallDate,type:'reported_fall',synthetic:true,confirmed:false});
    for(let day=0;day<days;day++){
      const date=dateAt(day),factor=phase(day,episode,startMs),active=!!episode&&date>=episode.onsetDate&&date<=episode.declineEndDate;
      const concern=episode?.pattern,stress=normal(random);
      pressureState=.72*pressureState+stress*2.3;
      glucoseState=.65*glucoseState+normal(random)*4.2;
      activityState=.75*activityState+normal(random)*.055;
      sleepState=.7*sleepState+normal(random)*.16;
      weightState=.85*weightState+normal(random)*.055;
      const targetWeight=baseline.weight+weightState-factor*(concern==='appetite'?2.1:.55);
      const weight=round(priorWeight+clamp(targetWeight-priorWeight,-.28,.28));priorWeight=weight;
      const activity=Math.round(clamp(baseline.activity*(1+activityState-factor*(concern==='mobility'?.48:.25)),120,14000));
      const sleep=round(clamp(baseline.sleep+sleepState-factor*(concern==='medication'?1.25:.7),3.5,10));
      const prescribed=2+index%3;
      // Missing doses form short, person-specific patterns; an unknown log is
      // represented later as missing, never as zero doses taken.
      const nuisanceDay=(day+index)%23===0;
      const missChance=clamp(.018+(priorDoses?.taken<prescribed ? .07 : 0)+factor*(concern==='medication' ? .46 : .09)+(nuisanceDay ? .13 : 0),0,.75);
      const doseStatuses=Array.from({length:prescribed},()=>random()>missChance?'taken':'missed');
      const taken=doseStatuses.filter(status=>status==='taken').length;
      priorDoses={taken,prescribed};
      const scheduledHours=prescribed===2?['08:00','20:00']:prescribed===3?['08:00','14:00','20:00']:['08:00','12:00','16:00','20:00'];
      const medication={taken,prescribed,doses:scheduledHours.map((scheduledTime,dose)=>({name:`Scheduled medicine ${dose+1}`,scheduledTime,status:doseStatuses[dose]}))};
      const vitals={
        systolic:round(clamp(baseline.systolic+pressureState+factor*(concern==='multisignal'?24:concern==='medication'?17:4),85,195)),
        diastolic:round(clamp(baseline.diastolic+pressureState*.32+normal(random)*1.1+factor*(concern==='multisignal'?7:2),50,115)),
        // Incidental low measurements remain visible even outside a planted
        // scenario. Such days are unlabelled, not assumed true negatives.
        glucose:round(clamp(baseline.glucose+glucoseState+factor*(diabetes?concern==='medication'?54:23:7),60,320)),
        spo2:round(clamp(baseline.spo2+normal(random)*.22-factor*(concern==='multisignal'?3.8:.35),88,100)),weight
      };
      const allVitals=day===0;
      const schedules={systolic:allVitals||random()<(pressureHistory?.8:.48),diastolic:false,glucose:allVitals||random()<(diabetes?.78:.14),spo2:allVitals||random()<.5,weight:allVitals||(day+index)%4===0};
      schedules.diastolic=schedules.systolic;
      for(const key of Object.keys(vitals))if(!schedules[key]||random()<.025)vitals[key]=null;
      const medicationLogged=day===0||random()>.075;
      let note='';
      if(day===0||(day+index)%3===0||date===fallDate||active&&random()<.35){
        note=familiarNotes[language][Math.floor(random()*familiarNotes[language].length)];
        const parts=[];
        if(factor>=.25){
          if(concern==='multisignal')parts.push(language==='hi'?'कुछ कमजोरी है और भूख कम लग रही है।':language==='hinglish'?'Kamzori hai aur bhookh kam lag rahi hai.':'Feeling weak and eating less than usual.');
          if(concern==='appetite')parts.push(language==='hi'?'भूख कम है। अकेलापन लग रहा है।':language==='hinglish'?'Khana kam khaya. Akela mehsoos ho raha hai.':'Appetite is low and I miss having company.');
          if(concern==='medication'&&sleep<baseline.sleep-.65)parts.push(language==='hi'?'नींद कम आई।':language==='hinglish'?'Neend kam aayi.':'Sleeping poorly this week.');
          if(concern==='mobility'&&date!==fallDate)parts.push(language==='hi'?'चलने में दर्द है। आज कम चला।':language==='hinglish'?'Chalne mein dard hai. Aaj activity kam thi.':'Pain when walking; less active today.');
          if(languageVariant==='held-out-phrases'&&parts.length){
            const alternatives={multisignal:{en:'Feeling exhausted. Ate less than usual.',hi:'कमजोरी महसूस हो रही है। भूख कम है।',hinglish:'Bhookh kam hai aur kamzori hai.'},appetite:{en:'I have eaten much less and feel lonely.',hi:'खाना कम खाया। अकेलापन है।',hinglish:'Akela lag raha hai. Khana kam khaya.'},medication:{en:'I kept waking up last night.',hi:'नींद कम है।',hinglish:'Neend kharab thi.'},mobility:{en:'My leg hurts and movement is less than usual.',hi:'आज चलते समय दर्द हुआ।',hinglish:'Pair mein dard hai, kam walk ki.'}};
            parts[0]=alternatives[concern][language];
          }
        }
        if(date===fallDate)parts.push(language==='hi'?`आज ${profile.gender==='Male'?'गिर गया':'गिर गई'}। अभी दर्द है।`:language==='hinglish'?`Aaj gir ${profile.gender==='Male'?'gaya':'gayi'}. Abhi dard hai.`:languageVariant==='held-out-phrases'?'I lost my balance and landed on the floor today. My leg hurts.':'I fell today and have some pain.');
        if(medicationLogged&&taken<prescribed)parts.push(language==='hi'?'दवा की एक या अधिक खुराक नहीं ली।':language==='hinglish'?'Dawai ki dose nahi li.':'Missed a scheduled medicine dose today.');
        if(parts.length)note=parts.join(' ');
        else if(medicationLogged&&taken===prescribed&&day%5===0)note=language==='hi'?'आज दवाई समय पर ली। दिनचर्या सामान्य रही।':'All scheduled doses were recorded as taken today. Routine felt usual.';
      }
      // Whole missed check-ins are separate from individual fields. Preserve
      // an event day so the one reported incident is not silently discarded.
      const overdue=index>=60&&index%29===0&&day>=days-3;
      if(day>0&&date!==fallDate&&(overdue||random()<.045))continue;
      records.push({id:`${profile.id}:${date}`,seniorId:profile.id,date,vitals,medication:medicationLogged?medication:undefined,activity:random()<.06?null:activity,sleep:random()<.07?null:sleep,note,source:note?'Synthetic assisted check-in':'Synthetic structured daily log',measurementContext:{glucose:'Timing relative to meals is not specified; confirm context before interpretation.',weight:'Logged at a consistent simulated morning weighing time.',bloodPressure:'Simulated seated, resting cuff reading; not an actual device measurement.'},provenance:{synthetic:true,generator:REALISTIC_DATA_INFO.id},...(date===fallDate?{incidentId:`incident-${profile.id}-${fallDate}`,sensor:{fallDetected:true,confirmed:false}}:{})});
    }
    return profile;
  });
  return {seniors,records,groundTruth,events,metadata:{seed,days,startDate:dateAt(0),endDate,seniorCount,languageVariant,expectedObservations:seniorCount*days,actualObservations:records.length,dataType:'reference-informed synthetic simulation',synthetic:true,generator:REALISTIC_DATA_INFO.id,scenarioFraction,reference:REALISTIC_DATA_INFO,sourceCalibration:reference.distributions,recordSchemaVersion:2,incidentCount:events.length,groundTruthCoverage:'partial-positive-scenarios-only',unlabelledDaysAreNotNegative:true}};
}

/** The reference-informed cohort has partial scenario annotations, not complete
 * clinical outcomes. Keep the underlying rules/model untouched and prevent an
 * incomplete matrix from masquerading as measured clinical precision.
 */
export function createRealisticEngine(cohort=generateRealisticCohort(),options={}){
  const engine=createEngine(cohort,options);
  const evaluatedIds=new Set(engine.evaluationSplit.evaluationIds);
  let reviewCoverage;
  function coveredReviewScenarios(){
    if(reviewCoverage)return reviewCoverage;
    const cases=[];let total=0,covered=0;
    for(const episode of cohort.groundTruth.filter(item=>evaluatedIds.has(item.seniorId))){
      let first=null,scenarioDays=0,coveredDays=0;
      for(let ms=Math.max(Date.parse(episode.onsetDate),Date.parse(cohort.metadata.startDate)+30*DAY);ms<=Date.parse(episode.endDate);ms+=DAY){
        const date=new Date(ms).toISOString().slice(0,10),scored=engine.scoreSenior(episode.seniorId,date);
        scenarioDays++;total++;
        if(scored.score!=null&&scored.score>=30){coveredDays++;covered++;first??=date;}
      }
      cases.push({seniorId:episode.seniorId,pattern:episode.pattern,scenarioDays,coveredDays,firstReviewFlagDate:first,delayAfterOnsetDays:first?(Date.parse(first)-Date.parse(episode.onsetDate))/DAY:null});
    }
    const delays=cases.map(item=>item.delayAfterOnsetDays).filter(Number.isFinite);
    reviewCoverage={threshold:30,meaning:'A high or medium priority prompts a human check-in; distinct from threshold-60 high-priority coverage.',scenarioDays:total,coveredDays:covered,dailyCoverage:total?round(covered/total,3):null,detectedCases:delays.length,totalCases:cases.length,meanOnsetDetectionDelayDays:delays.length?round(delays.reduce((a,b)=>a+b,0)/delays.length,2):null,cases};
    return reviewCoverage;
  }
  const scope=raw=>({
    ...raw,
    precision:null,f1:null,falsePositives:null,trueNegatives:null,
    recall:raw.recall,
    unlabelledHighSeniorDays:raw.falsePositives,
    unlabelledNotHighSeniorDays:raw.trueNegatives,
    scenarioReviewCoverage:coveredReviewScenarios(),
    evaluatedAnnotationScope:'Positive authored review scenarios only; other days are unlabelled.',
    recallLabel:'Daily high-flag coverage within authored review scenarios',
    precisionLabel:'Not estimable: unlabelled days are not confirmed negatives',
    clinicalPerformance:{precision:null,recall:null,f1:null,reason:'No independent patient outcomes or adjudicated negative days are available.'},
    perPattern:raw.perPattern.map(pattern=>({...pattern,precision:null,f1:null,falsePositives:null,trueNegatives:null,unlabelledHighSeniorDays:pattern.falsePositives,unlabelledNotHighSeniorDays:pattern.trueNegatives})),
    model:{...raw.model,dataset:REALISTIC_DATA_INFO.title+'; aggregate source SHA256 '+reference.source.archiveSha256,limitations:REALISTIC_DATA_INFO.validation},
    methodology:`The Isolation Forest and personal-baseline rules use disjoint identity groups under ${engine.evaluationSplit.strategy}, seed ${engine.evaluationSplit.seed}. The forest fits first-30-day fitting identities; calibration uses only separate baseline identities. Evaluation begins at day31 using each person's own measured reference. Positive annotations cover authored review scenarios including gradual recovery; other days remain unlabelled. Daily and case coverage describe synthetic scenarios only. Clinical precision, specificity, F1 and predictive accuracy cannot be estimated. Flags outside annotations are unlabelled flags, not proven false alarms. Labels never fit the model or select the identity groups.`,
    ...(raw.ablation?{ablation:{comparison:raw.ablation.comparison,rulesOnly:{...raw.ablation.rulesOnly,precision:null,f1:null},rulesPlusModel:{...raw.ablation.rulesPlusModel,precision:null,f1:null}}}:{})
  });
  return {...engine,metrics:parameters=>scope(engine.metrics(parameters))};
}
