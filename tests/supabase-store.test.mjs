import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseStore} from '../lib/supabase-store.mjs';

const options={url:'https://project.supabase.co',publishableKey:'sb_publishable_test',accessToken:'verified-user-token'};
test('Supabase adapter sends named operations with caller JWT and rejects arbitrary SQL locally',async()=>{
 const calls=[];
 const db=createSupabaseStore({...options,fetchImpl:async(url,init)=>{calls.push({url,...init,body:JSON.parse(init.body)});return Response.json([{results:[{id:'membership'}],meta:{changes:0}}]);}});
 const record=await db.prepare('SELECT * FROM care_memberships WHERE id = ? AND workspace_id = ?').bind('membership','primary').first();
 assert.equal(record.id,'membership');
 assert.equal(calls[0].headers.Authorization,'Bearer verified-user-token');
 assert.equal(calls[0].headers.apikey,options.publishableKey);
 assert.deepEqual(calls[0].body,{commands:[{op:'members_get',args:['membership','primary']}]});
 assert.equal(JSON.stringify(calls[0].body).includes('SELECT'),false);
 assert.throws(()=>db.prepare('DELETE FROM auth.users'),/not been registered/);
 assert.equal(calls.length,1);
});
test('bounded event scanning preserves scope and requested descending ordering',async()=>{
 let sent;
 const db=createSupabaseStore({...options,fetchImpl:async(url,init)=>{sent={url,body:JSON.parse(init.body)};return Response.json({results:[]});}});
 await db.scanEvents({owner:'workspace:primary',seniorIds:['S002'],kinds:['signal'],limit:999999,ascending:false});
 assert.ok(sent.url.endsWith('/care_events_scan'));
 assert.deepEqual(sent.body.options.seniorIds,['S002']);assert.equal(sent.body.options.limit,5000);assert.equal(sent.body.options.ascending,false);
});
test('database denials are sanitized without leaking provider messages or clinical payloads',async()=>{
 const db=createSupabaseStore({...options,fetchImpl:async()=>Response.json({code:'42501',message:'Secret patient note and SQL detail'},{status:403})});
 await assert.rejects(()=>db.workflow('scores_get',{owner:'workspace:primary'}),error=>error.status===403&&!error.message.includes('Secret'));
});
test('the user request store refuses a service or secret key even on the server',()=>{
 assert.throws(()=>createSupabaseStore({...options,publishableKey:'sb_secret_never'}),/publishable/);
});
