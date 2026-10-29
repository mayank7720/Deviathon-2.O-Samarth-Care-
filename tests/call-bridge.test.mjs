import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {validateJob,originateRequest,jobPaths,parseBridgeResult} from '../bridge/asterisk/adapter.mjs';
import {inspectCallBridge} from '../scripts/check-call-bridge.mjs';

const now=1800000000000,id='33333333-3333-4333-8333-333333333333';
const job={id,dialNumber:'+919000000001',language:'hi',approved:true,expiresAt:now+60000};
test('call manifest binds explicit approval, UUID and bounded unexpired authorization',()=>{
  assert.equal(validateJob(job,{now}).jobId,id);
  assert.equal(validateJob({...job,id:undefined,jobId:id},{now}).id,id);
  for(const changes of [{approved:false},{approved:'true'},{expiresAt:now},{expiresAt:now+86400001},{expiresAt:NaN},{expiresAt:now+0.5},{language:'hi-IN'},{version:true},{jobId:'44444444-4444-4444-8444-444444444444'},{path:'/etc/passwd'}])assert.throws(()=>validateJob({...job,...changes},{now}));
});
test('call destination and job identifiers cannot inject a CLI, channel or path',()=>{
  for(const dialNumber of ['9000000001','+019000000001','+919000000001\nSystem(evil)','+919000000001&Mobile/other/123','+919000000001;exit','+919000000001 extension s@evil','tel:+919000000001'])assert.throws(()=>originateRequest({...job,dialNumber},{SAMARTH_ASTERISK_DEVICE:'samarthphone'},{now}));
  for(const badId of ['../../etc/passwd',`${id}/other`,`${id}\nexit`,'not-uuid'])assert.throws(()=>jobPaths(badId));
});
test('originate request is only a validated argv with fixed answered context',()=>{
  const request=originateRequest(job,{SAMARTH_ASTERISK_DEVICE:'samarthphone'},{now});
  assert.deepEqual(request.args,['-rx',`channel originate Mobile/samarthphone/+919000000001 extension ${id}@samarth-checkin`]);
  assert.equal(request.command,'asterisk');assert.equal(request.shell,false);assert.equal(request.acceptanceIsNotAnswer,true);
  assert.equal(request.manifestPath,`/var/lib/samarth/jobs/${id}.json`);
  assert.equal(request.resultPath,`/var/lib/samarth/results/${id}.json`);
  for(const device of ['',undefined,'phone/other','phone newcall','phone;exit','phone\nCommand: System','../phone'])assert.throws(()=>originateRequest(job,{SAMARTH_ASTERISK_DEVICE:device},{now}));
});
test('answer metadata never allows arbitrary audio paths, unconsented audio or false completion',()=>{
  const value={version:1,jobId:id,status:'answers_recorded',consentGranted:true,consentedAt:'2026-10-29T10:00:00Z',startedAt:'2026-10-29T10:00:00Z',completedAt:'2026-10-29T10:01:00Z',callAnswered:true,externalDelivery:true,source:'asterisk-bluetooth-sim',transcriptionStatus:'not_started',requiresHumanReview:true,answers:['wellbeing','medication','appetite','support'].map((questionId,i)=>({questionId,path:`/var/lib/samarth/recordings/${id}/q${i+1}.wav`,durationSeconds:2,sampleRate:8000,channels:1,sampleWidth:2}))};
  assert.equal(parseBridgeResult(value,id).answers.length,4);
  assert.throws(()=>parseBridgeResult({...value,consentGranted:false},id));
  assert.throws(()=>parseBridgeResult({...value,answers:value.answers.slice(0,3)},id));
  assert.throws(()=>parseBridgeResult({...value,answers:value.answers.map((a,i)=>i?a:{...a,path:'/etc/passwd'})},id));
  assert.throws(()=>parseBridgeResult({...value,answers:value.answers.map(a=>({...a,durationSeconds:31}))},id));
  assert.throws(()=>parseBridgeResult({...value,status:'delivered'},id));
  assert.throws(()=>parseBridgeResult({...value,callAnswered:false,externalDelivery:false},id));
  assert.throws(()=>parseBridgeResult({...value,completedAt:'2026-10-29T10:10:00Z'},id));
  assert.equal(parseBridgeResult({...value,status:'declined',consentGranted:false,consentedAt:null,answers:[]},id).status,'declined');
});
test('Windows preflight only checks Python and never attempts a call or installation',()=>{
  const commands=[];
  const result=inspectCallBridge({platform:'win32',run:(file,args)=>{commands.push([file,args]);return {ok:true,output:'Python 3.13'};}});
  assert.equal(result.ready,false);assert.equal(result.callsStarted,0);assert.equal(result.readOnly,true);
  assert.deepEqual(commands,[['python',['--version']]]);
});
test('Linux preflight inspects known read-only commands without exposing hardware identifiers',()=>{
  const commands=[];
  const result=inspectCallBridge({platform:'linux',run:(file,args)=>{commands.push([file,args]);return {ok:true,output:args.includes('module show like chan_mobile.so')?'chan_mobile.so Bluetooth driver\n1 modules loaded':args.includes('mobile show devices')?'samarthphone AA:BB:CC:DD:EE:FF 1 samarth-bt Yes Free No':'available'};},exists:()=>true,list:()=>['hci0'],read:()=>Buffer.from('RIFF'+''.padEnd(4)+'WAVE'+''.padEnd(40))});
  assert.equal(result.ready,true);assert.equal(result.callsStarted,0);
  assert.ok(commands.every(([,args])=>!args.some(a=>/originate|module load|pair|connect|install/.test(a))));
  assert.ok(!JSON.stringify(result).includes('AA:BB:CC:DD:EE:FF'));
});
test('optional manager access stays disabled and AGI has a hard call duration',()=>{
  const manager=readFileSync(new URL('../bridge/asterisk/manager.conf.sample',import.meta.url),'utf8');
  assert.match(manager,/^enabled=no$/m);assert.match(manager,/^bindaddr=127\.0\.0\.1$/m);assert.ok(!/^write=.*(?:system|command|all)/m.test(manager));
  const dialplan=readFileSync(new URL('../bridge/asterisk/extensions.conf.sample',import.meta.url),'utf8');
  assert.match(dialplan,/TIMEOUT\(absolute\)=240/);assert.match(dialplan,/AGI\(samarth_checkin\.py,\$\{EXTEN\}\)/);
});
test('Python AGI mock covers consent decline timeout disconnect bounded recording and replay guard',t=>{
  const executable=process.platform==='win32'?'python':'python3';
  const version=spawnSync(executable,['--version'],{encoding:'utf8',windowsHide:true,shell:false});
  if(version.error){t.skip('Python3 is required for local AGI protocol verification.');return;}
  const result=spawnSync(executable,['-B','bridge/asterisk/test_agi_protocol.py'],{encoding:'utf8',windowsHide:true,shell:false,timeout:15000});
  assert.equal(result.status,0,result.stderr);const summary=JSON.parse(result.stdout);
  assert.ok(summary.checks>=30);assert.equal(summary.callsStarted,0);assert.equal(summary.networkRequests,0);
});
