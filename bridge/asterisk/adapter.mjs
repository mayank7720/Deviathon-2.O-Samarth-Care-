/** Pure construction only: importing this module never installs software or starts a call. */
export const CALL_SPOOL_ROOT='/var/lib/samarth';
export const MAX_JOB_AGE_MS=24*60*60*1000;
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const e164=/^\+[1-9][0-9]{7,14}$/;
const device=/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const allowedKeys=new Set(['version','id','jobId','dialNumber','language','approved','expiresAt']);
const reject=message=>{throw new TypeError(message);};

export function validateJob(value,{now=Date.now()}={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))reject('A call job must be an object.');
  if(Object.keys(value).some(key=>!allowedKeys.has(key)))reject('A call job contains unsupported fields.');
  if(value.version!==undefined&&value.version!==1)reject('Unsupported call job version.');
  const id=value.id??value.jobId;
  if(typeof id!=='string'||!uuid.test(id))reject('A call job needs a UUID.');
  if(value.id!==undefined&&value.jobId!==undefined&&value.id.toLowerCase()!==value.jobId.toLowerCase())reject('Call job identifiers must match.');
  if(typeof value.dialNumber!=='string'||!e164.test(value.dialNumber))reject('The approved destination must use strict E.164 format.');
  if(!['hi','en'].includes(value.language))reject('Choose Hindi or English prompts.');
  if(value.approved!==true)reject('Only an explicitly approved call job can be staged.');
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+MAX_JOB_AGE_MS)reject('The call job is expired or its expiry exceeds 24 hours.');
  return Object.freeze({version:1,id:id.toLowerCase(),jobId:id.toLowerCase(),dialNumber:value.dialNumber,language:value.language,approved:true,expiresAt:value.expiresAt});
}

export function jobPaths(id) {
  if(typeof id!=='string'||!uuid.test(id))reject('Only a UUID can identify a spool job.');
  const key=id.toLowerCase();
  return Object.freeze({manifestPath:`${CALL_SPOOL_ROOT}/jobs/${key}.json`,resultPath:`${CALL_SPOOL_ROOT}/results/${key}.json`,recordingDirectory:`${CALL_SPOOL_ROOT}/recordings/${key}`});
}

export function originateRequest(value,env={},options={}) {
  const job=validateJob(value,options),mobileDevice=env.SAMARTH_ASTERISK_DEVICE;
  if(typeof mobileDevice!=='string'||!device.test(mobileDevice))reject('Configure one safe Asterisk mobile-device identifier.');
  // All dynamic fragments are validated tokens. The caller must use execFile/spawn with shell:false.
  const cli=`channel originate Mobile/${mobileDevice}/${job.dialNumber} extension ${job.id}@samarth-checkin`;
  return Object.freeze({command:'asterisk',args:Object.freeze(['-rx',cli]),shell:false,jobId:job.id,...jobPaths(job.id),acceptanceIsNotAnswer:true});
}

export function parseBridgeResult(value,jobId) {
  const paths=jobPaths(jobId),id=jobId.toLowerCase();
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||value.jobId!==id)reject('Invalid local call result.');
  if(!['answers_recorded','declined','disconnected','failed'].includes(value.status)||typeof value.consentGranted!=='boolean'||!Array.isArray(value.answers)||value.answers.length>4)reject('Invalid local call result state.');
  const start=Date.parse(value.startedAt),end=Date.parse(value.completedAt),consented=Date.parse(value.consentedAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>300000||typeof value.callAnswered!=='boolean'||value.externalDelivery!==value.callAnswered||value.source!=='asterisk-bluetooth-sim'||value.transcriptionStatus!=='not_started'||value.requiresHumanReview!==true)reject('The local result is missing bounded channel evidence.');
  if(value.consentGranted&&(!value.callAnswered||!Number.isFinite(consented)||consented<start||consented>end))reject('Recording consent needs answered-channel evidence and a valid time.');
  if(!value.consentGranted&&(value.answers.length||value.consentedAt!==null))reject('Audio must never exist without recording consent.');
  if(value.status==='declined'&&value.consentGranted)reject('A declined session cannot have recording consent.');
  if(value.status==='declined'&&!value.callAnswered)reject('A declined session needs answered-channel evidence.');
  const ids=['wellbeing','medication','appetite','support'];
  for(let i=0;i<value.answers.length;i++) {
    const answer=value.answers[i];
    if(answer?.questionId!==ids[i]||answer.path!==`${paths.recordingDirectory}/q${i+1}.wav`||!Number.isFinite(answer.durationSeconds)||answer.durationSeconds<=0||answer.durationSeconds>30.1||answer.sampleRate!==8000||answer.channels!==1||answer.sampleWidth!==2)reject('Invalid answer audio metadata or path.');
  }
  if(value.status==='answers_recorded'&&(!value.consentGranted||value.answers.length!==4))reject('A completed recording session needs consent and four audio files.');
  return value;
}
