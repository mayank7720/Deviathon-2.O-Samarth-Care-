"use client";
import AccountConsole from './components/AccountConsole';
import AccountSettings from './components/AccountSettings';
import CareMark from './components/CareMark';
import PhoneSupport, {PhoneSupportNotice,CarePhoneContact} from './components/PhoneSupport';

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from './components/WorkspaceLink';
import {usePathname,useRouter} from 'next/navigation';
import {siteRoute,workspacePath,defaultWorkspace,canOpenWorkspace} from '../lib/site-links.mjs';
import AccessPortal, { type AccessState } from "./components/AccessPortal";
import DeliveryCenter, { RuntimeControls } from "./components/DeliveryCenter";
import GroundedReports from './components/GroundedReports';
import SharedSummaryHistory from './components/SharedSummaryHistory';
import CareReviewNav from './components/CareReviewNav';
import {workspaceNavigation} from '../lib/workspace-navigation.mjs';
import dynamic from 'next/dynamic';
const CareMonitoring=dynamic(()=>import('./components/CareMonitoring'),{ssr:false});
import MotionCheckin from './components/MotionCheckin';
import TelephonyCenter from './components/TelephonyCenter';
import CareOperations from './components/CareOperations';
import SpeechNotes from './components/SpeechNotes';
import HistoryTimeline from './components/HistoryTimeline';
import OutcomesInsights from './components/OutcomesInsights';
import HouseholdAccess from './components/HouseholdAccess';
import PortalCare from './components/PortalCare';
import CloudOperations from './components/CloudOperations';
import {
  AnalysisView,
  AlertsView,
  CommunicationsView,
} from "./components/CareExtensions";

type View =
  | "dashboard"
  | "seniors"
  | "checkin"
  | "insights"
  | "family"
  | "analysis"
  | "monitoring"
  | "medications"
  | "family-reports"
  | "alerts"
  | "communications"
  | "access"
  | "deliveries"
  | "reports"
  | "telephony"
  | "care-operations"
  | "speech"
  | "followups"
  | "household"
  | "system"
  | "account"
  | "phone-support";
type Role = "coordinator" | "operations" | "family" | "senior";
type Senior = any;
type Snapshot = {
  session: {
    role: Role;
    name: string;
    seniorId?: string;
    isAdmin?: boolean;
    availableRoles?: Role[];
    userId?: string;
  };
  date: string;
  stats: any;
  seniors: Senior[];
  tasks: any[];
  metrics: any;
  audit: any[];
  operations?: any;
  runtime?: any;
};

const icons: Record<string, React.ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  people: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      <circle cx="9" cy="7" r="4" />
    </>
  ),
  heart: (
    <>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
      <path d="m4 12 4-1 2 4 3-7 2 4h5" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18M7 14l4-5 4 3 6-7" />
    </>
  ),
  phone: (
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L9 10.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 1.1Z" />
  ),
  arrow: (
    <>
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </>
  ),
  down: <path d="m6 9 6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="7.3" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-11 12a2 2 0 0 0 4 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
      <path d="m8 12 3 3 5-5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.01" />
    </>
  ),
  alert: (
    <>
      <path d="m10.3 3.8-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.2l-8-14a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4m0 4v.01" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 3C8 3 3 8 5 15c2 7 15 5 15-12Z" />
      <path d="M3 22 15 9" />
    </>
  ),
  note: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8m-8 4h6" />
    </>
  ),
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 3 4 3 4-3 4-3M8 9h.01M16 9h.01" />
    </>
  ),
};
function Icon({
  name,
  size = 20,
  ...props
}: {
  name: string;
  size?: number;
  [key: string]: any;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {icons[name] || icons.heart}
    </svg>
  );
}
function initials(name = "Senior") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("");
}
function Avatar({
  senior,
  large = false,
}: {
  senior: Senior;
  large?: boolean;
}) {
  const colors = ["mint", "sand", "rose", "blue"];
  const index =
    [...(senior?.id || "S")].reduce((a, c) => a + c.charCodeAt(0), 0) % 4;
  return (
    <span className={`avatar ${colors[index]} ${large ? "large" : ""}`}>
      {initials(senior?.name)}
    </span>
  );
}
function Badge({ level }: { level?: string }) {
  return (
    <span className={`risk-badge ${level || "unknown"}`}>
      <span />
      {level === "high"
        ? "High priority"
        : level === "medium"
          ? "Watch closely"
          : level === "low"
            ? "Within usual pattern"
            : "Check-in needed"}
    </span>
  );
}
function CareStatus({ state }: { state?: any }) {
  const status = state?.status || "unreviewed";
  return (
    <span className={`care-status ${status}`}>
      {status === "resolved"
        ? "Outcome recorded"
        : status === "in_progress"
          ? "Follow-up in progress"
          : status === "acknowledged"
            ? "Acknowledged"
      : "No review recorded"}
    </span>
  );
}
function pct(value: any) {
  const n = value == null ? NaN : Number(value);
  return Number.isFinite(n) ? `${Math.round(n <= 1 ? n * 100 : n)}%` : "—";
}
function shortDate(date?: string) {
  return date
    ? new Date(date.slice(0, 10) + "T12:00:00").toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      })
    : "Not recorded";
}
function Sparkline({
  values,
  level = "low",
  large = false,
}: {
  values: any[];
  level?: string;
  large?: boolean;
}) {
  const list = (values || []).map((value) =>
    typeof value === "number" ? value : value?.score,
  );
  if (
    list.filter((value) => typeof value === "number" && Number.isFinite(value))
      .length < 2
  )
    return (
      <div className="trend-empty">
        Not enough recorded history to show a trend.
      </div>
    );
  const height = large ? 150 : 36;
  const width = large ? 600 : 104;
  let connected = false;
  const points = list
    .map((value, index) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        connected = false;
        return "";
      }
      const point = `${(index * width) / Math.max(1, list.length - 1)},${height - 5 - (Math.max(0, Math.min(100, value)) / 100) * (height - 10)}`;
      const command = connected ? "L" : "M";
      connected = true;
      return `${command}${point}`;
    })
    .join(" ");
  return (
    <svg
      className={`sparkline ${level} ${large ? "trend-chart" : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Risk score trend over time; gaps indicate unavailable scores"
    >
      {large &&
        [25, 50, 75].map((v) => (
          <line
            key={v}
            x1="0"
            x2={width}
            y1={height - (v / 100) * height}
            y2={height - (v / 100) * height}
            stroke="#e9eeeb"
            strokeDasharray="4 5"
          />
        ))}
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={large ? 2.5 : 1.7}
        strokeLinejoin="round"
        d={points}
      />
    </svg>
  );
}
async function api(path: string, method = "GET", body?: any): Promise<any> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload: any = await response.json();
  if (!response.ok)
    throw new Error(
      payload.error || payload.message || `Request failed (${response.status})`,
    );
  return payload;
}

function Overlay({
  children,
  onClose,
  className = "",
  label,
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const elements = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex="0"]',
          ) || []),
        ];
        const first = elements[0],
          last = elements[elements.length - 1];
        if (!first) return;
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.removeEventListener("keydown", key);
      old?.focus();
    };
  }, [onClose]);
  return (
    <div
      className={`overlay ${className}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={className === "drawer-overlay" ? "detail-drawer" : "modal"}
        ref={ref}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <AccessPortal>
      {(auth, exit) => <CareWorkspace auth={auth} onExit={exit} />}
    </AccessPortal>
  );
}

function CareWorkspace({
  auth,
  onExit,
}: {
  auth: AccessState;
  onExit: () => Promise<void>;
}) {
  const router=useRouter(),pathname=usePathname(),requestedView=siteRoute(pathname||'/').view;
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [riskFilter, setRiskFilter] = useState("all"),
    [cityFilter, setCityFilter] = useState("all"),
    [selected, setSelected] = useState<Senior | null>(null),
    [detail, setDetail] = useState<any>(null),
    [signalOpen, setSignalOpen] = useState(false),
    [signalSenior, setSignalSenior] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false),
    [taskOpen, setTaskOpen] = useState(false),
    [analysisSenior, setAnalysisSenior] = useState(""),
    [careOperationsSenior, setCareOperationsSenior] = useState(""),
    [taskReview, setTaskReview] = useState<any>(null),
    [taskOutcome, setTaskOutcome] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailRequest = useRef(0);
  const navigationRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobileOpen) return;
    const phone = window.matchMedia('(max-width: 600px)');
    if (!phone.matches) return;
    const overflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = 'hidden';
    navigationRef.current?.querySelector<HTMLElement>('button')?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(navigationRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])') || []);
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    function resize(event: MediaQueryListEvent) {
      if (!event.matches) setMobileOpen(false);
    }
    document.addEventListener('keydown', keyboard);
    phone.addEventListener('change', resize);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keyboard);
      phone.removeEventListener('change', resize);
      if (phone.matches && menuButton?.isConnected) menuButton.focus();
    };
  }, [mobileOpen]);
  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }
  async function load() {
    try {
      const result = await api("/bootstrap");
      setData({
        ...result,
        seniors: result.seniors || [],
        tasks: result.tasks || [],
        audit: result.audit || [],
        stats: result.stats || {},
        metrics: result.metrics || {},
      });
      setError("");
      return result;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }
  useEffect(() => {
    void load();
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  const role:Role = data?.session?.role || (auth.session?.role as Role) || 'coordinator',
    staff = role === "coordinator" || role === "operations",
    canWrite = role === "coordinator" || role === 'operations' && data?.session?.isAdmin === true;
  const view=(canOpenWorkspace(requestedView,role,data?.session?.isAdmin===true)?requestedView:defaultWorkspace(role)) as View;
  useEffect(()=>{if(data&&requestedView!==view)router.replace(workspacePath(view));},[data,requestedView,view,router]);
  const seniors = data?.seniors || [],
    tasks = data?.tasks || [],
    stats = data?.stats || {},
    metrics = data?.metrics || {};
  const filtered = useMemo(
    () =>
      seniors.filter(
        (s) =>
          (!search ||
            `${s.name} ${s.city} ${s.id}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (riskFilter === "all" || s.level === riskFilter) &&
          (cityFilter === "all" || s.city === cityFilter),
      ),
    [seniors, search, riskFilter, cityFilter],
  );
  const cities = [...new Set(seniors.map((s) => s.city))].sort();
  const openTasks = tasks.filter((t) => t.status !== "completed");
  async function openSenior(senior: Senior) {
    const request = ++detailRequest.current;
    setSelected(senior);
    setDetail(null);
    try {
      const result = await api(`/seniors/${encodeURIComponent(senior.id)}`);
      if (request === detailRequest.current) setDetail(result);
    } catch (err: any) {
      if (request === detailRequest.current) notify(err.message);
    }
  }
  async function addTask(senior: Senior) {
    setBusy(true);
    try {
      await api("/tasks", "POST", {
        seniorId: senior.id,
        action: senior.action || "Wellbeing check-in call",
        note: "Created from daily priority queue",
      });
      await load();
      notify(`Follow-up added for ${senior.name}`);
      if (selected?.id === senior.id)
        setDetail(await api(`/seniors/${encodeURIComponent(senior.id)}`));
    } catch (err: any) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }
  function completeTask(task: any) {
    setTaskReview(task);
    setTaskOutcome("");
  }
  async function saveTaskOutcome(event: React.FormEvent) {
    event.preventDefault();
    if (!taskReview || taskOutcome.trim().length < 5) return;
    setBusy(true);
    try {
      await api(`/tasks/${taskReview.id}`, "PATCH", {
        status: "completed",
        outcome: taskOutcome.trim(),
      });
      await load();
      setTaskReview(null);
      setTaskOutcome("");
      notify("Follow-up outcome recorded");
    } catch (err: any) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function feedback(useful: boolean) {
    if (!selected) return;
    try {
      await api("/feedback", "POST", { seniorId: selected.id, useful });
      notify("Thank you. Your feedback has been saved for review.");
    } catch (err: any) {
      notify(err.message);
    }
  }
  function navigate(next: View) {
    window.history.pushState(null,'',workspacePath(next));
    window.scrollTo({top:0,behavior:'instant'});
    setSearch("");
    setMobileOpen(false);
  }
  const navGroups=workspaceNavigation(role,data?.session?.isAdmin===true,canWrite);
  const nav=navGroups.flatMap(group=>group.items);
  const activeTitle = nav.find((n) => n.id === view)?.label || "Care overview";
  const effectiveSenior = detail?.senior || selected;
  if (!data)
    return (
      <div className="loading-screen">
        <div className="loading-brand">
          <CareMark size={34} />
          <span>
            SwasthSync
          </span>
        </div>
        <p>
          {error
            ? "We couldn’t load your care workspace."
            : "Getting your care overview ready…"}
        </p>
        {error && (
          <>
            <p className="error-copy">{error}</p>
            <button className="button primary" onClick={load}>
              Try again
            </button>
          </>
        )}
        <span className="loading-caption">
          Small signals. More thoughtful care.
        </span>
      </div>
    );

  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside id="workspace-navigation" ref={navigationRef} className={`sidebar ${mobileOpen ? "is-open" : ""}`} role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined} aria-label="Workspace navigation">
        <button className="icon-button mobile-nav-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><Icon name="close"/></button>
        <Link
          className="brand"
          href={workspacePath(defaultWorkspace(role))}
          onClick={()=>{setSearch('');setMobileOpen(false);}}
        >
          <span className="brand-icon">
            <CareMark size={25} />
          </span>
          <span>
            SwasthSync
            <small>CARE, A LITTLE EARLIER</small>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          {navGroups.map(group=><section className="workspace-nav-group" key={group.label} aria-label={group.label}><h2 className="nav-heading">{group.label}</h2>{group.items.map((item) => (
            <Link
              className={`nav-item ${view === item.id ? "active" : ""}`}
              key={item.id}
              aria-current={view === item.id ? 'page' : undefined}
              href={workspacePath(item.id)}
              onClick={()=>{setSearch('');setMobileOpen(false);}}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === "dashboard" && stats.high > 0 && (
                <span className="nav-count">{stats.high}</span>
              )}
            </Link>
          ))}</section>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <Icon name="shield" size={18} />
            <div>
              <strong>Care you can trust</strong>
              <span>
                Private by design.
                <br />
                Always guided by people.
              </span>
            </div>
          </div>
          <div className="profile">
            <span className="profile-avatar">
              {initials(data.session.name || "Ananya Sharma")}
            </span>
            <div>
              <strong>{data.session.name || "Ananya Sharma"}</strong>
              <span>
                {role === "coordinator"
                  ? "Care coordinator"
                  : role === "operations"
                    ? "Operations manager"
                    : role === "family"
                      ? "Family member"
                      : "Senior member"}
              </span>
            </div>
            <span className="profile-online" />
          </div>
          <button className="button secondary small" onClick={onExit}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="main-shell" inert={mobileOpen || undefined}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              ref={menuButtonRef}
              aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={mobileOpen}
              aria-controls="workspace-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <span>Workspace</span>
            <span className="breadcrumb-divider">/</span>
            <strong>{activeTitle}</strong>
          </div>
          <div className="topbar-right">
            <span className="synthetic-pill">
              <span />
              Synthetic demo
            </span>
            <span className="topbar-date">
              <Icon name="calendar" size={16} />
              {new Date(
                `${data.date || "2026-10-27"}T12:00:00`,
              ).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <button
              className="icon-button notification"
              aria-label="Open notification center"
              onClick={() => navigate("deliveries")}
            >
              <Icon name="bell" />
              {openTasks.length > 0 && <span />}
            </button>
          </div>
        </header>
        <main className="main-content">
          {staff&&view!=='phone-support'&&<PhoneSupportNotice onOpen={()=>navigate('phone-support')}/>}
          {view==='phone-support'&&staff&&<PhoneSupport seniors={seniors} notify={notify} onChanged={load} onOpenFollowups={()=>navigate('followups')}/>}
          {error && (
            <div className="inline-error" role="alert">
              {error}
              <button onClick={load}>Retry</button>
            </div>
          )}
          {staff && (view === "dashboard" || view === "seniors") && (
            <>
              <section className="page-intro">
                <div>
                  <div className="eyebrow">
                    <span className="sun-icon">☀</span>{" "}
                    {new Date(`${data.date}T12:00:00`)
                      .toLocaleDateString("en-IN", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })
                      .toUpperCase()}
                  </div>
                  <h1>
                    {view === "dashboard"
                      ? "A little attention. A big difference."
                      : "Every senior, thoughtfully cared for."}
                  </h1>
                  <p>
                    {view === "dashboard"
                      ? "Here’s who could use a little extra care today."
                      : "A personal baseline. A clearer picture. One connected care community."}
                  </p>
                </div>
                <div className="intro-actions">
                  <a className="button secondary" href="/api/export?format=csv">
                    <Icon name="download" size={16} />
                    Export
                  </a>
                  {canWrite && (
                    <button
                      className="button primary"
                      onClick={() => {
                        setSignalSenior(seniors[0]?.id || "");
                        setSignalOpen(true);
                      }}
                    >
                      <Icon name="plus" size={18} />
                      Log check-in
                    </button>
                  )}
                </div>
              </section>
              <section
                className="stat-grid"
                aria-label="Care overview statistics"
              >
                <StatCard
                  icon="people"
                  title="Seniors in your care"
                  value={stats.total ?? seniors.length}
                  caption="Across your care community"
                  tone="green"
                />
                <StatCard
                  icon="alert"
                  title="Need attention"
                  value={(stats.high || 0) + (stats.medium || 0)}
                  caption={`${stats.high || 0} high priority · ${stats.medium || 0} to watch`}
                  tone="orange"
                />
                <StatCard
                  icon="heart"
                  title="Within usual pattern"
                  value={stats.low || 0}
                  caption="Within their usual patterns"
                  tone="mint"
                />
                <StatCard
                  icon="info"
                  title="Check-in needed"
                  value={stats.unknown || 0}
                  caption="Insufficient recent information"
                  tone="blue"
                />
                <StatCard
                  icon="check"
                  title="Follow-ups completed"
                  value={tasks.filter((t) => t.status === "completed").length}
                  caption={`${openTasks.length} care actions still open`}
                  tone="blue"
                />
              </section>
              <div
                className={
                  view === "dashboard"
                    ? "dashboard-columns"
                    : "directory-layout"
                }
              >
                <section className="panel queue-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        {view === "dashboard"
                          ? "Your care priorities"
                          : "Senior directory"}
                        <span className="count-bubble">{filtered.length}</span>
                      </h2>
                      <p>
                        {view === "dashboard"
                          ? "Small changes, seen early. Sorted by who needs you most."
                          : "Search and explore daily wellbeing across the cohort."}
                      </p>
                    </div>
                    <span className="updated-indicator">
                      <span />
                      Scores for {shortDate(data.date)}
                    </span>
                  </div>
                  <div className="queue-controls">
                    <div
                      className="tabs"
                      role="group"
                      aria-label="Filter risk level"
                    >
                      {[
                        { id: "all", label: "All seniors" },
                        { id: "high", label: "High priority" },
                        { id: "medium", label: "Watch closely" },
                        { id: "low", label: "Within usual pattern" },
                        { id: "unknown", label: "Check-in needed" },
                      ].map((t) => (
                        <button
                          key={t.id}
                          className={riskFilter === t.id ? "selected" : ""}
                          onClick={() => setRiskFilter(t.id)}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <div className="queue-search-row">
                      <label className="search-field">
                        <Icon name="search" size={17} />
                        <input
                          aria-label="Search seniors"
                          placeholder="Search a senior or city…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                      <label className="city-select">
                        <span className="sr-only">Filter by city</span>
                        <select
                          value={cityFilter}
                          onChange={(e) => setCityFilter(e.target.value)}
                        >
                          <option value="all">All cities</option>
                          {cities.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <Icon name="down" size={13} />
                      </label>
                    </div>
                  </div>
                  <div className="queue-table">
                    <div className="queue-table-head">
                      <span>SENIOR</span>
                      <span>WELLBEING SIGNALS</span>
                      <span>PRIORITY</span>
                      <span />
                    </div>
                    {filtered
                      .slice(0, view === "seniors" ? filtered.length : 7)
                      .map((s) => (
                        <div className="senior-row" key={s.id}>
                          <button
                            className="senior-person"
                            onClick={() => openSenior(s)}
                          >
                            <Avatar senior={s} />
                            <span>
                              <strong>{s.name}</strong>
                              <span>
                                {s.age} years{" "}
                                <span className="text-dot">·</span> {s.city}
                              </span>
                            </span>
                          </button>
                          <button
                            className="senior-signal"
                            onClick={() => openSenior(s)}
                          >
                            <span>
                              {s.reasons?.[0]?.title ||
                                (s.level === "low"
                                  ? "Consistent with usual patterns"
                                  : "A check-in is needed to complete the picture")}
                            </span>
                            <small>
                              {s.reasons?.[1]?.title ||
                                (s.level === "unknown"
                                  ? "Recent observations needed"
                                  : "Compared with their own usual pattern")}
                            </small>
                          </button>
                          <div className="senior-risk">
                            <Badge level={s.level} />
                            {s.urgency === "immediate" && (
                              <span className="urgency-badge immediate">
                                Contact now
                              </span>
                            )}
                            <small>
                              <span className="score-value">
                                {s.score == null ? "—" : s.score}
                              </span>
                              {s.score == null
                                ? " · Not enough information"
                                : " / 100 "}
                              {s.score != null && (
                                <span className="score-label">risk score</span>
                              )}
                            </small>
                            <CareStatus state={s.careState} />
                          </div>
                          <button
                            className="row-open"
                            onClick={() => openSenior(s)}
                            aria-label={`Review ${s.name}`}
                          >
                            <Icon name="arrow" size={18} />
                          </button>
                        </div>
                      ))}
                    {filtered.length === 0 && (
                      <div className="empty-state">
                        <Icon name="search" size={30} />
                        <h3>No seniors match these filters</h3>
                        <p>Try another name, city, or priority.</p>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setSearch("");
                            setCityFilter("all");
                            setRiskFilter("all");
                          }}
                        >
                          Clear filters
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="queue-footer">
                    <span>
                      Showing{" "}
                      {Math.min(filtered.length, view === "seniors" ? filtered.length : 7)}{" "}
                      of {filtered.length} seniors{" "}
                      <span className="text-dot">·</span> Urgent reports first ·
                      Personal risk next
                    </span>
                    {view === "dashboard" ? (
                      <button
                        className="text-button"
                        onClick={() => navigate("seniors")}
                      >
                        View all seniors
                        <Icon name="arrow" size={15} />
                      </button>
                    ) : (
                      <span className="queue-footnote">
                        Immediate reports stay ahead of nonurgent scores
                      </span>
                    )}
                  </div>
                </section>
                {view === "dashboard" && (
                  <aside className="dashboard-aside">
                    <section className="panel snapshot-panel">
                      <div className="panel-heading compact">
                        <h2>Today, at a glance</h2>
                        <span className="small-square">
                          <Icon name="chart" size={16} />
                        </span>
                      </div>
                      <div className="donut-layout">
                        <div
                          className="wellbeing-donut"
                          style={
                            {
                              "--high": `${(100 * (stats.high || 0)) / Math.max(1, stats.total ?? seniors.length)}%`,
                              "--watch": `${(100 * ((stats.high || 0) + (stats.medium || 0))) / Math.max(1, stats.total ?? seniors.length)}%`,
                              "--stable": `${(100 * ((stats.high || 0) + (stats.medium || 0) + (stats.low || 0))) / Math.max(1, stats.total ?? seniors.length)}%`,
                            } as React.CSSProperties
                          }
                        >
                          <div>
                            <strong>{stats.total ?? seniors.length}</strong>
                            <span>seniors</span>
                          </div>
                        </div>
                        <div className="donut-legend">
                          <div>
                            <span className="legend-dot high" />
                            <span>High priority</span>
                            <strong>{stats.high || 0}</strong>
                          </div>
                          <div>
                            <span className="legend-dot medium" />
                            <span>Watch closely</span>
                            <strong>{stats.medium || 0}</strong>
                          </div>
                          <div>
                            <span className="legend-dot low" />
                            <span>Within usual pattern</span>
                            <strong>{stats.low || 0}</strong>
                          </div>
                          <div>
                            <span className="legend-dot unknown" />
                            <span>Check-in needed</span>
                            <strong>{stats.unknown || 0}</strong>
                          </div>
                        </div>
                      </div>
                      <div className="snapshot-caption">
                        <Icon name="info" size={14} />
                        <span>
                          Risk is relative to each senior’s own baseline.
                        </span>
                      </div>
                    </section>
                    <section className="panel followups-panel">
                      <div className="panel-heading compact">
                        <h2>Care in motion</h2>
                        <span className="count-bubble">{openTasks.length}</span>
                      </div>
                      <div className="followup-list">
                        {openTasks.slice(0, 3).map((t, i) => (
                          <div className="followup-item" key={t.id}>
                            <span
                              className={`task-icon ${i === 1 ? "warm" : ""}`}
                            >
                              <Icon
                                name={i === 1 ? "note" : "phone"}
                                size={16}
                              />
                            </span>
                            <div>
                              <strong>
                                {seniors.find((s) => s.id === t.seniorId)
                                  ?.name ||
                                  t.seniorName ||
                                  "Senior follow-up"}
                              </strong>
                              <span>{t.action}</span>
                            </div>
                            <button
                              className="task-check"
                              aria-label={`Complete follow-up for ${seniors.find((s) => s.id === t.seniorId)?.name || "senior"}`}
                              disabled={busy || !canWrite}
                              onClick={() => completeTask(t)}
                            >
                              <Icon name="check" size={13} />
                            </button>
                          </div>
                        ))}
                        {openTasks.length === 0 && (
                          <div className="small-empty">
                            <Icon name="check" size={24} />
                            <strong>A little breathing room.</strong>
                            <span>Review a senior to add a follow-up.</span>
                          </div>
                        )}
                      </div>
                      <button
                        className="full-text-button"
                        onClick={() => setTaskOpen(true)}
                      >
                        View all follow-ups
                        <Icon name="arrow" size={15} />
                      </button>
                    </section>
                    <section className="care-note">
                      <span className="care-note-icon">
                        <Icon name="leaf" size={24} />
                      </span>
                      <span className="care-note-label">
                        THE HUMAN SIDE OF CARE
                      </span>
                      <h3>
                        A familiar voice
                        <br />
                        can change a day.
                      </h3>
                      <p>
                        A short, thoughtful check-in often tells us what numbers
                        can’t.
                      </p>
                      <button
                        onClick={() =>
                          navigate(canWrite ? "checkin" : "insights")
                        }
                      >
                        {canWrite
                          ? "Start a check-in"
                          : "Explore care insights"}
                        <Icon name="arrow" size={16} />
                      </button>
                      <div className="care-note-leaf leaf-one" />
                      <div className="care-note-leaf leaf-two" />
                    </section>
                  </aside>
                )}
              </div>
              <section className="trust-strip">
                <span>
                  <Icon name="shield" size={17} />
                  Privacy first, care always.
                </span>
                <p>
                  200 synthetic seniors · 90 days of signals · Human decisions,
                  supported by AI
                </p>
                <button onClick={() => navigate("insights")}>
                  How it works
                  <Icon name="arrow" size={14} />
                </button>
              </section>
            </>
          )}

          {view === "checkin" && (
            <>{role==='senior'&&data.session.seniorId&&<CarePhoneContact seniorId={data.session.seniorId} name={seniors.find(senior=>senior.id===data.session.seniorId)?.name||'Senior member'}/>}<PortalCare mode="checkin" seniors={seniors} session={data.session} asOfDate={data.date} notify={notify} onChanged={load}/>{role==='senior'&&data.session.seniorId&&<MotionCheckin seniorId={data.session.seniorId} notify={notify} onSaved={load} />}</>
          )}
          {view === "followups" && <PortalCare mode="followups" seniors={seniors} session={data.session} asOfDate={data.date} notify={notify} onChanged={load}/>}
          {view === "household" && ["family","senior"].includes(role) && <HouseholdAccess notify={notify} onChanged={load}/>}
          {view === "system" && data.session.role === "operations" && data.session.isAdmin && <CloudOperations notify={notify}/>}
          {view === "family" && (
            <FamilyView seniors={seniors} date={data.date} notify={notify}/>
          )}
          {view==='family-reports'&&role==='family'&&<FamilyView seniors={seniors} date={data.date} notify={notify} summaryOnly/>}
          {view === "insights" && staff && (
            <>
              <OutcomesInsights data={data} seniors={data.seniors} onOpenSenior={openSenior} />
              <RuntimeControls key={`${data.runtime?.mode}:${data.date}`} data={data} notify={notify} onChanged={load} />
            </>
          )}
          {staff&&["analysis","monitoring","medications","reports"].includes(view)&&<CareReviewNav active={view}/>}
          {view === "analysis" && staff && (
            <AnalysisView
              data={data}
              notify={notify}
              initialSenior={analysisSenior || seniors[0]?.id}
              onSeniorChange={setAnalysisSenior}
            />
          )}
          {['monitoring','medications'].includes(view)&&staff&&<CareMonitoring key={view} initialSenior={analysisSenior} onSeniorChange={setAnalysisSenior} section={view==='medications'?'medications':'vitals'} data={data} notify={notify} onOpenFollowups={()=>navigate('followups')}/>}
          {view==='reports'&&staff&&<GroundedReports initialSenior={analysisSenior} onSeniorChange={setAnalysisSenior} data={data} notify={notify} onChanged={load} onOpenDeliveries={()=>navigate('deliveries')} />}
          {view==='telephony'&&staff&&<TelephonyCenter data={data} notify={notify} onOpenFollowups={()=>navigate('followups')} />}
          {view==='care-operations'&&staff&&<CareOperations data={data} notify={notify} onChanged={load} initialSenior={careOperationsSenior} />}
          {view==='speech'&&staff&&<SpeechNotes data={data} notify={notify} onChanged={load} />}
          {view === "alerts" && (
            <AlertsView data={data} notify={notify} onChanged={load} />
          )}
          {view === "communications" && (
            <CommunicationsView data={data} notify={notify} onChanged={load} />
          )}
          {view === "deliveries" && (
            <DeliveryCenter data={data} notify={notify} onChanged={load} />
          )}
          {view === "access" && data.session.role === 'operations' && data.session.isAdmin && (
            <AccountConsole data={data} notify={notify} onChanged={load} onOwnPassword={()=>navigate('account')}/>
          )}
          {view==='account'&&<AccountSettings name={data.session.name} role={{operations:'Operations Manager',coordinator:'Care Coordinator',family:'Family Member',senior:'Senior Member'}[role]}/>}
          <footer className="page-footer">
            <span>Decision support · Not a diagnosis</span>
          </footer>
        </main>
      </div>

      {selected && (
        <Overlay
          className="drawer-overlay"
          label={`${effectiveSenior.name} wellbeing detail`}
          onClose={() => {
            setSelected(null);
            setDetail(null);
          }}
        >
          <div className="drawer-top">
            <span>SENIOR WELLBEING PROFILE</span>
            <button
              className="icon-button"
              aria-label="Close profile"
              onClick={() => {
                setSelected(null);
                setDetail(null);
              }}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="drawer-profile">
            <Avatar senior={selected} large />
            <div>
              <h2>{effectiveSenior.name}</h2>
              <p>
                {effectiveSenior.age} years · {effectiveSenior.city} ·{" "}
                {effectiveSenior.language || "Hindi / English"}
              </p>
              <span className="profile-id">
                {effectiveSenior.id} · {effectiveSenior.dataProvenance?.kind==='recorded'?'Care record':'Synthetic identity'}
              </span>
            </div>
          </div>
          <div className="drawer-risk">
            <div>
              <Badge level={effectiveSenior.level} />
              {effectiveSenior.urgency === "immediate" && (
                <span className="urgency-badge immediate">Contact now</span>
              )}
              <p>
                {effectiveSenior.score == null
                  ? "More information needed"
                  : "Daily risk score"}
              </p>
            </div>
            <strong>
              {effectiveSenior.score == null ? "—" : effectiveSenior.score}
              {effectiveSenior.score != null && <small>/100</small>}
            </strong>
          </div>
          <div className="drawer-content">
            <div className="drawer-care-state">
              <CareStatus state={effectiveSenior.careState} />
              <span>Recorded response for this scoring day</span>
            </div>
            <section className="data-quality">
              <div>
                <Icon name="info" size={17} />
                <strong>
                  Observation completeness: {effectiveSenior.confidence == null ? "Not enough observations" : `${effectiveSenior.confidence}%`}
                </strong>
              </div>
              <p>
                {effectiveSenior.dataFreshness?.label ||
                  "Signal availability reviewed"}{" "}
                · Last check-in {shortDate(effectiveSenior.lastCheckIn)}
                {effectiveSenior.dataFreshness
                  ? ` · ${effectiveSenior.dataFreshness.observedSignals}/${effectiveSenior.dataFreshness.expectedSignals} recent signal slots observed`
                  : ""}
              </p>
              <span>
                Reflects signal completeness and recency, not the likelihood of
                illness.
              </span>
            </section>
            <section>
              <div className="section-title">
                <h3>What changed?</h3>
                <span>EXPLAINABLE SIGNALS</span>
              </div>
              {(detail?.senior?.reasons || effectiveSenior.reasons || []).map(
                (r: any, i: number) => (
                  <div className="reason-item" key={i}>
                    <span className={`reason-number ${effectiveSenior.level}`}>
                      {i + 1}
                    </span>
                    <div>
                      <strong>{r.title}</strong>
                      <p>{r.detail}</p>
                      <span>{r.source || "Personal baseline comparison"}</span>
                    </div>
                  </div>
                ),
              )}
            </section>
            <div className="recommendation">
              <Icon name="phone" size={21} />
              <div>
                <span>RECOMMENDED NEXT STEP</span>
                <strong>
                  {effectiveSenior.action ||
                    "Check in and review recent changes"}
                </strong>
                <p>
                  A coordinator reviews every alert and decides what happens
                  next.
                </p>
              </div>
            </div>
            <section>
              <div className="section-title">
                <h3>Risk over time</h3>
                <span>{(effectiveSenior.trend || []).length} DAYS</span>
              </div>
              <div className="trend-wrap">
                <Sparkline
                  values={detail?.senior?.trend || effectiveSenior.trend || []}
                  level={effectiveSenior.level}
                  large
                />
                <div className="chart-axis">
                  <span>{shortDate(effectiveSenior.trend?.[0]?.date)}</span>
                  <span>Personal trend</span>
                  <span>{shortDate(data.date)}</span>
                </div>
              </div>
              <p className="subtle-note">
                {effectiveSenior.dataProvenance?.kind==='recorded'?'Reported concerns are reviewed while this senior’s personal reference is being established.':'Rules + Isolation Forest identify changes from this senior’s own baseline.'}
              </p>
              <button
                className="button secondary small"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setAnalysisSenior(effectiveSenior.id);
                  setSelected(null);
                  setDetail(null);
                  navigate("analysis");
                }}
              >
                Explore personal analysis
              </button>
            </section>
            <HistoryTimeline seniorId={effectiveSenior.id} asOfDate={data.date} cohortStart={data.runtime?.cohortStart} cohortEnd={data.runtime?.cohortEnd} refreshKey={data.audit?.length} />
            <section>
              <div className="section-title">
                <h3>Latest signals</h3>
                <span>VALUE / USUAL</span>
              </div>
              <div className="vital-grid">
                {[
                  {
                    label: "Blood pressure",
                    key: "systolic",
                    value: `${effectiveSenior.latest?.vitals?.systolic ?? "—"}/${effectiveSenior.latest?.vitals?.diastolic ?? "—"}`,
                    baseline: `${effectiveSenior.baseline?.systolic ?? "—"}/${effectiveSenior.baseline?.diastolic ?? "—"}`,
                    unit: "mmHg",
                  },
                  {
                    label: "Blood glucose",
                    key: "glucose",
                    value: effectiveSenior.latest?.vitals?.glucose,
                    baseline: effectiveSenior.baseline?.glucose,
                    unit: "mg/dL",
                  },
                  {
                    label: "Oxygen saturation",
                    key: "spo2",
                    value: effectiveSenior.latest?.vitals?.spo2,
                    baseline: effectiveSenior.baseline?.spo2,
                    unit: "%",
                  },
                  {
                    label: "Sleep",
                    key: "sleep",
                    value: effectiveSenior.latest?.sleep,
                    baseline: effectiveSenior.baseline?.sleep,
                    unit: "hours",
                  },
                ].map((v) => (
                  <div className="vital-tile" key={v.key}>
                    <span>{v.label}</span>
                    <strong>
                      {v.value ?? "—"}
                      <small>{v.unit}</small>
                    </strong>
                    <p>
                      Usual:{" "}
                      {Number.isFinite(v.baseline)
                        ? Math.round(Number(v.baseline) * 10) / 10
                        : (v.baseline ?? "—")}
                    </p>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <div className="section-title">
                <h3>Medication check</h3>
                <Icon name="check" size={17} />
              </div>
              <div className="medication-summary">
                <strong>
                  {effectiveSenior.latest?.medication?.taken ?? "—"}
                  <span>
                    {" "}
                    / {effectiveSenior.latest?.medication?.prescribed ??
                      "—"}{" "}
                    doses recorded
                  </span>
                </strong>
                <p>
                  Latest available day. Missing entries are treated as unknown.
                </p>
              </div>
            </section>
            <section>
              <div className="section-title">
                <h3>Latest call note</h3>
                <span>
                  {shortDate(
                    effectiveSenior.latest?.date || effectiveSenior.lastCheckIn,
                  )}
                </span>
              </div>
              <blockquote className="call-note">
                {effectiveSenior.latest?.note ||
                  "No note was recorded for the latest day."}
              </blockquote>
            </section>
            {canWrite && (
              <section>
                <div className="section-title">
                  <h3>Family sharing consent</h3>
                  <Icon name="shield" size={17} />
                </div>
                <label className="consent-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(effectiveSenior.familyConsent)}
                    onChange={async (e) => {
                      const allowed = e.target.checked;
                      try {
                        await api("/consent", "POST", {
                          seniorId: effectiveSenior.id,
                          allowed,
                        });
                        setSelected({
                          ...effectiveSenior,
                          familyConsent: allowed,
                        });
                        setDetail((previous: any) =>
                          previous
                            ? {
                                ...previous,
                                senior: {
                                  ...previous.senior,
                                  familyConsent: allowed,
                                },
                              }
                            : previous,
                        );
                        await load();
                        notify(
                          allowed
                            ? "Family sharing consent recorded"
                            : "Family sharing revoked",
                        );
                      } catch (err: any) {
                        notify(err.message);
                      }
                    }}
                  />
                  <span>Allow linked family to view wellbeing summaries</span>
                </label>
                <p className="subtle-note">
                  Changing this setting simulates a coordinator recording the
                  senior’s consent.
                </p>
              </section>
            )}
            {canWrite && (
              <section className="feedback-section">
                <h3>Was this alert useful?</h3>
                <div>
                  <button
                    className="button secondary small"
                    onClick={() => feedback(true)}
                  >
                    Yes, useful
                  </button>
                  <button
                    className="button secondary small"
                    onClick={() => feedback(false)}
                  >
                    Needs review
                  </button>
                </div>
                <p>
                  Reviewed examples train a separate alert-usefulness model once
                  enough balanced feedback exists. Urgent care flags stay
                  visible.
                </p>
              </section>
            )}
          </div>
          {staff && (
            <div className="drawer-actions">
              <button className="button secondary" onClick={()=>{setCareOperationsSenior(effectiveSenior.id);setSelected(null);navigate('care-operations');}}>
                Care owner & case history
              </button>
              {canWrite&&<>
              <button
                className="button secondary"
                onClick={() => {
                  setSignalSenior(effectiveSenior.id);
                  setSelected(null);
                  setSignalOpen(true);
                }}
              >
                <Icon name="plus" size={17} />
                Add signal
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => addTask(effectiveSenior)}
              >
                <Icon name="phone" size={17} />
                Create follow-up task
              </button>
              </>}
            </div>
          )}
        </Overlay>
      )}
      {signalOpen && (
        <SignalModal
          seniors={seniors}
          initialSenior={signalSenior}
          asOfDate={data.date}
          cohortStart={data.runtime?.cohortStart}
          onClose={() => setSignalOpen(false)}
          notify={notify}
          onSaved={async () => {
            await load();
            setSignalOpen(false);
          }}
        />
      )}
      {taskOpen && (
        <Overlay label="Care follow-ups" onClose={() => setTaskOpen(false)}>
          <div className="modal-header">
            <div>
              <span className="eyebrow">CARE IN MOTION</span>
              <h2>Your follow-ups</h2>
            </div>
            <button
              className="icon-button"
              aria-label="Close follow-ups"
              onClick={() => setTaskOpen(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="tasks-modal-list">
            {tasks.length === 0 && (
              <div className="empty-state">
                <Icon name="check" size={30} />
                <h3>No follow-ups yet</h3>
                <p>Review a senior and create a care action.</p>
              </div>
            )}
            {[...tasks]
              .sort(
                (a, b) =>
                  Number(a.status === "completed") -
                  Number(b.status === "completed"),
              )
              .map((t) => (
                <div
                  className={`task-full ${t.status === "completed" ? "completed" : ""}`}
                  key={t.id}
                >
                  <span className="task-icon">
                    <Icon
                      name={t.status === "completed" ? "check" : "phone"}
                      size={19}
                    />
                  </span>
                  <div>
                    <strong>
                      {seniors.find((s) => s.id === t.seniorId)?.name ||
                        t.seniorName ||
                        "Senior follow-up"}
                    </strong>
                    <p>{t.action}</p>
                    <span>
                      {t.status === "completed" ? "Completed" : "Open"} ·{" "}
                      {shortDate(t.createdAt || data.date)}
                    </span>
                  </div>
                  {t.status !== "completed" && canWrite && (
                    <button
                      className="button secondary small"
                      disabled={busy || !canWrite}
                      onClick={() => completeTask(t)}
                    >
                      Complete
                    </button>
                  )}
                </div>
              ))}
          </div>
        </Overlay>
      )}
      {taskReview && (
        <Overlay
          label="Record follow-up outcome"
          onClose={() => setTaskReview(null)}
        >
          <div className="modal-header">
            <div>
              <span className="eyebrow">DOCUMENT THE HUMAN RESPONSE</span>
              <h2>What happened during this follow-up?</h2>
              <p>{taskReview.action}</p>
            </div>
            <button
              className="icon-button"
              aria-label="Close task outcome"
              onClick={() => setTaskReview(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          <form className="task-outcome-form" onSubmit={saveTaskOutcome}>
            <label>
              Outcome and agreed next step
              <textarea
                required
                minLength={5}
                maxLength={1000}
                rows={5}
                value={taskOutcome}
                onChange={(event) => setTaskOutcome(event.target.value)}
                placeholder="Record who was contacted, what was confirmed, and the agreed next step."
              />
            </label>
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setTaskReview(null)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={busy || taskOutcome.trim().length < 5}
              >
                {busy ? "Saving…" : "Record outcome & complete"}
              </button>
            </div>
          </form>
        </Overlay>
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  title,
  value,
  caption,
  tone,
}: {
  icon: string;
  title: string;
  value: number | string;
  caption: string;
  tone: string;
}) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-top">
        <span>{title}</span>
        <span className="stat-icon">
          <Icon name={icon} size={19} />
        </span>
      </div>
      <strong>{value}</strong>
      <p>
        <span className="stat-caption-dot" />
        {caption}
      </p>
    </article>
  );
}

function SignalModal({
  seniors,
  initialSenior,
  asOfDate,
  cohortStart,
  onClose,
  notify,
  onSaved,
}: {
  seniors: Senior[];
  initialSenior: string;
  asOfDate: string;
  cohortStart?: string;
  onClose: () => void;
  notify: (m: string) => void;
  onSaved: () => void;
}) {
  const [seniorId, setSeniorId] = useState(
      initialSenior || seniors[0]?.id || "",
    ),
    [type, setType] = useState("note"),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [observationDate,setObservationDate]=useState(asOfDate);
  const [measurementTime,setMeasurementTime]=useState("");
  const [note, setNote] = useState(""),
    [vitals, setVitals] = useState<Record<string, string>>({
      systolic: "",
      diastolic: "",
      glucose: "",
      spo2: "",
      weight: "",
    }),
    [taken, setTaken] = useState(""),
    [prescribed, setPrescribed] = useState("");
  const [lifestyle, setLifestyle] = useState<Record<string, string>>({
    steps: "",
    sleepHours: "",
    waterGlasses: "",
    meals: "",
    mood: "okay",
    painScore: "",
  });
  const [sensor, setSensor] = useState<Record<string, string>>({
      steps: "",
      inactiveMinutes: "",
      impactG: "",
    }),
    [fallDetected, setFallDetected] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body: any = { seniorId, type, date:observationDate, observationTime:measurementTime, timezone:'Asia/Kolkata' };
      if (type === "note") body.note = note;
      if (type === "vitals")
        body.vitals = Object.fromEntries(
          Object.entries(vitals)
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, Number(v)]),
        );
      if (type === "medication")
        body.medication = {
          taken: Number(taken),
          prescribed: Number(prescribed),
        };
      if (type === "lifestyle")
        body.lifestyle = Object.fromEntries(
          Object.entries(lifestyle)
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, k === "mood" ? v : Number(v)]),
        );
      if (type === "sensor")
        body.sensor = {
          ...Object.fromEntries(
            Object.entries(sensor)
              .filter(([, v]) => v !== "")
              .map(([k, v]) => [k, Number(v)]),
          ),
          fallDetected,
        };
      await api("/signals", "POST", body);
      notify("Observation saved to the senior’s history.");
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Overlay label="Log a wellbeing signal" onClose={onClose}>
      <div className="modal-header">
        <div>
          <h2>Log a wellbeing signal</h2>
          <p>Record when the observation happened.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Close signal form"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <form onSubmit={save} className="signal-form">
        <label>
          Senior
          <select
            value={seniorId}
            required
            onChange={(e) => setSeniorId(e.target.value)}
          >
            {seniors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.city}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Observation date
            <input type="date" required value={observationDate} min={cohortStart} max={asOfDate} onChange={e=>setObservationDate(e.target.value)} />
          </label>
          <label>
            Observation time (optional, India time)
            <input type="time" value={measurementTime} onChange={e=>setMeasurementTime(e.target.value)} />
          </label>
        </div>
        <p className="subtle-note">Leave the time blank when it is unknown. Save time is recorded separately.{asOfDate!==new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())?' The workspace is viewing a historical day.':''}</p>
        <div
          className="segmented-control"
          role="group"
          aria-label="Signal type"
        >
          {[
            { id: "note", label: "Call note", icon: "note" },
            { id: "vitals", label: "Vitals", icon: "heart" },
            { id: "medication", label: "Medication", icon: "check" },
            { id: "lifestyle", label: "Daily routine", icon: "leaf" },
            { id: "sensor", label: "Activity sensor", icon: "chart" },
          ].map((t) => (
            <button
              type="button"
              key={t.id}
              className={type === t.id ? "selected" : ""}
              onClick={() => setType(t.id)}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
            </button>
          ))}
        </div>
        {type === "note" && (
          <>
            <label>
              What did you notice?
              <textarea
                required
                minLength={3}
                maxLength={1600}
                rows={5}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="For example: Aaj bhookh kam hai, and she missed her evening medicine…"
              />
            </label>
            <div className="form-help">
              <Icon name="info" size={15} />
              <span>
                Hindi, English, and mixed-language notes are supported. This
                demo uses synthetic details only.
              </span>
            </div>
          </>
        )}
        {type === "vitals" && (
          <>
            <div className="form-grid">
              {[
                {
                  key: "systolic",
                  label: "Systolic BP (mmHg)",
                  min: 60,
                  max: 260,
                },
                {
                  key: "diastolic",
                  label: "Diastolic BP (mmHg)",
                  min: 35,
                  max: 180,
                },
                {
                  key: "glucose",
                  label: "Blood glucose (mg/dL)",
                  min: 30,
                  max: 600,
                },
                { key: "spo2", label: "SpO₂ (%)", min: 50, max: 100 },
                { key: "weight", label: "Weight (kg)", min: 20, max: 200 },
              ].map((v) => (
                <label key={v.key}>
                  {v.label}
                  <input
                    type="number"
                    step="0.1"
                    min={v.min}
                    max={v.max}
                    placeholder="Not recorded"
                    value={vitals[v.key]}
                    onChange={(e) =>
                      setVitals({ ...vitals, [v.key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <p className="subtle-note">
              Enter available readings. Leave unrecorded measurements empty.
            </p>
          </>
        )}
        {type === "medication" && (
          <div className="form-grid">
            <label>
              Doses taken
              <input
                type="number"
                required
                min="0"
                max="20"
                value={taken}
                onChange={(e) => setTaken(e.target.value)}
                placeholder="0"
              />
            </label>
            <label>
              Doses prescribed
              <input
                type="number"
                required
                min="1"
                max="20"
                value={prescribed}
                onChange={(e) => setPrescribed(e.target.value)}
                placeholder="3"
              />
            </label>
          </div>
        )}
        {type === "lifestyle" && (
          <>
            <div className="form-grid">
              {[
                { key: "steps", label: "Steps today", max: 50000 },
                { key: "sleepHours", label: "Sleep (hours)", max: 24 },
                { key: "waterGlasses", label: "Glasses of water", max: 30 },
                { key: "meals", label: "Meals eaten", max: 6 },
                {
                  key: "painScore",
                  label: "Self-reported discomfort (0–10)",
                  max: 10,
                },
              ].map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input
                    type="number"
                    min="0"
                    max={field.max}
                    step={field.key === "sleepHours" ? "0.5" : "1"}
                    value={lifestyle[field.key]}
                    onChange={(e) =>
                      setLifestyle({
                        ...lifestyle,
                        [field.key]: e.target.value,
                      })
                    }
                    placeholder="Not recorded"
                  />
                </label>
              ))}
              <label>
                How did they feel?
                <select
                  value={lifestyle.mood}
                  onChange={(e) =>
                    setLifestyle({ ...lifestyle, mood: e.target.value })
                  }
                >
                  <option value="good">Good</option>
                  <option value="okay">As usual</option>
                  <option value="low">Low</option>
                  <option value="lonely">Feeling lonely</option>
                </select>
              </label>
            </div>
            <p className="subtle-note">
              Everyday observations support a conversation. Unrecorded fields
              stay unknown.
            </p>
          </>
        )}
        {type === "sensor" && (
          <>
            <div className="form-grid">
              {[
                { key: "steps", label: "Sensor steps", max: 50000 },
                {
                  key: "inactiveMinutes",
                  label: "Inactivity (minutes)",
                  max: 1440,
                },
                { key: "impactG", label: "Reported impact (g)", max: 20 },
              ].map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input
                    type="number"
                    min="0"
                    max={field.max}
                    step={field.key === "impactG" ? "0.1" : "1"}
                    value={sensor[field.key]}
                    onChange={(e) =>
                      setSensor({ ...sensor, [field.key]: e.target.value })
                    }
                    placeholder="Not recorded"
                  />
                </label>
              ))}
            </div>
            <label className="consent-toggle" style={{ marginTop: 20 }}>
              <input
                type="checkbox"
                checked={fallDetected}
                onChange={(e) => setFallDetected(e.target.checked)}
              />
              Sensor reported a possible fall
            </label>
            <p className="subtle-note">
              Manual sensor input. A fall flag needs prompt human
              review; no hardware is connected.
            </p>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={saving || !seniorId}
          >
            {saving ? "Saving…" : "Save signal"}
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function FamilyView({ seniors, date,notify,summaryOnly=false }: { seniors: Senior[]; date: string;notify:(message:string)=>void;summaryOnly?:boolean }) {
  const [selectedSeniorId, setSelectedSeniorId] = useState("");
  const [summaryAttempt, setSummaryAttempt] = useState(0);
  const s = seniors.find((senior) => senior.id === selectedSeniorId) || seniors[0];
  const summaryKey = s ? `${s.id}:${date}:${s.familyConsent !== false}` : "";
  const [weekly, setWeekly] = useState<{
    key: string;
    status: "ready" | "error" | "pending";
    summary?: { text: string; method?:string; period?: { from: string; to: string } };
    error?: string;
    currentPeriodPending?:boolean;
  } | null>(null);
  const currentWeekly = weekly?.key === summaryKey ? weekly : null;
  const [requestBusy,setRequestBusy]=useState(false);
  const [requestedSenior,setRequestedSenior]=useState('');
  async function requestSummary(){if(!s||requestBusy)return;setRequestBusy(true);try{
    const result=await api(`/portal-care?seniorId=${encodeURIComponent(s.id)}`);
    const action='Prepare the weekly family wellbeing update';
    const prior=(result.requests||[]).find((r:any)=>r.action===action&&!['completed','cancelled'].includes(r.status));
    if(!prior)await api('/portal-care/requests','POST',{idempotencyKey:crypto.randomUUID(),seniorId:s.id,action,details:`Please review and share the weekly update for the period ending ${date}.`,dueDate:date,priority:'routine'});
    setRequestedSenior(s.id);notify(prior?'Your existing summary request is saved in Follow-ups.':'Summary requested. Your care team can review it in Follow-ups.');
  }catch(error:any){notify(error.message||'The summary request could not be saved.');}finally{setRequestBusy(false);}}
  useEffect(() => {
    let active = true,running=false;
    function refreshSummary(){if(running||!s?.id||s.familyConsent===false)return;running=true;
      void api(`/summaries/${encodeURIComponent(s.id)}`)
        .then((result) => {
          if (!active) return;
          if(result.status==='pending_review') {setWeekly({key:summaryKey,status:'pending'});return;}
          if (typeof result.summary?.text !== "string" || !result.summary.text.trim()) {
            setWeekly({ key: summaryKey, status: "error", error: "A weekly summary is not available yet. Contact your care coordinator for an update." });
            return;
          }
          setWeekly({ key: summaryKey, status: "ready", summary: result.summary,currentPeriodPending:result.currentPeriodPending===true });
        })
        .catch((error:any) => {
          if (active) setWeekly({ key: summaryKey, status: "error", error: error.message||"Unable to load this wellbeing summary. Try again or contact your care coordinator." });
        }).finally(()=>{running=false;});
    }
    refreshSummary();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')refreshSummary();},20000);
    window.addEventListener('focus',refreshSummary);
    return () => {
      active = false;
      clearInterval(timer);window.removeEventListener('focus',refreshSummary);
    };
  }, [s?.id, s?.familyConsent, summaryKey,summaryAttempt]);
  const coordinatorName = typeof s?.coordinator === "string" && s.coordinator.trim()
    ? s.coordinator
    : "Your care coordinator";
  const coordinatorInitials = coordinatorName === "Your care coordinator" ? "SC"
    : coordinatorName.split(/\s+/).filter(Boolean).slice(0, 2).map((name: string) => name[0]).join("");
  return (
    <>
      <section className="page-intro">
        <div>
          <span className="eyebrow">FAMILY</span>
          <h1>{summaryOnly?'Weekly summaries':'Family overview'}</h1>
          <p>Updates shared by your family’s care team after review.</p>
        </div>
        <span className="date-tag">
          <Icon name="calendar" size={17} />
          Week ending {shortDate(date)}
        </span>
      </section>
      {seniors.length > 1 && (
        <section className="panel" style={{ padding: "18px 22px", marginBottom: 24 }} aria-label="Linked family members">
          <label htmlFor="family-senior-select">
            Family member
            <select
              id="family-senior-select"
              value={s?.id || ""}
              onChange={(event) => setSelectedSeniorId(event.target.value)}
            >
              {seniors.map((senior) => <option key={senior.id} value={senior.id}>{senior.name}</option>)}
            </select>
          </label>
        </section>
      )}
      {s&&s.familyConsent!==false&&<CarePhoneContact seniorId={s.id} name={s.name}/>}
      {s&&s.familyConsent!==false&&<div className="family-summary-toolbar"><button className="button secondary" onClick={()=>setSummaryAttempt(n=>n+1)}>Refresh weekly update</button><span>Approved updates refresh automatically while this page is open.</span></div>}
      {!s || s.familyConsent === false ? (
        <section className="panel consent-empty">
          <Icon name="shield" size={45} />
          <h2>Sharing is currently paused</h2>
          <p>
            No shared wellbeing update is available. Contact your care team to
            confirm family access and sharing permission.
          </p>
        </section>
      ) : (
        <div className={summaryOnly?'family-reports-layout':'family-layout'}>
          <section className="panel family-summary" aria-busy={!currentWeekly}>
            <div className="family-summary-head">
              <Avatar senior={s} large />
              <div>
                <span className="eyebrow">WEEKLY UPDATE</span>
                <h2>{s.name}</h2>
                <p>{s.city}</p>
              </div>
              <span className="consent-badge">
                <Icon name="shield" size={15} />
                Shared with consent
              </span>
            </div>
            <div className="family-status">
              <Icon name="heart" size={26} />
              <div>
                <h3>
                  {s.level === "high"
                    ? ["acknowledged", "in_progress"].includes(
                        s.careState?.status,
                      )
                      ? "Your coordinator has acknowledged this change."
                      : s.careState?.status === "resolved"
                        ? "Your coordinator has recorded a follow-up outcome."
                        : "A change needs a care-team check-in."
                    : s.level === "medium"
                      ? "A little extra attention this week."
                      : s.level === "low"
                        ? "Recent entries are close to the usual routine."
                        : "A check-in will help fill in the picture."}
                </h3>
                {currentWeekly?.status === "ready" && <><p>{currentWeekly.summary?.text}</p><p className="subtle-note">{currentWeekly.summary?.method||'Reviewed care-team update'}</p></>}
                {currentWeekly?.status==='pending'&&<p role="status">Your care team has not shared an approved weekly update for this period yet.</p>}
                {(currentWeekly?.status==='pending'||currentWeekly?.currentPeriodPending)&&<div><p className="subtle-note">{currentWeekly?.currentPeriodPending?'This is the latest approved update. A newer update can be requested.':'Your coordinator reviews generated summaries before sharing them.'}</p><button className="button secondary" disabled={requestBusy||requestedSenior===s.id} onClick={requestSummary}>{requestBusy?'Saving request…':requestedSenior===s.id?'Summary request saved':'Request weekly update'}</button></div>}
                {!currentWeekly && <p role="status" aria-live="polite">Loading wellbeing summary…</p>}
                {currentWeekly?.status === "error" && (
                  <div className="extension-error" role="alert">
                    <p>{currentWeekly.error}</p>
                    <button className="button secondary" onClick={() => setSummaryAttempt((attempt) => attempt + 1)}>Retry</button>
                  </div>
                )}
                {currentWeekly?.status === "ready" && currentWeekly.summary?.period && (
                  <p className="subtle-note">{shortDate(currentWeekly.summary.period.from)}–{shortDate(currentWeekly.summary.period.to)}</p>
                )}
              </div>
            </div>
            <h3>Care information</h3>
            <div className="family-points">
              <p>
                <Icon name="phone" size={19} />
                <span>
                  Your coordinator reviews changes and arranges follow-up.
                </span>
              </p>
              <p>
                <Icon name="bell" size={19} />
                <span>
                  Check your notifications for care-team updates and urgent follow-up.
                </span>
              </p>
              <p>
                <Icon name="shield" size={19} />
                <span>
                  Each family member’s updates are shared with their permission.
                </span>
              </p>
            </div>
          </section>
          {!summaryOnly&&<aside className="panel family-side">
            <span className="eyebrow">CARE TEAM</span>
            <span className="family-coordinator-avatar">{coordinatorInitials}</span>
            <h3>{coordinatorName}</h3>
            <p>Care coordinator</p>
            <div className="family-contact-note">
              <Icon name="phone" size={20} />
              <strong>Contact your care team</strong>
              <p>
                Use your care-team contact details to discuss an update or arrange a check-in.
              </p>
            </div>
            <span className="subtle-note">
              Wellbeing signals support human review and are not a diagnosis.
            </span>
          </aside>}
        </div>
      )}
      {summaryOnly&&s&&s.familyConsent!==false&&<SharedSummaryHistory seniorId={s.id}/>}
    </>
  );
}
