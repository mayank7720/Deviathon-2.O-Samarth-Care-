import {careModel} from './model-runtime.mjs';
import { scanEvents,workflow } from './workflow-store.mjs';
import { readRuntime } from './runtime.mjs';
import { runDaily } from './daily-workflow.mjs';
import { processDeliveries } from './delivery-routes.mjs';
import {workspaceCareModel} from './recorded-seniors.mjs';

/** Trusted server entry point. Never call this with an identity from request headers. */
export async function runWorkspaceDaily(db,env={}) {
  const members=await workflow(db,'members_get',{workspaceId:'primary'});
  const allScope=m=>(typeof m.scope_json==='string'?JSON.parse(m.scope_json):m.scope_json||[]).includes('*');
  const administrator=m=>m.is_admin===true||Number(m.is_admin)===1;
  const member=members.find(m=>m.role==='operations'&&administrator(m)&&allScope(m))||members.find(m=>m.role==='coordinator'&&allScope(m));
  if(!member)return {skipped:'No active care manager with the required senior scope.'};
  const owner='workspace:primary',context={owner,workspaceId:'primary',identity:{userId:member.user_id},session:{role:member.role,userId:member.user_id,name:'Daily care processor',scope:['*'],isAdmin:administrator(member)}};
  const {cohort,engine,dataRevision}=await workspaceCareModel(db,careModel(env));
  const runtime=await readRuntime(db,owner,{cohortStart:cohort.metadata?.startDate,cohortEnd:cohort.metadata?.endDate,dataRevision});
  const raw=await scanEvents(db,{owner,seniorIds:cohort.seniors.map(s=>s.id),kinds:['signal','consent','task','feedback','alert_state','alert_seen','alert_policy'],limit:5000});
  // Payload fields cannot turn a task or audit event into a clinical signal.
  const rows=raw.map(r=>{
    const payload=typeof r.payload==='string'?JSON.parse(r.payload):r.payload;
    const record=payload?.record&&typeof payload.record==='object'&&!Array.isArray(payload.record)?payload.record:{};
    return {...r,...payload,...(r.kind==='signal'?{record:{...record,seniorId:r.senior_id,id:r.id,recordedAt:r.created_at}}:{}),id:r.id,kind:r.kind,owner,senior_id:r.senior_id,payload:r.payload,created_at:r.created_at,sequence:r.sequence,seniorId:r.senior_id,createdAt:r.created_at};
  });
  let consents=await workflow(db,'consents_get',{owner});
  const seed=cohort.seniors.filter(s=>!consents.some(c=>c.senior_id===s.id)).map(s=>{const saved=rows.filter(r=>r.kind==='consent'&&r.seniorId===s.id).at(-1);return {seniorId:s.id,allowed:saved?saved.allowed:s.familyConsent};});
  if(seed.length)await workflow(db,'consents_seed',{owner,consents:seed,updatedAt:new Date().toISOString()});
  consents=await workflow(db,'consents_get',{owner});
  const event=(db,owner,kind,seniorId,payload,id=crypto.randomUUID())=>db.prepare('INSERT INTO care_events (id,owner,kind,senior_id,payload,created_at) VALUES (?,?,?,?,?,?)').bind(id,owner,kind,seniorId,JSON.stringify(payload),new Date().toISOString());
  const result=await runDaily({db,context,cohort,engine,rows,runtime,consents,event});
  const delivery=await processDeliveries({db,context,env,consents});
  return {job:result.job,deliveriesQueued:result.deliveriesQueued,delivery};
}
