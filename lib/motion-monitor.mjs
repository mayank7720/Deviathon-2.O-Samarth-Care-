/** Foreground phone-motion aggregates. A candidate is never a confirmed fall. */
const G=9.80665;
const angle=(a,b)=>{const norm=Math.hypot(...a)*Math.hypot(...b);return norm?Math.acos(Math.max(-1,Math.min(1,a.reduce((sum,v,i)=>sum+v*b[i],0)/norm)))*180/Math.PI:0;};
export function createMotionMonitor({quietG=.12,impactG=2.8,tiltDegrees=45,quietSeconds=10}={}) {
  let first=null,last=null,count=0,gravity=null,impact=null,quietSince=null,longestQuiet=0,peak=0,maxTilt=0,candidate=false;
  return {
    ingest({timestamp,x,y,z}) {
      if(![timestamp,x,y,z].every(Number.isFinite)||Math.max(Math.abs(x),Math.abs(y),Math.abs(z))>200)return false;
      if(last!=null&&timestamp-last<45)return false;
      first??=timestamp;last=timestamp;count++;
      const vector=[x,y,z],magnitude=Math.hypot(x,y,z)/G;
      peak=Math.max(peak,magnitude);
      const prior=gravity||vector;gravity=prior.map((v,i)=>.94*v+.06*vector[i]);
      const dynamic=Math.hypot(...vector.map((v,i)=>v-gravity[i]))/G;
      if(magnitude>=impactG&&!impact)impact={timestamp,orientation:[...prior]};
      if(dynamic<quietG){quietSince??=timestamp;longestQuiet=Math.max(longestQuiet,(timestamp-quietSince)/1000);}else quietSince=null;
      if(impact){const tilt=angle(impact.orientation,gravity);maxTilt=Math.max(maxTilt,tilt);if(timestamp-impact.timestamp>=quietSeconds*1000&&timestamp-impact.timestamp<=30000&&tilt>=tiltDegrees&&quietSince!=null&&(timestamp-quietSince)/1000>=quietSeconds)candidate=true;if(timestamp-impact.timestamp>30000&&!candidate)impact=null;}
      return true;
    },
    summary() {return {durationSeconds:first==null?0:Math.round((last-first)/1000),sampleCount:count,peakImpactG:Math.round(peak*100)/100,maxTiltDegrees:Math.round(maxTilt),longestQuietSeconds:Math.round(longestQuiet),possibleFall:candidate,source:'browser-motion',confirmation:'unconfirmed',foregroundOnly:true};}
  };
}
export function validateMotionSummary(value) {
  const ranges={durationSeconds:[5,3600],sampleCount:[50,100000],peakImpactG:[0,20],maxTiltDegrees:[0,180],longestQuietSeconds:[0,3600]};
  for(const [key,[min,max]] of Object.entries(ranges))if(!Number.isFinite(value?.[key])||value[key]<min||value[key]>max)throw Object.assign(new Error(`A valid motion observation is required (${key}).`),{status:400});
  if(value.longestQuietSeconds>value.durationSeconds||value.sampleCount>value.durationSeconds*100)throw Object.assign(new Error('The motion observation has inconsistent timing.'),{status:400});
  return {durationSeconds:value.durationSeconds,sampleCount:Math.round(value.sampleCount),impactG:value.peakImpactG,postureChange:value.maxTiltDegrees>=45,fallDetected:value.peakImpactG>=2.8&&value.maxTiltDegrees>=45&&value.longestQuietSeconds>=10&&value.possibleFall===true,inactiveMinutes:Math.floor(value.longestQuietSeconds/60),source:'browser-motion',confirmation:'unconfirmed',foregroundOnly:true};
}
