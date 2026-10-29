/** Read-only hardware preflight. It never pairs devices, installs modules or originates a call. */
import {spawnSync} from 'node:child_process';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const probe=(file,args)=>{
  const result=spawnSync(file,args,{encoding:'utf8',timeout:5000,windowsHide:true,shell:false,maxBuffer:128*1024});
  return {available:!result.error,ok:!result.error&&result.status===0,output:result.stdout||''};
};

export function inspectCallBridge({platform=process.platform,deviceName,run=probe,exists=existsSync,list=readdirSync,read=readFileSync}={}) {
  const python=run(platform==='win32'?'python':'python3',['--version']);
  const checks={python:{available:python.ok},asterisk:{available:false,running:false,mobileModuleLoaded:false},bluetooth:{bluezAvailable:false,controllerPresent:false,pairedMobileReady:false},prompts:{present:false}};
  if(platform!=='linux')return {version:1,platform,ready:false,readOnly:true,callsStarted:0,checks,reason:'The supplied Asterisk mobile bridge requires Linux, BlueZ and exclusive access to a compatible Bluetooth controller. Windows/ordinary WSL is not a verified call bridge. No installation or pairing was attempted.'};
  const asterisk=run('asterisk',['-V']);checks.asterisk.available=asterisk.ok;
  const version=asterisk.ok?run('asterisk',['-rx','core show version']):{ok:false};checks.asterisk.running=version.ok;
  if(version.ok){
    const modules=run('asterisk',['-rx','module show like chan_mobile.so']);
    checks.asterisk.mobileModuleLoaded=modules.ok&&/chan_mobile\.so/.test(modules.output)&&!/0 modules loaded/i.test(modules.output);
    if(checks.asterisk.mobileModuleLoaded){
      const devices=run('asterisk',['-rx','mobile show devices']);
      checks.bluetooth.pairedMobileReady=devices.ok&&devices.output.split(/\r?\n/).some(row=>/^\S+\s+(?:[a-f\d]{2}:){5}[a-f\d]{2}\s+\S+\s+\S+\s+Yes\s+Free\b/i.test(row)&&(!deviceName||row.trim().split(/\s+/)[0]===deviceName));
    }
  }
  const bluez=run('bluetoothctl',['--version']);checks.bluetooth.bluezAvailable=bluez.ok;
  try{checks.bluetooth.controllerPresent=exists('/sys/class/bluetooth')&&list('/sys/class/bluetooth').some(name=>/^hci\d+$/.test(name));}catch{}
  try{checks.prompts.present=['hi','en'].every(language=>['consent','q1','q2','q3','q4','thanks','declined'].every(name=>{
    const filename=`/var/lib/asterisk/sounds/samarth/${language}/${name}.wav`;
    if(!exists(filename))return false;
    const bytes=read(filename);return bytes.length>44&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE';
  }));}catch{}
  const ready=checks.python.available&&checks.asterisk.running&&checks.asterisk.mobileModuleLoaded&&checks.bluetooth.bluezAvailable&&checks.bluetooth.controllerPresent&&checks.bluetooth.pairedMobileReady&&checks.prompts.present;
  return {version:1,platform,ready,readOnly:true,callsStarted:0,checks,reason:ready?'Local prerequisites are visible. Two-way audio, explicit consent capture, transcription and reliable hangup still require an authorized owned-number call; this preflight proves none of those.':'One or more local prerequisites are missing. This script does not install, pair, load modules or place test calls.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const report=inspectCallBridge();
  process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
  process.exitCode=report.ready?0:2;
}
