/** Reported concerns remain actionable while personal reference collection is incomplete. */
import {extractCues,classifyTriage} from './triage.mjs';
import {signalValue,medicationCounts} from './personal-baseline.mjs';

export function initialReview(recent=[],raw=recent) {
  const cues=[...new Map(recent.flatMap(row=>extractCues(row.note)).map(cue=>[cue.cue,cue])).values()];
  const triage=classifyTriage({cues},raw),reasons=[];
  for(const item of triage.triageEvidence)reasons.push({title:'A reported concern needs prompt review',detail:item.detail,source:['oxygen-reading','pressure-reading','glucose-reading'].includes(item.id)?'vitals':item.id==='sensor-fall'?'sensor':'notes'});
  for(const cue of cues)if(!triage.triageEvidence.some(item=>item.detail===cue.evidence))reasons.push({title:cue.label,detail:cue.evidence,source:'notes'});
  const mean=key=>{const values=recent.map(row=>signalValue(row,key)).filter(Number.isFinite);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;};
  const oxygen=mean('spo2'),pressure=mean('systolic');
  if(oxygen!==null&&oxygen>=90&&oxygen<92)reasons.push({title:'Oxygen readings need verification',detail:`Recent oxygen average ${Math.round(oxygen*10)/10}%. The personal oxygen reference is not established; verify this reading with the care team.`,source:'vitals'});
  if(pressure!==null&&pressure>=160&&pressure<180)reasons.push({title:'Blood-pressure readings need verification',detail:`Recent systolic average ${Math.round(pressure)} mmHg. The personal pressure reference is not established; review the recorded readings and context.`,source:'vitals'});
  const logs=recent.map(row=>medicationCounts(row.medication)).filter(log=>!log.invalid&&log.prescribed>0);
  const resolved=logs.reduce((n,log)=>n+log.prescribed,0),taken=logs.reduce((n,log)=>n+log.taken,0);
  if(resolved>0&&taken<resolved*.8)reasons.push({title:'Reported missed doses need a check-in',detail:`${taken} of ${resolved} resolved logged doses were taken. Pending and missing outcomes are excluded. Ask about barriers and arrange a medicine review; do not change medicines from this flag.`,source:'medication'});
  const concern=triage.immediateReview||reasons.length>0,score=triage.immediateReview?60:concern?30:null,level=triage.immediateReview?'high':concern?'medium':'unknown';
  reasons.push({title:'Personal reference not established',detail:'Insufficient dated measurements to establish a personal reference. Reported concerns can still request a human check-in; a routine report does not establish stability.',source:'data'});
  return {score,level,cues,reasons:reasons.slice(0,5),action:triage.immediateReview?triage.triageAction:concern?'Contact the senior today, verify the reported concern and agree a follow-up while collecting their personal reference.':'Call to confirm wellbeing and collect dated observations while establishing the personal reference.',...classifyTriage({score,level,cues,warmup:true},raw)};
}
