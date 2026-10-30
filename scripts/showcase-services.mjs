/** Start already configured local showcase services. No inbox reading, model
 * downloads, provider calls, permission grants or automatic billing changes. */
import {existsSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const flags=new Set(process.argv.slice(2));
if([...flags].some(value=>!['--start','--check'].includes(value)))throw Error('Use --start or --check.');
const health=async(port,valid)=>{
 try{const response=await fetch(`http://127.0.0.1:${port}/health`,{redirect:'error',signal:AbortSignal.timeout(2000)});const data=await response.json();return response.ok&&valid(data)?data:null;}catch{return null;}
};
const phoneHealth=()=>health(8089,data=>data.listening===true&&typeof data.webhooks==='number');
const speechHealth=()=>health(8766,data=>data.engine==='faster-whisper'&&data.modelInstalled===true);
function run(file,args=[]){
 const result=spawnSync(process.execPath,[file,...args],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:30000});
 if(result.error||result.status!==0)throw Error('Setup could not finish '+path.basename(file)+'. Check the phone connection and private configuration.');
}
function launch(script,label){
 mkdirSync('outputs',{recursive:true});
 const out=openSync(`outputs/${label}.stdout.log`,'a'),err=openSync(`outputs/${label}.stderr.log`,'a');
 try{
  const child=spawn(process.execPath,[script],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',out,err]});
  child.once('error',()=>console.error(label+' could not start. Check its local log.'));
  child.unref();
 }finally{closeSync(out);closeSync(err);}
}
let phone=await phoneHealth(),speech=await speechHealth();
if(flags.has('--start')){
 run('scripts/phone-intake-receiver.mjs',['--check']);
 run('scripts/phone-intake-receiver.mjs',['--pair']);
 run('scripts/phone-intake-receiver.mjs',['--register']);
 if(!phone)launch('scripts/phone-intake-receiver.mjs','phone-receiver');
 if(!speech){
  if(!existsSync('.local-tools/speech/venv/Scripts/python.exe')&&!existsSync('.local-tools/speech/venv/bin/python'))throw Error('Install the documented local transcription environment first.');
  launch('scripts/start-speech.mjs','speech');
 }
 // Bound startup polling; this does not create a call, message or care record.
 for(let attempt=0;attempt<20&&(!phone||!speech||!phone.alertWorker?.lastSuccessAt||phone.alertWorker?.errorStage);attempt++){
  await new Promise(resolve=>setTimeout(resolve,1000));
  [phone,speech]=await Promise.all([phoneHealth(),speechHealth()]);
 }
}
console.log(JSON.stringify({website:'https://swasthsync.vercel.app/',incomingSms:{online:!!phone,cloudWorkerHealthy:!!phone?.alertWorker?.lastSuccessAt&&!phone?.alertWorker?.errorStage},localTranscription:{online:!!speech,ready:speech?.ready===true,model:speech?.model||null},trialCalls:'Use Calls & SMS in the website; saved consent and provider verification required. Calls are never started by this launcher.',notice:'The website runs in the cloud. Keep this laptop, USB phone and SMS Gateway online for SMS; local transcription runs only on this laptop.'},null,2));
if(!phone||!speech?.ready||!phone.alertWorker?.lastSuccessAt||phone.alertWorker?.errorStage)process.exitCode=2;
