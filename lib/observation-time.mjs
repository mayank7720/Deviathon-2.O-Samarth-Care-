import {indiaDate,validDate,TIMEZONE} from './runtime.mjs';

export class ObservationTimeError extends Error {
  constructor(message){super(message);this.status=400;}
}
const check=(condition,message)=>{if(!condition)throw new ObservationTimeError(message);};

/** Measurement time is optional. A date-only observation never acquires a fabricated clock time. */
export function observationTime(input={}, {asOfDate,cohortStart,now=new Date()}={}) {
  const date=input.date??asOfDate;
  check(validDate(date),'Choose a valid observation date.');
  check(!cohortStart||date>=cohortStart,'The observation is earlier than the available care history.');
  check(validDate(asOfDate)&&date<=asOfDate,'The observation date must be no later than the workspace date.');
  check(!input.timezone||input.timezone===TIMEZONE,'Observation times use Asia/Kolkata.');
  let observedAt=input.observedAt??null;
  if(input.observationTime!=null&&input.observationTime!==''){
    check(typeof input.observationTime==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(input.observationTime),'Enter the observation time as HH:MM.');
    check(observedAt===null,'Provide one observation time.');
    observedAt=`${date}T${input.observationTime}:00+05:30`;
  }
  if(observedAt===null||observedAt==='')return {date,observedAt:null,timePrecision:'day',timezone:TIMEZONE};
  check(typeof observedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(observedAt),'Include a timezone offset in the observation timestamp.');
  const time=new Date(observedAt);
  check(Number.isFinite(time.getTime()),'Choose a valid observation time.');
  check(indiaDate(time)===date,'The observation time must belong to the selected date in India.');
  check(time.getTime()<=now.getTime()+60000,'The observation time cannot be in the future.');
  return {date,observedAt:time.toISOString(),timePrecision:input.observationTime?'minute':'second',timezone:TIMEZONE};
}
