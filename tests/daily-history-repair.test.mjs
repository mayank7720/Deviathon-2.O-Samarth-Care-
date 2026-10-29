import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './helpers/d1.mjs';
import {runDaily} from '../lib/daily-workflow.mjs';
import {runWorkspaceDaily} from '../lib/job-runner.mjs';
import {workflow} from '../lib/workflow-store.mjs';

function fixture(t){
 const db=new LocalD1();t.after(()=>db.close());
 const context={owner:'workspace:primary',workspaceId:'primary',session:{role:'operations',isAdmin:true,userId:'owner',scope:['S001']}};
 const cohort={metadata:{startDate:'2026-10-01'},seniors:[{id:'S001',name:'Fictional senior',familyConsent:false}],records:[]};
 const rows=[{id:'backdated-signal',kind:'signal',seniorId:'S001',createdAt:'2026-10-29T08:00:00Z',record:{seniorId:'S001',date:'2026-10-27',observedAt:'2026-10-27T04:00:00Z',vitals:{weight:65}}}];
 const calls=[],engine={scoreSenior(id,date,extras){calls.push({id,date,extras});return {id,name:'Fictional senior',asOfDate:date,score:10,level:'low',urgency:'routine',urgencyRank:3,cues:[],baseline:{},trend:[],reasons:[],action:'Continue agreed check-ins.',latest:null};}};
 return {db,context,cohort,engine,rows,runtime:{date:'2026-10-29',dataRevision:'fixture'},consents:[],calls};
}
test('failed backdated compact-score repair stays pending and retries without losing measured/save times',async t=>{
 const f=fixture(t);let fail=true,pending=true;const writes=[];
 f.db.historyDirty=async()=>({pending:pending?[{seniorId:'S001',from:'2026-10-27',to:'2026-10-27',watermark:'7'}]:[],hasMore:false});
 f.db.historyScores=async payload=>{writes.push(payload);if(fail)throw Object.assign(new Error('Temporary history write failure'),{status:503});pending=false;return {ok:true};};
 await assert.rejects(()=>runDaily(f),error=>error.status===503);
 assert.equal((await workflow(f.db,'job_get',{owner:f.context.owner,id:'daily:workspace:primary:2026-10-29'})).status,'failed');
 assert.equal(pending,true);fail=false;
 const result=await runDaily(f);assert.equal(result.job.status,'completed');assert.equal(result.history.repaired,1);
 assert.equal(writes[1].watermark,'7');assert.deepEqual(writes[1].scores.map(row=>row.date),['2026-10-27','2026-10-28','2026-10-29']);
 const extras=f.calls.at(-1).extras;assert.equal(extras[0].observedAt,'2026-10-27T04:00:00Z');assert.equal(extras[0].recordedAt,'2026-10-29T08:00:00Z');
});
test('an already-completed daily job still reconciles independently pending historical scores',async t=>{
 const f=fixture(t);let pending=false,writes=0;
 f.db.historyDirty=async()=>({pending:pending?[{seniorId:'S001',from:'2026-10-28',watermark:'9'}]:[],hasMore:false});
 f.db.historyScores=async()=>{writes++;pending=false;return {ok:true};};
 await runDaily(f);pending=true;
 const retry=await runDaily(f);assert.equal(retry.job.status,'already_completed');assert.equal(retry.history.repaired,1);assert.equal(writes,1);
});
test('daily repair refuses another senior and leaves its historical marker untouched',async t=>{
 const f=fixture(t);let writes=0;
 f.db.historyDirty=async()=>({pending:[{seniorId:'S002',from:'2026-10-28',watermark:'8'}],hasMore:false});
 f.db.historyScores=async()=>{writes++;};
 await assert.rejects(()=>runDaily(f),error=>error.status===403);assert.equal(writes,0);
});
test('a concurrent new observation remains explicitly pending after the previous watermark is repaired',async t=>{
 const f=fixture(t);let watermark='7';
 f.db.historyDirty=async()=>({pending:[{seniorId:'S001',from:'2026-10-28',watermark}],hasMore:false});
 f.db.historyScores=async payload=>{assert.equal(payload.watermark,'7');watermark='8';return {ok:true,dirtyCleared:false};};
 const result=await runDaily(f);assert.equal(result.history.repaired,1);assert.equal(result.history.hasMore,true);
});
test('replay leaves future history pending without scoring its observations',async t=>{
 const f=fixture(t);let writes=0;
 f.db.historyDirty=async()=>({pending:[{seniorId:'S001',from:'2026-10-30',to:'2026-10-30',watermark:'9'}],hasMore:false});
 f.db.historyScores=async()=>{writes++;};
 const result=await runDaily(f);assert.equal(writes,0);assert.equal(result.history.repaired,0);assert.equal(result.history.hasMore,true);
 assert.ok(f.calls.every(call=>call.date<='2026-10-29'));
});
test('the sole all-scope Operations administrator runs daily processing while a scoped coordinator does not gain access',async t=>{
 const db=new LocalD1();t.after(()=>db.close());
 for(const [id,role,scope,admin] of [['owner','operations',['*'],1],['coordinator','coordinator',['S001','S002'],0]]){
  await db.prepare('INSERT INTO care_memberships VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(id,'primary',id,`${id}@example.test`,id,role,'',JSON.stringify(scope),admin,'active','2026-10-29').run();
 }
 const result=await runWorkspaceDaily(db,{SAMARTH_DATA_MODE:'reference-informed',SAMARTH_COHORT_END:'2026-10-29'});
 assert.equal(result.skipped,undefined);assert.equal(result.job.status,'completed');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM care_daily_scores WHERE score_date = ?').bind('2026-10-29').first()).n,200);
 assert.equal((await db.prepare('SELECT scope_json FROM care_memberships WHERE id = ?').bind('coordinator').first()).scope_json,'["S001","S002"]');
});
