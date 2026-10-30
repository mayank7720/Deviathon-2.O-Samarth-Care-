"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import CareMark from "../../components/CareMark";
import "../../components/portal-care.css";
import "../../components/portal-care-modern.css";
import "./senior-demo.css";

type View = "checkin" | "followups" | "family" | "messages" | "updates";
type Checkin = { id: string; date: string; summary: string; note: string };
type Followup = { id: string; date: string; action: string; details: string; priority: string };
type Message = { id: string; date: string; text: string };
type DemoData = { checkins: Checkin[]; followups: Followup[]; messages: Message[]; familySharing: boolean };

const storageKey = "swasthsync-public-senior-demo-v1";
const questions = [
  { id: "wellbeing", label: "How are you feeling?", hi: "आज आप कैसा महसूस कर रहे हैं?", options: [["usual", "As usual", "हमेशा जैसा"], ["changed", "Something feels different", "कुछ अलग लग रहा है"], ["help", "I need support", "मदद चाहिए"]] },
  { id: "medicines", label: "Were medicines taken according to the agreed plan?", hi: "क्या तय योजना के अनुसार दवा ली?", options: [["taken", "Taken according to plan", "योजना के अनुसार ली"], ["missed", "A dose was missed", "एक खुराक छूट गई"], ["review", "Help with the medicine plan", "दवा की योजना में मदद चाहिए"]] },
  { id: "daily_routine", label: "How are eating and sleeping?", hi: "खाना और नींद कैसी है?", options: [["usual", "As usual", "हमेशा जैसे"], ["less_food", "Eating less", "कम खाया"], ["less_sleep", "Sleeping less", "नींद कम आई"]] },
  { id: "support", label: "When would you like the care team to contact you?", hi: "देखभाल टीम कब बात करे?", options: [["routine", "At the usual time", "तय समय पर"], ["today", "Today", "आज"], ["prompt", "As soon as possible", "जल्द से जल्द"]] },
] as const;
const emptyData: DemoData = { checkins: [], followups: [], messages: [], familySharing: true };
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const displayDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function SeniorPublicDemo() {
  const [view, setView] = useState<View>("checkin");
  const [data, setData] = useState<DemoData>(emptyData);
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [action, setAction] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState("routine");
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    let active=true;
    void Promise.resolve().then(()=>{try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored&&active) setData({ ...emptyData, ...JSON.parse(stored) });
    } catch { /* Storage may be disabled; the preview still works for this visit. */ }});
    return()=>{active=false;};
  }, []);

  function updateData(next: DemoData) {
    setData(next);
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* The preview still works for this visit. */ }
  }
  function saveCheckin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const summary = questions.map((question) => {
      const choice = question.options.find(([value]) => value === answers[question.id]);
      return `${question.label}: ${choice?.[1] || "not answered"}`;
    }).join(" · ");
    updateData({ ...data, checkins: [{ id: crypto.randomUUID(), date: today(), summary, note: note.trim() }, ...data.checkins] });
    setAnswers({}); setNote(""); setSaved("Your demo check-in was saved in this browser tab. It was not sent to a care team.");
  }
  function saveFollowup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateData({ ...data, followups: [{ id: crypto.randomUUID(), date: today(), action: action.trim(), details: details.trim(), priority }, ...data.followups] });
    setAction(""); setDetails(""); setPriority("routine"); setSaved("Your demo request was saved in this browser tab only.");
  }
  function saveMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateData({ ...data, messages: [{ id: crypto.randomUUID(), date: today(), text: message.trim() }, ...data.messages] });
    setMessage(""); setSaved("Your demo message was saved in this browser tab only. It was not sent.");
  }

  const nav: { id: View; label: string }[] = [
    { id: "checkin", label: "My wellbeing check-in" },
    { id: "followups", label: "My follow-ups" },
    { id: "family", label: "Family access" },
    { id: "messages", label: "Talk to my care team" },
    { id: "updates", label: "My care updates" },
  ];

  return <main className="senior-public-demo">
    <header className="senior-demo-header">
      <Link href="/" className="senior-demo-brand"><CareMark size={27}/><span>SwasthSync<small>SENIOR MEMBER PREVIEW</small></span></Link>
      <span className="senior-demo-badge"><span/>Public synthetic demo</span>
      <Link href="/sign-in" className="button secondary small">Sign in to your account</Link>
    </header>
    <div className="senior-demo-content">
      <section className="senior-demo-intro page-intro"><span className="eyebrow">A SIMPLE PLACE TO CHECK IN</span><h1>Hello, Senior Member</h1><p>Try the check-in and support options using fictional information.</p></section>
      <aside className="senior-demo-notice" role="note"><strong>Demo only:</strong> please do not enter personal health information. Anything you save stays in this browser tab and is not sent to a care team.</aside>
      <nav className="senior-demo-nav" aria-label="Senior demo sections">{nav.map(item=><button type="button" key={item.id} className={view===item.id?"active":""} onClick={()=>{setView(item.id);setSaved("");}}>{item.label}</button>)}</nav>
      {saved&&<p className="senior-demo-saved" role="status">{saved}</p>}

      {view==="checkin"&&<section className="portal-care">
        <form className="panel portal-checkin" onSubmit={saveCheckin}>
          <div className="portal-checkin-heading"><div><h2>How are you today?</h2><p>Answer a few simple questions. Your care team can use a real check-in only after you open your assigned account.</p></div><label>Language<select value={language} onChange={event=>setLanguage(event.target.value as "en" | "hi")}><option value="en">English</option><option value="hi">हिन्दी</option></select></label></div>
          {questions.map((question,index)=><fieldset key={question.id}><legend>{index+1}. {language==="hi"?question.hi:question.label}</legend><div>{question.options.map(([value,en,hi])=><label key={value} className={answers[question.id]===value?"selected":""}><input type="radio" name={question.id} value={value} required checked={answers[question.id]===value} onChange={()=>setAnswers(previous=>({...previous,[question.id]:value}))}/><span>{language==="hi"?hi:en}</span></label>)}</div></fieldset>)}
          <label className="portal-note">Anything else to share? (optional)<textarea rows={3} maxLength={500} value={note} onChange={event=>setNote(event.target.value)} placeholder="Use fictional example text only."/></label>
          <button className="button primary" disabled={Object.keys(answers).length<questions.length}>Save demo check-in</button>
          <p className="portal-help">This preview does not assess your health or contact a care worker. For urgent help, contact your usual care or emergency service.</p>
        </form>
        <section className="panel portal-history"><h2>Recent demo check-ins</h2>{data.checkins.length?data.checkins.map(entry=><article key={entry.id}><div><strong>{displayDate(entry.date)}</strong><span>Fictional demo entry</span></div><p>{entry.summary}</p>{entry.note&&<p>{entry.note}</p>}</article>):<p>No check-ins saved in this browser tab.</p>}</section>
      </section>}

      {view==="followups"&&<section className="portal-care"><form className="panel portal-form" onSubmit={saveFollowup}><h2>Request support</h2><label className="portal-full">What would you like help with?<input required minLength={3} maxLength={120} value={action} onChange={event=>setAction(event.target.value)} placeholder="Example: Please call me about my appointment"/></label><label className="portal-full">Details<textarea rows={3} maxLength={500} value={details} onChange={event=>setDetails(event.target.value)} placeholder="Fictional example only"/></label><label>When would you like a call?<select value={priority} onChange={event=>setPriority(event.target.value)}><option value="routine">At the usual time</option><option value="today">Today</option><option value="prompt">As soon as possible</option></select></label><div className="portal-full"><button className="button primary">Save demo request</button></div></form><section className="panel portal-history"><h2>My demo follow-ups</h2>{data.followups.length?data.followups.map(item=><article key={item.id}><div><strong>{item.action}</strong><span>{displayDate(item.date)} · {item.priority==="routine"?"Usual time":item.priority}</span></div>{item.details&&<p>{item.details}</p>}<span className="portal-pill">Preview only · not sent</span></article>):<p>No support requests saved in this browser tab.</p>}</section></section>}

      {view==="family"&&<section className="senior-demo-panel panel"><span className="eyebrow">SHARING BY PERMISSION</span><h2>Family access</h2><p>In your assigned account, you can choose whether care updates are shared with linked family members.</p><label className="senior-demo-toggle"><input type="checkbox" checked={data.familySharing} onChange={event=>updateData({...data,familySharing:event.target.checked})}/><span><strong>Allow family updates in this preview</strong><small>This switch changes only this browser demo. It does not change account or care-record consent.</small></span></label><p className="senior-demo-callout">For a real care record, family sharing consent is checked by the care service.</p></section>}

      {view==="messages"&&<section className="portal-care"><form className="panel portal-form senior-demo-message" onSubmit={saveMessage}><h2>Talk to my care team</h2><p className="portal-full">Try writing a sample message. It stays in this browser and is not delivered.</p><label className="portal-full">Your message<textarea required minLength={2} maxLength={500} rows={4} value={message} onChange={event=>setMessage(event.target.value)} placeholder="Fictional example only"/></label><div className="portal-full"><button className="button primary">Save demo message</button></div></form><section className="panel portal-history"><h2>Demo messages</h2>{data.messages.length?data.messages.map(item=><article key={item.id}><div><strong>{displayDate(item.date)}</strong><span>Only in this browser</span></div><p>{item.text}</p></article>):<p>No messages saved in this browser tab.</p>}</section></section>}

      {view==="updates"&&<section className="panel portal-history senior-demo-updates"><h2>My care updates</h2><p>These are activity items from this browser preview, not notifications from a care team.</p>{[...data.checkins.map(item=>({id:item.id,date:item.date,label:"Demo check-in saved"})),...data.followups.map(item=>({id:item.id,date:item.date,label:"Demo support request saved"})),...data.messages.map(item=>({id:item.id,date:item.date,label:"Demo message saved"}))].sort((a,b)=>b.date.localeCompare(a.date)).map(item=><article key={item.id}><div><strong>{item.label}</strong><span>{displayDate(item.date)} · Browser preview</span></div></article>)}{!data.checkins.length&&!data.followups.length&&!data.messages.length&&<p>No demo activity yet.</p>}</section>}
      <footer className="senior-demo-footer">Your assigned senior account and real care data remain protected by sign-in.</footer>
    </div>
  </main>;
}
