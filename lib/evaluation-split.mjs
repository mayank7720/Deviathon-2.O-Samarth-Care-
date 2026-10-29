/** Profile-stratified identity splits. Outcomes and observations never select a split. */
const textOrder=(a,b)=>a<b?-1:a>b?1:0;
const hash32=(value,seed=0)=>{
 let hash=(2166136261^seed)>>>0;
 for(const character of value)hash=Math.imul(hash^character.charCodeAt(0),16777619)>>>0;
 return hash;
};
// Fixed Murmur3 finalization disperses neighbouring sequential IDs; plain
// FNV's numeric ordering can cluster identities sharing an ID prefix.
const rankHash=(value,seed)=>{
 let hash=hash32(value,seed);
 hash=Math.imul(hash^(hash>>>16),0x85ebca6b);hash=Math.imul(hash^(hash>>>13),0xc2b2ae35);
 return (hash^(hash>>>16))>>>0;
};
const ranked=(values,seed,purpose)=>values.slice().sort((a,b)=>rankHash(purpose+'\0'+a,seed)-rankHash(purpose+'\0'+b,seed)||textOrder(a,b));
function stratumFor(profile){
 const value=typeof profile.gender==='string'?profile.gender.trim().toLowerCase():'';
 const gender=value==='male'||value==='female'?value:value?'other':'unknown';
 const age=Number.isFinite(profile.age)&&profile.age>=0&&profile.age<=120?profile.age:null;
 const ageBand=age===null?'unknown':age<60?'under-60':age<70?'60-69':age<80?'70-79':'80-plus';
 const diabetes=Array.isArray(profile.conditions)&&profile.conditions.some(condition=>typeof condition==='string'&&condition.trim().toLowerCase()==='diabetes history');
 return gender+'|'+ageBand+'|'+(diabetes?'diabetes-history':'no-diabetes-history');
}
/** Allocate an exact target across integer bucket sizes, using largest remainders. */
function quotas(buckets,target,seed,purpose){
 const total=buckets.reduce((sum,bucket)=>sum+bucket.size,0),result=new Map(buckets.map(bucket=>[bucket.key,0]));
 if(!total||!target)return result;
 const remainders=buckets.map(bucket=>{
  const numerator=bucket.size*target,base=Math.floor(numerator/total);
  result.set(bucket.key,base);
  return {key:bucket.key,remainder:numerator%total};
 }).sort((a,b)=>b.remainder-a.remainder||rankHash(purpose+'\0'+a.key,seed)-rankHash(purpose+'\0'+b.key,seed)||textOrder(a.key,b.key));
 const remaining=target-[...result.values()].reduce((sum,count)=>sum+count,0);
 for(let index=0;index<remaining;index++)result.set(remainders[index].key,result.get(remainders[index].key)+1);
 return result;
}

/**
 * Default: reserve round(N/4) identities for evaluation, then one fifth of the
 * remainder for calibration. Stable seeded ID hashes rank within gender,
 * age-band and diabetes-history strata. Reordering input cannot change the
 * default plan. Rare strata can lack a role because integer quotas cannot put
 * a single identity in several independent sets.
 *
 * legacy-modulo exactly reproduces the earlier array-index evaluation split
 * and unseeded FNV calibration split. Its input order intentionally matters;
 * use the original cohort order when reproducing historical reports.
 */
export function createCohortSplit(seniors,{strategy='stratified-v1',seed=104}={}){
 if(!Array.isArray(seniors))throw new Error('A senior profile array is required.');
 if(!['stratified-v1','legacy-modulo'].includes(strategy))throw new Error('Choose stratified-v1 or legacy-modulo.');
 if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('Split seed must be an unsigned 32-bit integer.');
 const seen=new Set(),buckets=new Map();
 for(const profile of seniors){
  if(typeof profile?.id!=='string'||!profile.id.trim()||profile.id!==profile.id.trim())throw new Error('Every senior needs a nonempty stable ID without outer whitespace.');
  if(seen.has(profile.id))throw new Error('Senior IDs must be unique.');
  seen.add(profile.id);
  const key=stratumFor(profile);
  if(!buckets.has(key))buckets.set(key,[]);
  buckets.get(key).push(profile.id);
 }
 const fitIds=[],calibrationIds=[],evaluationIds=[];
 if(strategy==='legacy-modulo'){
  seniors.forEach((profile,index)=>{(index%4===3?evaluationIds:hash32(profile.id)%5===0?calibrationIds:fitIds).push(profile.id);});
 }else{
  const sizes=[...buckets].map(([key,ids])=>({key,size:ids.length})),evaluationTarget=Math.round(seniors.length*.25);
  const evaluationQuotas=quotas(sizes,evaluationTarget,seed,'evaluation-quota');
  const remainingSizes=sizes.map(bucket=>({...bucket,size:bucket.size-evaluationQuotas.get(bucket.key)}));
  const calibrationQuotas=quotas(remainingSizes,Math.round((seniors.length-evaluationTarget)*.2),seed,'calibration-quota');
  for(const [key,ids] of buckets){
   const ordered=ranked(ids,seed,'evaluation'),count=evaluationQuotas.get(key),remaining=ranked(ordered.slice(count),seed,'calibration'),calibrationCount=calibrationQuotas.get(key);
   evaluationIds.push(...ordered.slice(0,count));calibrationIds.push(...remaining.slice(0,calibrationCount));fitIds.push(...remaining.slice(calibrationCount));
  }
 }
 for(const ids of [fitIds,calibrationIds,evaluationIds])ids.sort(textOrder);
 const sets={fit:new Set(fitIds),calibration:new Set(calibrationIds),evaluation:new Set(evaluationIds)};
 const strata=[...buckets].sort(([a],[b])=>textOrder(a,b)).map(([key,ids])=>({key,total:ids.length,...Object.fromEntries(Object.entries(sets).map(([role,selected])=>[role,ids.filter(id=>selected.has(id)).length]))}));
 return {strategy,seed,fitIds,calibrationIds,evaluationIds,strata};
}
