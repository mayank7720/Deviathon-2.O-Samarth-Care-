import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {createHmac} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const secret='fixture-only-gateway-key-with-no-real-access';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('phone alert receipt recovery inspects the existing gateway message and never enqueues another SMS',{timeout:15000},async t=>{
 const app=await fixture(t,'alert-recovery');
 assert.ok((await app.health()).alertWorker.lastSuccessAt);
 assert.match(app.output(),/fixture-alert-reconciled/);
 assert.ok(!app.output().includes('fixture-checkin-enqueued'));
});

// Run the real listener in an empty temporary directory. Every upstream fetch
// is intercepted before startup; no private settings, cloud or carrier is used.
async function fixture(t,mode){
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const folder=await mkdtemp(join(tmpdir(),'samarth-phone-receiver-test-'));
 const preload=join(folder,'upstream.mjs');
 await writeFile(preload,`
 let logins=0,expired=false,delivered=false;
 const checkinMode=process.env.FIXTURE_MODE.startsWith('checkin-'),alertRecovery=process.env.FIXTURE_MODE==='alert-recovery',resume=process.env.FIXTURE_MODE==='checkin-resume'||alertRecovery,awaitingReceipt=process.env.FIXTURE_MODE==='checkin-sent';
 const jobId='00000000-0000-4000-8000-000000000002',leaseToken='00000000-0000-4000-8000-000000000003';
 const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
 globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input));
  if(url.origin==='http://127.0.0.1:8080'&&url.pathname==='/message/00000000-0000-0000-0000-000000000000')return json({},404);
  if((checkinMode||alertRecovery)&&url.origin==='http://127.0.0.1:8080'){
   if(url.pathname==='/message/'+jobId)return json({id:jobId,state:'Delivered'},resume?200:404);
   if(url.pathname==='/message'&&options.method==='POST'){
    if(resume)throw Error('A recovered attempt must never enqueue another SMS');
    const value=JSON.parse(options.body);if(value.id!==jobId||value.phoneNumbers.length!==1||value.phoneNumbers[0]!=='+19990000001'||value.textMessage.text.length>160)throw Error('Incorrect assigned message');
    console.log('fixture-checkin-enqueued');return json({id:jobId,state:awaitingReceipt?'Sent':'Delivered'});
   }
  }
  if(url.origin!=='https://receiver-fixture.invalid')throw Error('Unexpected external access in fixture');
  if(url.pathname==='/api/auth/login'){logins++;if(logins>1)console.log('fixture-session-renewed');return json({},200,{'set-cookie':'fixture='+logins+'; Path=/'});}
  if(url.pathname==='/api/session')return json({});
  const expiresHere=process.env.FIXTURE_MODE==='heartbeat'?url.pathname==='/api/telephony/bridge/heartbeat':url.pathname==='/api/phone-intake/receive';
  if(expiresHere&&!expired){expired=true;return json({error:'Expired fixture session'},401);}
  if(url.pathname==='/api/telephony/bridge/heartbeat')return json({ok:true});
  if(url.pathname==='/api/phone-intake/outbound')return json({jobs:alertRecovery&&!delivered?[{id:jobId,receiptOnly:true}]:[]});
  if(alertRecovery&&url.pathname==='/api/telephony/jobs/'+jobId+'/claim'){
   if(JSON.parse(options.body).receiptOnly!==true)throw Error('Recovery must explicitly request an inspect-only lease');
   return json({job:{id:jobId,channel:'sms',leaseToken,receiptOnly:true}});
  }
  if(alertRecovery&&url.pathname==='/api/telephony/jobs/'+jobId+'/receipt'){
   const value=JSON.parse(options.body);if(value.providerId!==jobId||value.leaseToken!==leaseToken||value.status!=='delivered')throw Error('Incorrect recovered alert receipt');
   delivered=true;console.log('fixture-alert-reconciled');return json({ok:true});
  }
  if(url.pathname==='/api/sms-checkins/bridge/outbound')return json({jobs:checkinMode&&!delivered?[{id:jobId}]:[]});
  if(checkinMode&&url.pathname==='/api/sms-checkins/bridge/claim')return json({job:{id:jobId,channel:'sms',phone:'+19990000001',text:'SwasthSync: Reply 1=okay, 2=call, 3=help. Ref ABC123. STOP=stop SMS. Emergency:112.',leaseToken,receiptOnly:resume}});
  if(checkinMode&&url.pathname==='/api/sms-checkins/bridge/receipt'){
   const value=JSON.parse(options.body);if(value.id!==jobId||value.providerId!==jobId||value.leaseToken!==leaseToken||!['sent','delivered'].includes(value.status))throw Error('Incorrect durable receipt');
   delivered=value.status==='delivered';console.log('fixture-checkin-'+value.status);return json({ok:true});
  }
  if(url.pathname==='/api/sms-checkins/bridge/eligible'){
   const body=JSON.parse(options.body);if(Object.keys(body).join()!=='senderHash'||!/^[a-f0-9]{64}$/.test(body.senderHash))throw Error('Eligibility must use only a masked sender hash');
   return json({eligible:process.env.FIXTURE_MODE!=='unknown'});
  }
  if(url.pathname==='/api/phone-intake/receive')return json({ok:true,id:'00000000-0000-4000-8000-000000000001'});
  throw Error('Unexpected upstream action in fixture');
 };
 `);
 const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,fileURLToPath(new URL('../scripts/phone-intake-receiver.mjs',import.meta.url))],{
  cwd:folder,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_OPTIONS:'',FIXTURE_MODE:mode,
   SAMARTH_PHONE_INTAKE_PORT:String(port),SAMARTH_PHONE_INTAKE_APP_URL:'https://receiver-fixture.invalid',
   SAMARTH_ANDROID_GATEWAY_URL:'http://127.0.0.1:8080',SAMARTH_ANDROID_SIM_SLOT:'2',
   SAMARTH_ANDROID_WEBHOOK_SIGNING_KEY:secret,SAMARTH_ANDROID_BRIDGE_SECRET:'fixture-only-bridge-secret-with-no-real-access',
   SAMARTH_RELAY_EMAIL:'fixture@example.invalid',SAMARTH_RELAY_PASSWORD:'fixture-only-password',SAMARTH_RELAY_ROLE:'operations',
   SAMARTH_ANDROID_GATEWAY_USERNAME:'fixture',SAMARTH_ANDROID_GATEWAY_PASSWORD:'fixture-only',SAMARTH_PHONE_INTAKE_SEND_ALERTS:mode==='heartbeat'||mode==='alert-recovery'||mode.startsWith('checkin-')?'true':'false'},
 });
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 const closed=new Promise(resolve=>child.once('close',resolve));
 let stopped=false;
 async function stop(){if(stopped)return;stopped=true;if(child.exitCode===null&&!child.killed)child.kill();await closed;await unlink(preload);await rmdir(folder);}
 t.after(stop);
 const origin=`http://127.0.0.1:${port}`;
 async function health(){return (await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)})).json();}
 let ready=false;
 for(let i=0;i<60;i++){
  if(child.exitCode!==null)throw Error('Receiver fixture exited before startup: '+output);
  try{const state=await health();if(state.listening&&(!(mode==='heartbeat'||mode==='alert-recovery'||mode.startsWith('checkin-'))||state.alertWorker.lastSuccessAt)){ready=true;break;}}catch{}
  await delay(50);
 }
 assert.equal(ready,true,'Receiver fixture must start and become ready');
 return {origin,health,stop,output:()=>output};
}

async function send(origin,{sim=2,key=secret,message='HELP private-fixture-note'}={}){
 const timestamp=String(Math.floor(Date.now()/1000));
 const raw=JSON.stringify({event:'sms:received',id:'fixture-event',deviceId:'fixture-device',payload:{messageId:'fixture-message',sender:'+19990000001',message,simNumber:sim,receivedAt:new Date().toISOString()}});
 const signature=createHmac('sha256',key).update(raw+timestamp).digest('hex');
 return fetch(origin+'/sms',{method:'POST',headers:{'content-type':'application/json','x-timestamp':timestamp,'x-signature':signature},body:raw});
}

test('real local listener distinguishes rejection, filtering and durable intake without exposing message data', {timeout:15000},async t=>{
 const app=await fixture(t,'receive');
 assert.equal((await send(app.origin,{key:'fixture-wrong-key'})).status,401);
 assert.equal((await send(app.origin,{sim:1})).status,200);
 assert.equal((await send(app.origin,{message:'private unrelated SMS'})).status,200);
 const result=await send(app.origin);assert.equal(result.status,200);assert.equal((await result.json()).stored,true);
 const state=await app.health();assert.equal(state.webhooks,4);assert.equal(state.rejected,1);assert.equal(state.ignored,2);assert.equal(state.stored,1);
 const health=JSON.stringify(state);for(const privateValue of ['+19990000001','private-fixture-note',secret,'fixture@example.invalid'])assert.ok(!health.includes(privateValue));
 await app.stop();assert.match(app.output(),/fixture-session-renewed/);assert.ok(!app.output().includes('private-fixture-note'));
});

test('expired alert-worker session renews before queue processing without sending any SMS', {timeout:15000},async t=>{
 const app=await fixture(t,'heartbeat');const state=await app.health();
 assert.equal(state.alertWorker.enabled,true);assert.ok(state.alertWorker.lastSuccessAt);assert.equal(state.alertWorker.errorStage,null);
 await app.stop();assert.match(app.output(),/fixture-session-renewed/);
});

test('numeric check-in replies leave the relay only for a saved care contact; unrelated numbers stay local',{timeout:15000},async t=>{
 const known=await fixture(t,'receive');
 const saved=await send(known.origin,{message:'2'});assert.equal((await saved.json()).stored,true);
 await known.stop();
 const unknown=await fixture(t,'unknown');
 const ignored=await send(unknown.origin,{message:'2'});assert.equal((await ignored.json()).ignored,true);
 const health=await unknown.health();assert.equal(health.stored,0);assert.equal(health.lastResult,'no_care_contact');
});

test('real receiver worker sends a saved question through the adapter and records its separate delivery receipt',{timeout:15000},async t=>{
 const app=await fixture(t,'checkin-new');assert.equal((await app.health()).alertWorker.errorStage,null);
 await app.stop();assert.match(app.output(),/fixture-checkin-enqueued/);assert.match(app.output(),/fixture-checkin-delivered/);
});
test('a recovered check-in attempt only checks the saved provider ID and does not enqueue a duplicate SMS',{timeout:15000},async t=>{
 const app=await fixture(t,'checkin-resume');assert.equal((await app.health()).alertWorker.errorStage,null);
 await app.stop();assert.ok(!app.output().includes('fixture-checkin-enqueued'));assert.match(app.output(),/fixture-checkin-delivered/);
});

test('waiting for a handset receipt does not block the alert worker from completing its queue check',{timeout:10000},async t=>{
 const app=await fixture(t,'checkin-sent'),state=await app.health();
 assert.ok(state.alertWorker.lastSuccessAt);assert.equal(state.alertWorker.pendingReceiptChecks,1);assert.equal(state.alertWorker.errorStage,null);
 const result=await send(app.origin);assert.equal((await result.json()).stored,true);
 await app.stop();assert.match(app.output(),/fixture-checkin-sent/);assert.doesNotMatch(app.output(),/fixture-checkin-delivered/);
});
