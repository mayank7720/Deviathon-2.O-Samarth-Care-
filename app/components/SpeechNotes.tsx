"use client";

import {useEffect,useRef,useState} from 'react';
import type {ChangeEvent} from 'react';
import {careApi} from './AccessPortal';
import './speech-notes.css';

type Props={data:{seniors:{id:string;name:string}[];session:{role:string;isAdmin?:boolean}};notify:(message:string)=>void;onChanged?:()=>void|Promise<void>};
type DraftStatus='awaiting_review'|'approved'|'rejected';
type Segment={start:number;end:number;text:string};
type Draft={id:string;seniorId:string;status:DraftStatus;text:string;editedText?:string;model:string;language:string;durationSeconds:number|null;createdAt:string;segments:Segment[];review?:{action:string;editedText:string;note:string;createdAt:string}};
type ServiceStatus={configured:boolean;serviceUrl:string;privacy:string;maxBytes:number;maxSeconds:number};
type AudioInput={blob:Blob;name:string;seniorId:string;source:'recording'|'upload';durationSeconds:number|null};
type Receipt={payload:string;signature:string};
type PendingReceipt={receipt:Receipt;seniorId:string};
type ReviewAction='approve'|'reject';
const SERVICE_URL='http://127.0.0.1:8766';
const MAX_BYTES=8388608,MAX_SECONDS=180;
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown)=>typeof value==='string'?value:'';
const list=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
const errorMessage=(reason:unknown)=>reason instanceof Error?reason.message:'The speech note could not be processed.';
const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const stamp=(value:string)=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}):'Not recorded';
const statusLabels:Record<DraftStatus,string>={awaiting_review:'Awaiting human review',approved:'Approved care note',rejected:'Rejected draft'};
function serviceStatus(value:unknown):ServiceStatus {
  const row=object(value),limits=object(row.limits);
  return {configured:row.configured===true&&row.serviceUrl===SERVICE_URL,serviceUrl:SERVICE_URL,privacy:text(row.privacy),maxBytes:typeof limits.maxBytes==='number'&&limits.maxBytes>0?Math.min(MAX_BYTES,limits.maxBytes):MAX_BYTES,maxSeconds:typeof limits.maxSeconds==='number'&&limits.maxSeconds>0?Math.min(MAX_SECONDS,limits.maxSeconds):MAX_SECONDS};
}
function draftList(value:unknown):Draft[] {
  return list(object(value).drafts).filter(entry=>{const row=object(entry);return /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(text(row.id))&&Object.hasOwn(statusLabels,text(row.status))&&typeof row.text==='string';}).map(entry=>{
    const row=object(entry),review=object(row.review);
    return {id:text(row.id),seniorId:text(row.seniorId),status:row.status as DraftStatus,text:text(row.text),editedText:text(row.editedText),model:text(row.model),language:text(row.language),durationSeconds:typeof row.durationSeconds==='number'&&Number.isFinite(row.durationSeconds)?row.durationSeconds:null,createdAt:text(row.createdAt),segments:list(row.segments).filter(entry=>{const segment=object(entry);return typeof segment.start==='number'&&Number.isFinite(segment.start)&&typeof segment.end==='number'&&Number.isFinite(segment.end)&&typeof segment.text==='string';}).map(entry=>{const segment=object(entry);return {start:segment.start as number,end:segment.end as number,text:text(segment.text)};}),...(typeof row.review==='object'&&row.review?{review:{action:text(review.action),editedText:text(review.editedText),note:text(review.note),createdAt:text(review.createdAt)}}:{})};
  });
}
function receiptFrom(value:unknown):Receipt {
  const receipt=object(object(value).receipt);
  if(typeof receipt.payload!=='string'||!receipt.payload.length||receipt.payload.length>65536||!/^[a-f\d]{64}$/i.test(text(receipt.signature)))throw new Error('The laptop service returned an invalid signed transcription receipt.');
  return {payload:receipt.payload,signature:text(receipt.signature)};
}
function audioType(file:File) {
  const mime=file.type.split(';')[0].toLowerCase();
  if(['audio/wav','audio/x-wav','audio/wave','audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/flac','audio/x-flac'].includes(mime))return file.type;
  const extension=file.name.split('.').at(-1)?.toLowerCase();
  const types:Record<string,string>={wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',webm:'audio/webm',ogg:'audio/ogg',oga:'audio/ogg',flac:'audio/flac'};
  return extension?types[extension]||'':'';
}

function DraftCard({draft,canWrite,disabled,busy,onReview}:{draft:Draft;canWrite:boolean;disabled:boolean;busy:boolean;onReview:(id:string,action:ReviewAction,editedText:string,note:string)=>Promise<void>}) {
  const [edited,setEdited]=useState(draft.editedText||draft.text),[note,setNote]=useState(''),[error,setError]=useState('');
  async function review(action:ReviewAction){
    if(action==='approve'&&(!edited.trim()||edited.length>6000))return;
    setError('');
    try{await onReview(draft.id,action,edited.trim(),note.trim());}catch(reason){setError(errorMessage(reason));}
  }
  return <article className="panel speech-draft">
    <header><div><span className="eyebrow">LOCAL SPEECH RECOGNITION</span><h2>{draft.status==='awaiting_review'?'Check what the senior said':'Recorded transcript review'}</h2></div><span className={`speech-draft-status ${draft.status}`}>{statusLabels[draft.status]}</span></header>
    <dl className="speech-draft-meta"><div><dt>Recorded draft</dt><dd>{stamp(draft.createdAt)}</dd></div><div><dt>Recognition model</dt><dd>{draft.model||'Not recorded'}</dd></div><div><dt>Language / duration</dt><dd>{draft.language||'Not recorded'} · {draft.durationSeconds===null?'Duration not recorded':`${draft.durationSeconds.toFixed(1)} seconds`}</dd></div></dl>
    {draft.status==='awaiting_review'&&canWrite?<label className="speech-transcript-label">Review and correct the transcript<textarea rows={7} maxLength={6000} value={edited} onChange={event=>setEdited(event.target.value)} disabled={disabled}/><span>{edited.length}/6,000 characters. Check Hindi/English wording, names, negations and numbers against the audio before approval.</span></label>:<p className="speech-transcript">{draft.status==='approved'?(draft.review?.editedText||draft.editedText||draft.text):draft.text}</p>}
    <details className="speech-original"><summary>Original recognition output and provenance</summary><p className="speech-transcript">{draft.text||'No original transcript text is available.'}</p><p>Recognized with local faster-whisper{draft.model?` (${draft.model})`:''}. This is a speech transcript, not an LLM-generated report or a diagnosis.</p>{draft.segments.length>0&&<ol>{draft.segments.map((segment,index)=><li key={`${segment.start}:${index}`}><time>{clock(segment.start)}–{clock(segment.end)}</time><span>{segment.text}</span></li>)}</ol>}</details>
    {draft.review&&<div className="speech-review-record"><strong>Recorded human review · {stamp(draft.review.createdAt)}</strong>{draft.review.note&&<p>{draft.review.note}</p>}</div>}
    {draft.status==='awaiting_review'&&canWrite&&<div className="speech-review-actions"><label>Review note (optional)<textarea rows={2} maxLength={1000} value={note} onChange={event=>setNote(event.target.value)} placeholder="Record a correction or why this draft should be rejected" disabled={disabled}/></label><p>Only an approved transcript becomes a call note used by the care system. Unreviewed and rejected drafts do not count as senior observations.</p>{error&&<p className="extension-error" role="alert">{error}</p>}<div><button className="button primary" disabled={disabled||!edited.trim()||edited.length>6000} onClick={()=>review('approve')}>{busy?'Saving review…':'Approve as a care note'}</button><button className="button secondary" disabled={disabled} onClick={()=>review('reject')}>Reject draft</button></div></div>}
    {draft.status==='awaiting_review'&&!canWrite&&<p className="speech-muted">A care coordinator must review this draft before it can become a senior’s call note.</p>}
  </article>;
}

function SpeechWorkspace({data,notify,onChanged,canWrite}:Props&{canWrite:boolean}) {
  const [choice,setChoice]=useState(''),[drafts,setDrafts]=useState<Draft[]>([]),[loading,setLoading]=useState(true),[listError,setListError]=useState(''),[reviewing,setReviewing]=useState<string|null>(null);
  const [service,setService]=useState<ServiceStatus|null>(null),[serviceError,setServiceError]=useState(''),[health,setHealth]=useState<'unchecked'|'checking'|'ready'|'not_ready'|'unavailable'>('unchecked'),[healthMessage,setHealthMessage]=useState('The laptop service has not been checked in this session.');
  const [consent,setConsent]=useState(false),[inputMode,setInputMode]=useState<'record'|'upload'>('record'),[audio,setAudio]=useState<AudioInput|null>(null),[audioUrl,setAudioUrl]=useState(''),[audioSaved,setAudioSaved]=useState(false),[observedDuration,setObservedDuration]=useState<number|null>(null),[requestingMic,setRequestingMic]=useState(false),[recording,setRecording]=useState(false),[elapsed,setElapsed]=useState(0),[phase,setPhase]=useState<'idle'|'ticket'|'transcribing'|'saving'>('idle'),[audioError,setAudioError]=useState(''),[pending,setPending]=useState<PendingReceipt|null>(null);
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),stopTimer=useRef<ReturnType<typeof setTimeout>|null>(null),tickTimer=useRef<ReturnType<typeof setInterval>|null>(null),requestAbort=useRef<AbortController|null>(null),mounted=useRef(true),draftRequest=useRef(0),recordingStarted=useRef(0),recordedBytes=useRef(0),recordingFailure=useRef(''),localAudioUrl=useRef('');
  const selectedId=choice||data.seniors[0]?.id||'',selectedName=data.seniors.find(senior=>senior.id===selectedId)?.name||'the selected senior';
  const maxBytes=service?.maxBytes||MAX_BYTES,maxSeconds=service?.maxSeconds||MAX_SECONDS,busy=phase!=='idle',locked=busy||recording||requestingMic||Boolean(reviewing),duration=observedDuration??audio?.durationSeconds??null,tooLong=duration!==null&&duration>maxSeconds;
  function releaseMicrophone(){
    if(stopTimer.current)clearTimeout(stopTimer.current);if(tickTimer.current)clearInterval(tickTimer.current);stopTimer.current=null;tickTimer.current=null;
    stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
  }
  function replaceAudio(next:AudioInput|null){if(localAudioUrl.current)URL.revokeObjectURL(localAudioUrl.current);const url=next?URL.createObjectURL(next.blob):'';localAudioUrl.current=url;setAudio(next);setAudioUrl(url);setAudioSaved(false);}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;requestAbort.current?.abort();const activeRecorder=recorder.current;if(activeRecorder){activeRecorder.ondataavailable=null;activeRecorder.onstop=null;activeRecorder.onerror=null;if(activeRecorder.state!=='inactive')activeRecorder.stop();}if(stopTimer.current)clearTimeout(stopTimer.current);if(tickTimer.current)clearInterval(tickTimer.current);stream.current?.getTracks().forEach(track=>track.stop());if(localAudioUrl.current)URL.revokeObjectURL(localAudioUrl.current);};},[]);
  useEffect(()=>{
    let active=true;
    if(canWrite)careApi('/speech/status').then((value:unknown)=>{if(active){setService(serviceStatus(value));setServiceError('');}}).catch(reason=>{if(active)setServiceError(errorMessage(reason));});
    return()=>{active=false;};
  },[canWrite]);
  useEffect(()=>{
    let active=true;const requestId=++draftRequest.current;
    if(!selectedId)return;
    careApi(`/speech/drafts?seniorId=${encodeURIComponent(selectedId)}`).then((value:unknown)=>{if(active&&requestId===draftRequest.current){setDrafts(draftList(value).filter(draft=>draft.seniorId===selectedId));setListError('');}}).catch(reason=>{if(active&&requestId===draftRequest.current)setListError(errorMessage(reason));}).finally(()=>{if(active&&requestId===draftRequest.current)setLoading(false);});
    return()=>{active=false;};
  },[selectedId]);
  async function refreshDrafts(){
    if(!selectedId)return;
    const requestId=++draftRequest.current;setLoading(true);
    try{const value:unknown=await careApi(`/speech/drafts?seniorId=${encodeURIComponent(selectedId)}`);if(requestId===draftRequest.current){setDrafts(draftList(value).filter(draft=>draft.seniorId===selectedId));setListError('');}}catch(reason){if(requestId===draftRequest.current)setListError(errorMessage(reason));}finally{if(requestId===draftRequest.current)setLoading(false);}
  }
  async function refreshStatus(){
    try{const value:unknown=await careApi('/speech/status');setService(serviceStatus(value));setServiceError('');}catch(reason){setServiceError(errorMessage(reason));}
  }
  async function checkHealth(){
    setHealth('checking');setHealthMessage('Checking the laptop speech service…');
    try{
      const response=await fetch(`${SERVICE_URL}/health`,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(6000)});
      if(!response.ok)throw new Error('The laptop service did not return a successful health response.');
      const value:unknown=await response.json(),row=object(value);
      if(row.engine!=='faster-whisper'||typeof row.ready!=='boolean'||typeof row.modelInstalled!=='boolean')throw new Error('The response did not identify the expected local speech service.');
      setHealth(row.ready===true?'ready':'not_ready');setHealthMessage(row.ready===true?`Laptop service ready${text(row.model)?` · model ${text(row.model)}`:''}. Audio will be processed on this laptop.`:row.modelInstalled===false?'The laptop service is reachable, but its speech model is not installed yet. Complete model setup before transcription.':'The laptop service is reachable, but the recognition model is not ready.');
    }catch{setHealth('unavailable');setHealthMessage('The paired speech service could not be reached on this computer. Start Local Transcription here, then allow local-network access if your browser asks. Audio recognition needs this computer; the rest of the public website remains available.');}
  }
  function stopRecording(){if(recorder.current&&recorder.current.state!=='inactive')recorder.current.stop();}
  async function startRecording(){
    if(!canWrite||!consent||!selectedId||locked||pending)return;
    setAudioError('');replaceAudio(null);setObservedDuration(null);
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setAudioError('Microphone recording is not supported in this browser. Upload a consented audio file instead.');return;}
    let microphone:MediaStream|null=null;
    setRequestingMic(true);
    try{
      microphone=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!mounted.current){microphone.getTracks().forEach(track=>track.stop());return;}
      stream.current=microphone;
      const mimeType=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
      const current=new MediaRecorder(microphone,mimeType?{mimeType}:undefined),chunks:Blob[]=[];
      recorder.current=current;recordedBytes.current=0;recordingFailure.current='';recordingStarted.current=Date.now();
      current.ondataavailable=event=>{if(!event.data.size)return;recordedBytes.current+=event.data.size;if(recordedBytes.current>maxBytes){recordingFailure.current='The recording exceeded the audio size limit. Record a shorter voice note.';if(current.state!=='inactive')current.stop();return;}chunks.push(event.data);};
      current.onerror=()=>{recordingFailure.current='The browser could not complete this recording. Try again or upload a consented audio file.';if(current.state!=='inactive')current.stop();else{releaseMicrophone();if(mounted.current){setRecording(false);setAudioError(recordingFailure.current);}}};
      current.onstop=()=>{
        releaseMicrophone();if(!mounted.current)return;setRecording(false);
        if(recordingFailure.current){setAudioError(recordingFailure.current);return;}
        const blob=new Blob(chunks,{type:current.mimeType||mimeType||'audio/webm'}),seconds=(Date.now()-recordingStarted.current)/1000;
        if(!blob.size){setAudioError('No audio was recorded. Check your microphone and try again.');return;}
        replaceAudio({blob,name:'Consented microphone voice note',seniorId:selectedId,source:'recording',durationSeconds:seconds});setObservedDuration(null);setElapsed(Math.floor(seconds));
      };
      current.start(1000);setElapsed(0);setRecording(true);
      tickTimer.current=setInterval(()=>{if(mounted.current)setElapsed(Math.floor((Date.now()-recordingStarted.current)/1000));},250);
      // Stop slightly early so final recorder buffering stays within the service's hard duration cap.
      stopTimer.current=setTimeout(()=>{if(current.state!=='inactive')current.stop();},Math.max(1,maxSeconds-1)*1000);
    }catch{microphone?.getTracks().forEach(track=>track.stop());releaseMicrophone();if(mounted.current){setRecording(false);setAudioError('Microphone access was not available. Allow it in your browser when you choose to record, or upload a consented audio file.');}}finally{if(mounted.current)setRequestingMic(false);}
  }
  function chooseFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    setAudioError('');
    if(!consent){setAudioError('Confirm the senior’s permission before choosing audio for transcription.');return;}
    if(!file.size||file.size>maxBytes){setAudioError(`Choose a nonempty audio file no larger than ${(maxBytes/1048576).toFixed(0)} MiB.`);return;}
    const type=audioType(file);if(!type){setAudioError('Choose a supported audio file, such as WAV, MP3, M4A, WebM, Ogg or FLAC.');return;}
    replaceAudio({blob:file.type===type?file:new Blob([file],{type}),name:file.name,seniorId:selectedId,source:'upload',durationSeconds:null});setObservedDuration(null);
  }
  function clearAudio(){replaceAudio(null);setObservedDuration(null);setAudioError('');setConsent(false);}
  async function saveReceipt(value:PendingReceipt){
    setPhase('saving');
    await careApi('/speech/drafts','POST',{receipt:value.receipt,consentConfirmed:true});
    if(!mounted.current)return;
    setPending(null);setAudioSaved(true);
    await refreshDrafts();notify('Transcription saved as a review draft. A coordinator must check it before it becomes a care note.');
  }
  async function transcribe(){
    if(!canWrite||!audio||!consent||!service?.configured||health!=='ready'||busy||recording||tooLong||audio.seniorId!==selectedId)return;
    setAudioError('');setPhase('ticket');
    const abort=new AbortController();requestAbort.current=abort;
    const timeout=setTimeout(()=>abort.abort(),240000);
    try{
      const ticketResponse:unknown=await careApi('/speech/ticket','POST',{seniorId:audio.seniorId,consentConfirmed:true}),ticket=object(ticketResponse);
      if(!mounted.current)return;
      if(abort.signal.aborted)throw new Error('The transcription request expired before audio processing began.');
      const expiresAt=typeof ticket.expiresAt==='number'?ticket.expiresAt:Date.parse(text(ticket.expiresAt));
      if(ticket.serviceUrl!==SERVICE_URL||!text(ticket.ticket)||!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw new Error('The app did not return a valid, current laptop-service ticket.');
      setPhase('transcribing');
      const response=await fetch(`${SERVICE_URL}/transcribe`,{method:'POST',mode:'cors',credentials:'omit',redirect:'error',headers:{Authorization:`Bearer ${text(ticket.ticket)}`,'content-type':audio.blob.type||'application/octet-stream'},body:audio.blob,signal:abort.signal});
      if(!response.ok)throw new Error(response.status===413?'The audio exceeds the laptop service’s size or duration limit. Choose a shorter recording.':response.status===401||response.status===403?'The laptop service refused the one-use ticket. Check its configuration, then retry with a fresh ticket.':'The laptop service could not transcribe this audio. Check the service and retry.');
      const value:unknown=await response.json(),next={receipt:receiptFrom(value),seniorId:audio.seniorId};
      if(!mounted.current)return;setPending(next);await saveReceipt(next);
    }catch(reason){if(mounted.current)setAudioError(abort.signal.aborted?'The transcription request stopped waiting. The laptop service may still finish; no new care note has been approved. You can check the service and retry.':errorMessage(reason));}finally{clearTimeout(timeout);requestAbort.current=null;if(mounted.current)setPhase('idle');}
  }
  async function retrySave(){if(!pending||!consent||busy)return;setAudioError('');try{await saveReceipt(pending);}catch(reason){if(mounted.current)setAudioError(errorMessage(reason));}finally{if(mounted.current)setPhase('idle');}}
  async function reviewDraft(id:string,action:ReviewAction,editedText:string,note:string){
    setReviewing(id);
    try{await careApi(`/speech/drafts/${encodeURIComponent(id)}/review`,'POST',{action,...(action==='approve'?{editedText}:{}),...(note?{note}:{})});await refreshDrafts();await onChanged?.();notify(action==='approve'?'Reviewed transcript approved for the care record.':'Transcription draft rejected.');}finally{if(mounted.current)setReviewing(null);}
  }
  const phaseLabel={idle:'Transcribe on this laptop',ticket:'Requesting a one-use ticket…',transcribing:'Recognizing speech on this laptop…',saving:'Saving the signed transcript draft…'}[phase];
  return <>
    <section className="page-intro"><div><span className="eyebrow">LISTEN, CHECK & RECORD</span><h1>Voice notes & transcription</h1><p>Turn consented Hindi or English audio into a transcript, then check the words before they enter the senior’s care record.</p></div></section>
    <section className="panel speech-selection"><label>Senior<select value={selectedId} disabled={locked||Boolean(audio)||Boolean(pending)} onChange={event=>{setChoice(event.target.value);setLoading(true);}}>{data.seniors.map(senior=><option key={senior.id} value={senior.id}>{senior.name} · {senior.id}</option>)}</select></label><p>{audio||pending?'This audio is bound to the selected senior. Clear it before changing the senior.':canWrite?'Choose whose consented recording you will review.':'Operations view: inspect recorded transcript reviews.'}</p></section>
    {canWrite&&<div className="speech-capture-grid"><section className="panel speech-capture"><header><span className="eyebrow">A CONSENTED RECORDING</span><h2>Capture a voice note</h2><p>Record with this computer’s microphone or upload audio you already have permission to use. This does not capture an ordinary mobile phone call automatically.</p></header>
      <label className="speech-consent"><input type="checkbox" checked={consent} disabled={locked} onChange={event=>setConsent(event.target.checked)}/><span>I have the senior’s permission to record or upload this audio and transcribe it on this laptop. I will review the text before adding a care note.</span></label>
      {!audio&&!pending&&<><div className="speech-mode" role="group" aria-label="Choose audio input"><button className={inputMode==='record'?'active':''} disabled={locked} onClick={()=>setInputMode('record')}>Record microphone</button><button className={inputMode==='upload'?'active':''} disabled={locked} onClick={()=>setInputMode('upload')}>Upload audio</button></div>{inputMode==='record'?<div className="speech-record-control"><div className={`speech-record-clock ${recording?'recording':''}`}><span aria-hidden="true"/>{clock(elapsed)}<small> / {clock(maxSeconds)}</small></div>{recording?<button className="button secondary" onClick={stopRecording}>Stop recording</button>:<button className="button primary" disabled={!consent||!selectedId||locked} onClick={startRecording}>{requestingMic?'Waiting for microphone permission…':'Start microphone recording'}</button>}<p>{recording?'Microphone active. Recording stops automatically before the three-minute limit.':'Microphone permission is requested only when you press Start.'}</p></div>:<label className="speech-upload">Choose a consented audio file<input type="file" accept="audio/*,.webm,.m4a,.mp4,.flac,.ogg,.wav,.mp3" disabled={!consent||!selectedId||locked} onChange={chooseFile}/><span>Up to {(maxBytes/1048576).toFixed(0)} MiB and {clock(maxSeconds)}. The laptop service checks the actual duration before recognition.</span></label>}</>}
      {audio&&<div className="speech-audio-preview"><div><strong>{audio.name}</strong><span>{(audio.blob.size/1048576).toFixed(2)} MiB · {duration===null?'Duration checked by laptop service':`${duration.toFixed(1)} seconds`}</span></div>{audioUrl&&<audio key={audioUrl} controls preload="metadata" src={audioUrl} onLoadedMetadata={event=>{const seconds=event.currentTarget.duration;if(Number.isFinite(seconds)&&seconds>0)setObservedDuration(seconds);}}/>}{tooLong&&<p className="extension-error" role="alert">This audio exceeds {clock(maxSeconds)}. Choose a shorter recording.</p>}<button className="button secondary" disabled={locked||Boolean(pending)} onClick={clearAudio}>Clear local audio</button></div>}
      {audioSaved?<p className="speech-saved-audio">The review draft is saved. Play this local audio while checking the transcript below, then clear it when you finish. Audio is retained only in this open page.</p>:pending?<div className="speech-pending"><strong>{phase==='saving'?'Transcription finished; saving the review draft…':'Transcription finished; saving the draft needs another attempt.'}</strong><p>The signed receipt is retained in this open page. Retry saving without sending audio for recognition again.</p><div><button className="button primary" disabled={!consent||locked} onClick={retrySave}>{busy?'Saving draft…':'Retry saving transcript draft'}</button><button className="button secondary" disabled={locked} onClick={()=>{setPending(null);clearAudio();}}>Discard unsaved transcript</button></div></div>:<button className="button primary speech-transcribe" disabled={!audio||!consent||!service?.configured||health!=='ready'||locked||tooLong} onClick={transcribe}>{phaseLabel}</button>}
      {busy&&<p className="speech-progress" role="status">{phaseLabel} Audio is not uploaded to the app server. Keep this page open.</p>}
      {audioError&&<p className="extension-error" role="alert">{audioError}</p>}
    </section><aside className="panel speech-service"><span className="eyebrow">LOCAL FASTER-WHISPER</span><h2>Speech stays on your laptop</h2><p>{service?.privacy||'The speech service receives audio directly from this browser on the same laptop. Only the signed transcript and its provenance are saved to the private care workspace.'}</p><div className={`speech-health ${health}`}><strong>{health==='ready'?'Checked: ready':health==='checking'?'Checking service':health==='not_ready'?'Model not ready':health==='unavailable'?'Service unavailable':'Not checked'}</strong><p>{healthMessage}</p></div><button className="button secondary" disabled={health==='checking'||locked} onClick={checkHealth}>Check laptop service</button><dl><div><dt>Transcription setup</dt><dd>{service===null?'Loading app configuration…':service.configured?'Ticket signing configured':'Not configured in the app'}</dd></div><div><dt>Local service address</dt><dd><code>{SERVICE_URL}</code></dd></div></dl>{(!service?.configured||serviceError)&&<><p className="speech-muted">The local speech bridge needs its model and shared signing configuration before this page can transcribe.</p><button className="button secondary" disabled={locked} onClick={refreshStatus}>Refresh app configuration</button></>}{serviceError&&<p className="extension-error" role="alert">{serviceError}</p>}<p className="speech-local-access">For this laptop bridge, open the local app at <a href="http://127.0.0.1:5173/">127.0.0.1:5173</a> or localhost:5173. The public website can still show saved transcript reviews.</p><p className="speech-muted">Recognition can miss words, negation and numbers. Review against the recording. These notes flag concerns for people; they do not establish a medical condition.</p></aside></div>}
    <div className="speech-list-toolbar"><div><span className="eyebrow">{selectedName}</span><h2>Transcript review queue</h2><p>{drafts.length} saved draft{drafts.length===1?'':'s'} · {drafts.filter(draft=>draft.status==='awaiting_review').length} awaiting review</p></div><button className="button secondary" disabled={loading||locked} onClick={refreshDrafts}>Refresh drafts</button></div>
    {listError&&<p className="extension-error" role="alert">{listError}</p>}
    {loading?<div className="panel speech-empty">Loading recorded transcription drafts…</div>:!drafts.length?<div className="panel speech-empty"><h3>No transcription drafts recorded</h3><p>{canWrite?'A consented recording can become a review draft after the local service is configured. No transcript has been filled in as an AI result.':'There are no saved transcript reviews for this senior.'}</p></div>:<div className="speech-draft-list">{drafts.map(draft=><DraftCard key={`${draft.id}:${draft.status}`} draft={draft} canWrite={canWrite} disabled={locked} busy={reviewing===draft.id} onReview={reviewDraft}/>)}</div>}
  </>;
}

export default function SpeechNotes(props:Props){
  const role=props.data.session.role;
  if(!['coordinator','operations'].includes(role))return <section className="panel speech-empty"><h1>Care-team access required</h1><p>Transcription recordings and review drafts are available only to the authorized care team.</p></section>;
  return <SpeechWorkspace key={role} {...props} canWrite={role==='coordinator'||role==='operations'&&props.data.session.isAdmin===true}/>;
}
