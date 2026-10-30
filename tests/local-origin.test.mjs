import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNodeRequest} from '../lib/server-runtime.mjs';
import {handleSupabaseAuthRoute} from '../lib/supabase-auth.mjs';
const make=(url='http://localhost:5173/api/auth/login',headers={})=>new Request(url,{method:'POST',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json',...headers},body:'{"message":"मदद"}'});
test('local Next adapter preserves the actual loopback origin and exact request body',async()=>{
 const request=make(),result=normalizeNodeRequest(request);
 assert.equal(new URL(result.url).origin,'http://127.0.0.1:5173');assert.equal(result.headers.get('origin'),'http://127.0.0.1:5173');assert.equal(await result.text(),'{"message":"मदद"}');
});
test('remote hosts, different ports, HTTPS and spoofed forwarded hosts never rewrite security origin',()=>{
 for(const request of [make(undefined,{host:'evil.example'}),make(undefined,{host:'127.0.0.1:8000'}),make('https://care.example/api/auth/login'),make(undefined,{host:'localhost:5173','x-forwarded-host':'evil.example'})])assert.equal(normalizeNodeRequest(request),request);
});
test('normalizing a loopback transport still rejects a cross-origin login before provider access',async()=>{
 let contacted=false;const request=normalizeNodeRequest(make(undefined,{origin:'https://evil.example'}));
 const response=await handleSupabaseAuthRoute('auth/login',request,{}, {},{fetchImpl:async()=>{contacted=true;throw Error('Unexpected provider call');}});
 assert.equal(response.status,403);assert.equal(contacted,false);
});
