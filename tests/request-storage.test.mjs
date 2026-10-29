import test from 'node:test';
import assert from 'node:assert/strict';
import {requestMetadata,recordRequestResult} from '../lib/request-storage.mjs';
test('request receipts exclude bodies, identifiers and query values',()=>{
 const metadata=requestMetadata(new Request('https://care.test/api/accounts/private-identity?token=secret',{method:'POST',body:'private password and notes'}),new Response('{}',{status:403}),{id:'request-id',startedAt:100,now:150});
 assert.deepEqual(metadata,{requestId:'request-id',category:'accounts',method:'POST',status:403,durationMs:50});
 assert.doesNotMatch(JSON.stringify(metadata),/secret|password|private|identity/);
});
test('request logging failure preserves the committed result',async()=>{
 const response=await recordRequestResult({recordRequest:async()=>{throw new Error('offline');}},new Request('https://care.test/api/tasks',{method:'POST'}),new Response('{"saved":true}',{status:201}),Date.now());
 assert.equal(response.status,201);assert.deepEqual(await response.json(),{saved:true});assert.equal(response.headers.get('x-care-request-log'),'unavailable');
});
test('successful cloud receipt is traceable with a request ID',async()=>{
 let saved;const response=await recordRequestResult({recordRequest:async meta=>{saved=meta;return {stored:true};}},new Request('https://care.test/api/reports'),new Response('{}'),Date.now());
 assert.equal(saved.requestId,response.headers.get('x-care-request-id'));assert.equal(response.headers.get('x-care-request-log'),'stored');
});
