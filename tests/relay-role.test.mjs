import test from 'node:test';
import assert from 'node:assert/strict';
import {relayRole} from '../lib/relay-role.mjs';
import {workerConfiguration,createCareClient} from '../scripts/sim-call-worker.mjs';
test('relay selects only its configured assigned staff role and defaults to coordinator',()=>{
 assert.equal(relayRole({}),'coordinator');assert.equal(relayRole({SAMARTH_RELAY_ROLE:'operations'}),'operations');
 for(const role of ['senior','family','admin','service_role'])assert.throws(()=>relayRole({SAMARTH_RELAY_ROLE:role}),/coordinator or operations/);
});
test('SIM relay signs in to its selected Operations portal without acquiring roles',async()=>{
 const config=workerConfiguration({SAMARTH_RELAY_ROLE:'operations',SAMARTH_SIM_BRIDGE_SECRET:'synthetic-secret-at-least-thirty-two-characters',SAMARTH_RELAY_EMAIL:'ops@example.invalid',SAMARTH_RELAY_PASSWORD:'synthetic-password',SAMARTH_ASTERISK_DEVICE:'OwnedPhone'}),calls=[];
 assert.equal(config.role,'operations');const client=createCareClient(config,{fetchImpl:async(url,options)=>{calls.push(JSON.parse(options.body));return new Response('{}',{status:200});}});await client.login();assert.equal(calls.length,2);assert.equal(calls[0].role,'operations');assert.deepEqual(calls[1],{role:'operations'});
});
