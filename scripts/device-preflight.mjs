/** Read-only Android pairing inspection. It cannot install, grant, dial or send. */
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
export function adbDevices(output=''){
  return String(output).split(/\r?\n/).filter(line=>line&&!line.startsWith('List of devices')&&!line.startsWith('*')).map(line=>{
    const parts=line.trim().split(/\s+/);return {serial:parts[0],state:parts[1]};
  }).filter(row=>row.serial&&['device','unauthorized','offline','recovery','sideload','bootloader'].includes(row.state));
}
const configured=value=>typeof value==='string'&&value.length>0&&!/REPLACE|PLACEHOLDER|<.+>/i.test(value);
export function inspectAndroidPhone({env=process.env,exists=existsSync,read=readFileSync,run=(file,args)=>{
  const value=spawnSync(file,args,{encoding:'utf8',windowsHide:true,shell:false,timeout:10000,maxBuffer:100000});
  return {ok:!value.error&&value.status===0,output:value.stdout||''};
},platform=process.platform,repoRoot=root}={}){
  let privateConfig={};
  try{const filename=path.join(repoRoot,'.dev.vars.android-relay');if(exists(filename))privateConfig=parseEnv(read(filename,'utf8'));}catch{}
  const settings={...privateConfig,...env};
  const bundled=path.join(repoRoot,'.local-tools','platform-tools',platform==='win32'?'adb.exe':'adb');
  const executable=settings.SAMARTH_ADB_PATH||(exists(bundled)?bundled:'adb');
  const version=run(executable,['version']);
  const checks={adbAvailable:version.ok,connectedDevices:0,authorization:'not_connected',model:null,androidVersion:null,usbGatewayForwarded:false,gatewayCredentialsConfigured:configured(settings.SAMARTH_ANDROID_GATEWAY_USERNAME)&&configured(settings.SAMARTH_ANDROID_GATEWAY_PASSWORD),relayAccountConfigured:configured(settings.SAMARTH_RELAY_EMAIL)&&configured(settings.SAMARTH_RELAY_PASSWORD),bridgeSecretConfigured:configured(settings.SAMARTH_ANDROID_BRIDGE_SECRET)&&settings.SAMARTH_ANDROID_BRIDGE_SECRET.length>=32};
  if(version.ok){
    const listing=run(executable,['devices','-l']);const devices=listing.ok?adbDevices(listing.output):[];
    checks.connectedDevices=devices.length;
    if(devices.length>1)checks.authorization='multiple_devices_choose_one';
    else if(devices.length===1){
      const device=devices[0];checks.authorization=device.state==='device'?'authorized':device.state;
      if(device.state==='device'){
        const prop=name=>{const value=run(executable,['-s',device.serial,'shell','getprop',name]);const output=value.output.trim();return value.ok&&output.length<=100&&!/[\r\n]/.test(output)?output:null;};
        checks.model=prop('ro.product.model');checks.androidVersion=prop('ro.build.version.release');
        const forwarding=run(executable,['forward','--list']);
        checks.usbGatewayForwarded=forwarding.ok&&forwarding.output.split(/\r?\n/).some(line=>{const fields=line.trim().split(/\s+/);return fields[0]===device.serial&&fields[1]==='tcp:8080'&&fields[2]==='tcp:8080';});
      }
    }
  }
  const nextSteps=[];
  if(!checks.adbAvailable)nextSteps.push('Install official Android Platform Tools or configure its local adb path.');
  else if(checks.authorization==='unauthorized')nextSteps.push('Unlock your phone and accept Allow USB debugging for this computer. Run this check again.');
  else if(checks.authorization==='multiple_devices_choose_one')nextSteps.push('Disconnect other Android devices so the intended showcase phone is unambiguous.');
  else if(checks.authorization!=='authorized')nextSteps.push('Connect the intended phone by USB and enable debugging on the phone.');
  if(checks.authorization==='authorized'&&!checks.usbGatewayForwarded)nextSteps.push('After starting the phone gateway, forward its local port: adb forward tcp:8080 tcp:8080.');
  if(!checks.gatewayCredentialsConfigured)nextSteps.push('Start SMS Gateway Local Server on the phone, then save its credentials in the private relay settings.');
  if(!checks.relayAccountConfigured||!checks.bridgeSecretConfigured)nextSteps.push('Complete the private coordinator and bridge configuration for the relay.');
  const ready=checks.authorization==='authorized'&&checks.usbGatewayForwarded&&checks.gatewayCredentialsConfigured&&checks.relayAccountConfigured&&checks.bridgeSecretConfigured;
  return {version:1,readOnly:true,smsSent:0,callsStarted:0,permissionsGranted:0,readyForGatewayProbe:ready,checks,nextSteps,notice:'This inspection does not contact the gateway, test carrier service, send messages, grant phone permissions or install software. A ready result still requires one explicitly approved owned-number test.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.slice(2).some(arg=>arg!=='--check'))throw new Error('This script only supports the read-only --check option.');
  const report=inspectAndroidPhone();console.log(JSON.stringify(report,null,2));process.exitCode=report.readyForGatewayProbe?0:2;
}
