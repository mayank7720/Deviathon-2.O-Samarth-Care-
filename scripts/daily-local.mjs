import { DatabaseSync } from 'node:sqlite';
import { readdirSync,existsSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runWorkspaceDaily } from '../lib/job-runner.mjs';
import {showcaseEnvironment} from '../lib/model-runtime.mjs';

const root=resolve(import.meta.dirname,'..');
const directory=resolve(root,'.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const watch=process.argv.includes('--watch');
let busy=false,lastStatus='';
function environment(){const env={...process.env};const path=resolve(root,'.dev.vars');if(existsSync(path))for(const line of readFileSync(path,'utf8').split(/\r?\n/)){const found=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(found)env[found[1]]=found[2].trim().replace(/^['"]|['"]$/g,'');}return env;}
async function tick(){
  if(busy)return;busy=true;
  let sqlite;
  try {
    const env=showcaseEnvironment(environment());
    if(env.SAMARTH_AUTH_MODE==='supabase'||env.CLOUDFLARE_ENV==='supabase')return; // Local SQLite jobs must not impersonate cloud users.
    const files=existsSync(directory)?readdirSync(directory).filter(f=>f.endsWith('.sqlite')&&f!=='metadata.sqlite'):[];
    if(files.length!==1){if(!watch)console.log('Daily processing needs one initialized local care database. Run npm run db:init first.');return;}
    sqlite=new DatabaseSync(resolve(directory,files[0]));sqlite.exec('PRAGMA busy_timeout=5000');
    if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='care_jobs'").get())return;
    const db={prepare(sql){const stmt=sqlite.prepare(sql);const wrap=(args=[])=>({bind:(...v)=>wrap(v),first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)}),run:async()=>{const value=stmt.run(...args);return {meta:{changes:Number(value.changes)}};}});return wrap();},async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
    const result=await runWorkspaceDaily(db,env);
    const status=JSON.stringify(result);
    if(status!==lastStatus&&result.job?.status!=='already_completed'){console.log('Daily care processing:',status);lastStatus=status;}
  }catch(error){console.error('Daily care processing could not finish:',error.status||'retry pending');process.exitCode=watch?0:1;}
  finally{sqlite?.close();busy=false;}
}
await tick();
if(watch)setInterval(tick,60000);
