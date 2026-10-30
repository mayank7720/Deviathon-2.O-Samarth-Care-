/** Operations owns the calling policy; request bodies cannot override it. */
export const DEFAULT_CALLING_POLICY=Object.freeze({callsEnabled:true,restrictHours:true,start:'08:00',end:'20:00',helpOutsideHours:false});
const clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/u;
export function callingPolicy(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.callsEnabled!=='boolean'||typeof value.restrictHours!=='boolean'||typeof value.helpOutsideHours!=='boolean'||!clock.test(value.start||'')||!clock.test(value.end||'')||value.restrictHours&&value.start===value.end)throw Object.assign(Error('Set valid calling controls and different start/end times, or choose all-day access.'),{status:400});
 return {callsEnabled:value.callsEnabled,restrictHours:value.restrictHours,start:value.start,end:value.end,helpOutsideHours:value.helpOutsideHours};
}
export function callWindowAllowed(policy,now=Date.now(),help=false){
 const p=callingPolicy(policy);if(!p.callsEnabled)return false;
 if(!p.restrictHours||help&&p.helpOutsideHours)return true;
 const date=new Date(now+330*60000),time=String(date.getUTCHours()).padStart(2,'0')+':'+String(date.getUTCMinutes()).padStart(2,'0');
 return p.start<p.end?time>=p.start&&time<p.end:time>=p.start||time<p.end;
}
export function assertCallingPolicy(policy,now,help=false){
 const p=callingPolicy(policy);
 if(!callWindowAllowed(p,now,help))throw Object.assign(Error(p.callsEnabled?'Calling is outside the hours configured by Operations. Review Calls & SMS → Calling controls.':'All new bot calls are paused by Operations.'),{status:409,callNotPlaced:true});
}
