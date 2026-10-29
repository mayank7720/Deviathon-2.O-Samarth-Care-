/** Start only the already installed, paired local speech service. */
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const python=path.join(root,'.local-tools','speech','venv',...(process.platform==='win32'?['Scripts','python.exe']:['bin','python']));
if(process.argv.length>2)throw new Error('The speech launcher takes no arguments. Configure its private settings file instead.');
if(!existsSync(python))throw new Error('The local speech environment is missing. Run the documented speech setup first.');
if(!existsSync(path.join(root,'.dev.vars.speech'))&&!process.env.SAMARTH_SPEECH_SECRET)throw new Error('Pair local speech in the private settings file before starting it.');
const child=spawn(python,['-B',path.join(root,'scripts','speech_service.py')],{cwd:root,stdio:'inherit',windowsHide:true,shell:false});
child.once('error',()=>{console.error('The local speech service could not launch. Check the installed environment.');process.exitCode=1;});
child.once('exit',(code,signal)=>{process.exitCode=signal?1:code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
