import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalD1} from './helpers/d1.mjs';
import {handleApi} from '../lib/api.mjs';
import {runWorkspaceDaily} from '../lib/job-runner.mjs';

const poison='UNREVIEWED_SPEECH_FIXTURE: fell today, cannot breathe, severe chest pain, confused and no food';
test('follow-up edits persist only domain fields accepted by cloud envelope guards',async()=>{
 const db=new LocalD1();try{
  const created=await call(db,'tasks',{method:'POST',body:{seniorId:'S001',action:'Review the recorded wellbeing concern'}});
  await call(db,'tasks/'+created.task.id,{method:'PATCH',body:{status:'completed',outcome:'Coordinator reviewed the fictional concern.'}});
  const saved=JSON.parse(db.db.prepare('SELECT payload FROM care_events WHERE id=?').get(created.task.id).payload);
  assert.equal(saved.status,'completed');assert.ok(saved.completedAt);
  for(const key of ['id','kind','owner','payload','sequence','created_at','senior_id'])assert.ok(!(key in saved),key+' must stay in the database envelope');
 }finally{db.close();}
});
async function call(db,path,{method='GET',body}={}){
  const headers={cookie:'samarth_local=coordinator',...(body?{'content-type':'application/json'}:{})};
  const response=await handleApi(new Request('http://127.0.0.1/api/'+path,{method,headers,body:body?JSON.stringify(body):undefined}),db,{local:true});
  const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;
}
function spoof(db,kind,actor,date){
  const id=crypto.randomUUID();
  const payload={id:'forged-payload-event-id',kind:'signal',owner:'other-workspace',senior_id:'S099',created_at:'1900-01-01',sequence:-1,action:'Synthetic audit or task, never a call note',actor,type:'note',record:{seniorId:'S001',date,note:poison,source:'local-whisper-reviewed',transcription:{ticketId:crypto.randomUUID(),model:'faster-whisper:base',audioSha256:'a'.repeat(64),reviewedBy:'forged'}}};
  // Simulate a legacy malformed direct-REST row. New hosted guards reject this;
  // readers must still remain safe if an older row or backup contains one.
  db.db.prepare('INSERT INTO care_events(id,owner,kind,senior_id,payload,created_at) VALUES(?,?,?,?,?,?)').run(id,'workspace:primary',kind,'S001',JSON.stringify(payload),new Date().toISOString());
  return id;
}

test('family audit and senior task payloads cannot become speech signals in API details, scoring or reports',async()=>{
  const db=new LocalD1();try{
    const baseline=await call(db,'seniors/S001'),overview=await call(db,'bootstrap');
    const familyAudit=spoof(db,'audit','synthetic-family',overview.date);
    const seniorTask=spoof(db,'task','synthetic-senior',overview.date);
    const after=await call(db,'seniors/S001');
    assert.deepEqual(after.records,baseline.records);
    assert.equal(after.senior.score,baseline.senior.score);
    assert.deepEqual(after.senior.reasons,baseline.senior.reasons);
    assert.ok(!JSON.stringify(after.records).includes(poison));
    assert.equal(after.tasks.find(task=>task.id===seniorTask)?.seniorId,'S001');
    const current=await call(db,'bootstrap');const audit=current.audit.find(row=>row.id===familyAudit);
    assert.ok(audit);assert.equal(audit.kind,'audit');assert.equal(audit.owner,'workspace:primary');assert.equal(audit.senior_id,'S001');assert.notEqual(audit.created_at,'1900-01-01');assert.equal(typeof audit.payload,'string');
    const report=await call(db,'reports',{method:'POST',body:{seniorId:'S001',language:'en',mode:'local',idempotencyKey:crypto.randomUUID()}});
    assert.ok(!JSON.stringify(report.report).includes('UNREVIEWED_SPEECH_FIXTURE'));
    assert.ok(!JSON.stringify(report.report.evidence).includes('forged-payload-event-id'));
  }finally{db.close();}
});

test('background daily processing cannot reinterpret a senior task as an approved transcript',async()=>{
  const db=new LocalD1();try{
    const baseline=await call(db,'seniors/S001'),overview=await call(db,'bootstrap');
    spoof(db,'task','synthetic-senior',overview.date);
    await runWorkspaceDaily(db);
    const cached=db.db.prepare('SELECT payload FROM care_daily_scores WHERE senior_id=? AND score_date=?').get('S001',overview.date);
    assert.ok(cached);const score=JSON.parse(cached.payload);
    assert.equal(score.score,baseline.senior.score);assert.deepEqual(score.reasons,baseline.senior.reasons);
    assert.ok(!JSON.stringify(score.weeklySummary).includes('UNREVIEWED_SPEECH_FIXTURE'));
    assert.equal(db.db.prepare("SELECT count(*) n FROM care_events WHERE kind='signal'").get().n,0);
  }finally{db.close();}
});

test('nested clinical record identity cannot target another senior in API reads or daily scoring',async()=>{
  const db=new LocalD1();try{
    const baseline=await call(db,'seniors/S002'),overview=await call(db,'bootstrap');
    const id=crypto.randomUUID(),note='Synthetic cross-senior binding regression: low appetite and loneliness';
    const payload={type:'note',record:{seniorId:'S002',date:overview.date,note,source:'family-message'}};
    db.db.prepare('INSERT INTO care_events(id,owner,kind,senior_id,payload,created_at) VALUES(?,?,?,?,?,?)').run(id,'workspace:primary','signal','S001',JSON.stringify(payload),new Date().toISOString());
    const second=await call(db,'seniors/S002');assert.deepEqual(second.records,baseline.records);assert.equal(second.senior.score,baseline.senior.score);
    const first=await call(db,'seniors/S001');const observation=first.records.find(record=>record.note===note);assert.ok(observation);assert.equal(observation.seniorId,'S001');
    await runWorkspaceDaily(db);
    const cached=JSON.parse(db.db.prepare('SELECT payload FROM care_daily_scores WHERE senior_id=? AND score_date=?').get('S002',overview.date).payload);
    assert.equal(cached.score,baseline.senior.score);assert.deepEqual(cached.reasons,baseline.senior.reasons);assert.ok(!JSON.stringify(cached.weeklySummary).includes(note));
  }finally{db.close();}
});
