/** Calendar groups sum only logged outcomes. Unobserved groups stay null. */
export function medicationBuckets(points,groupBy='day'){
 if(!['day','week','month'].includes(groupBy))throw Error('Choose day, week or month.');
 const buckets=new Map();
 for(const point of points){
  let key=point.date;
  if(groupBy==='month')key=key.slice(0,7);
  if(groupBy==='week'){const t=new Date(point.date+'T00:00:00Z');t.setUTCDate(t.getUTCDate()-(t.getUTCDay()+6)%7);key=t.toISOString().slice(0,10);}
  const bucket=buckets.get(key)||{key,from:point.date,to:point.date,calendarDays:0,loggedDays:0,taken:null,missed:null,unknown:null};
  bucket.to=point.date;bucket.calendarDays++;
  if(point.hasMedication){bucket.loggedDays++;for(const field of ['taken','missed','unknown'])if(Number.isFinite(point[field]))bucket[field]=(bucket[field]??0)+point[field];}
  buckets.set(key,bucket);
 }
 return [...buckets.values()];
}
