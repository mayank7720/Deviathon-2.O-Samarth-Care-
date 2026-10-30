"use client";
import {useEffect,useState} from 'react';
import {careApi} from './AccessPortal';
type Shared={id:string;status:string;kind:string;channel:string;body?:string;summary?:{text?:string;period?:{from?:string;to?:string};method?:string};deliveredAt?:string};
export default function SharedSummaryHistory({seniorId}:{seniorId:string}){
 const [value,setValue]=useState<{seniorId:string;items:Shared[];error?:string}|null>(null);
 useEffect(()=>{let active=true,running=false;async function load(){if(running)return;running=true;try{const result=await careApi<{deliveries:Shared[]}>(`/deliveries?seniorId=${encodeURIComponent(seniorId)}&limit=100`);if(active)setValue({seniorId,items:result.deliveries.filter(d=>d.kind==='weekly_summary'&&d.channel==='in_app'&&['delivered','read'].includes(d.status))});}catch(e){if(active)setValue({seniorId,items:[],error:e instanceof Error?e.message:'Summary history could not be loaded.'});}finally{running=false;}}void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},20000);return()=>{active=false;clearInterval(timer);};},[seniorId]);
 const current=value?.seniorId===seniorId?value:null;
 return <section className="panel shared-summary-history"><h2>Shared summary history</h2>{!current?<p role="status">Loading shared updates…</p>:current.error?<p role="alert">{current.error}</p>:!current.items.length?<p>Your coordinator has not published a reviewed summary yet. Requested updates appear in Follow-ups.</p>:current.items.map(item=><details key={item.id}><summary>{item.summary?.period?.from||'Reviewed update'}{item.summary?.period?.to?' – '+item.summary.period.to:''}</summary><p>{item.summary?.text||item.body}</p><small>{item.summary?.method||'Reviewed care-team summary'}</small></details>)}</section>;
}
