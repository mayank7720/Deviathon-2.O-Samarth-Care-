"use client";

import React, {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import CareMark from './CareMark';
import {CareRequestError,canEnterPortal,careRequest,invitationDetails} from '../../lib/portal-entry.mjs';
import {siteRoute,signInPath,canonicalLegacyLink,workspaceDestination} from '../../lib/site-links.mjs';
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
 {id:'senior',title:'Senior member',description:'Share how you feel, ask for support and view your care updates.',type:'Personal account',icon:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z'},
 {id:'family',title:'Family member',description:'See shared updates and stay in touch with your loved one’s care team.',type:'Personal account',icon:'m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1Z'},
 {id:'coordinator',title:'Care coordinator',description:'Review wellbeing changes, respond to requests and manage follow-ups.',type:'Care team',icon:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'},
 {id:'operations',title:'Operations manager',description:'Manage accounts, care assignments and communication settings.',type:'Administration',icon:'M3 3v18h18M7 14l4-5 4 3 6-7'},
];
const roleName=(id:string)=>roles.find(role=>role.id===id)?.title||'Care account';
const errorText=(value:unknown)=>value instanceof Error?value.message:'The request could not be completed. Please try again.';
const isPublicRole=(role:string)=>role==='family'||role==='senior';
const Arrow=()=> <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>;
const Check=()=> <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>;
function PortalContent({auth,exit,children}:{auth:AccessState;exit:()=>Promise<void>;children:(auth:AccessState,exit:()=>Promise<void>)=>React.ReactNode}){return <>{children(auth,exit)}</>;}

export default function AccessPortal({children}:{children:(auth:AccessState,exit:()=>Promise<void>)=>React.ReactNode}){
 const router=useRouter(),pathname=usePathname(),route=siteRoute(pathname||'/');
 const loginRole=route.kind==='sign-in'||route.kind==='register'?route.role:'',register=route.kind==='register';
 const [auth,setAuth]=useState<AccessState|null>(null),[busy,setBusy]=useState('');
 const [sessionError,setSessionError]=useState(''),[formError,setFormError]=useState(''),[inviteError,setInviteError]=useState(''),[notice,setNotice]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[showPassword,setShowPassword]=useState(false),[displayName,setDisplayName]=useState('');
 const [inviteMode,setInviteMode]=useState(false),[invitation,setInvitation]=useState(''),[inviteRole,setInviteRole]=useState('family'),[editInvitation,setEditInvitation]=useState(false),[correctRoles,setCorrectRoles]=useState<string[]>([]);
 const [returnTo,setReturnTo]=useState('');
 const loginRef=useRef<HTMLDivElement>(null),locked=useRef(false),revision=useRef(0),invitationActive=useRef(false);
 const accountBlocked=auth?.accountStatus?.enabled===false||auth?.accountStatus?.reauthenticationRequired===true;
 const validInvitation=invitationDetails(invitation).valid;
 const signupAllowed=auth?.allowSignup===true||auth?.configuration?.allowSignup===true;
 function working(value:string){locked.current=!!value;setBusy(value);}
 const applyState=useCallback((state:AccessState)=>{
  setAuth(state);
  if(state.accountStatus?.enabled===false)setSessionError('This account is suspended. Contact the Operations manager.');
  else if(state.accountStatus?.reauthenticationRequired)setSessionError('Your sign-in details changed. Sign out, then sign in again.');
  else setSessionError('');
 },[]);
 async function refresh(){const current=++revision.current,state=await careApi<AccessState>('/auth');if(current===revision.current)applyState(state);return state;}
 function nextLocation(){return new URL(window.location.href).searchParams.get('next')||'';}
 function openWorkspace(state:AccessState,role:string){router.replace(workspaceDestination(role,state.session?.isAdmin===true,nextLocation()));}
 function closeSignIn(){setPassword('');router.push(signInPath('',false,{token:invitationDetails(invitation).token,next:nextLocation()}));}
 useEffect(()=>{
  let active=true;const details=invitationDetails(window.location.href);invitationActive.current=details.present;
  void Promise.resolve().then(()=>{
   if(!active)return;
   setInviteMode(details.present);setInvitation(details.token||'');setInviteRole(details.role&&details.role!=='operations'?details.role:'family');setEditInvitation(details.present&&!details.valid);
   if(details.present&&!details.valid)setInviteError('This invitation link is incomplete. Paste the full link your care team shared.');
   const current=++revision.current;
   return careApi<AccessState>('/auth').then(state=>{if(active&&current===revision.current)applyState(state);});
  }).catch(error=>{if(active)setSessionError(errorText(error));});
  return()=>{active=false;};
 },[applyState]);
 useEffect(()=>{
  if(!loginRole)return;
  loginRef.current?.querySelector<HTMLInputElement>('input')?.focus();
 },[loginRole,register]);
 useEffect(()=>{
  const legacy=canonicalLegacyLink(window.location.href);if(legacy){router.replace(legacy);return;}
  void Promise.resolve().then(()=>setReturnTo(new URL(window.location.href).searchParams.get('next')||''));
  if(route.kind==='workspace'&&auth&&!auth.authenticated)router.replace(signInPath('',false,{next:pathname}));
  else if(route.kind==='workspace'&&auth?.authenticated&&!canEnterPortal(auth))router.replace(auth.memberships?.length?'/sign-in':'/invitations');
 },[router,pathname,route.kind,auth]);
 async function selectSession(state:AccessState,role:string,enter=true){const result=await careApi<{session:Record<string,unknown>}>('/session','POST',{role});const next={...state,authorized:true,session:result.session,activeRole:role};applyState(next);if(enter)openWorkspace(next,role);return next;}
 async function open(role:string){
  if(locked.current)return;working(role);setSessionError('');
  try{if(auth?.localDemo&&!auth.authenticated){await careApi('/auth/local-login','POST',{role});const state=await refresh();openWorkspace(state,role);}else if(auth)await selectSession(auth,role,true);}
  catch(error){setSessionError(errorText(error));}finally{working('');}
 }
 async function exit(){
  if(locked.current)return;working('logout');
  try{await careApi('/auth/logout','POST',{});revision.current++;setPassword('');if(auth?.authMode==='sites'){window.location.assign(auth.signOutUrl||'/signout-with-chatgpt?return_to=/');return;}await refresh();router.replace(signInPath('',false,{token:showInvite?invitationDetails(invitation).token:''}));}
  catch(error){setSessionError(errorText(error));}finally{working('');}
 }
 function choosePortal(role:string,create=false){
  if(locked.current)return;setFormError('');setNotice('');setCorrectRoles([]);setShowPassword(false);
  if(auth?.authenticated||auth?.localDemo){void open(role);return;}setPassword('');router.push(signInPath(role,create,{token:invitationDetails(invitation).token,next:nextLocation()}));
 }
 async function signIn(event:React.FormEvent){
  event.preventDefault();if(locked.current)return;working('login');setFormError('');setCorrectRoles([]);setNotice('');
  try{
   await careApi(register?'/auth/register':'/auth/login','POST',{email:email.trim(),password,role:loginRole,...(register?{displayName:displayName.trim()}:{})});setPassword('');
   if(register){router.replace(signInPath(loginRole,false,{token:invitation,next:nextLocation()}));setNotice(inviteMode?'Check your email to verify your account, then return to this invitation and sign in.':'Check your email to verify your account, then sign in. Accept your invitation to connect to care.');return;}
   const next=await refresh(),assigned=next.memberships?.some(member=>member.role===loginRole&&(member.status===undefined||member.status==='active'));
   if(!assigned&&next.memberships?.length){await careApi('/auth/logout','POST',{});await refresh();throw new Error('Choose the portal assigned to this account.');}
   if(assigned)await selectSession(next,loginRole,!invitationActive.current);
   else{setInviteMode(true);invitationActive.current=true;setNotice('Signed in. Accept your invitation below to connect your care account.');}
   if(invitationActive.current)router.replace('/invitations'+(validInvitation?'#invite='+invitation+'&role='+loginRole:''));
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
 function showInvitation(){
  setInviteMode(true);invitationActive.current=true;setEditInvitation(true);setSessionError('');
  router.push('/invitations');
  requestAnimationFrame(()=>{
   document.getElementById('invitation-title')?.focus({preventScroll:true});
   document.getElementById('care-invitation')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  });
 }
 function continueWithoutInvitation(){clearInvitationLocation();invitationActive.current=false;setInviteMode(false);setInvitation('');setInviteError('');if(auth&&canEnterPortal(auth)){openWorkspace(auth,String(auth.session?.role||auth.activeRole||''));}}
 const showInvite=route.kind==='invitations';
 if(route.kind==='workspace'&&auth&&canEnterPortal(auth))return <PortalContent auth={auth} exit={exit}>{children}</PortalContent>;
 const loginForm=<div className="access-auth-page"><div className="access-login-dialog" ref={loginRef}  aria-labelledby="care-login-title" aria-describedby="care-login-description">
   <div className="access-login-head"><span className="landing-eyebrow">{roleName(loginRole)}</span><button type="button" className="icon-button" aria-label="Close sign-in" disabled={!!busy} onClick={closeSignIn}>×</button></div>
   <h1 id="care-login-title">{register?'Create your account':'Welcome back.'}</h1><p id="care-login-description">{register?'Use your own email address. You will need to verify it before connecting to care.':inviteMode?'Sign in with the email address used for your invitation.':'Sign in to your care workspace.'}</p>
   {formError&&<div className="extension-error" role="alert">{formError}{correctRoles.length>0&&<div className="landing-correct-portals">{correctRoles.map(role=><button type="button" className="landing-inline-link" key={role} onClick={()=>choosePortal(role)}>Use {roleName(role)} sign-in</button>)}</div>}</div>}
   {notice&&<p className="landing-notice" role="status">{notice}</p>}
   {auth?.authenticated?<div className="landing-signed-in"><p>Signed in as <strong>{auth.identity?.email||auth.identity?.name}</strong>.</p><div className="phone-support-actions">{canEnterPortal(auth)?<Link className="button primary" href={workspaceDestination(String(auth.session?.role||auth.activeRole||''),auth.session?.isAdmin===true,returnTo)}>Open my workspace <Arrow/></Link>:<Link className="button primary" href="/invitations">Connect to care <Arrow/></Link>}<button type="button" className="button secondary" disabled={!!busy} onClick={exit}>Use a different account</button></div></div>:<form onSubmit={signIn}>
    {register&&<label>Full name<input type="text" required minLength={2} maxLength={80} autoComplete="name" value={displayName} disabled={!!busy} onChange={event=>setDisplayName(event.target.value)}/></label>}
    <label>Email address<input type="email" required maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} disabled={!!busy} onChange={event=>setEmail(event.target.value)}/></label>
    <label>Password<span className="landing-password-field"><input type={showPassword?'text':'password'} required minLength={register?12:1} maxLength={128} autoComplete={register?'new-password':'current-password'} value={password} disabled={!!busy} onChange={event=>setPassword(event.target.value)}/><button type="button" disabled={!!busy} aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} onClick={()=>setShowPassword(value=>!value)}>{showPassword?'Hide':'Show'}</button></span>{register&&<small>Use at least 12 characters.</small>}</label>
    <button className="button primary" disabled={!!busy}>{busy==='login'?register?'Creating account…':'Signing in…':register?'Create account':'Sign in'}{!busy&&<Arrow/>}</button>
   </form>}
   {!auth?.authenticated&&isPublicRole(loginRole)&&signupAllowed&&<p className="landing-login-switch">{register?'Already have an account?':'New to SwasthSync?'} <button type="button" className="landing-inline-link" disabled={!!busy} onClick={()=>choosePortal(loginRole,!register)}>{register?'Sign in':'Create an account'}</button></p>}
   {!isPublicRole(loginRole)&&<p className="landing-staff-note">Use the account created by Operations.</p>}
   <button type="button" className="landing-login-back" disabled={!!busy} onClick={closeSignIn}>Choose a different portal</button>
  </div></div>;
 return <div className="access-portal care-landing">
  <a className="landing-skip" href="#main-content">Skip to main content</a>
  <header className="access-header">
   <Link href="/" className="access-brand" aria-label="SwasthSync home"><span className="landing-brand-mark"><CareMark size={29}/></span><span>SwasthSync</span></Link>
   <nav className="landing-navigation" aria-label="Main navigation"><Link href="/how-it-works">How it works</Link><Link href="/for-families">For families</Link><Link href="/questions">Questions</Link></nav>
   {auth?.authenticated?<div className="landing-account-links">{canEnterPortal(auth)&&<Link className="button primary" href={workspaceDestination(String(auth.session?.role||auth.activeRole||''),auth.session?.isAdmin===true)}>Open workspace <Arrow/></Link>}<button className="button secondary" onClick={exit} disabled={!!busy}>{busy==='logout'?'Signing out…':'Sign out'}</button></div>:<Link className="button primary" href="/sign-in">Sign in <Arrow/></Link>}
  </header>
  <main className="access-main" id="main-content" tabIndex={-1}>
   {sessionError&&<div className="extension-error" role="alert">{sessionError}{!auth&&<button type="button" className="landing-inline-link" onClick={()=>refresh().catch(error=>setSessionError(errorText(error)))}>Try again</button>}{accountBlocked&&<button type="button" className="landing-inline-link" disabled={!!busy} onClick={exit}>Sign out</button>}</div>}
   {notice&&!loginRole&&<p className="landing-notice" role="status">{notice}</p>}
   {route.kind!=='home'&&route.kind!=='workspace'&&!loginRole&&<div className="landing-route-intro"><h1>{({'sign-in':'Sign in',register:'Create an account',invitations:'Your care invitation','how-it-works':'How SwasthSync works','for-families':'Care for your family',questions:'Common questions'} as Record<string,string>)[route.kind]}</h1><Link href="/">← Back to home</Link></div>}
   {route.kind==='workspace'&&<p className="access-loading" role="status">Checking secure workspace access…</p>}
   {loginRole&&(!register||signupAllowed)?loginForm:loginRole&&<section className="panel access-auth-page"><p role="status">{auth?'Account creation is unavailable. Contact the care team, or sign in to an existing account.':'Checking account setup…'}</p><Link href={signInPath(loginRole)}>Sign in</Link></section>}
   {showInvite&&<section className="landing-invitation" id="care-invitation" aria-labelledby="invitation-title">
    <div className="landing-invite-heading"><span className="landing-invite-icon"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg></span><div><span className="landing-eyebrow">YOUR CARE CONNECTION</span><h2 id="invitation-title" tabIndex={-1}>Accept your invitation</h2><p>Use the email address the invitation was created for.</p></div></div>
    <ol className="landing-invite-steps" aria-label="Invitation steps"><li className={auth?.authenticated?'complete':'current'}><span>{auth?.authenticated?<Check/>:'1'}</span>Sign in</li><li className={auth?.authenticated?'current':''}><span>2</span>Accept connection</li><li><span>3</span>Open your portal</li></ol>
    {inviteError&&<p className="extension-error" role="alert">{inviteError}</p>}
    {auth?.authenticated?<form onSubmit={accept} className="landing-invite-form">
     <div className="landing-invite-identity"><span>Signed in as</span><strong>{auth.identity?.email||auth.identity?.name}</strong><button type="button" className="landing-inline-link" disabled={!!busy} onClick={exit}>Use a different account</button></div>
     {validInvitation&&!editInvitation?<div className="landing-invite-ready"><Check/><span>Invitation link is ready</span><button className="landing-inline-link" type="button" onClick={()=>setEditInvitation(true)}>Use another link</button></div>:<label>Invitation link or code<input required autoComplete="off" value={invitation} onChange={event=>{setInvitation(event.target.value);setInviteError('');}} placeholder="Paste the link shared with you"/></label>}
     <div className="landing-invite-actions"><button className="button primary" disabled={!!busy||!validInvitation||accountBlocked}>{busy==='invite'?'Connecting…':'Accept and open portal'}<Arrow/></button>{canEnterPortal(auth)&&<button className="landing-inline-link" type="button" disabled={!!busy} onClick={continueWithoutInvitation}>Continue to my existing portal</button>}</div>
    </form>:<div className="landing-invite-anonymous"><label>Account type<select value={inviteRole} onChange={event=>setInviteRole(event.target.value)}><option value="family">Family member</option><option value="senior">Senior member</option><option value="coordinator">Care coordinator</option></select></label><div><button className="button primary" disabled={!auth||!!busy} onClick={()=>choosePortal(inviteRole)}>Sign in to accept <Arrow/></button>{signupAllowed&&isPublicRole(inviteRole)&&<button className="button secondary" disabled={!auth||!!busy} onClick={()=>choosePortal(inviteRole,true)}>Create an account</button>}</div><p>{inviteRole==='coordinator'?'Use the coordinator login created by Operations.':'Already have a login? Sign in. If you are new, create an account and verify your email first.'}</p></div>}
   </section>}
   {route.kind==='home'&&<section className="landing-hero" aria-labelledby="landing-title">
    <div className="landing-hero-copy">
     <span className="landing-eyebrow">SENIORS. FAMILIES. CARE TEAMS.</span>
     <h1 id="landing-title">Everyday care.<br/><em>A closer connection.</em></h1>
     <p>Keep wellbeing updates, family conversations and care-team follow-ups together. Notice changes. Know the next step.</p>
     <div className="landing-hero-actions"><Link className="button primary" href="/sign-in">Choose your portal <Arrow/></Link><Link href="/how-it-works" className="landing-text-link">See how it works <Arrow/></Link></div>
     <div className="landing-hero-points"><span><Check/>Personal wellbeing history</span><span><Check/>Human follow-up</span><span><Check/>Sharing with consent</span></div>
    </div>
    <aside className="landing-care-preview" aria-label="How your care stays connected">
     <div className="landing-preview-top"><span className="landing-preview-symbol"><CareMark size={29}/></span><div><span className="landing-eyebrow">YOUR CIRCLE OF CARE</span><strong>Every update has a next step.</strong></div></div>
     <div className="landing-preview-center">
      <span className="landing-preview-home"><svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M13 35 40 13l27 22v32H49V47H31v20H13Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M31 29c-7-8-17 2 0 13 17-11 7-21 0-13Z" transform="translate(9 2)" fill="currentColor" stroke="none"/></svg></span>
      <h2>At home.<br/><em>In good company.</em></h2><p>The senior stays at the centre.</p>
     </div>
     <div className="landing-preview-people">
      <div><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m0 4a5 5 0 0 1 4 4v3"/></svg></span><strong>Family</strong><small>Updates shared with consent</small></div>
      <div><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></svg></span><strong>Care team</strong><small>Review, respond, follow up</small></div>
     </div>
     <div className="landing-preview-note"><Check/><span>One shared care history</span></div>
    </aside>
   </section>}
   {(['home','sign-in','register'].includes(route.kind)&&!loginRole)&&<section className="landing-portals" id="portal-options" aria-labelledby="portals-title" tabIndex={-1}>
    <div className="landing-section-heading"><div><span className="landing-eyebrow">YOUR CARE PORTAL</span><h2 id="portals-title">{register?'Create a personal account.':'Choose your sign-in.'}</h2></div><p>Choose your account type to sign in.</p></div>
    {auth?.authenticated&&<div className="access-identity"><span className="access-identity-dot"/><span>Signed in as <strong>{auth.identity?.name||auth.identity?.email||'care member'}</strong>{auth.identity?.email&&<small>{auth.identity.email}</small>}</span><span>{auth.memberships?.length?'Account connected':'Invitation required'}</span></div>}
    {!auth&&!sessionError&&<p className="access-loading" role="status">Connecting to secure sign-in…</p>}
    <div className="access-role-grid">{roles.filter(role=>!register||isPublicRole(role.id)).map(role=>{
     const assigned=auth?.memberships?.some(member=>member.role===role.id&&(member.status===undefined||member.status==='active'));
     const localEntry=auth?.localDemo&&!auth.authenticated,unavailable=auth?.authenticated&&!assigned;
     return <article className={`access-role ${role.id}`} key={role.id}>
      <span className="access-role-icon"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={role.icon}/></svg></span>
      <div className="access-role-copy"><span className="access-role-type">{role.type}</span><h3>{role.title}</h3><p>{role.description}</p></div>
      {auth?.authenticated||localEntry?<button className="button secondary" disabled={!auth||!!busy||accountBlocked||!!unavailable} onClick={()=>choosePortal(role.id)} aria-label={`${role.title} portal`}>{busy===role.id?'Opening…':assigned||localEntry?'Open portal':'Not assigned'}<Arrow/></button>:<Link className="button secondary" href={signInPath(role.id,register,{token:invitationDetails(invitation).token,next:returnTo})}>{register?'Create account':'Sign in'}<Arrow/></Link>}
      {role.id==='senior'&&!register&&<Link className="landing-inline-link" href="/demo/senior">Try the fictional senior preview <Arrow/></Link>}
     </article>;
    })}</div>
    <div className="landing-access-help"><p>{signupAllowed?'New here? Create a senior or family account from its sign-in screen.':'Your care team can help set up an account.'} Care-team accounts are set up by Operations.</p><button type="button" className="landing-inline-link" disabled={!!busy} onClick={showInvitation}>Accept an invitation <Arrow/></button></div>
   </section>}
   {['home','how-it-works'].includes(route.kind)&&<section className="landing-approach" id="care-approach" aria-labelledby="approach-title">
    <div className="landing-section-heading"><div><span className="landing-eyebrow">HOW IT WORKS</span><h2 id="approach-title">From a small update<br/>to a clear next step.</h2></div><p>A connected history helps the care team understand what changed and follow through.</p></div>
    <div className="landing-approach-grid">
     <article><span>01 / KEEP IN TOUCH</span><h3>Start with the everyday.</h3><p>Record a wellbeing update, health reading, medication log or conversation with the senior.</p></article>
     <article><span>02 / NOTICE CHANGES</span><h3>See the person’s pattern.</h3><p>Changes are compared with the senior’s own history. Care coordinators review the reasons behind each flag.</p></article>
     <article><span>03 / FOLLOW THROUGH</span><h3>Keep the next step clear.</h3><p>Assign a follow-up, record the outcome and share the appropriate update with the family.</p></article>
    </div>
   </section>}
   {['home','for-families'].includes(route.kind)&&<section className="landing-family" id="for-families" aria-labelledby="families-title">
    <div><span className="landing-eyebrow">FOR THE PEOPLE WHO CARE</span><h2 id="families-title">Stay close.<br/>Even from a distance.</h2><p>See the updates your loved one has agreed to share. Ask for support, follow care conversations and know what happens next.</p><Link className="button primary" href="/sign-in/family">Family sign-in <Arrow/></Link></div>
    <div className="landing-family-principles">
     <article><span>01</span><div><h3>A person behind every decision</h3><p>Wellbeing flags help coordinators decide what needs a closer look. People remain responsible for care.</p></div></article>
     <article><span>02</span><div><h3>A website when it helps</h3><p>A coordinator can record a phone conversation for a senior who prefers to speak rather than use a screen.</p></div></article>
     <article><span>03</span><div><h3>Sharing stays in the senior’s hands</h3><p>Family members see only the care records connected to their account and allowed by sharing consent.</p></div></article>
    </div>
   </section>}
   {['home','questions'].includes(route.kind)&&<section className="landing-faq" id="care-questions" aria-labelledby="questions-title">
    <div className="landing-section-heading"><div><span className="landing-eyebrow">A FEW HELPFUL ANSWERS</span><h2 id="questions-title">Before you sign in.</h2></div><p>Getting connected should feel simple.</p></div>
    <div className="landing-faq-list">
     <details><summary>Which portal should I choose?<Arrow/></summary><p>Choose the role assigned to your account. Seniors and family members have personal portals. Care coordinators and the Operations manager use their care-team accounts. Choosing a portal does not change your access.</p></details>
     <details><summary>How do I accept an invitation?<Arrow/></summary><p>Open the invitation link and sign in using the email it was sent to. If you are a new senior or family member, create your account and verify your email first. Then return to the link and select “Accept and open portal”.</p><button type="button" className="landing-inline-link" disabled={!!busy} onClick={showInvitation}>Open invitation setup <Arrow/></button></details>
     <details><summary>Does a senior need to use the website?<Arrow/></summary><p>No. A care coordinator can record updates from a phone conversation. The senior portal is an additional way to share an update or request support.</p></details>
     <details><summary>What does a wellbeing flag mean?<Arrow/></summary><p>It highlights a change for a care coordinator to review. It is not a diagnosis. The coordinator checks the supporting information and decides the next step.</p></details>
    </div>
   </section>}
  </main>
  <footer className="landing-footer"><Link href="/" className="landing-footer-brand"><CareMark size={24}/><span>SwasthSync</span></Link><p>Independent DEV_104 concept prototype.<br/>Showcase histories are synthetic. Care decisions remain with people.</p><Link href="/sign-in">Sign in <Arrow/></Link></footer>

 </div>;
}
