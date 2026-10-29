/** Daily model inputs derived from raw observations. Raw records remain unchanged. */
const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
export const DAILY_AGGREGATION = Object.freeze({
  vitals: 'Latest explicitly timed reading for each field; otherwise latest recorded entry. Unknown measurement times remain unknown.',
  medication: 'Latest daily log, never a sum of repeated daily totals.',
  notes: 'Distinct notes in measurement/save order. Untimed entries retain their time precision.',
  safety: 'Urgency checks use raw readings before daily aggregation.',
});
const validDate = value => typeof value === 'string' && DAY_FORMAT.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
const instant = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
export const observedInstant = record => instant(record?.observedAt);
const recordedInstant = record => instant(record?.recordedAt ?? record?.createdAt ?? record?.created_at);
const stableKey = record => String(record?.id ?? record?.eventId ?? '');

/** A saved time orders entries but never becomes their measurement time. */
export function compareObservations(a, b) {
  const byDate=String(a?.date||'').localeCompare(String(b?.date||''));
  if(byDate)return byDate;
  const am=observedInstant(a),bm=observedInstant(b);
  if(am!==null&&bm!==null&&am!==bm)return am-bm;
  if((am===null)!==(bm===null))return am===null?-1:1;
  const ar=recordedInstant(a),br=recordedInstant(b);
  if(ar!==null&&br!==null&&ar!==br)return ar-br;
  if((ar===null)!==(br===null))return ar===null?-1:1;
  const ak=stableKey(a),bk=stableKey(b);
  return ak&&bk?ak.localeCompare(bk):0;
}

export function observationRecords(records=[],{seniorId,asOfDate}={}) {
  return records.filter(record=>record&&(!seniorId||!record.seniorId||record.seniorId===seniorId)&&validDate(record.date)&&(!asOfDate||record.date<=asOfDate)).slice().sort(compareObservations);
}

/**
 * Keep the latest measured value for each vital independently. Unknown-time
 * entries never displace an explicitly timed value because they arrived later.
 * Daily medication snapshots replace each other instead of accumulating.
 */
export function mergeDailyObservations(records=[],options={}) {
  const daily=new Map();
  for(const record of observationRecords(records,options)){
    const prior=daily.get(record.date),next={...prior,...record};
    const sources={...(prior?.vitalSources||{})};
    if(prior?.vitals||record.vitals){
      next.vitals={...(prior?.vitals||{})};
      for(const [key,value] of Object.entries(record.vitals||{})){
        if(value===undefined)continue;
        if(!Number.isFinite(value)&&Number.isFinite(next.vitals[key]))continue;
        const measured=observedInstant(record);
        if(sources[key]?.observedAt&&measured===null)continue;
        next.vitals[key]=value;
        sources[key]={id:record.id||record.eventId||null,observedAt:measured===null?null:record.observedAt,recordedAt:record.recordedAt||record.createdAt||record.created_at||null,timePrecision:record.timePrecision||(measured===null?'day':'second')};
      }
      next.vitalSources=sources;
    }
    if(record.medication)next.medication={...record.medication};
    else if(prior?.medication)next.medication=prior.medication;
    for(const key of ['lifestyle','sensor'])if(prior?.[key]||record[key])next[key]={...(prior?.[key]||{}),...(record[key]||{})};
    if(prior?.sensor?.fallDetected===true)next.sensor={...next.sensor,fallDetected:true};
    const notes=[];
    for(const note of [prior?.note,record.note])if(typeof note==='string')for(const line of note.split('\n').map(value=>value.trim()).filter(Boolean))if(!notes.includes(line))notes.push(line);
    if(notes.length)next.note=notes.join('\n');
    next.observationCount=(prior?.observationCount||0)+1;
    next.dailyAggregation=DAILY_AGGREGATION;
    daily.set(record.date,next);
  }
  return [...daily.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
