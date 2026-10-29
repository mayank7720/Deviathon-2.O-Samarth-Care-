"use client";

import React, { useEffect, useState } from "react";
import { careApi } from "./AccessPortal";

type Runtime = { mode: string; date: string; timezone?: string; cohortStart?: string; cohortEnd?: string; schedulerConfigured?: boolean; lastJob?: {date?: string}; jobStatus?: {status?: string; completedAt?: string; lastRunAt?: string; date?: string; schedulerConfigured?: boolean} | null };
type Delivery = {id:string;seniorId:string;recipientRole:string;kind:string;channel:string;status:string;createdAt:string;deliveredAt?:string;readAt?:string;attempts:number;lastError?:string;body?:string;message?:string};
type PushConfig = {enabled:boolean;publicKey?:string;serviceWorkerPath?:string};
type Props = {
  data: {runtime?:Runtime;date?:string;session:{role:string;isAdmin?:boolean};seniors?:{id:string;name:string}[]};
  notify: (message: string) => void;
  onChanged?: () => void;
};
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'Unable to complete this action.';
const displayTime = (value?: string | number) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not recorded";
function decodeKey(key: string) {
  const padding = "=".repeat((4 - (key.length % 4)) % 4);
  return Uint8Array.from(
    atob((key + padding).replace(/-/g, "+").replace(/_/g, "/")),
    (character) => character.charCodeAt(0),
  );
}

export function RuntimeControls({ data, notify, onChanged }: Props) {
  const [runtime, setRuntime] = useState<Runtime | null>(data.runtime || null);
  const [mode, setMode] = useState(data.runtime?.mode || "replay");
  const [date, setDate] = useState(
    data.runtime?.date || data.date || "2026-10-27",
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function refresh() {
    try {
      const result = await careApi("/runtime");
      const next = result.runtime || result;
      setRuntime(next);
      setMode(next.mode);
      setDate(next.date);
      setError("");
    } catch (err: unknown) {
      setError(errorMessage(err));
    }
  }
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy("clock");
    try {
      await careApi("/runtime", "POST", {
        mode,
        ...(mode === "replay" ? { date } : {}),
      });
      await refresh();
      await onChanged?.();
      notify(
        "Workspace clock updated. Scores and data freshness use the selected day.",
      );
    } catch (err: unknown) {
      notify(errorMessage(err));
    } finally {
      setBusy("");
    }
  }
  async function runDaily() {
    setBusy("job");
    try {
      const result = await careApi("/jobs/daily", "POST", {});
      await refresh();
      await onChanged?.();
      notify(
        result.job?.status === "already_completed"
          ? "The daily job has already completed for this day."
          : "Daily processing completed. Check the delivery log for actual outcomes.",
      );
    } catch (err: unknown) {
      notify(errorMessage(err));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel extension-panel runtime-controls">
      <div className="extension-panel-heading">
        <span className="eyebrow">A CLOCK YOU CAN INSPECT</span>
        <h2>Daily care processing</h2>
        <p>
          Replay the synthetic history or use the current date in India. A live
          clock does not invent fresh observations.
        </p>
      </div>
      {error && (
        <p className="extension-error" role="alert">
          {error}
        </p>
      )}
      <div className="runtime-current">
        <strong>
          {runtime?.mode === "live" ? "Live clock" : "Demo replay"}
        </strong>
        <span>
          {runtime?.date || data.date} · {runtime?.timezone || "Asia/Kolkata"}
        </span>
      </div>
      {data.session?.isAdmin && (
        <>
          <form className="runtime-form" onSubmit={save}>
            <label>
              Clock mode
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value)}
              >
                <option value="replay">Demo replay</option>
                <option value="live">Live clock</option>
              </select>
            </label>
            {mode === "replay" && (
              <label>
                Replay day
                <input
                  type="date"
                  required
                  min={runtime?.cohortStart || "2026-07-30"}
                  max={runtime?.cohortEnd || "2026-10-27"}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
            )}
            <button className="button secondary" disabled={!!busy}>
              {busy === "clock" ? "Updating…" : "Apply clock"}
            </button>
          </form>
          <div className="runtime-actions">
            <button
              className="button primary"
              disabled={!!busy}
              onClick={runDaily}
            >
              {busy === "job" ? "Processing…" : "Run daily processing now"}
            </button>
            <span>
              Repeating a completed daily run should not duplicate alerts or
              deliveries.
            </span>
          </div>
        </>
      )}
      <dl className="runtime-status">
        <div>
          <dt>Latest daily run</dt>
          <dd>
            {runtime?.jobStatus?.completedAt || runtime?.jobStatus?.lastRunAt
              ? displayTime(runtime.jobStatus.completedAt || runtime.jobStatus.lastRunAt)
              : runtime?.jobStatus?.date ||
                runtime?.lastJob?.date ||
                "No completed run recorded"}
          </dd>
        </div>
        <div>
          <dt>Background scheduling</dt>
          <dd>
            {runtime?.schedulerConfigured ||
            runtime?.jobStatus?.schedulerConfigured
              ? "Configured; inspect recorded run outcomes"
              : "No background schedule confirmed. Use the manual daily run for this showcase."}
          </dd>
        </div>
      </dl>
      <div className="extension-note">
        The first 30 days are a baseline warm-up period. Insufficient or overdue
        observations require a check-in; they do not indicate good health.
      </div>
    </section>
  );
}

export default function DeliveryCenter({ data, notify, onChanged }: Props) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [pushConfig, setPushConfig] = useState<PushConfig | null>(null);
  const [permission, setPermission] = useState("default");
  const [subscribed, setSubscribed] = useState(false);
  const [filter, setFilter] = useState("all");
  const staff = ["coordinator", "operations"].includes(data.session?.role);
  const canProcess =
    data.session?.role === "coordinator" || data.session?.isAdmin;
  async function load() {
    try {
      const result = await careApi("/deliveries");
      setDeliveries(result.deliveries || []);
      setError("");
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void Promise.resolve().then(load);
    careApi("/push/config")
      .then(setPushConfig)
      .catch(() => setPushConfig({ enabled: false }));
    void Promise.resolve("Notification" in window ? Notification.permission : "unsupported").then(setPermission);
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .getRegistration("/")
        .then((registration) => registration?.pushManager?.getSubscription())
        .then((subscription) => setSubscribed(!!subscription))
        .catch(() => {});
  }, []);
  async function subscribe() {
    setBusy("push");
    try {
      if (!pushConfig?.enabled || !pushConfig.publicKey)
        throw new Error(
          "Browser push is not configured on this server. Your care inbox remains available.",
        );
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window) ||
        !window.isSecureContext
      )
        throw new Error(
          "This browser needs push support and HTTPS or localhost.",
        );
      const decision = await Notification.requestPermission();
      setPermission(decision);
      if (decision !== "granted")
        throw new Error(
          "Notifications were not enabled. You can continue using the care inbox.",
        );
      const registration = await navigator.serviceWorker.register(
        pushConfig.serviceWorkerPath || "/sw.js",
      );
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(pushConfig.publicKey),
        }));
      await careApi("/push/subscriptions", "POST", {
        subscription: subscription.toJSON(),
      });
      setSubscribed(true);
      notify(
        "This browser is subscribed. Delivery logs will show attempted and completed notifications.",
      );
    } catch (err: unknown) {
      notify(errorMessage(err));
    } finally {
      setBusy("");
    }
  }
  async function unsubscribe() {
    setBusy("push-off");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await careApi("/push/subscriptions", "DELETE", {
          endpoint: subscription.endpoint,
        });
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      notify(
        "Browser notifications are disabled for this device. Your protected inbox is still available.",
      );
    } catch (err: unknown) {
      notify(errorMessage(err));
    } finally {
      setBusy("");
    }
  }
  async function process() {
    setBusy("process");
    try {
      await careApi("/deliveries/process", "POST", {});
      await load();
      await onChanged?.();
      notify("Delivery attempts processed. Review their status below.");
    } catch (err: unknown) {
      notify(errorMessage(err));
    } finally {
      setBusy("");
    }
  }
  async function markRead(id: string) {
    try {
      await careApi(`/deliveries/${encodeURIComponent(id)}`, "PATCH", {
        read: true,
      });
      await load();
    } catch (err: unknown) {
      notify(errorMessage(err));
    }
  }
  async function approve(id: string) {
    setBusy(id);
    try {
      await careApi(`/deliveries/${encodeURIComponent(id)}`, "PATCH", { approve: true });
      await load();
      notify("Summary approved and queued. Process deliveries to send it.");
    } catch (err: unknown) {
      notify(errorMessage(err));
    } finally { setBusy(""); }
  }
  const visible = deliveries.filter(
    (delivery) => filter === "all" || delivery.status === filter,
  );
  return (
    <>
      <section className="page-intro">
        <div>
          <span className="eyebrow">CARE THAT REACHES THE RIGHT PERSON</span>
          <h1>Notification & delivery center</h1>
          <p>
            See what was queued, attempted, delivered, or read. Family sharing
            is checked again before delivery.
          </p>
        </div>
        {canProcess && (
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={process}
          >
            {busy === "process" ? "Processing…" : "Process queued deliveries"}
          </button>
        )}
      </section>
      <section className="push-enrollment panel extension-panel">
        <div>
          <h2>Updates on this device</h2>
          <p>
            Browser push can alert you while the care page is closed.
            Notifications contain a generic prompt to open the protected care
            inbox.
          </p>
          <span>
            {pushConfig?.enabled
              ? `Browser permission: ${permission}`
              : "Push delivery is not configured. In-app delivery is available."}
          </span>
        </div>
        <div className="push-actions">
          {subscribed && <span>Subscribed on this device</span>}
          <button
            className="button primary"
            disabled={
              !!busy || !pushConfig?.enabled || permission === "unsupported"
            }
            onClick={subscribe}
          >
            {busy === "push"
              ? "Enabling…"
              : permission === "granted"
                ? "Register this browser"
                : "Enable browser notifications"}
          </button>
          {subscribed && (
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={unsubscribe}
            >
              {busy === "push-off" ? "Disabling…" : "Disable on this device"}
            </button>
          )}
        </div>
      </section>
      <div className="extension-toolbar">
        <label>
          Delivery status
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All outcomes</option>
            {["pending_review", "queued", "delivered", "failed", "read", "blocked_consent"].map(
              (status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ),
            )}
          </select>
        </label>
        <button className="button secondary" onClick={load}>
          Refresh delivery log
        </button>
      </div>
      {error && (
        <div className="extension-error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="panel extension-loading">Loading delivery records…</div>
      ) : (
        <section className="delivery-list">
          {!visible.length && (
            <div className="panel extension-empty">
              <h2>No delivery records match</h2>
              <p>
                Daily processing creates due summaries and serious care updates.
                A queued record is not proof of delivery.
              </p>
            </div>
          )}
          {visible.map((delivery) => (
            <article className="panel delivery-card" key={delivery.id}>
              <div className="delivery-heading">
                <div>
                  <span className="eyebrow">
                    {delivery.channel === "web_push"
                      ? "BROWSER PUSH"
                      : "CARE INBOX"}{" "}
                    · {delivery.recipientRole || "Assigned recipient"}
                  </span>
                  <h2>
                    {delivery.kind === "weekly_summary"
                      ? "Weekly wellbeing summary"
                      : "Care-team follow-up update"}
                  </h2>
                </div>
                <span className={`delivery-status ${delivery.status}`}>
                  {String(delivery.status || "queued").replaceAll("_", " ")}
                </span>
              </div>
              <p>
                {delivery.body ||
                  delivery.message ||
                  "Open the protected care inbox to review the consented update."}
              </p>
              {staff && (
                <p className="extension-muted">
                  {data.seniors?.find(
                    (senior) => senior.id === delivery.seniorId,
                  )?.name || delivery.seniorId}
                </p>
              )}
              <dl className="delivery-times">
                <div>
                  <dt>Created</dt>
                  <dd>{displayTime(delivery.createdAt)}</dd>
                </div>
                <div>
                  <dt>Delivered</dt>
                  <dd>{displayTime(delivery.deliveredAt)}</dd>
                </div>
                <div>
                  <dt>Attempts</dt>
                  <dd>{delivery.attempts ?? 0}</dd>
                </div>
              </dl>
              {delivery.lastError && staff && (
                <p className="delivery-error">{delivery.lastError}</p>
              )}
              {canProcess && delivery.status === "pending_review" && (
                <button className="button primary" disabled={!!busy} onClick={() => approve(delivery.id)}>
                  Review complete — approve summary
                </button>
              )}
              {delivery.status === "blocked_consent" && (
                <p className="extension-note">
                  Family sharing is unavailable. No family delivery should be
                  attempted until current consent permits it.
                </p>
              )}
              {["delivered", "read"].includes(delivery.status) &&
                delivery.recipientRole === data.session.role &&
                delivery.status !== "read" && (
                  <button
                    className="button secondary"
                    onClick={() => markRead(delivery.id)}
                  >
                    Mark update read
                  </button>
                )}
            </article>
          ))}
        </section>
      )}
      {staff && (
        <RuntimeControls data={data} notify={notify} onChanged={onChanged} />
      )}
      <div className="extension-note">
        Browser delivery is best-effort and requires an enrolled supported
        device. This service does not send telephone calls or SMS, and
        notification delivery is not a clinical response.
      </div>
    </>
  );
}
