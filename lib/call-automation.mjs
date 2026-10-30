/** Automatic calls use saved cloud policy, never numbers from a browser or model. */
import {callingPolicy} from './calling-policy.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k));
export const CALL_AUTOMATION_VERSION='care-call-automation-v1';
export const CALL_AUTOMATION_REASONS=Object.freeze({
 paused:'Automatic calling is paused by Operations.',outside_hours:'Waiting for the calling access and hours configured by Operations.',
 contact_changed:'A saved mobile or channel permission changed. Review and save the automation again.',
 senior_contact:'One unique senior account with a confirmed, voice-enabled mobile is required.',
 coordinator_contact:'The assigned coordinator needs a confirmed, voice-enabled mobile.',
 shared_number:'A shared or service number needs human review before automatic calling.',
 source_closed:'The original help request has closed or no longer belongs to this assignment.',
 source_changed:'The original caller or care assignment changed. A person must review this request.',
 settings_changed:'The automation settings changed before this call started.',
 quota_unknown:'Operations must confirm the remaining trial minutes before automatic calling.',
 quota_exhausted:'The reserved trial-call allowance is used up. No paid fallback is allowed.',
 daily_limit:'The five-call showcase limit is reached. The care request remains visible.',
 active_call:'Another call is active or has an uncertain result. No duplicate call will be started.',
 active_help:'A help request already needs human contact. The routine daily call was skipped.',
 expired:'The scheduled attempt expired. Review the saved request and arrange human contact.',
 worker_unavailable:'The calling worker could not confirm a result. Inspect the saved call before retrying.',
 notice_unacknowledged:'The care notice was not acknowledged. Operations needs to arrange a response.',
 provider_not_connected:'The trial calling provider is not connected.',
});
export function validateAutomationSettings(value){
 if(!keys(value,['seniorId','revision','dailyEnabled','helpEnabled','dailyTime','language','trialVerified','consentConfirmed']))fail(400,'Use the saved senior, schedule and call-permission controls only.');
 if(!/^S\d{3,6}$/u.test(value.seniorId||'')||!Number.isSafeInteger(value.revision)||value.revision<0)fail(400,'Choose a senior and refresh the current settings.');
 if(typeof value.dailyEnabled!=='boolean'||typeof value.helpEnabled!=='boolean'||!['en','hi'].includes(value.language)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value.dailyTime||''))fail(400,'Choose Hindi or English and a valid daily time. Operations controls the allowed calling hours.');
 if((value.dailyEnabled||value.helpEnabled)&&(value.trialVerified!==true||value.consentConfirmed!==true))fail(400,'Confirm voice consent and trial verification for the senior and assigned coordinator before enabling calls.');
 return {...value};
}
export function validateAutomationControl(value){
 if(!keys(value,['revision','enabled','remainingMinutes','allowanceConfirmed','demoEnabled'])||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.enabled!=='boolean'||value.demoEnabled!==undefined&&typeof value.demoEnabled!=='boolean'||!Number.isSafeInteger(value.remainingMinutes)||value.remainingMinutes<0||value.remainingMinutes>75)fail(400,'Use a current control revision and 0–75 confirmed remaining trial minutes.');
 if(value.enabled&&(value.allowanceConfirmed!==true||value.remainingMinutes<8))fail(400,'Confirm at least eight available trial minutes for a senior call and coordinator briefing.');
 if(value.demoEnabled===true&&(!value.enabled||value.allowanceConfirmed!==true))fail(400,'A demo window requires armed automation and a newly confirmed free-trial allowance.');
 return {...value};
}
export async function handleCallAutomationRoute({path,request,body={},db,context}){
 if(!['telephony/automation','telephony/automation/settings','telephony/automation/control','telephony/automation/policy'].includes(path))return null;
 const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 try{
  const s=context?.session;
  if(!context?.authenticated||!context?.authorized||!s?.userId)fail(401,'Sign in to an assigned care account.');
  if(!['coordinator','operations'].includes(s.role))fail(403,'Only assigned care staff can configure automatic calls.');
  if(typeof db.callAutomation!=='function')fail(503,'Automatic calls require the connected cloud workspace.');
  if(path==='telephony/automation'&&request.method==='GET')return json(await db.callAutomation('list',{}));
  if(request.method!=='POST')fail(405,'Use the saved call settings controls.');
  if(path==='telephony/automation/settings')return json(await db.callAutomation('save',validateAutomationSettings(body)));
  if(path==='telephony/automation/policy'){
   if(s.role!=='operations'||s.isAdmin!==true)fail(403,'Only the Operations administrator can change calling access and hours.');
   if(!keys(body,['revision','callsEnabled','restrictHours','start','end','helpOutsideHours'])||!Number.isSafeInteger(body.revision)||body.revision<0)fail(400,'Refresh the current calling controls before saving.');
   return json(await db.callAutomation('policy',{revision:body.revision,...callingPolicy(body)}));
  }
  if(path==='telephony/automation/control'){
   if(s.role!=='operations'||s.isAdmin!==true)fail(403,'Only the Operations administrator can arm or pause automatic calling.');
   return json(await db.callAutomation('control',validateAutomationControl(body)));
  }
  fail(404,'Automatic call action not found.');
 }catch(e){return json({error:e.status?e.message:'The automatic call settings could not be saved. Refresh to check the stored version.'},e.status||503);}
}
