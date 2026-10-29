import { useState } from "react";
import "./RolePages.css";

const roles = [
  { id: "coordinator", icon: "▦", title: "Care coordinator", description: "Manage seniors, check-ins and alerts", href: "/dashboard" },
  { id: "family", icon: "♡", title: "Family member", description: "Stay close to your loved one’s wellbeing", href: "/family" },
  { id: "senior", icon: "☀", title: "Senior citizen", description: "See your day and reach someone easily", href: "/senior" },
  { id: "operations", icon: "⌖", title: "Operations manager", description: "Review team trends and response outcomes", href: "/operations" },
];

function RoleBrand() {
  return <a className="role-brand" href="/"><span>S</span> SAARTHI<span className="role-brand-ai">.AI</span></a>;
}

export function LoginPage() {
  const isRegister = window.location.pathname === "/register";
  const [role, setRole] = useState("coordinator");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    if (!email || !password || (isRegister && !String(data.get("name") || "").trim())) {
      setError("Please fill in all fields to continue.");
      return;
    }
    localStorage.setItem("saarthi-demo-role", role);
    window.location.assign(roles.find((item) => item.id === role).href);
  }

  return <main className="role-auth-page">
    <a className="auth-back-home" href="/">← Back to home</a>
    <section className="role-auth-card">
      <RoleBrand />
      <p className="auth-eyebrow">A CARING TEAM, CONNECTED</p>
      <h1>{isRegister ? "Create your account" : "Welcome back"}</h1>
      <p className="auth-subtitle">Sign in to continue to your SAARTHI AI space.</p>

      <form onSubmit={handleSubmit}>
        {isRegister && <label className="auth-field">Full name<input name="name" autoComplete="name" placeholder="Your name" /></label>}
        <label className="auth-field">I am signing in as
          <div className="role-options">
            {roles.map((item) => <button type="button" key={item.id} className={`role-option ${role === item.id ? "selected" : ""}`} onClick={() => setRole(item.id)} aria-pressed={role === item.id}>
              <span className="role-option-icon">{item.icon}</span><span><b>{item.title}</b><small>{item.description}</small></span><i>{role === item.id ? "✓" : ""}</i>
            </button>)}
          </div>
        </label>
        <label className="auth-field">Email address<input type="email" name="email" autoComplete="email" placeholder="you@example.com" /></label>
        <label className="auth-field">Password<span className="password-wrap"><input type={showPassword ? "text" : "password"} name="password" autoComplete={isRegister ? "new-password" : "current-password"} placeholder="Enter your password" /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></span></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-submit" type="submit">{isRegister ? "Create account" : "Continue to my dashboard"}<span>→</span></button>
      </form>
      <p className="auth-switch">{isRegister ? "Already have an account?" : "New to SAARTHI AI?"} <a href={isRegister ? "/login" : "/register"}>{isRegister ? "Sign in" : "Create an account"}</a></p>
      <p className="auth-demo-note">Account verification will be available when authentication is connected.</p>
    </section>
  </main>;
}

function RoleShell({ role, title, subtitle, children }) {
  return <div className="role-dashboard-page">
    <header className="role-dashboard-header"><RoleBrand /><div><span className="role-live-dot" /> Workspace</div><a href="/login">Switch profile / Sign out ↗</a></header>
    <main className={`role-dashboard-content ${role}`}><p className="role-dashboard-eyebrow">{role === "family" ? "FAMILY SPACE" : role === "operations" ? "OPERATIONS" : "PERSONAL SPACE"}</p><h1>{title}</h1><p className="role-dashboard-subtitle">{subtitle}</p>{children}<p className="role-disclaimer">This workspace does not contain preloaded records. Secure data services must be connected before real care information is entered.</p></main>
  </div>;
}

export function FamilyDashboard() {
  return <RoleShell role="family" title="Your family space" subtitle="Connected senior information will appear here.">
    <section className="family-person-card"><div className="family-avatar">＋</div><div><span className="family-status">NO PROFILE CONNECTED</span><h2>No senior linked yet</h2><p>Connect a senior profile to view care updates.</p></div><span className="family-heart">♡</span></section>
    <div className="family-consent-note"><strong>Sharing requires consent</strong><p>Senior information stays hidden until a profile is linked and the senior has agreed to family sharing.</p></div>
    <div className="family-metrics"><article><span>Daily activity</span><strong>0 <small>steps</small></strong><p>No activity records</p><div className="zero-progress" /></article><article><span>Sleep</span><strong>0h 0m</strong><p>No sleep records</p><div className="zero-progress" /></article><article><span>Medication</span><strong>0 <small>records</small></strong><p>No medication records</p><div className="medication-check empty-medication">No doses recorded</div></article></div>
    <section className="family-summary"><span>WEEKLY WELLBEING SUMMARY</span><h2>No summary available</h2><p>A short update will appear here after a senior profile is linked and family sharing is approved.</p></section>
    <section className="family-timeline"><div className="role-section-heading"><div><span>RECENT UPDATES</span><h2>Activity timeline</h2></div><span className="timeline-count">0 updates</span></div><div className="role-empty-state"><strong>No updates yet</strong><p>Updates will appear here when care activity is recorded.</p></div></section>
    <section className="family-contact"><span>♡</span><div><b>Care team connection</b><small>Coordinator contact details will appear when your profile is linked.</small></div><span>Not connected</span></section>
  </RoleShell>;
}

export function SeniorDashboard() {
  const [checkin, setCheckin] = useState("");
  const [note, setNote] = useState("");

  return <RoleShell role="senior" title="Your day at a glance" subtitle="Your personal care information will appear here.">
    <section className="senior-welcome-card"><span className="senior-sun">☀</span><div><span>DAILY STATUS</span><h2>No status recorded</h2><p>Your check-in and wellbeing updates will appear here.</p></div><span className="senior-status-pill status-empty">—</span></section>
    <div className="senior-metrics"><article><span className="senior-metric-icon">◷</span><small>Activity today</small><strong>0</strong><p>steps recorded</p><div className="zero-progress" /></article><article><span className="senior-metric-icon">☾</span><small>Last night</small><strong>0h 0m</strong><p>sleep recorded</p><div className="zero-progress" /></article><article><span className="senior-metric-icon">✚</span><small>Medicine</small><strong>0</strong><p>doses recorded</p><div className="senior-taken empty-medication">No medication records</div></article></div>
    <section className="senior-reminder"><div><span>REMINDERS</span><h2>No reminders yet</h2><p>Reminders will appear here when they are added to your care plan.</p></div><span>0</span></section>
    <section className="senior-help"><div><h2>Need help?</h2><p>Emergency contact details will appear when your profile is connected.</p></div><button disabled className="help-unavailable">Not connected</button></section>
    <button className="senior-sos help-unavailable" disabled><span>☎</span><div><b>Emergency support</b><small>Connect your care profile to enable this button.</small></div><strong>—</strong></button>
    <section className="senior-checkin">
      <span>DAILY CHECK-IN · रोज़ का हाल</span>
      <h2>How are you feeling today?</h2>
      <p>Choose one option. Your care team can follow up once your profile is connected.</p>
      <div className="checkin-options"><button type="button" className={checkin === "okay" ? "selected" : ""} onClick={() => setCheckin("okay")}>I’m okay <small>मैं ठीक हूँ</small></button><button type="button" className={checkin === "call" ? "selected" : ""} onClick={() => setCheckin("call")}>Please call me <small>मुझे फ़ोन करें</small></button></div>
      <label>Anything else you’d like to share?<textarea value={note} onChange={(event) => setNote(event.target.value)} rows="2" placeholder="Optional note / वैकल्पिक नोट" /></label>
      <button className="senior-voice-unavailable" disabled>Voice note · उपलब्ध नहीं</button>
      <p className="checkin-unavailable">Check-ins will be sent when a secure care connection is set up.</p>
      <button className="senior-checkin-submit" disabled>Save check-in · not connected</button>
    </section>
  </RoleShell>;
}

export function OperationsDashboard() {
  return <RoleShell role="operations" title="Operations overview" subtitle="Track response coverage and outcomes across care teams.">
    <div className="ops-metrics"><article><span>Open follow-ups</span><strong>0</strong><small>No pending items</small></article><article><span>Average response time</span><strong>0</strong><small>No response data</small></article><article><span>Resolved alerts</span><strong>0</strong><small>No outcomes recorded</small></article></div>
    <section className="family-timeline ops-empty"><div className="role-section-heading"><div><span>TEAM PERFORMANCE</span><h2>City and team outcomes</h2></div><span className="timeline-count">0 teams</span></div><div className="role-empty-state"><strong>No operational data yet</strong><p>Team-level volume, response times and outcomes will appear when records are connected.</p></div></section>
    <section className="family-consent-note"><strong>Privacy boundary</strong><p>Operations view shows aggregated counts only. Personal health details stay within authorized care roles.</p></section>
  </RoleShell>;
}
