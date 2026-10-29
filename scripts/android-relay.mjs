/** Local-only bridge between the public care API and a USB-forwarded Android.
 * Run manually after pairing; it does not install software or change a phone.
 */
import {relayRole} from '../lib/relay-role.mjs';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { androidSmsRequest,androidSmsStatus,probeAndroidGateway,signBridgeRequest } from '../lib/telephony.mjs';

if(existsSync('.dev.vars.android-relay'))process.loadEnvFile('.dev.vars.android-relay');
const env=process.env,origin=new URL(env.SAMARTH_APP_URL||'http://127.0.0.1:5173');
if(origin.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw new Error('Use HTTPS for the public care application.');
if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Configure the application origin only.');
if(!env.SAMARTH_ANDROID_BRIDGE_SECRET||env.SAMARTH_ANDROID_BRIDGE_SECRET.length<32)throw new Error('Configure the private Android bridge credential.');
const assignedRole=relayRole(env);
let cookies=new Map(),active=false;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(path,method='GET',body) {
  const raw=body===undefined?'':JSON.stringify(body),pathname='/api/'+path;
  const signed=path.startsWith('telephony/')?await signBridgeRequest({method,path:pathname,body:raw,secret:env.SAMARTH_ANDROID_BRIDGE_SECRET}):{};
  const response=await fetch(new URL(pathname,origin),{method,headers:{...signed,Origin:origin.origin,...(raw?{'content-type':'application/json'}:{}),Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')},body:raw||undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
  for(const value of response.headers.getSetCookie()){const first=value.split(';')[0],index=first.indexOf('=');cookies.set(first.slice(0,index),first.slice(index+1));}
  let data;try{data=await response.json();}catch{throw new Error('The care application returned an invalid response.');}
  if(!response.ok){const error=new Error(data.error||'The care application could not complete the request.');error.status=response.status;throw error;}return data;
}
async function login() {
  if(env.SAMARTH_RELAY_LOCAL_DEMO==='true') {
    if(!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw new Error('Fixture login is restricted to loopback.');
    await api('auth/local-login','POST',{role:assignedRole});
  }else {
    if(!env.SAMARTH_RELAY_EMAIL||!env.SAMARTH_RELAY_PASSWORD)throw new Error('Configure the assigned care account for the Android relay.');
    await api('auth/login','POST',{email:env.SAMARTH_RELAY_EMAIL,password:env.SAMARTH_RELAY_PASSWORD,role:assignedRole});
    await api('session','POST',{role:assignedRole});
  }
}
async function receipt(job,proof){return api(`telephony/jobs/${job.id}/receipt`,'POST',{leaseToken:job.leaseToken,providerId:job.id,status:proof.status});}
async function runJob(pending) {
  const {job}=await api(`telephony/jobs/${pending.id}/claim`,'POST',{});
  if(job.channel==='android_dialer') {
    if(env.SAMARTH_ANDROID_DIALER_ENABLED!=='true')throw new Error('Enable the assisted device dialer explicitly before claiming call jobs.');
    await promisify(execFile)(env.SAMARTH_ADB_PATH||'adb',['shell','am','start','-a','android.intent.action.DIAL','-d',`tel:${job.phone}`],{windowsHide:true,timeout:10000,maxBuffer:10000});
    await receipt(job,{status:'awaiting_device_action'});
    console.log('Opened the paired phone dialer. A person must press Call; no connected-call receipt is claimed.');return;
  }
  let proof=await androidSmsRequest(job,env);
  await receipt(job,proof);
  console.log(`SMS job ${job.id.slice(0,8)}: ${proof.status}.`);
  // The handset/carrier may omit delivery reports. Never invent Delivered or
  // resend a message merely because its later state is indeterminate.
  for(let attempt=0;attempt<36&&!['delivered','failed','cancelled'].includes(proof.status);attempt++) {
    await pause(5000);const next=await androidSmsStatus(job,env);
    if(next.status!==proof.status){await receipt(job,next);proof=next;console.log(`SMS job ${job.id.slice(0,8)}: ${proof.status}.`);}
  }
}
async function tick() {
  if(active)return;active=true;
  try {
    await probeAndroidGateway(env);
    await api('telephony/bridge/heartbeat','POST',{deviceReady:true});
    const {jobs}=await api('telephony/bridge/jobs');
    for(const job of jobs) {
      if(job.channel==='android_dialer'&&env.SAMARTH_ANDROID_DIALER_ENABLED!=='true')continue;
      try{await runJob(job);}catch(error){console.error(`Telephone job could not finish (${error.status||'device state unknown'}). Inspect the protected delivery log before retrying.`);}
    }
  }catch(error){if(error.status===401)await login();else console.error('Android bridge is not ready. Check its private configuration and USB connection.');}
  finally{active=false;}
}
await login();console.log('Android relay signed in. Only approved contact jobs will be processed.');await tick();
if(!process.argv.includes('--once'))setInterval(tick,15000);
