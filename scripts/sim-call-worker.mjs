/** Prepared Linux bridge. Importing this module or running it without --allow-calls never dials. */
import {relayRole} from '../lib/relay-role.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {CALL_SPOOL_ROOT,jobPaths,originateRequest,parseBridgeResult} from '../bridge/asterisk/adapter.mjs';
import {signBridgeRequest} from '../lib/telephony.mjs';
import {inspectCallBridge} from './check-call-bridge.mjs';

const execute=promisify(execFile),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fail=message=>{throw new Error(message);};
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
export const SIM_WORKER_LIMITS=Object.freeze({resultWaitMs:300000,transcriptionWaitMs:240000,maxResultBytes:32768,maxAudioBytes:500000});

export function workerConfiguration(env={}) {
  let origin;try{origin=new URL(env.SAMARTH_APP_URL||'http://127.0.0.1:5173');}catch{fail('Configure the care application origin.');}
  if(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))fail('Use HTTPS for a public care application.');
  if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)fail('Configure only the application origin, without credentials or a path.');
  if(typeof env.SAMARTH_SIM_BRIDGE_SECRET!=='string'||env.SAMARTH_SIM_BRIDGE_SECRET.length<32||env.SAMARTH_SIM_BRIDGE_SECRET.length>256)fail('Configure the private SIM bridge credential.');
  if(typeof env.SAMARTH_RELAY_EMAIL!=='string'||!env.SAMARTH_RELAY_EMAIL.includes('@')||typeof env.SAMARTH_RELAY_PASSWORD!=='string'||env.SAMARTH_RELAY_PASSWORD.length<8)fail('Configure an assigned care account privately.');
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(env.SAMARTH_ASTERISK_DEVICE||''))fail('Configure the paired Asterisk mobile-device identifier.');
  return {role:relayRole(env),origin:origin.origin,secret:env.SAMARTH_SIM_BRIDGE_SECRET,email:env.SAMARTH_RELAY_EMAIL,password:env.SAMARTH_RELAY_PASSWORD,device:env.SAMARTH_ASTERISK_DEVICE};
}

export function assertLiveCallReady({allowCalls=false,platform=process.platform,preflight,env={}}={}) {
  if(!allowCalls)fail('Live calls require the explicit --allow-calls argument.');
  if(platform!=='linux')fail('This prepared Bluetooth voice bridge requires Linux; no call was started.');
  if(env.SAMARTH_SIM_AUDIO_VERIFIED!=='true')fail('Verify two-way audio and hangup on an authorized owned-number call before enabling this worker.');
  if(preflight?.ready!==true||preflight?.readOnly!==true||preflight?.callsStarted!==0)fail('The read-only Linux/Asterisk/Bluetooth preflight is not ready.');
}

/** Cookie state stays in this process; no service-role key, raw JWT log or browser login bypass. */
export function createCareClient(config,{fetchImpl=fetch}={}) {
  const cookies=new Map();
  async function api(path,method='GET',body) {
    if(!/^[a-z0-9][a-z0-9/_-]*$/i.test(path)||path.includes('..'))fail('Invalid protected API path.');
    const raw=body===undefined?'':JSON.stringify(body),pathname='/api/'+path;
    const signed=path.startsWith('sim-calls/')?await signBridgeRequest({method,path:pathname,body:raw,secret:config.secret}):{};
    const response=await fetchImpl(new URL(pathname,config.origin),{method,headers:{...signed,Origin:config.origin,...(raw?{'content-type':'application/json'}:{}),Cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; ')},body:raw||undefined,redirect:'error',signal:AbortSignal.timeout(25000)});
    for(const value of response.headers.getSetCookie?.()||[]){const first=value.split(';')[0],index=first.indexOf('=');if(index>0)cookies.set(first.slice(0,index),first.slice(index+1));}
    let data;try{data=await response.json();}catch{fail('The care application returned an unreadable response.');}
    if(!response.ok){const error=new Error(data.error||'The protected care request failed.');error.status=response.status;throw error;}return data;
  }
  return {api,async login(){await api('auth/login','POST',{email:config.email,password:config.password,role:config.role||'coordinator'});await api('session','POST',{role:config.role||'coordinator'});}};
}

async function privateDirectory(path) {
  const info=await fs.lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o022)||await fs.realpath(path)!==path)fail('The fixed SIM spool must contain private, real directories.');
}
async function privateRead(path,maxBytes) {
  const file=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.size<=0||info.size>maxBytes||(info.mode&0o022))fail('A private bridge file is missing, too large, linked or writable by another account.');return await file.readFile();}finally{await file.close();}
}
async function writeOnce(path,value) {
  const file=await fs.open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
}
export function createPrivateSpool() {
  const root=CALL_SPOOL_ROOT;
  return {
    async lock(){
      for(const name of [root,root+'/jobs',root+'/results',root+'/recordings',root+'/control'])await privateDirectory(name);
      const path=root+'/control/worker.lock';
      await writeOnce(path,{version:1,pid:process.pid,startedAt:new Date().toISOString()});
      return async()=>{await fs.unlink(path);};
    },
    async stage(manifest){
      const paths=jobPaths(manifest.id);
      // The authoritative server claim is already single-use. Never overwrite local evidence.
      for(const path of [paths.manifestPath,paths.resultPath,`${root}/control/${manifest.id}.submission.json`]){
        try{await fs.lstat(path);fail('Local evidence already exists for this call. Inspect it; do not redial.');}catch(error){if(error.code!=='ENOENT')throw error;}
      }
      await writeOnce(paths.manifestPath,manifest);
    },
    async markSubmitting(id){await writeOnce(`${root}/control/${id}.submission.json`,{version:1,jobId:id,phase:'submission_started',createdAt:new Date().toISOString()});},
    async waitResult(id,{timeoutMs=SIM_WORKER_LIMITS.resultWaitMs}={}){
      const path=jobPaths(id).resultPath,deadline=Date.now()+timeoutMs;
      do{try{return parseBridgeResult(JSON.parse((await privateRead(path,SIM_WORKER_LIMITS.maxResultBytes)).toString('utf8')),id);}catch(error){if(error.code!=='ENOENT')throw error;}await pause(500);}while(Date.now()<deadline);
      fail('No terminal local channel evidence arrived before the bounded wait. Inspect Asterisk before any new call.');
    },
    async audio(id,answer){
      const paths=jobPaths(id);
      if(!answer.path.startsWith(paths.recordingDirectory+'/')||!/^q[1-4]\.wav$/.test(answer.path.slice(paths.recordingDirectory.length+1)))fail('Unexpected local answer path.');
      await privateDirectory(paths.recordingDirectory);
      const bytes=await privateRead(answer.path,SIM_WORKER_LIMITS.maxAudioBytes);
      if(bytes.length<44||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WAVE')fail('Recorded answer is not a WAV file.');
      return bytes;
    },
    async record(id,phase,value){if(!uuid(id)||!/^[a-z_]{1,32}$/.test(phase))fail('Invalid local evidence identifier.');await writeOnce(`${root}/control/${id}.${phase}.json`,{version:1,jobId:id,phase,createdAt:new Date().toISOString(),...value});},
  };
}

export async function transcribeRecordedAnswers({job,result,api,spool,origin,fetchImpl=fetch}) {
  if(result.consentGranted!==true||!result.answers.length)return [];
  const draftIds=[];
  for(const answer of result.answers) {
    const bytes=await spool.audio(job.id,answer);
    const ticket=await api('speech/ticket','POST',{seniorId:job.seniorId,consentConfirmed:true});
    if(ticket.serviceUrl!=='http://127.0.0.1:8766'||!uuid(ticket.ticketId)||typeof ticket.ticket!=='string')fail('The paired local speech ticket is invalid.');
    const response=await fetchImpl(ticket.serviceUrl+'/transcribe',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+ticket.ticket,'content-type':'audio/wav'},body:bytes,redirect:'error',signal:AbortSignal.timeout(SIM_WORKER_LIMITS.transcriptionWaitMs)});
    if(!response.ok)fail('Local speech recognition did not complete; recorded audio remains private for manual review.');
    const value=await response.json();
    if(!value.receipt||typeof value.receipt.payload!=='string'||typeof value.receipt.signature!=='string')fail('The local speech service did not return a signed receipt.');
    // Retain the receipt before cloud saving, so a lost HTTP response does not require recognition again.
    await spool.record(job.id,'transcript_'+answer.questionId,{ticketId:ticket.ticketId,receipt:value.receipt});
    const saved=await api('speech/drafts','POST',{receipt:value.receipt,consentConfirmed:true});
    if(saved.draft?.id!==ticket.ticketId)fail('The saved transcript draft did not match its speech ticket.');
    draftIds.push(ticket.ticketId);
  }
  await api(`sim-calls/jobs/${job.id}/transcripts`,'POST',{leaseToken:job.leaseToken,draftIds});
  return draftIds;
}

/** Dependencies are injected in tests; production uses the fixed private spool and execFile. */
export async function processSimCall(pending,{api,spool,env,origin,executeImpl=execute,fetchImpl=fetch,now=Date.now,log=()=>{}}) {
  const {job}=await api(`sim-calls/jobs/${pending.id}/claim`,'POST',{});
  if(!job||job.id!==pending.id||!uuid(job.id)||typeof job.leaseToken!=='string')fail('The protected call claim did not match the queued job.');
  let actionStarted=false,result;
  const receipt=(status,evidence={})=>api(`sim-calls/jobs/${job.id}/receipt`,'POST',{leaseToken:job.leaseToken,status,callAnswered:false,consentGranted:false,audioCount:0,...evidence});
  try{
    const manifest={version:1,id:job.id,jobId:job.id,dialNumber:job.phone,language:job.language,approved:true,expiresAt:Math.min(Date.parse(job.expiresAt),Date.parse(job.leaseExpiresAt))};
    const request=originateRequest(manifest,env,{now:now()});
    await spool.stage(manifest);
    await spool.markSubmitting(job.id);actionStarted=true;
    // Never invoke a shell. Destination and device were validated by the pure adapter.
    await executeImpl(request.command,[...request.args],{shell:false,timeout:15000,maxBuffer:16384,encoding:'utf8'});
    try{await receipt('originated');}catch{/* Still collect terminal device evidence; do not invoke Asterisk again. */}
    result=await spool.waitResult(job.id);
    const proof={callAnswered:result.callAnswered===true,consentGranted:result.consentGranted===true,audioCount:result.answers.length};
    await spool.record(job.id,'terminal_evidence',{status:result.status,...proof});
    await receipt(result.status,proof);
  }catch{
    // A lost command response can mean the SIM was dialled. Keep that state terminal and unretryable.
    const status=actionStarted?'submission_unknown':'failed';
    try{await spool.record(job.id,'worker_failure',{status,actionStarted});}catch{/* Preserve earlier durable evidence. */}
    if(!result)try{await receipt(status);}catch{/* No redial or second mutation is attempted. */}
    const stopped=new Error(actionStarted?'Call state needs inspection. No redial was attempted; the worker stopped.':'The approved call could not be staged. No dial command was run.');stopped.requiresInspection=actionStarted;throw stopped;
  }
  log('Terminal device evidence saved. An answered channel does not establish a human care outcome.');
  if(result.consentGranted&&result.answers.length){
    try{const ids=await transcribeRecordedAnswers({job,result,api,spool,origin,fetchImpl});log(`${ids.length} local transcript drafts saved; coordinator review is still required.`);}catch{log('Transcription or draft association needs manual attention. The call will not be repeated.');return {jobId:job.id,status:result.status,transcription:'needs_attention'};}
  }
  return {jobId:job.id,status:result.status,transcription:result.answers.length?'drafts_saved':'not_requested'};
}

export async function main(args=process.argv.slice(2),env=process.env) {
  if(args.some(arg=>!['--check','--allow-calls','--watch'].includes(arg))||args.includes('--check')&&args.includes('--allow-calls'))fail('Use --check, or --allow-calls with optional --watch.');
  const preflight=inspectCallBridge({deviceName:env.SAMARTH_ASTERISK_DEVICE});
  if(!args.includes('--allow-calls')){
    console.log(JSON.stringify({...preflight,workerMode:'check_only',explicitCallsEnabled:false},null,2));return;
  }
  assertLiveCallReady({allowCalls:true,preflight,env});
  const config=workerConfiguration(env),spool=createPrivateSpool(),release=await spool.lock();
  try{
    const client=createCareClient(config);await client.login();
    do{
      const ready=inspectCallBridge({deviceName:config.device});assertLiveCallReady({allowCalls:true,preflight:ready,env});
      await client.api('sim-calls/bridge/heartbeat','POST',{deviceReady:true});
      const {jobs}=await client.api('sim-calls/bridge/jobs');
      if(!Array.isArray(jobs))fail('The protected call queue is invalid.');
      if(jobs.length)await processSimCall(jobs[0],{api:client.api,spool,env:{SAMARTH_ASTERISK_DEVICE:config.device},origin:config.origin,log:message=>console.log(message)});
      if(args.includes('--watch'))await pause(15000);
    }while(args.includes('--watch'));
  }finally{await release();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await fs.access('.dev.vars.sim-call-worker');process.loadEnvFile('.dev.vars.sim-call-worker');}catch(error){if(error.code!=='ENOENT')throw error;}
  main().catch(()=>{console.error('SIM voice worker stopped. Check the private setup and local call evidence before restarting. No automatic redial is performed.');process.exitCode=1;});
}
