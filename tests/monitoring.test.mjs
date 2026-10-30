import test from 'node:test';
import assert from 'node:assert/strict';
import {monitoringSnapshot,medicationBuckets} from '../lib/monitoring.mjs';
const senior={id:'S001',dataProvenance:{synthetic:true}},date='2026-10-30';
test('monitoring fills the calendar with gaps rather than healthy readings and excludes other seniors and future data',()=>{
 const r=monitoringSnapshot(senior,[{seniorId:'S001',date:'2026-10-29',vitals:{systolic:130,glucose:105}},{seniorId:'S002',date,vitals:{systolic:200}},{seniorId:'S001',date:'2026-10-31',vitals:{systolic:210}}],date,7);
 assert.equal(r.points.length,7);assert.equal(r.period.from,'2026-10-24');assert.equal(r.observedDays,1);assert.equal(r.points.at(-1).systolic,null);assert.equal(r.points.at(-2).systolic,130);assert.equal(r.synthetic,true);assert.throws(()=>monitoringSnapshot(senior,[],date,14));
});

test('medication chart sums match the resolved-dose analysis and preserve calendar gaps in week/month groups',()=>{
 const records=[
  {seniorId:'S001',date:'2026-10-25',medication:{doses:[{name:'Example A',status:'taken'},{name:'Example B',status:'pending'}]}},
  {seniorId:'S001',date:'2026-10-26',medication:{doses:[{name:'Example A',status:'missed'}]}},
  {seniorId:'S001',date:'2026-10-30',medication:{prescribed:2,taken:3}}
 ];
 const r=monitoringSnapshot(senior,records,date,30);
 assert.equal(r.medication.loggedDays,3);assert.equal(r.medication.unloggedDays,27);
 for(const group of ['day','week','month']){
  const buckets=medicationBuckets(r.points,group);
  const sum=k=>buckets.reduce((s,b)=>s+(b[k]??0),0);
  assert.equal(sum('taken'),r.medication.takenDoses);assert.equal(sum('missed'),r.medication.missedDoses);assert.equal(sum('unknown'),r.medication.unresolvedDoses);
  assert.equal(sum('loggedDays'),3);assert.equal(sum('calendarDays'),30);
  assert.ok(buckets.filter(b=>!b.loggedDays).every(b=>b.taken===null&&b.missed===null&&b.unknown===null));
 }
 assert.deepEqual(r.medication.medicineOutcomes.map(x=>x.name).sort(),['example a','example b']);
 const weeks=medicationBuckets(r.points,'week');assert.ok(weeks.some(w=>w.from==='2026-10-26'));
 assert.throws(()=>medicationBuckets(r.points,'random'));
});
test('medicine patterns use explicit outcomes, retain unknown doses and stop a missed streak across missing days',()=>{
 const doses=[{name:'Example A',status:'missed'},{name:'Example B',status:'pending'}];
 const r=monitoringSnapshot(senior,[{seniorId:'S001',date:'2026-10-28',medication:{doses}},{seniorId:'S001',date,medication:{doses}}],date,30);
 assert.equal(r.medication.missedDoses,2);assert.equal(r.medication.unresolvedDoses,2);assert.equal(r.medication.medicinePatterns[0].missedDays,2);assert.equal(r.medication.longestMissedStreak,1);assert.equal(r.medication.currentMissedStreak,1);assert.equal(r.points.at(-2).missed,null);
 assert.equal(monitoringSnapshot(senior,[{seniorId:'S001',date:'2026-10-28',medication:{doses}}],date,7).medication.currentMissedStreak,0);
});
