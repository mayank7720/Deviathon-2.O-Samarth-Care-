/** Robust personal references and persistent changes. No population diagnosis. */
export const SIGNALS = Object.freeze({
  systolic:{range:[50,280],floor:6,unit:'mmHg',label:'Systolic pressure',domain:'vitals',direction:0},
  diastolic:{range:[25,180],floor:4,unit:'mmHg',label:'Diastolic pressure',domain:'vitals',direction:0},
  glucose:{range:[20,700],floor:12,unit:'mg/dL',label:'Glucose',domain:'vitals',direction:0,min:3},
  spo2:{range:[40,100],floor:.65,unit:'%',label:'Oxygen saturation',domain:'vitals',direction:-1},
  weight:{range:[20,250],floor:.6,unit:'kg',label:'Weight',domain:'vitals',direction:0,min:3},
  activity:{range:[0,50000],floor:400,unit:'steps/day',label:'Movement',domain:'routine',direction:-1},
  sleep:{range:[0,24],floor:.5,unit:'hours/night',label:'Sleep',domain:'routine',direction:0},
});
export const median = values => {
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b),n=sorted.length;
  return n ? n%2 ? sorted[(n-1)/2] : (sorted[n/2-1]+sorted[n/2])/2 : null;
};
export function medicationCounts(value) {
  const prescribed=value?.prescribed,taken=value?.taken;
  const validPrescribed=Number.isInteger(prescribed)&&prescribed>=0&&prescribed<=30;
  const validTaken=Number.isInteger(taken)&&taken>=0&&taken<=30;
  const complete=validPrescribed&&validTaken&&taken<=prescribed;
  let invalid=(prescribed!=null&&!validPrescribed)||(taken!=null&&!validTaken)||(validPrescribed&&validTaken&&taken>prescribed);
  const doses=Array.isArray(value?.doses)?value.doses:[];
  if(doses.length) {
    let observedTaken=0,observedMissed=0;
    for(const dose of doses) {
      const positive=dose?.status==='taken'||dose?.taken===true,negative=dose?.status==='missed'||dose?.taken===false;
      if(positive&&negative){invalid=true;continue;}
      if(['pending','unknown','scheduled','not_logged'].includes(dose?.status))continue;
      if(positive)observedTaken++;else if(negative)observedMissed++;
    }
    const resolved=observedTaken+observedMissed,scheduled=Math.max(validPrescribed?prescribed:0,doses.length);
    if(validPrescribed&&doses.length>prescribed)invalid=true;
    if(complete&&(observedTaken>taken||observedMissed>prescribed-taken||resolved===scheduled&&observedTaken!==taken))invalid=true;
    return {taken:observedTaken,prescribed:resolved,scheduled,unresolved:Math.max(0,scheduled-resolved),invalid};
  }
  return {taken:complete?taken:0,prescribed:complete?prescribed:0,scheduled:validPrescribed?prescribed:0,unresolved:complete?0:validPrescribed?prescribed:0,invalid};
}
export const validMedication=value=>{const counts=medicationCounts(value);return counts.prescribed>0&&!counts.invalid;};
export function signalValue(record,key) {
  const value=key==='activity'?(record?.sensor?.steps??record?.lifestyle?.steps??record?.activity):key==='sleep'?(record?.lifestyle?.sleepHours??record?.sleep):record?.vitals?.[key];
  const definition=SIGNALS[key];
  return Number.isFinite(value)&&value>=definition.range[0]&&value<=definition.range[1]?value:null;
}
export function personalReference(records) {
  const baseline={},scales={},support={};
  for(const [key,definition] of Object.entries(SIGNALS)) {
    const values=records.map(row=>signalValue(row,key)).filter(Number.isFinite),center=median(values);
    const enough=values.length>=(definition.min||7);
    baseline[key]=enough?Math.round(center*100)/100:null;
    scales[key]=enough?Math.max(definition.floor,key==='activity'?center*.15:0,1.4826*median(values.map(value=>Math.abs(value-center)))):null;
    support[key]={observations:values.length,minimum:definition.min||7,supported:enough};
  }
  return {baseline,scales,support,method:'Median and median absolute deviation of measured daily values in the first 30 calendar days; no profile fallback.'};
}
/** Seven calendar days, lambda=.35, and repeated deviations in >=2 domains. */
export function persistentChanges(records,reference,asOfDate) {
  const cutoff=Date.parse(asOfDate+'T00:00:00Z'),changes=[];
  for(const [key,definition] of Object.entries(SIGNALS)) {
    if(!Number.isFinite(reference.baseline[key])||!Number.isFinite(reference.scales[key]))continue;
    const rows=records.filter(row=>Date.parse(row.date+'T00:00:00Z')>cutoff-7*86400000&&Date.parse(row.date+'T00:00:00Z')<=cutoff&&signalValue(row,key)!==null);
    if(rows.length<4||cutoff-Date.parse(rows.at(-1).date+'T00:00:00Z')>86400000)continue;
    let smoothed=0,previous=null;const zs=[];
    for(const row of rows) {
      const time=Date.parse(row.date+'T00:00:00Z');
      if(previous!==null)smoothed*=.65**Math.max(0,(time-previous)/86400000-1);
      const z=(signalValue(row,key)-reference.baseline[key])/reference.scales[key];
      smoothed=.35*Math.max(-6,Math.min(6,z))+.65*smoothed;previous=time;zs.push(z);
    }
    // With lambda=.35 the stationary EWMA scale is about .46 of the
    // individual scale. A 1.25-scale sustained mean shift is deliberately
    // easier to detect than a single large outlier; serial correlation means
    // this is an illustrative rule, not a statistical confidence interval.
    const sign=definition.direction||Math.sign(smoothed),repeated=zs.filter(z=>z*sign>=1).length;
    if(smoothed*sign<1.25||repeated<3)continue;
    changes.push({signal:key,label:definition.label,domain:definition.domain,direction:sign>0?'above':'below',baseline:reference.baseline[key],recent:signalValue(rows.at(-1),key),unit:definition.unit,observedDays:rows.length,deviatingDays:repeated,smoothedDeviation:Math.round(smoothed*100)/100,from:rows[0].date,to:rows.at(-1).date});
  }
  const domains=[...new Set(changes.map(change=>change.domain))];
  return {method:'Seven-day EWMA of robust personal deviations',windowDays:7,changes,domains,corroborated:domains.length>=2,points:domains.length>=2?Math.min(18,changes.length*4):0,limitation:'Descriptive repeated change; no disease probability or calibrated false-alarm rate.'};
}
