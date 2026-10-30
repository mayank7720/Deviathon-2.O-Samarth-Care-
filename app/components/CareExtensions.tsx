"use client";

import React, { useEffect, useRef, useState } from "react";
import { careApi } from "./AccessPortal";
import VoiceRoom from "./VoiceRoom";
import "./care-extensions.css";

type Props = {
  data: any;
  notify: (message: string) => void;
  onChanged?: () => void;
  initialSenior?: string;
};
function readable(value: any): string {
  if (value == null) return "Not available";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return `${Math.round(value * 10) / 10}`;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(readable).join(" · ");
  return Object.entries(value)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .map(([k, v]) => `${k.replace(/([A-Z])/g, " $1")}: ${readable(v)}`)
    .join(" · ");
}
function dateTime(value?: string) {
  return value
    ? new Date(value).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Today";
}
function Level({ level }: { level?: string }) {
  return (
    <span className={`extension-level ${level || "unknown"}`}>
      {level === "high"
        ? "Review promptly"
        : level === "medium"
          ? "Watch closely"
          : level === "low"
            ? "Within usual pattern"
            : "Check-in needed"}
    </span>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="page-intro">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}
function SeniorSelect({
  seniors,
  value,
  onChange,
}: {
  seniors: any[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="extension-senior-select">
      Senior
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {seniors.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.city}
          </option>
        ))}
      </select>
    </label>
  );
}
function Loading({ error, retry }: { error: string; retry: () => void }) {
  return error ? (
    <div className="extension-error" role="alert">
      {error}
      <button onClick={retry}>Try again</button>
    </div>
  ) : (
    <div className="panel extension-loading">
      Bringing the signals together…
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="extension-empty">
      <span aria-hidden="true">✓</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export {default as AnalysisView} from './RiskReview';

export function AlertsView({ data, notify, onChanged }: Props) {
  const [alerts, setAlerts] = useState<any[]>([]),
    [policy, setPolicy] = useState<any>({}),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [filter, setFilter] = useState("open"),
    [busy, setBusy] = useState(""),
    [review, setReview] = useState<any>(null),
    [outcome, setOutcome] = useState("");
  const staff = ["coordinator", "operations"].includes(data.session.role),
    canWrite = data.session.role === "coordinator" || data.session.role === 'operations' && data.session.isAdmin === true;
  async function load() {
    setError("");
    try {
      const result = await careApi("/alerts");
      setAlerts(result.alerts || []);
      setPolicy(result.policy || {});
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!review) return;
    const before = document.activeElement as HTMLElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>(".extension-dialog");
    dialog?.querySelector<HTMLElement>("textarea")?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") setReview(null);
      if (event.key !== "Tab") return;
      const fields = [
        ...(dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),textarea,input,select,a[href]",
        ) || []),
      ];
      const first = fields[0],
        last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [review]);
  async function update(alert: any, status: string) {
    setBusy(alert.id);
    try {
      await careApi(`/alerts/${encodeURIComponent(alert.id)}`, "PATCH", {
        status,
        ...(status === "snoozed" ? { snoozeHours: 4 } : {}),
        ...(status === "resolved" ? { outcome } : {}),
      });
      setReview(null);
      setOutcome("");
      await load();
      onChanged?.();
      notify(
        status === "resolved"
          ? "Review outcome recorded and alert resolved"
          : `Alert ${status}`,
      );
    } catch (err: any) {
      notify(err.message);
    } finally {
      setBusy("");
    }
  }
  async function savePolicy(e: React.FormEvent) {
    e.preventDefault();
    setBusy("policy");
    try {
      await careApi("/alerts/policy", "POST", {
        cooldownHours: Number(policy.cooldownHours),
        minimumScore: Number(policy.minimumScore),
      });
      await load();
      notify("Alert review policy saved");
    } catch (err: any) {
      notify(err.message);
    } finally {
      setBusy("");
    }
  }
  const filtered = alerts.filter(
    (a) =>
      filter === "all" ||
      a.status === filter ||
      (filter === "open" && !a.status),
  );
  return (
    <>
      <Heading
        eyebrow="THE RIGHT ATTENTION, AT THE RIGHT TIME"
        title={
          staff
            ? "A calmer, clearer alert inbox."
            : "Updates from your care team."
        }
        description={
          staff
            ? "Acknowledge, review, and close the loop. Urgent signals always remain visible for human review."
            : "Care-team flags for your linked record, with appropriate sharing permissions."
        }
      />
      <div className="extension-toolbar">
        <div className="extension-filter-tabs">
          {["open", "acknowledged", "snoozed", "resolved", "all"].map(
            (status) => (
              <button
                key={status}
                className={filter === status ? "active" : ""}
                onClick={() => setFilter(status)}
              >
                {status === "all"
                  ? "All alerts"
                  : status[0].toUpperCase() + status.slice(1)}
                <span>
                  {
                    alerts.filter(
                      (a) =>
                        status === "all" || (a.status || "open") === status,
                    ).length
                  }
                </span>
              </button>
            ),
          )}
        </div>
        <button className="button secondary" onClick={load}>
          Refresh
        </button>
      </div>
      {loading || error ? (
        <Loading error={error} retry={load} />
      ) : (
        <div className="alert-list">
          {filtered.length === 0 && (
            <section className="panel">
              <Empty
                title="Nothing waiting in this view"
                text="Use another status to review previous actions, or return later for new signals."
              />
            </section>
          )}
          {filtered.map((alert) => (
            <article
              className={`panel alert-card ${alert.level || "medium"}`}
              key={alert.id}
            >
              <div className="alert-card-heading">
                <div>
                  <span className="eyebrow">
                    {alert.name ||
                      data.seniors.find((s: any) => s.id === alert.seniorId)
                        ?.name ||
                      "Linked senior"}
                  </span>
                  <h2>{alert.title || "A wellbeing change needs review"}</h2>
                </div>
                {staff ? (
                  <Level level={alert.level} />
                ) : (
                  <span className="channel-label">Care-team update</span>
                )}
              </div>
              <div className="alert-meta">
                <span className={`alert-status ${alert.status || "open"}`}>
                  {alert.status || "open"}
                </span>
                <span>{dateTime(alert.createdAt)}</span>
                {alert.urgent && <strong>Urgent · cannot be snoozed</strong>}
              </div>
              {alert.reasons?.length > 0 && (
                <ul>
                  {alert.reasons.slice(0, 3).map((reason: any, i: number) => (
                    <li key={i}>
                      {reason.title || reason.detail || readable(reason)}
                    </li>
                  ))}
                </ul>
              )}
              <div className="alert-next-step">
                <strong>Recommended next step</strong>
                <p>
                  {alert.message ||
                    alert.action ||
                    "Arrange a coordinator review of the available signals."}
                </p>
              </div>
              {alert.outcome && (
                <div className="alert-outcome">
                  <strong>Review outcome</strong>
                  <p>{alert.outcome}</p>
                </div>
              )}
              {alert.snoozedUntil && alert.status === "snoozed" && (
                <p className="extension-muted">
                  Snoozed until {dateTime(alert.snoozedUntil)}
                </p>
              )}
              {canWrite && alert.status !== "resolved" && (
                <div className="alert-actions">
                  {alert.status !== "acknowledged" && (
                    <button
                      className="button secondary"
                      disabled={!!busy}
                      onClick={() => update(alert, "acknowledged")}
                    >
                      Acknowledge
                    </button>
                  )}
                  {!alert.urgent && alert.status !== "snoozed" && (
                    <button
                      className="button secondary"
                      disabled={!!busy}
                      onClick={() => update(alert, "snoozed")}
                    >
                      Snooze 4 hours
                    </button>
                  )}
                  <button
                    className="button primary"
                    disabled={!!busy}
                    onClick={() => {
                      setReview(alert);
                      setOutcome("");
                    }}
                  >
                    Record outcome & resolve
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {staff && data.session.isAdmin && (
        <section className="panel extension-panel alert-policy">
          <div className="extension-panel-heading">
            <h2>Reduce repeated low-priority alerts</h2>
            <p>
              High-priority and urgent alerts are never hidden by this policy.
            </p>
          </div>
          <form onSubmit={savePolicy}>
            <label>
              Repeat cooldown (hours)
              <input
                type="number"
                min="1"
                max="72"
                required
                value={policy.cooldownHours ?? 24}
                onChange={(e) =>
                  setPolicy({ ...policy, cooldownHours: e.target.value })
                }
              />
            </label>
            <label>
              Minimum review score
              <input
                type="number"
                min="30"
                max="60"
                required
                value={policy.minimumScore ?? 40}
                onChange={(e) =>
                  setPolicy({ ...policy, minimumScore: e.target.value })
                }
              />
            </label>
            <button className="button primary" disabled={!!busy}>
              Save review policy
            </button>
          </form>
        </section>
      )}
      {review && (
        <div className="extension-dialog-backdrop">
          <section
            className="extension-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Record alert outcome"
          >
            <h2>Close the loop with a real outcome.</h2>
            <p>
              {review.name}: {review.title}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                update(review, "resolved");
              }}
            >
              <label>
                Coordinator review note
                <textarea
                  required
                  minLength={5}
                  maxLength={1000}
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  rows={4}
                  placeholder="What did you review, and what happened next?"
                  autoFocus
                />
              </label>
              <div className="alert-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setReview(null)}
                >
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={!!busy || outcome.trim().length < 5}
                >
                  Save outcome & resolve
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

async function speakLocally(
  text: string,
  language: string,
  notify: (message: string) => void,
) {
  if (!("speechSynthesis" in window)) {
    notify("On-device speech is unavailable. Please read the text prompt.");
    return;
  }
  const voices = window.speechSynthesis
    .getVoices()
    .filter(
      (v) =>
        v.localService &&
        v.lang.toLowerCase().startsWith(language === "hi" ? "hi" : "en"),
    );
  if (!voices.length) {
    notify(
      "No on-device voice for this language is installed. The text prompt remains available.",
    );
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voices[0];
  utterance.lang = voices[0].lang;
  utterance.rate = 0.88;
  window.speechSynthesis.speak(utterance);
}

export function CommunicationsView({ data, notify, onChanged }: Props) {
  const [tab, setTab] = useState("inbox"),
    [messages, setMessages] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [seniorId, setSeniorId] = useState(
      data.seniors[0]?.id || data.session.seniorId || "",
    ),
    [recipient, setRecipient] = useState(""),
    [recipients, setRecipients] = useState<any[]>([]),
    [recipientError, setRecipientError] = useState(""),
    [language, setLanguage] = useState("en"),
    [channel, setChannel] = useState("in_app"),
    [template, setTemplate] = useState("checkin"),
    [message, setMessage] = useState(""),
    [ivr, setIvr] = useState<any>(null);
  const canSend =
      (data.session.role !== "operations" || data.session.isAdmin===true) &&
      !(data.session.role === "family" && data.seniors.length === 0),
    staff = ["coordinator", "operations"].includes(data.session.role);
  async function load() {
    setError("");
    try {
      const result = await careApi("/communications");
      setMessages(result.messages || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => {
      clearInterval(interval);
      window.speechSynthesis?.cancel();
    };
  }, []);
  useEffect(()=>{
    let current=true;
    setRecipientError('');setRecipients([]);setRecipient('');
    if(seniorId)careApi(`/communications/recipients?seniorId=${encodeURIComponent(seniorId)}`).then(result=>{if(!current)return;setRecipients(result.recipients||[]);setRecipient(result.recipients?.[0]?.userId||'');}).catch(err=>{if(current)setRecipientError(err.message);});
    return()=>{current=false;};
  },[seniorId]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await careApi("/communications", "POST", {
        seniorId,
        channel,
        recipientRole: recipients.find(item=>item.userId===recipient)?.role,
        recipientId: recipient,
        template,
        language,
        ...(message.trim() ? { message: message.trim() } : {}),
      });
      setMessage("");
      setTab("inbox");
      await load();
      notify(
        channel === "in_app"
          ? "Message saved to the care inbox"
          : "Simulation recorded. No external message or call was sent.",
      );
    } catch (err: any) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function markRead(id: string) {
    try {
      await careApi(`/communications/${encodeURIComponent(id)}`, "PATCH", {
        read: true,
      });
      await load();
    } catch (err: any) {
      notify(err.message);
    }
  }
  async function replyTo(item:any){
    try{const result=await careApi(`/communications/recipients?seniorId=${encodeURIComponent(item.seniorId)}`);const target=result.recipients.find((entry:any)=>entry.userId===item.senderId);if(!target){notify('This sender is no longer an available care contact.');return;}setSeniorId(item.seniorId);setRecipients(result.recipients);setRecipient(target.userId);setChannel('in_app');setTemplate('followup');setMessage('');setTab('compose');}catch(err:any){notify(err.message);}
  }
  async function beginIvr() {
    setBusy(true);
    try {
      setIvr(
        await careApi(
          `/ivr?seniorId=${encodeURIComponent(seniorId)}&language=${language}`,
        ),
      );
    } catch (err: any) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function answer(digit: string) {
    setBusy(true);
    try {
      const result = await careApi("/ivr", "POST", {
        seniorId,
        state: ivr.state,
        digit,
      });
      setIvr(result);
      if (result.recorded || result.complete) {
        onChanged?.();
        notify("Phone-flow answers saved for care-team review");
      }
    } catch (err: any) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="CARE CONVERSATIONS"
        title="Care conversations"
        description="Contact your assigned care team and linked household members."
      />
      <div className="extension-toolbar">
        <div className="extension-filter-tabs">
          {[
            { id: "inbox", label: "Care inbox" },
            { id: "compose", label: "Write a message" },
            { id: "voice", label: "Browser voice" },
          ]
            .filter(
              (t) =>
                (canSend || t.id === "inbox") &&
                (t.id !== "voice" || data.session.role !== 'operations'),
            )
            .map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? "active" : ""}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
        </div>
        <button className="button secondary" onClick={load}>
          Refresh inbox
        </button>
      </div>
      {tab === "inbox" && (
        <>
          {loading || error ? (
            <Loading error={error} retry={load} />
          ) : (
            <section className="message-list">
              {messages.length === 0 && (
                <section className="panel">
                  <Empty
                    title="No messages yet"
                    text="Choose Write a message to contact an assigned care team or household member."
                  />
                </section>
              )}
              {messages.map((m) => (
                <article
                  className={`panel message-card ${m.read || m.readAt ? "read" : ""}`}
                  key={m.id}
                >
                  <div className="message-heading">
                    <div>
                      <span className="eyebrow">
                        {m.senderName ||
                          m.senderRole ||
                          m.createdByRole ||
                          "Care team"}{" "}
                        → {m.recipientName || m.recipientRole || "Care member"}
                      </span>
                      <h3>
                        {m.seniorName ||
                          data.seniors.find((s: any) => s.id === m.seniorId)
                            ?.name ||
                          "Linked senior"}
                      </h3>
                    </div>
                    <span
                      className={`channel-label ${m.channel !== "in_app" ? "simulator" : ""}`}
                    >
                      {m.channel === "in_app"
                        ? "In-app message"
                        : m.channel === "sms_simulator"
                          ? "SMS simulation"
                          : "Phone simulation"}
                    </span>
                  </div>
                  <p
                    className="message-body"
                    lang={m.language === "hi" ? "hi" : "en"}
                  >
                    {m.body || m.message}
                  </p>
                  <div className="message-footer">
                    <span>
                      {dateTime(m.createdAt)}
                      {m.channel !== "in_app"
                        ? " · No external delivery"
                        : " · Saved in care inbox"}
                    </span>
                    <div>
                      <button
                        className="button secondary small"
                        onClick={() =>
                          speakLocally(
                            m.body || m.message,
                            m.language || "en",
                            notify,
                          )
                        }
                      >
                        Read aloud locally
                      </button>
                      {m.isRecipient && <button className="button secondary small" onClick={()=>replyTo(m)}>Reply</button>}
                      {!(m.read || m.readAt) &&
                        m.isRecipient && (
                          <button
                            className="button secondary small"
                            onClick={() => markRead(m.id)}
                          >
                            Mark read
                          </button>
                        )}
                    </div>
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      )}
      {tab === "compose" && canSend && (
        <section className="panel extension-panel compose-panel">
          <div className="extension-panel-heading">
            <h2>New message</h2>
            <p>
              Messages are saved to the selected person’s care inbox.
            </p>
          </div>
          <form onSubmit={send} className="extension-form-grid">
            <SeniorSelect
              seniors={data.seniors}
              value={seniorId}
              onChange={setSeniorId}
            />
            <label>
              To
              <select
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              >
                {!recipients.length&&<option value="">No assigned contacts</option>}
                {recipients.map(item=><option key={item.userId} value={item.userId}>{item.name} · {item.role==='coordinator'?'Care coordinator':item.role==='operations'?'Operations manager':item.role==='family'?'Family member':'Senior member'}</option>)}
              </select>
              {recipientError&&<span role="alert">{recipientError}</span>}
            </label>
            <label>
              Language
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="en">English</option>
                <option value="hi">हिन्दी</option>
              </select>
            </label>
            <label>
              Channel
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="in_app">In-app care inbox</option>
                {staff && (
                  <>
                    <option value="sms_simulator">
                      SMS simulation — no SMS sent
                    </option>
                    <option value="phone_simulator">
                      Phone simulation — no call placed
                    </option>
                  </>
                )}
              </select>
            </label>
            <label>
              Template
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              >
                <option value="checkin">Friendly wellbeing check-in</option>
                <option value="followup">Care follow-up</option>
                {staff && (
                  <>
                    <option value="serious_alert">
                      Important care-team update
                    </option>
                    <option value="weekly_summary">
                      Consented family summary
                    </option>
                  </>
                )}
              </select>
            </label>
            <label className="extension-full">
              {staff ? "Personal note (optional)" : "Your message"}
              <textarea
                required={!staff}
                maxLength={1600}
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Leave blank to use the local template, or write a kind, clear message…"
              />
            </label>
            <div className="extension-full compose-footer">
              <span>
                {channel === "in_app"
                  ? "Saved to the recipient’s in-app inbox. No email or push notification is sent."
                  : "A provider-free simulation. No SMS or telephone call will be delivered."}
              </span>
              <button className="button primary" disabled={busy || !seniorId || !recipient}>
                {busy
                  ? "Saving…"
                  : channel === "in_app"
                    ? "Send to care inbox"
                    : "Record simulation"}
              </button>
            </div>
          </form>
        </section>
      )}
      {tab === "phone" && (
        <section className="panel extension-panel ivr-panel">
          <div className="extension-panel-heading">
            <span className="eyebrow">BASIC-PHONE FLOW, IN YOUR BROWSER</span>
            <h2>
              {language === "hi"
                ? "एक छोटी बातचीत। बेहतर देखभाल।"
                : "Four small questions. A clearer picture."}
            </h2>
            <p>
              This simulator demonstrates a 1–2–3 keypad check-in. It does not
              call a telephone number.
            </p>
          </div>
          <div className="ivr-setup">
            <SeniorSelect
              seniors={data.seniors}
              value={seniorId}
              onChange={(id) => {
                setSeniorId(id);
                setIvr(null);
              }}
            />
            <label>
              Language
              <select
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  setIvr(null);
                }}
              >
                <option value="en">English</option>
                <option value="hi">हिन्दी</option>
              </select>
            </label>
          </div>
          {!ivr ? (
            <button
              className="button primary"
              disabled={busy || !seniorId}
              onClick={beginIvr}
            >
              Start phone-flow simulation
            </button>
          ) : ivr.complete || ivr.prompt?.complete ? (
            <div className="ivr-complete">
              <span>✓</span>
              <h3>
                {language === "hi"
                  ? "धन्यवाद। आपकी बात पहुँच गई।"
                  : "Thank you. Your care team has your update."}
              </h3>
              <p>
                {ivr.recorded || ivr.complete
                  ? "Answers recorded in the senior’s care history."
                  : "The simulated conversation is complete."}
              </p>
              <button className="button secondary" onClick={() => setIvr(null)}>
                Start again
              </button>
            </div>
          ) : (
            <div className="ivr-question">
              <span className="eyebrow">
                QUESTION {Number(ivr.state?.step || 0) + 1} OF 4
              </span>
              <h3 lang={language === "hi" ? "hi" : "en"}>
                {ivr.prompt?.prompt || ivr.prompt?.text}
              </h3>
              <button
                className="button secondary"
                onClick={() =>
                  speakLocally(
                    ivr.prompt?.prompt || ivr.prompt?.text,
                    language,
                    notify,
                  )
                }
              >
                Read prompt on this device
              </button>
              <div className="ivr-options">
                {(ivr.prompt?.options || []).map((option: any) => (
                  <button
                    key={option.digit}
                    disabled={busy}
                    onClick={() => answer(String(option.digit))}
                  >
                    <span>{option.digit}</span>
                    <strong>{option.label}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="extension-note">
            On-device speech uses installed local voices only. If a language
            voice is unavailable, the text prompt remains fully usable.
          </div>
        </section>
      )}
      {tab === "voice" && (
        <section className="panel extension-panel">
          <div className="extension-panel-heading">
            <h2>Be there, with a familiar voice.</h2>
            <p>
              A free peer-to-peer browser voice room. Microphone access starts
              only when you choose to join.
            </p>
          </div>
          <SeniorSelect
            seniors={data.seniors}
            value={seniorId}
            onChange={setSeniorId}
          />
          <VoiceRoom
            seniorId={seniorId}
            api={careApi}
            session={data.session}
            notify={notify}
          />
          <div className="extension-note">
            This showcase uses direct browser connections on compatible
            networks. It has no paid relay, telephone gateway, or background
            recording. Some network combinations cannot connect.
          </div>
        </section>
      )}
    </>
  );
}

export function AccessManagement({ data, notify }: Props) {
  const isAdmin = data.session?.role === "operations" && data.session?.isAdmin === true;
  const [access, setAccess] = useState<any>({ members: [], invites: [] }),
    [error, setError] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("family"),
    [seniorId, setSeniorId] = useState(data.seniors[0]?.id || "S001"),
    [busy, setBusy] = useState(false),
    [link, setLink] = useState("");
  async function load() {
    setError("");
    try {
      setAccess(await careApi("/access"));
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await careApi("/access/invites", "POST", {
        email: email.trim(),
        role,
        ...(["family", "senior"].includes(role) ? { seniorId } : {}),
      });
      setLink(result.inviteUrl);
      setEmail("");
      await load();
      notify("Invitation created. Share its link with the intended person.");
    } catch (err: any) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(member: any) {
    setBusy(true);
    try {
      await careApi(
        `/access/members/${encodeURIComponent(member.id)}`,
        "PATCH",
        { status: "revoked" },
      );
      await load();
      notify("Membership revoked");
    } catch (err: any) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (!isAdmin) {
    return <section className="panel extension-panel"><h2>Administrator access required</h2></section>;
  }
  return (
    <>
      <Heading
        eyebrow="ADMINISTRATION"
        title="Accounts & access"
        description="Manage user roles and linked seniors."
      />
      {error && <Loading error={error} retry={load} />}
      <div className="access-admin-columns">
        <section className="panel extension-panel">
          <div className="extension-panel-heading">
            <h2>Invite a member</h2>
            <p>Use the member’s account email.</p>
          </div>
          <form onSubmit={invite} className="access-invite-form">
            <label>
              Recipient email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="family@example.com"
                autoComplete="email"
              />
            </label>
            <label>
              Assigned role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="family">Family member</option>
                <option value="senior">Senior member</option>
                <option value="coordinator">Care coordinator</option>
                <option value="operations">Operations staff</option>
              </select>
            </label>
            {["family", "senior"].includes(role) && (
              <SeniorSelect
                seniors={data.seniors}
                value={seniorId}
                onChange={setSeniorId}
              />
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "Creating…" : "Create invitation link"}
            </button>
          </form>
          {link && (
            <div className="invitation-result">
              <strong>Invitation ready</strong>
              <p>
                This link is tied to the invited email. No email was sent
                automatically.
              </p>
              <input
                aria-label="Invitation link"
                value={link}
                readOnly
                onFocus={(e) => e.target.select()}
              />
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    notify("Invitation link copied");
                  } catch {
                    notify("Select and copy the invitation link above.");
                  }
                }}
              >
                Copy invitation link
              </button>
            </div>
          )}
        </section>
        <section className="panel extension-panel">
          <div className="extension-panel-heading">
            <h2>Members</h2>
          </div>
          <div className="membership-list">
            {(access.members || []).map((member: any) => (
              <article key={member.id}>
                <div>
                  <strong>
                    {member.name ||
                      member.email ||
                      member.identityEmail ||
                      "Care member"}
                  </strong>
                  <p>
                    {member.role}{" "}
                    {member.seniorId
                      ? `· ${member.seniorId}`
                      : "· Care workspace"}
                  </p>
                  <span>
                    {member.status || "active"}
                    {member.isAdmin ? " · Operations administrator" : ""}
                  </span>
                </div>
                {member.status !== "revoked" &&
                  member.userId !== data.session.userId &&
                  !member.isAdmin && (
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => revoke(member)}
                    >
                      Revoke access
                    </button>
                  )}
              </article>
            ))}
          </div>
        </section>
      </div>
      <section className="panel extension-panel invitation-history">
        <div className="extension-panel-heading">
          <h2>Invitation history</h2>
          <p>Pending invitations expire after seven days.</p>
        </div>
        {(access.invites || []).length ? (
          <div className="membership-list">
            {access.invites.map((invite: any) => (
              <article key={invite.id}>
                <div>
                  <strong>{invite.email}</strong>
                  <p>
                    {invite.role}
                    {invite.seniorId ? ` · ${invite.seniorId}` : ""}
                  </p>
                  <span>
                    {invite.status || "Pending"} · Expires{" "}
                    {dateTime(invite.expiresAt)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="No invitations yet"
            text="Invite a member to grant access."
          />
        )}
      </section>
    </>
  );
}
