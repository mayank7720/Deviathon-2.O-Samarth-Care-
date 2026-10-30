import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveConfig} from 'vite';
import {serverRuntime} from '../lib/server-runtime.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

test('portable Vite resolves Cloudflare before the broad tsconfig alias; native hosting retains Supabase auth',async(t)=>{
 const project=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const parent=resolve(project,'outputs');mkdirSync(parent,{recursive:true});
 const temporary=mkdtempSync(resolve(parent,'runtime-selection-'));
 // vinext generates route types while resolving config. Isolate those files
 // from a native Next build's .next/types directory.
 t.after(()=>{if(!temporary.startsWith(parent+sep))throw Error('Unexpected fixture path');rmSync(temporary,{recursive:true,force:true});});
 mkdirSync(resolve(temporary,'app'));mkdirSync(resolve(temporary,'worker'));
 mkdirSync(resolve(temporary,'scripts/connector-preview'),{recursive:true});
 writeFileSync(resolve(temporary,'app/page.tsx'),'export default function Page(){return null;}');
 writeFileSync(resolve(temporary,'worker/index.ts'),'export default {fetch(){return new Response("fixture");}};');
 writeFileSync(resolve(temporary,'scripts/connector-preview/worker.mjs'),'export default {fetch(){return new Response("fixture");}};');
 writeFileSync(resolve(temporary,'tsconfig.json'),JSON.stringify({compilerOptions:{paths:{'@/*':['./*']}}}));
 const config=await resolveConfig({root:temporary,configFile:resolve(project,'vite.config.ts'),logLevel:'silent'},'serve');
 const source='@/lib/server-runtime.mjs';
 // Inspect the actual merged plugin configuration, using Vite's first-match
 // rule. A broad '@' entry used to shadow the local runtime override.
 const entry=config.resolve.alias.find(({find})=>typeof find==='string'?source===find||source.startsWith(find+'/'):find.test(source));
 assert.ok(entry,'runtime import must have a matching alias');
 assert.match(entry.replacement.replaceAll('\\','/'),/\/lib\/server-runtime\.cloudflare\.mjs$/);
 const native=serverRuntime({SAMARTH_AUTH_MODE:'local',SAMARTH_LOCAL_DEMO:'true'});
 assert.equal(native.env.SAMARTH_AUTH_MODE,'supabase');
 assert.equal(native.local,false);
 assert.equal(native.db,undefined);
});
