/** Structural, provenance and consistency checks. These do not diagnose health. */
const DAY=86400000;
const round=v=>Math.round(v*1000)/1000;
const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const realDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function correlation(pairs){
  if(pairs.length<5)return null;
  const x=average(pairs.map(v=>v[0])),y=average(pairs.map(v=>v[1]));
  let xy=0,xx=0,yy=0;for(const[a,b]of pairs){xy+=(a-x)*(b-y);xx+=(a-x)**2;yy+=(b-y)**2;}
  return xx&&yy?xy/Math.sqrt(xx*yy):null;
}
export function auditCohort(cohort){
  const profiles=cohort?.seniors||[],records=cohort?.records||[],bySenior=new Map(profiles.map(s=>[s.id,[]])),keys=new Set(),issues=[];
  const bounds={systolic:[40,280],diastolic:[25,180],glucose:[20,700],spo2:[50,100],weight:[20,250]};
  const counts={duplicateSeniorDays:0,invalidDates:0,unknownSenior:0,outOfRangeValues:0,pressureOrder:0,invalidMedicationCounts:0,doseLogMismatch:0,contradictoryMedicineNotes:0,largeWeightJumps:0,missingProvenance:0};
  const fields=['systolic','diastolic','glucose','spo2','weight','activity','sleep','medication','note'],present=Object.fromEntries(fields.map(f=>[f,0]));
  const add=(kind,record,detail)=>{counts[kind]++;if(issues.length<60)issues.push({kind,seniorId:record.seniorId,date:record.date,detail});};
  for(const record of records){
    const key=`${record.seniorId}:${record.date}`;
    if(keys.has(key))add('duplicateSeniorDays',record,'Duplicate senior/day observation.');keys.add(key);
    if(!bySenior.has(record.seniorId))add('unknownSenior',record,'Observation does not belong to a declared profile.');else bySenior.get(record.seniorId).push(record);
    if(!realDate(record.date)||cohort.metadata?.startDate&&record.date<cohort.metadata.startDate||cohort.metadata?.endDate&&record.date>cohort.metadata.endDate)add('invalidDates',record,'Observation date must be a real date inside the cohort window.');
    for(const[field,range]of Object.entries(bounds)){
      const value=record.vitals?.[field];if(Number.isFinite(value)){present[field]++;if(value<range[0]||value>range[1])add('outOfRangeValues',record,`${field} is outside the structural plausibility bounds.`);}else if(value!=null)add('outOfRangeValues',record,`${field} must be numeric or missing.`);
    }
    if(Number.isFinite(record.vitals?.systolic)&&Number.isFinite(record.vitals?.diastolic)&&record.vitals.diastolic>=record.vitals.systolic)add('pressureOrder',record,'Diastolic must be below systolic.');
    for(const field of ['activity','sleep'])if(Number.isFinite(record[field]))present[field]++;
    if(record.note)present.note++;
    const medication=record.medication;
    if(medication){
      present.medication++;
      if(!Number.isInteger(medication.taken)||!Number.isInteger(medication.prescribed)||medication.prescribed<1||medication.taken<0||medication.taken>medication.prescribed)add('invalidMedicationCounts',record,'Taken doses must be whole numbers from zero to the scheduled count.');
      if(Array.isArray(medication.doses)&&((medication.doses.length!==medication.prescribed)||medication.doses.filter(d=>d.status==='taken').length!==medication.taken))add('doseLogMismatch',record,'Dose entries and aggregate counts disagree.');
      if(medication.taken<medication.prescribed&&/all\s+scheduled\s+doses.*taken\s+today|took\s+(?:all\s+)?medicines\s+(?:today|and)|दवाई\s+समय\s+पर\s+ली/iu.test(record.note||''))add('contradictoryMedicineNotes',record,'Note claims all current doses taken but the same-day log records a missed dose.');
    }
    if(cohort.metadata?.synthetic&&record.provenance?.synthetic!==true)add('missingProvenance',record,'Synthetic origin is missing on an observation.');
  }
  const pressureCorrelations=[],weightCorrelations=[],weightSteps=[];
  for(const list of bySenior.values()){
    list.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const pressurePairs=[],weightPairs=[];
    for(let i=1;i<list.length;i++){
      const previous=list[i-1],current=list[i],days=(Date.parse(current.date)-Date.parse(previous.date))/DAY;
      for(const[field,pairs]of [['systolic',pressurePairs],['weight',weightPairs]])if(days===1&&Number.isFinite(previous.vitals?.[field])&&Number.isFinite(current.vitals?.[field]))pairs.push([previous.vitals[field],current.vitals[field]]);
      if(days>0&&Number.isFinite(previous.vitals?.weight)&&Number.isFinite(current.vitals?.weight)){const delta=Math.abs(current.vitals.weight-previous.vitals.weight)/days;weightSteps.push(delta);if(delta>1.5)add('largeWeightJumps',current,'Weight changed by more than 1.5 kg per elapsed day; verify context or entry.');}
    }
    const pressure=correlation(pressurePairs),weight=correlation(weightPairs);if(pressure!=null)pressureCorrelations.push(pressure);if(weight!=null)weightCorrelations.push(weight);
  }
  const expected=cohort.metadata?.expectedObservations||profiles.length*(cohort.metadata?.days||0);
  const hardErrors=counts.duplicateSeniorDays+counts.invalidDates+counts.unknownSenior+counts.outOfRangeValues+counts.pressureOrder+counts.invalidMedicationCounts+counts.doseLogMismatch+counts.contradictoryMedicineNotes;
  const missingness=Object.fromEntries(fields.map(field=>[field,{present:present[field],missing:records.length-present[field],missingRate:records.length?round(1-present[field]/records.length):null}]));
  const sorted=weightSteps.sort((a,b)=>a-b);
  return {schemaVersion:1,passed:hardErrors===0,hardErrors,counts,issueExamples:issues,seniorCount:profiles.length,observations:records.length,expectedSeniorDays:expected,wholeCheckinMissingRate:expected?round(1-records.length/expected):null,missingness,temporal:{meanWithinPersonLagOneSystolicCorrelation:pressureCorrelations.length?round(average(pressureCorrelations)):null,meanWithinPersonLagOneWeightCorrelation:weightCorrelations.length?round(average(weightCorrelations)):null,maximumWeightChangeKgPerDay:sorted.length?round(sorted.at(-1)):null,p95WeightChangeKgPerDay:sorted.length?round(sorted[Math.floor((sorted.length-1)*.95)]):null},source:{kind:cohort.metadata?.dataType||'unspecified',synthetic:cohort.metadata?.synthetic===true||cohort.metadata?.dataType==='entirely synthetic',generator:cohort.metadata?.generator||'legacy-stress-cohort',referenceSha256:cohort.metadata?.reference?.source?.archiveSha256||null},interpretation:'Passing structural and consistency checks does not validate physiological realism, representativeness, risk thresholds or clinical outcomes. Broad bounds are input plausibility checks, not reference ranges or treatment advice.'};
}
