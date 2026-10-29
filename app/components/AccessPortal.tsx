"use client";

import React, {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {CareRequestError,canEnterPortal,careRequest,invitationDetails} from '../../lib/portal-entry.mjs';
import './care-extensions.css';
import './access-portal.css';

export type AccessState={
 authenticated:boolean;authorized?:boolean;identity?:{name?:string;email?:string};
 memberships?:{role:string;status?:string;[key:string]:unknown}[];session?:Record<string,unknown>;activeRole?:string;
 needsInvitation?:boolean;setupRequired?:boolean;localDemo?:boolean;signInUrl?:string;signOutUrl?:string;
 authMode?:'supabase'|'sites'|'local';configuration?:{allowSignup?:boolean};allowSignup?:boolean;
 accountStatus?:{enabled:boolean;reauthenticationRequired:boolean}|null;
};
// Each care portal validates its response shape at its own API boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function careApi<T=any>(path:string,method='GET',body?:unknown):Promise<T>{return careRequest(path,method,body) as Promise<T>;}

const roles=[
 {id:'senior',title:'Senior member',description:'Share a wellbeing update, request support and stay in touch.',icon:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z'},
 {id:'family',title:'Family member',description:'View shared updates and coordinate care for your loved ones.',icon:'m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1Z'},
 {id:'coordinator',title:'Care coordinator',description:'Review priorities, respond to requests and record follow-ups.',icon:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'},
 {id:'operations',title:'Operations manager',description:'Manage accounts, care assignments and service operations.',icon:'M3 3v18h18M7 14l4-5 4 3 6-7'},
];
const roleName=(id:string)=>roles.find(role=>role.id===id)?.title||'Care account';
const errorText=(value:unknown)=>value instanceof Error?value.message:'The request could not be completed. Please try again.';
const isPublicRole=(role:string)=>role==='family'||role==='senior';
const Leaf=()=> <svg viewBox="0 0 24 24" width="29" height="29" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M20 3C8 3 3 8 5 15c2 7 15 5 15-12ZM3 22 15 9"/></svg>;
const Arrow=()=> <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>;
const Check=()=> <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>;
function PortalContent({auth,exit,children}:{auth:AccessState;exit:()=>Promise<void>;children:(auth:AccessState,exit:()=>Promise<void>)=>React.ReactNode}){return <>{children(auth,exit)}</>;}

export default function AccessPortal({children}:{children:(auth:AccessState,exit:()=>Promise<void>)=>React.ReactNode}){
 const [auth,setAuth]=useState<AccessState|null>(null),[entered,setEntered]=useState(false),[busy,setBusy]=useState('');
 const [sessionError,setSessionError]=useState(''),[formError,setFormError]=useState(''),[inviteError,setInviteError]=useState(''),[notice,setNotice]=useState('');
 const [loginRole,setLoginRole]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[showPassword,setShowPassword]=useState(false),[register,setRegister]=useState(false),[displayName,setDisplayName]=useState('');
 const [inviteMode,setInviteMode]=useState(false),[invitation,setInvitation]=useState(''),[inviteRole,setInviteRole]=useState('family'),[editInvitation,setEditInvitation]=useState(false),[correctRoles,setCorrectRoles]=useState<string[]>([]);
 const loginRef=useRef<HTMLDivElement>(null),locked=useRef(false),revision=useRef(0),invitationActive=useRef(false);
 const accountBlocked=auth?.accountStatus?.enabled===false||auth?.accountStatus?.reauthenticationRequired===true;
 const validInvitation=invitationDetails(invitation).valid;
 const signupAllowed=auth?.allowSignup===true||auth?.configuration?.allowSignup===true;
 function working(value:string){locked.current=!!value;setBusy(value);}
 const applyState=useCallback((state:AccessState,enter=false)=>{
  setAuth(state);if(!canEnterPortal(state))setEntered(false);else if(enter&&!invitationActive.current)setEntered(true);
  if(state.accountStatus?.enabled===false)setSessionError('This account is suspended. Contact the Operations manager.');
  else if(state.accountStatus?.reauthenticationRequired)setSessionError('Your sign-in details changed. Sign out, then sign in again.');
  else setSessionError('');
 },[]);
 async function refresh(enter=false){const current=++revision.current,state=await careApi<AccessState>('/auth');if(current===revision.current)applyState(state,enter);return state;}
 useEffect(()=>{
  let active=true;const details=invitationDetails(window.location.href);invitationActive.current=details.present;
  void Promise.resolve().then(()=>{
   if(!active)return;
   setInviteMode(details.present);setInvitation(details.token||'');setInviteRole(details.role&&details.role!=='operations'?details.role:'family');setEditInvitation(details.present&&!details.valid);
   if(details.present&&!details.valid)setInviteError('This invitation link is incomplete. Paste the full link your care team shared.');
   const current=++revision.current;
   return careApi<AccessState>('/auth').then(state=>{if(active&&current===revision.current)applyState(state,true);});
  }).catch(error=>{if(active)setSessionError(errorText(error));});
  return()=>{active=false;};
 },[applyState]);
 useEffect(()=>{
  if(!loginRole)return;
  const old=document.activeElement instanceof HTMLElement?document.activeElement:null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';loginRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  function key(event:KeyboardEvent){
   if(event.key==='Escape'&&!locked.current){setLoginRole('');setPassword('');}
   if(event.key!=='Tab')return;
   const nodes=Array.from(loginRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]')||[]).filter(node=>!node.hidden);
   const first=nodes[0],last=nodes.at(-1);if(!first||!last)return;
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  document.addEventListener('keydown',key);
  return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);if(old?.isConnected)old.focus();};
 },[loginRole]);
 async function selectSession(state:AccessState,role:string,enter=true){const result=await careApi<{session:Record<string,unknown>}>('/session','POST',{role});const next={...state,authorized:true,session:result.session,activeRole:role};applyState(next,enter);return next;}
 async function open(role:string){
  if(locked.current)return;working(role);setSessionError('');
  try{if(auth?.localDemo&&!auth.authenticated){await careApi('/auth/local-login','POST',{role});await refresh(true);}else if(auth)await selectSession(auth,role,true);}
  catch(error){setSessionError(errorText(error));}finally{working('');}
 }
 async function exit(){
  if(locked.current)return;working('logout');
  try{await careApi('/auth/logout','POST',{});revision.current++;setEntered(false);setPassword('');if(auth?.authMode==='sites'){window.location.assign(auth.signOutUrl||'/signout-with-chatgpt?return_to=/');return;}await refresh();}
  catch(error){setSessionError(errorText(error));}finally{working('');}
 }
 function choosePortal(role:string,create=false){
  if(locked.current)return;setFormError('');setNotice('');setCorrectRoles([]);setRegister(create&&isPublicRole(role));setShowPassword(false);
  if(auth?.authenticated||auth?.localDemo){void open(role);return;}setPassword('');setLoginRole(role);
 }
 async function signIn(event:React.FormEvent){
  event.preventDefault();if(locked.current)return;working('login');setFormError('');setCorrectRoles([]);setNotice('');
  try{
   await careApi(register?'/auth/register':'/auth/login','POST',{email:email.trim(),password,role:loginRole,...(register?{displayName:displayName.trim()}:{})});setPassword('');
   if(register){setRegister(false);setNotice(inviteMode?'Check your email to verify your account, then return to this invitation and sign in.':'Check your email to verify your account, then sign in. Accept your invitation to connect to care.');return;}
   const next=await refresh(),assigned=next.memberships?.some(member=>member.role===loginRole&&(member.status===undefined||member.status==='active'));
   if(!assigned&&next.memberships?.length){await careApi('/auth/logout','POST',{});await refresh();throw new Error('Choose the portal assigned to this account.');}
   if(assigned)await selectSession(next,loginRole,!invitationActive.current);
   else{setEntered(false);setInviteMode(true);invitationActive.current=true;setNotice('Signed in. Accept your invitation below to connect your care account.');}
   setLoginRole('');
  }catch(error){setFormError(errorText(error));if(error instanceof CareRequestError&&error.code==='PORTAL_ROLE_MISMATCH')setCorrectRoles(error.availableRoles);}
  finally{working('');}
 }
 function clearInvitationLocation(){
  const url=new URL(window.location.href);url.searchParams.delete('invite');url.searchParams.delete('token');url.searchParams.delete('role');
  const hash=new URLSearchParams(url.hash.slice(1));if(hash.has('invite')||hash.has('token')){hash.delete('invite');hash.delete('token');hash.delete('role');url.hash=hash.toString();}
  window.history.replaceState({},'',url.pathname+url.search+url.hash);
 }
 async function accept(event:React.FormEvent){
  event.preventDefault();if(locked.current)return;const details=invitationDetails(invitation);if(!details.valid){setInviteError('Paste the complete invitation link, or its 64-character invitation code.');return;}working('invite');setInviteError('');
  let connectionSaved=false;
  try{const result=await careApi<{role:string}>('/access/accept','POST',{token:details.token});connectionSaved=true;clearInvitationLocation();invitationActive.current=false;setInvitation('');const next=await refresh();await selectSession(next,result.role,true);setInviteMode(false);}
  catch(error){setInviteError(connectionSaved?'Your connection was saved. Refresh this page to open your portal.':errorText(error));}finally{working('');}
 }
 function showInvitation(){setInviteMode(true);invitationActive.current=true;setEditInvitation(true);setEntered(false);setSessionError('');requestAnimationFrame(()=>document.getElementById('care-invitation')?.scrollIntoView({behavior:'smooth',block:'start'}));}
 function continueWithoutInvitation(){clearInvitationLocation();invitationActive.current=false;setInviteMode(false);setInvitation('');setInviteError('');if(canEnterPortal(auth))setEntered(true);}
 const showInvite=inviteMode||auth?.needsInvitation===true||!!(auth?.authenticated&&!auth.memberships?.length);
 if(entered&&auth&&canEnterPortal(auth))return <PortalContent auth={auth} exit={exit}>{children}</PortalContent>;
 return <div className="access-portal care-landing">
  <a className="landing-skip" href="#care-portals">Skip to sign in</a>
  <header className="access-header">
   <Link href="/" className="access-brand" aria-label="Samarth Care home"><span className="landing-brand-mark"><Leaf/></span><span>samarth<span className="landing-brand-dot">.</span><small>CARE AT HOME</small></span></Link>
   <nav className="landing-navigation" aria-label="Main navigation"><a href="#care-approach">Our approach</a><a href="#for-families">For families</a></nav>
   {auth?.authenticated?<button className="button secondary" onClick={exit} disabled={!!busy}>{busy==='logout'?'Signing out…':'Sign out'}</button>:<a className="button primary" href="#care-portals">Sign in <Arrow/></a>}
  </header>
  <main className="access-main">
   {showInvite&&<section className="landing-invitation" id="care-invitation" aria-labelledby="invitation-title">
    <div className="landing-invite-heading"><span className="landing-invite-icon"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg></span><div><span className="landing-eyebrow">YOUR CARE CONNECTION</span><h2 id="invitation-title">Accept your invitation</h2><p>Use the email address the invitation was created for.</p></div></div>
    <ol className="landing-invite-steps" aria-label="Invitation steps"><li className={auth?.authenticated?'complete':'current'}><span>{auth?.authenticated?<Check/>:'1'}</span>Sign in</li><li className={auth?.authenticated?'current':''}><span>2</span>Accept connection</li><li><span>3</span>Open your portal</li></ol>
    {inviteError&&<p className="extension-error" role="alert">{inviteError}</p>}
    {auth?.authenticated?<form onSubmit={accept} className="landing-invite-form">
     <div className="landing-invite-identity"><span>Signed in as</span><strong>{auth.identity?.email||auth.identity?.name}</strong><button type="button" className="landing-inline-link" disabled={!!busy} onClick={exit}>Use a different account</button></div>
     {validInvitation&&!editInvitation?<div className="landing-invite-ready"><Check/><span>Invitation link is ready</span><button className="landing-inline-link" type="button" onClick={()=>setEditInvitation(true)}>Use another link</button></div>:<label>Invitation link or code<input required autoComplete="off" value={invitation} onChange={event=>{setInvitation(event.target.value);setInviteError('');}} placeholder="Paste the link shared with you"/></label>}
     <div className="landing-invite-actions"><button className="button primary" disabled={!!busy||!validInvitation||accountBlocked}>{busy==='invite'?'Connecting…':'Accept and open portal'}<Arrow/></button>{canEnterPortal(auth)&&<button className="landing-inline-link" type="button" disabled={!!busy} onClick={continueWithoutInvitation}>Continue to my existing portal</button>}</div>
    </form>:<div className="landing-invite-anonymous"><label>Account type<select value={inviteRole} onChange={event=>setInviteRole(event.target.value)}><option value="family">Family member</option><option value="senior">Senior member</option><option value="coordinator">Care coordinator</option></select></label><div><button className="button primary" disabled={!auth||!!busy} onClick={()=>choosePortal(inviteRole)}>Sign in to accept <Arrow/></button>{signupAllowed&&isPublicRole(inviteRole)&&<button className="button secondary" disabled={!auth||!!busy} onClick={()=>choosePortal(inviteRole,true)}>Create an account</button>}</div><p>{inviteRole==='coordinator'?'Use the coordinator login created by Operations.':'Already have a login? Sign in. If you are new, create an account and verify your email first.'}</p></div>}
   </section>}
   <section className="landing-hero" aria-labelledby="landing-title">
    <div className="landing-hero-copy"><span className="landing-eyebrow">INDEPENDENCE AT HOME. CONNECTION THROUGH CARE.</span><h1 id="landing-title">Thoughtful care.<br/><em>Closer to home.</em></h1><p>A shared space for seniors, families and care teams to stay connected, notice changes and follow through.</p><div className="landing-hero-actions"><a className="button primary" href="#care-portals">Open your care portal <Arrow/></a><a href="#care-approach" className="landing-text-link">Discover our approach</a></div><div className="landing-hero-points"><span><Check/>Hindi & English check-ins</span><span><Check/>Human follow-up</span><span><Check/>Family sharing with consent</span></div></div>
    <aside className="landing-care-circle" aria-label="The people connected through care"><div className="landing-circle-orbit" aria-hidden="true"/><div className="landing-home"><div className="landing-home-icon"><svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M13 35 40 13l27 22v32H49V47H31v20H13Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M31 29c-7-8-17 2 0 13 17-11 7-21 0-13Z" transform="translate(9 2)" fill="currentColor" stroke="none"/></svg></div><h2>The senior<br/>comes first.</h2><p>Care that supports life<br/>in familiar surroundings.</p></div><div className="landing-circle-person person-family"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m0 4a5 5 0 0 1 4 4v3"/></svg></span><strong>Family</strong><small>Connected & informed</small></div><div className="landing-circle-person person-coordinator"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></svg></span><strong>Care team</strong><small>Reviews & follows up</small></div><p className="landing-circle-caption">One connected circle of care</p></aside>
   </section>
   <section className="landing-portals" id="care-portals" aria-labelledby="portals-title">
    <div className="landing-section-heading"><div><span className="landing-eyebrow">YOUR WORKSPACE</span><h2 id="portals-title">A place for everyone in the care circle.</h2></div><p>Choose your account type to sign in.</p></div>
    {auth?.authenticated&&<div className="access-identity"><span className="access-identity-dot"/><span>Signed in as <strong>{auth.identity?.name||auth.identity?.email||'care member'}</strong>{auth.identity?.email&&<small>{auth.identity.email}</small>}</span><span>{auth.memberships?.length?'Account connected':'Invitation required'}</span></div>}
    {sessionError&&<div className="extension-error" role="alert">{sessionError}{!auth&&<button className="landing-inline-link" onClick={()=>refresh(true).catch(error=>setSessionError(errorText(error)))}>Try again</button>}{accountBlocked&&<button className="landing-inline-link" disabled={!!busy} onClick={exit}>Sign out</button>}</div>}
    {notice&&!loginRole&&<p className="landing-notice" role="status">{notice}</p>}
    {!auth&&!sessionError&&<p className="access-loading" role="status">Connecting to secure sign-in…</p>}
    <div className="access-role-grid">{roles.map(role=>{const assigned=auth?.memberships?.some(member=>member.role===role.id&&(member.status===undefined||member.status==='active')),localEntry=auth?.localDemo&&!auth.authenticated,unavailable=auth?.authenticated&&!assigned;return <article className={`access-role ${role.id}`} key={role.id}><span className="access-role-icon"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={role.icon}/></svg></span><h3>{role.title}</h3><p>{role.description}</p><button className="button secondary" disabled={!auth||!!busy||accountBlocked||!!unavailable} onClick={()=>choosePortal(role.id)} aria-label={`${assigned||localEntry?'Open':'Sign in to'} ${role.title} portal`}>{busy===role.id?'Opening…':localEntry?'Open local demo':assigned?'Open portal':unavailable?'Not assigned':'Sign in'}<Arrow/></button></article>;})}</div>
    <div className="landing-access-help"><p>{signupAllowed?'New here? Family and senior accounts can be created from their sign-in form.':'Your care team can help set up an account.'} Operations sets up care-team access.</p><button type="button" className="landing-inline-link" disabled={!!busy} onClick={showInvitation}>Have an invitation?</button></div>
   </section>
   <section className="landing-approach" id="care-approach" aria-labelledby="approach-title"><div className="landing-section-heading"><div><span className="landing-eyebrow">SMALL UPDATES. THOUGHTFUL ACTION.</span><h2 id="approach-title">Care is a conversation<br/>that continues.</h2></div><p>Bring everyday information and the people who act on it into one clear care history.</p></div><div className="landing-approach-grid"><article><span>01 / SHARE</span><h3>A little about the day.</h3><p>A simple call, wellbeing update, reading or medication log helps build a picture of the senior’s routine.</p></article><article><span>02 / UNDERSTAND</span><h3>A person reviews the change.</h3><p>The care team sees what changed, the dated evidence behind it and what needs attention next.</p></article><article><span>03 / FOLLOW THROUGH</span><h3>The next step stays visible.</h3><p>Support requests have an owner and a recorded outcome. Family receives appropriate, consented updates.</p></article></div></section>
   <section className="landing-family" id="for-families" aria-labelledby="families-title"><div><span className="landing-eyebrow">TOGETHER, EVEN FROM A DISTANCE</span><h2 id="families-title">Stay involved.<br/>Respect their independence.</h2><p>Understand the updates shared with you, ask the care team for support and follow the next step without losing the thread.</p><a className="button primary" href="#care-portals">Explore your portal <Arrow/></a></div><div className="landing-family-principles"><article><span>01</span><div><h3>People before dashboards</h3><p>A wellbeing flag starts a human review. It does not make a diagnosis.</p></div></article><article><span>02</span><div><h3>A simple call is enough</h3><p>Seniors can speak to their coordinator in Hindi or English. The website is an optional way to stay connected.</p></div></article><article><span>03</span><div><h3>Shared by permission</h3><p>Family access follows the senior’s sharing consent and the care records linked to each account.</p></div></article></div></section>
  </main>
  <footer className="landing-footer"><Link href="/" className="landing-footer-brand"><Leaf/><span>Samarth Care</span></Link><p>Independent DEV_104 concept prototype.<br/>Showcase histories are synthetic. Care decisions remain with people.</p><a href="#care-portals">Sign in <Arrow/></a></footer>
  {loginRole&&<div className="access-login-overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&!locked.current){setLoginRole('');setPassword('');}}}><div className="access-login-dialog" ref={loginRef} role="dialog" aria-modal="true" aria-labelledby="care-login-title" aria-describedby="care-login-description">
   <div className="access-login-head"><span className="landing-eyebrow">{roleName(loginRole)}</span><button type="button" className="icon-button" aria-label="Close sign-in" disabled={!!busy} onClick={()=>{setLoginRole('');setPassword('');}}>×</button></div>
   <h2 id="care-login-title">{register?'Create your account':'Welcome back.'}</h2><p id="care-login-description">{register?'Use your own email address. You will need to verify it before connecting to care.':inviteMode?'Sign in with the email address used for your invitation.':'Sign in to your care workspace.'}</p>
   {formError&&<div className="extension-error" role="alert">{formError}{correctRoles.length>0&&<div className="landing-correct-portals">{correctRoles.map(role=><button type="button" className="landing-inline-link" key={role} onClick={()=>{setLoginRole(role);setRegister(false);setFormError('');setCorrectRoles([]);}}>Use {roleName(role)} sign-in</button>)}</div>}</div>}
   {notice&&<p className="landing-notice" role="status">{notice}</p>}
   <form onSubmit={signIn}>
    {register&&<label>Full name<input type="text" required minLength={2} maxLength={80} autoComplete="name" value={displayName} disabled={!!busy} onChange={event=>setDisplayName(event.target.value)}/></label>}
    <label>Email address<input type="email" required maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} disabled={!!busy} onChange={event=>setEmail(event.target.value)}/></label>
    <label>Password<span className="landing-password-field"><input type={showPassword?'text':'password'} required minLength={register?12:1} maxLength={128} autoComplete={register?'new-password':'current-password'} value={password} disabled={!!busy} onChange={event=>setPassword(event.target.value)}/><button type="button" disabled={!!busy} aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)}>{showPassword?'Hide':'Show'}</button></span>{register&&<small>Use at least 12 characters.</small>}</label>
    <button className="button primary" disabled={!!busy}>{busy==='login'?register?'Creating account…':'Signing in…':register?'Create account':'Sign in'}{!busy&&<Arrow/>}</button>
   </form>
   {isPublicRole(loginRole)&&signupAllowed&&<p className="landing-login-switch">{register?'Already have an account?':'New to Samarth Care?'} <button type="button" className="landing-inline-link" disabled={!!busy} onClick={()=>{setRegister(value=>!value);setFormError('');setNotice('');setPassword('');}}>{register?'Sign in':'Create an account'}</button></p>}
   {!isPublicRole(loginRole)&&<p className="landing-staff-note">Use the account created by Operations.</p>}
   <button type="button" className="landing-login-back" disabled={!!busy} onClick={()=>{setLoginRole('');setPassword('');}}>Choose a different portal</button>
  </div></div>}
 </div>;
}
