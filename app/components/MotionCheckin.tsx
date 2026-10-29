"use client";
import {useEffect,useRef,useState} from 'react';
import {careApi} from './AccessPortal';
import {createMotionMonitor} from '../../lib/motion-monitor.mjs';
type Snapshot={durationSeconds:number;sampleCount:number;peakImpactG:number;maxTiltDegrees:number;longestQuietSeconds:number;possibleFall:boolean};
type Props={seniorId:string;notify:(message:string)=>void;onSaved?:()=>void};
export default function MotionCheckin({seniorId,notify,onSaved}:Props){
  const [active,setActive]=useState(false),[summary,setSummary]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false);
  const cleanup=useRef<(()=>void)|null>(null),monitor=useRef<ReturnType<typeof createMotionMonitor>|null>(null);
  useEffect(()=>()=>cleanup.current?.(),[]);
  function stop(){cleanup.current?.();cleanup.current=null;setActive(false);if(monitor.current)setSummary(monitor.current.summary());}
  async function start(){
    try{
      if(!window.isSecureContext||!('DeviceMotionEvent'in window))throw new Error('Motion input requires a compatible phone and HTTPS. Open this page on your phone.');
      const motionType=DeviceMotionEvent as typeof DeviceMotionEvent&{requestPermission?:()=>Promise<string>};
      if(motionType.requestPermission&&await motionType.requestPermission()!=='granted')throw new Error('Motion permission was not granted.');
      monitor.current=createMotionMonitor();
      const listener=(event:DeviceMotionEvent)=>{const a=event.accelerationIncludingGravity;if(a?.x!=null&&a.y!=null&&a.z!=null)monitor.current?.ingest({timestamp:performance.now(),x:a.x,y:a.y,z:a.z});};
      const visibility=()=>{if(document.hidden)stop();};
      window.addEventListener('devicemotion',listener);document.addEventListener('visibilitychange',visibility);
      const timer=setInterval(()=>{if(monitor.current)setSummary(monitor.current.summary());},1000);
      cleanup.current=()=>{window.removeEventListener('devicemotion',listener);document.removeEventListener('visibilitychange',visibility);clearInterval(timer);};
      setSummary(null);setActive(true);
    }catch(error){notify(error instanceof Error?error.message:'Motion input could not start.');}
  }
  async function save(){
    stop();if(!monitor.current)return;setBusy(true);
    try{await careApi('/sensors/checkin','POST',{seniorId,observation:monitor.current.summary()});notify('Phone-motion observation saved for human review. A possible fall remains unconfirmed.');onSaved?.();}catch(error){notify(error instanceof Error?error.message:'Motion observation could not be saved.');}finally{setBusy(false);}
  }
  return <section className="panel extension-panel"><span className="eyebrow">OPTIONAL PHONE SENSOR INPUT</span><h2>Motion check-in</h2><p>Keep this page open on a phone you are carrying. It measures motion and quiet periods while visible. A phone impact can happen without a person falling.</p><div className="extension-toolbar"><button className="button secondary" disabled={active||busy} onClick={start}>Start motion observation</button><button className="button secondary" disabled={!active} onClick={stop}>Stop</button><button className="button primary" disabled={!summary||summary.durationSeconds<5||summary.sampleCount<50||busy} onClick={save}>Save for care-team review</button></div>{summary&&<p role="status">{summary.durationSeconds}s observed · {summary.sampleCount} samples · peak {summary.peakImpactG} g · longest quiet period {summary.longestQuietSeconds}s. {summary.possibleFall?'A possible fall pattern needs verification.':'No candidate from this illustrative rule.'}</p>}<p className="extension-note">No location or audio is collected. This is an unvalidated foreground motion rule, not a certified fall detector. Do not drop the phone to test it.</p></section>;
}
