import { isWorkspaceAdmin } from './access.mjs';
import { e164 } from './telephony.mjs';
import {validateAccountAction} from './account-management.mjs';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function handleAccountRoute({path,request,body,db,context}) {
  if(path!=='accounts'&&path!=='accounts/assign'&&path!=='accounts/senior'&&!/^accounts\/[a-f0-9-]{36}(?:\/(?:phone|password|email))?$/i.test(path))return null;
  if(!isWorkspaceAdmin(context.session))return reply({error:'Only the operations administrator can manage accounts.'},403);
  if(typeof db.accountDirectory!=='function')return reply({error:'Account setup requires the connected care database.'},503);
  try {
    if(path==='accounts'&&request.method==='GET')return reply({accounts:await db.accountDirectory()});
    const accountPath=path.match(/^accounts\/([a-f0-9-]{36})(?:\/(password|email))?$/i);
    const action=path==='accounts/senior'&&request.method==='POST'?'onboard':path==='accounts'&&request.method==='POST'?'create':path==='accounts/assign'&&request.method==='POST'?'assign':accountPath?.[2]&&request.method==='POST'?accountPath[2]:accountPath&&!accountPath[2]&&request.method==='DELETE'?'delete':accountPath&&!accountPath[2]&&request.method==='PATCH'?'update':null;
    if(action){
      if(typeof db.adminAccount!=='function')return reply({error:'The account administrator service is not configured.'},503);
      const validated=validateAccountAction(action,{...body,...(accountPath?{targetUserId:accountPath[1]}:{})});
      return reply(await db.adminAccount(action,validated),['create','onboard'].includes(action)?201:200);
    }
    const match=path.match(/^accounts\/([a-f0-9-]{36})\/phone$/i);
    if(!match||request.method!=='PUT')return reply({error:'Use the supported account action.'},405);
    if(body?.action==='permissions') {
      if(body.recipientConfirmed!==true||typeof body.smsConsent!=='boolean'||typeof body.callConsent!=='boolean')return reply({error:'Confirm the recipient and choose SMS and call permissions separately.'},400);
      return reply(await db.setAccountChannels({userId:match[1],smsConsent:body.smsConsent,callConsent:body.callConsent,confirmed:true}));
    }
    const phone=typeof body?.phone==='string'?body.phone.trim():'';
    if(phone&&!e164(phone))return reply({error:'Enter a mobile number with country code, such as +91 followed by the number.'},400);
    if(phone&&body.recipientConfirmed!==true)return reply({error:'Confirm the number belongs to this account and the recipient agreed to the selected channels.'},400);
    if(typeof body?.smsConsent!=='boolean'||typeof body?.callConsent!=='boolean')return reply({error:'Choose SMS and call permissions separately.'},400);
    return reply(await db.setAccountPhone({userId:match[1],phone:phone||null,smsConsent:!!phone&&body.smsConsent,callConsent:!!phone&&body.callConsent,confirmed:!!phone&&body.recipientConfirmed===true}));
  } catch(error) {return reply({error:error.status?error.message:'Account contact details could not be saved.'},error.status||500);}
}
