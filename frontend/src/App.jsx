import { useState } from "react";
import "./App.css";
import LandingPage from "./LandingPage.jsx";
import { FamilyDashboard, LoginPage, OperationsDashboard, SeniorDashboard } from "./RolePages.jsx";

const navigation = [
  { name: "Dashboard", icon: "▦" },
  { name: "Seniors", icon: "♙" },
  { name: "Alerts", icon: "⚑" },
  { name: "Analytics", icon: "▥" },
  { name: "Settings", icon: "⚙" },
];

function DashboardApp() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [seniors, setSeniors] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [reviewedAlerts, setReviewedAlerts] = useState([]);
  const [actionNotes, setActionNotes] = useState({});
  const [showSeniorForm, setShowSeniorForm] = useState(false);
  const [checkinSenior, setCheckinSenior] = useState(null);

  const filteredSeniors = seniors.filter((senior) =>
    `${senior.name} ${senior.id}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const pendingCount = alerts.filter(
    (alert) =>
      alert.status === "Pending" &&
      !reviewedAlerts.includes(alert.id)
  ).length;
  const checkinCount = seniors.reduce((total, senior) => total + senior.records.length, 0);

  function markReviewed(alertId, actionNote) {
    setReviewedAlerts((previous) =>
      previous.includes(alertId)
        ? previous
        : [...previous, alertId]
    );
    if (actionNote.trim()) {
      setActionNotes((previous) => ({ ...previous, [alertId]: actionNote.trim() }));
    }
    setSelectedAlert(null);
  }

  function addSenior(profile) {
    const newSenior = {
      ...profile,
      id: `SR-${Date.now().toString().slice(-6)}`,
      records: [],
      status: "No records",
      activity: "Not recorded",
      steps: 0,
      baseline: 0,
      sleep: "0h 0m",
      medication: "0 records",
    };
    setSeniors((current) => [...current, newSenior]);
    setShowSeniorForm(false);
    setActivePage("Seniors");
  }

  function saveCheckin(seniorId, record) {
    const savedRecord = { ...record, id: `REC-${Date.now()}`, createdAt: new Date().toLocaleString() };
    setSeniors((current) => current.map((senior) => {
      if (senior.id !== seniorId) return senior;
      const records = [savedRecord, ...senior.records];
      const latest = records[0];
      return {
        ...senior,
        records,
        steps: Number(latest.steps) || 0,
        activity: latest.steps ? `${latest.steps} steps recorded` : "Not recorded",
        sleep: latest.sleepHours ? `${latest.sleepHours}h` : "0h 0m",
        medication: latest.medication || "Not recorded",
        status: latest.followUp ? "Follow-up requested" : "Updated",
      };
    }));
    if (record.followUp) {
      const senior = seniors.find((item) => item.id === seniorId);
      const alert = {
        id: `ALT-${Date.now()}`,
        title: "Follow-up requested",
        person: senior?.name || "Senior",
        seniorId,
        time: "Just now",
        level: "Medium",
        status: "Pending",
        reason: record.note || "The senior requested a call during check-in.",
        action: "Contact the senior to understand what support they need.",
      };
      setAlerts((current) => [alert, ...current]);
    }
    setCheckinSenior(null);
  }

  return (
    <div className="coordinator-layout">
      <header className="coordinator-header">
        <a className="coordinator-brand" href="/">
          <span className="coordinator-brand-mark">S</span>
          <span>SAARTHI<span className="coordinator-brand-ai">.AI</span><small>CARE WORKSPACE</small></span>
        </a>
        <nav className="coordinator-nav" aria-label="Coordinator workspace">
          {navigation.map((item) => (
            <button
              key={item.name}
              className={`coordinator-nav-item ${
                activePage === item.name ? "active" : ""
              }`}
              onClick={() => {
                setActivePage(item.name);
                setSelectedAlert(null);
              }}
            >
              <span>{item.icon}</span>
              <span>{item.name}</span>

              {item.name === "Alerts" && pendingCount > 0 && (
                <span className="nav-badge">{pendingCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="coordinator-header-actions">
          <span className="coordinator-workspace-status"><i /> Workspace</span>
          <a href="/login">Sign out</a>
        </div>
      </header>

      <main className="coordinator-main">
        <section className="page-content">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">COORDINATOR WORKSPACE</p>

              <h1>
                {activePage === "Dashboard" ? "Care overview" : activePage}
              </h1>

              <p className="subtitle">
                Manage senior profiles, care records and alerts.
              </p>
            </div>

            <button
              className="primary-button"
              onClick={() => setShowSeniorForm(true)}
            >
              + Add senior
            </button>
          </div>

          <div className="notice">
            <span>ⓘ</span>
            <p>
              {seniors.length === 0 ? <><strong>Workspace is empty.</strong> Add a senior profile to start recording care activity.</> : <><strong>{seniors.length} profiles connected.</strong> Follow-up requests are routed for coordinator review.</>}
            </p>
          </div>

          {activePage === "Dashboard" && (
            <Dashboard
              pendingCount={pendingCount}
              onNavigate={setActivePage}
              onOpenAlert={setSelectedAlert}
              seniors={seniors}
              alerts={alerts}
              onAddSenior={() => setShowSeniorForm(true)}
              onRecordCheckin={setCheckinSenior}
              checkinCount={checkinCount}
              reviewedCount={reviewedAlerts.length}
            />
          )}

          {activePage === "Seniors" && (
            <SeniorsPage
              seniors={filteredSeniors}
              search={search}
              setSearch={setSearch}
              onAddSenior={() => setShowSeniorForm(true)}
              onRecordCheckin={setCheckinSenior}
            />
          )}

          {activePage === "Alerts" && (
            <AlertsPage
              alerts={alerts}
              reviewedAlerts={reviewedAlerts}
              onOpenAlert={setSelectedAlert}
            />
          )}

          {activePage === "Analytics" && <AnalyticsPage seniors={seniors} />}

          {activePage === "Settings" && <SettingsPage />}

          {selectedAlert && (
            <AlertModal
              alert={selectedAlert}
              isReviewed={reviewedAlerts.includes(selectedAlert.id)}
              actionNote={actionNotes[selectedAlert.id] || ""}
              onClose={() => setSelectedAlert(null)}
              onReview={(actionNote) => markReviewed(selectedAlert.id, actionNote)}
            />
          )}

          {showSeniorForm && <SeniorForm onClose={() => setShowSeniorForm(false)} onSave={addSenior} />}
          {checkinSenior && <CheckinForm senior={checkinSenior} onClose={() => setCheckinSenior(null)} onSave={saveCheckin} />}

          <footer className="footer-note">
            <span>✦</span>
            AI-assisted monitoring supports human care; it does not diagnose
            medical conditions.
          </footer>
        </section>
      </main>
    </div>
  );
}

function Dashboard({ pendingCount, onNavigate, onOpenAlert, seniors: seniorRecords, alerts: alertRecords, onAddSenior, onRecordCheckin, checkinCount, reviewedCount }) {
  const stats = [
    {
      label: "Registered Seniors",
      value: String(seniorRecords.length),
      detail: "Profiles added",
      icon: "♙",
      color: "blue",
    },
    {
      label: "Pending Reviews",
      value: String(pendingCount),
      detail: "Awaiting human review",
      icon: "⚑",
      color: "orange",
    },
    {
      label: "Risk assessments",
      value: "0",
      detail: "Scoring model not connected",
      icon: "⌁",
      color: "green",
    },
    {
      label: "Check-ins Recorded",
      value: String(checkinCount),
      detail: `${reviewedCount} follow-ups reviewed`,
      icon: "◷",
      color: "purple",
    },
  ];

  return (
    <>
      <div className="stats-grid">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <div className="section-heading">
        <div>
          <h2>Care Overview</h2>
          <p>Prioritize follow-ups and review each senior’s latest care signals.</p>
        </div>
        <button className="text-button" onClick={onAddSenior}>+ Add senior</button>
      </div>

      <div className="content-grid">
        <section className="panel seniors-panel">
          <div className="panel-heading">
            <div>
              <h3>Senior Directory</h3>
              <p>{seniorRecords.length} registered</p>
            </div>

            <button
              className="text-button"
              onClick={() => onNavigate("Seniors")}
            >
              View all →
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SENIOR</th>
                  <th>ACTIVITY</th>
                  <th>STATUS</th>
                </tr>
              </thead>

              <tbody>
                {seniorRecords.map((senior) => (
                  <tr key={senior.id}>
                    <td>
                      <PersonCell senior={senior} />
                    </td>
                    <td>{senior.activity}<br /><button className="inline-action" onClick={() => onRecordCheckin(senior)}>Record update</button></td>
                    <td>
                      <StatusPill status={senior.status} />
                    </td>
                  </tr>
                ))}
                {seniorRecords.length === 0 && <tr><td colSpan="3" className="empty-state">No senior profiles yet. Add a profile to start the care workflow.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel alerts-panel">
          <div className="panel-heading">
            <div>
              <h3>Priority follow-ups</h3>
              <p>Requests awaiting a human response</p>
            </div>

            <button
              className="text-button"
              onClick={() => onNavigate("Alerts")}
            >
              View queue →
            </button>
          </div>

          <div className="alert-list">
            {alertRecords.map((alert) => (
              <AlertItem
                key={alert.id}
                alert={alert}
                onClick={() => onOpenAlert(alert)}
              />
            ))}
            {alertRecords.length === 0 && <div className="empty-panel-state"><span>✓</span><strong>No follow-ups pending</strong><p>Senior check-ins that need attention will appear here.</p></div>}
          </div>
        </section>
      </div>

      <CareSignals seniors={seniorRecords} onRecordCheckin={onRecordCheckin} />
    </>
  );
}

function CareSignals({ seniors: seniorRecords, onRecordCheckin }) {
  return (
    <section className="panel care-signals-panel">
      <div className="panel-heading">
        <div><h3>Daily wellbeing signals</h3><p>Activity, sleep and medication records.</p></div>
        <span className="demo-tag">CURRENT RECORDS</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>SENIOR</th><th>ACTIVITY</th><th>SLEEP</th><th>VITALS</th><th>MEDICATION</th><th>REPORTED CUE</th></tr></thead>
          <tbody>{seniorRecords.map((senior) => <tr key={senior.id}>
            <td><strong>{senior.name}</strong><br /><span className="care-record-id">{senior.id}</span></td>
            <td>{senior.steps.toLocaleString("en-IN")} steps</td>
            <td>{senior.sleep}</td>
            <td>{formatVitals(senior.records[0])}</td>
            <td><span className={senior.medication === "Missed" ? "med-status missed" : "med-status"}>{senior.medication}</span></td>
            <td>{senior.records[0]?.note || "No note recorded"}<br /><button className="inline-action" onClick={() => onRecordCheckin(senior)}>Add care signals</button></td>
          </tr>)}
          {seniorRecords.length === 0 && <tr><td colSpan="6" className="empty-state">No wellbeing records have been added yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatVitals(record) {
  if (!record) return "Not recorded";
  const values = [record.bp && `BP ${record.bp}`, record.sugar && `Sugar ${record.sugar}`, record.spo2 && `SpO₂ ${record.spo2}%`, record.weight && `${record.weight} kg`].filter(Boolean);
  return values.length ? values.join(" · ") : "Not recorded";
}

function StatCard({ label, value, detail, icon, color }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <div className={`stat-icon ${color}`}>{icon}</div>
      </div>
      <h2>{value}</h2>
      <p>{detail}</p>
    </div>
  );
}

function PersonCell({ senior }) {
  return (
    <div className="person-cell">
      <div className="person-avatar">
        {senior.name.charAt(0)}
      </div>
      <div>
        <strong>{senior.name}</strong>
        <span>
          {senior.id} · Age {senior.age}
        </span>
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const isStable = status === "Stable";

  return (
    <span className={`status-pill ${isStable ? "stable" : "review"}`}>
      {status}
    </span>
  );
}

function AlertItem({ alert, onClick, reviewed = false }) {
  const level = alert.level.toLowerCase();

  return (
    <button className="alert-item alert-button" onClick={onClick}>
      <div className={`alert-marker marker-${level}`}>
        {level === "low" ? "✓" : "!"}
      </div>

      <div className="alert-copy">
        <strong>{alert.title}</strong>
        <p>{alert.person}</p>
        <span>
          {alert.time}
          {reviewed ? " · Reviewed" : ""}
        </span>
      </div>

      <span className={`level-tag ${level}`}>{alert.level}</span>
    </button>
  );
}

function SeniorsPage({ seniors: visibleSeniors, search, setSearch, onAddSenior, onRecordCheckin }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>Senior Directory</h3>
          <p>Search and review registered senior profiles.</p>
        </div>
        <button className="primary-button" onClick={onAddSenior}>+ Add senior</button>
      </div>

      <div className="search-row">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by senior name or ID..."
          aria-label="Search seniors"
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SENIOR ID</th>
              <th>NAME</th>
              <th>AGE</th>
              <th>ACTIVITY</th>
              <th>STEPS</th>
              <th>STATUS</th>
              <th>ACTION</th>
            </tr>
          </thead>

          <tbody>
            {visibleSeniors.map((senior) => (
              <tr key={senior.id}>
                <td>{senior.id}</td>
                <td>{senior.name}</td>
                <td>{senior.age}</td>
                <td>{senior.activity}</td>
                <td>{senior.steps.toLocaleString("en-IN")}</td>
                <td>
                  <StatusPill status={senior.status} />
                </td>
                <td><button className="inline-action" onClick={() => onRecordCheckin(senior)}>Record check-in</button></td>
              </tr>
            ))}

            {visibleSeniors.length === 0 && (
              <tr>
                <td colSpan="7" className="empty-state">
                  {visibleSeniors.length === 0 && !search
                    ? "No senior profiles yet. Add a profile to get started."
                    : "No seniors match your search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AlertsPage({ alerts: alertRecords, reviewedAlerts, onOpenAlert }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>Alert Centre</h3>
          <p>Review follow-up requests and record the action taken.</p>
        </div>
        <span className="demo-tag">{alertRecords.length} ALERTS</span>
      </div>

      <div className="alert-list">
        {alertRecords.map((alert) => (
          <AlertItem
            key={alert.id}
            alert={alert}
            reviewed={reviewedAlerts.includes(alert.id)}
            onClick={() => onOpenAlert(alert)}
          />
        ))}
        {alertRecords.length === 0 && <div className="empty-panel-state"><span>✓</span><strong>No follow-ups pending</strong><p>Requests for coordinator follow-up will appear when a senior checks in.</p></div>}
      </div>
    </section>
  );
}

function AlertModal({ alert, isReviewed, actionNote, onClose, onReview }) {
  const [action, setAction] = useState(actionNote);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="alert-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-modal-title"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">ALERT DETAILS · {alert.id}</p>
            <h2 id="alert-modal-title">{alert.title}</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="detail-row">
            <span>Senior</span>
            <strong>{alert.person}</strong>
          </div>
          <div className="detail-row">
            <span>Senior ID</span>
            <strong>{alert.seniorId}</strong>
          </div>
          <div className="detail-row">
            <span>Recorded</span>
            <strong>{alert.time}</strong>
          </div>
          <div className="detail-row">
            <span>Priority</span>
            <span className={`level-tag ${alert.level.toLowerCase()}`}>
              {alert.level}
            </span>
          </div>
          <div className="detail-row">
            <span>Review status</span>
            <strong>{isReviewed ? "Reviewed" : alert.status}</strong>
          </div>

          <div className="evidence-box">
            <strong>AI pattern and reason</strong>
            <p>{alert.reason}</p>
          </div>

          <div className="evidence-box action-box">
            <strong>Suggested follow-up</strong>
            <p>{alert.action}</p>
          </div>

          <label className="action-record-field">Action taken / follow-up note
            <textarea value={action} onChange={(event) => setAction(event.target.value)} placeholder="Write the follow-up action" disabled={isReviewed} />
          </label>
          {actionNote && <p className="saved-action-note"><strong>Recorded action:</strong> {actionNote}</p>}

          <p className="modal-disclaimer">
            AI insights support human care. They are not a diagnosis or a
            substitute for professional judgement.
          </p>
        </div>

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button
            className="primary-button"
            onClick={() => onReview(action)}
            disabled={isReviewed}
          >
            {isReviewed ? "Already Reviewed" : "Mark as Reviewed"}
          </button>
        </div>
      </section>
    </div>
  );
}

function AnalyticsPage({ seniors }) {
  const maxSteps = Math.max(1, ...seniors.map((senior) => senior.steps));

  return (
    <section className="panel analytics-panel">
      <div className="panel-heading">
        <div>
          <h3>Activity Analytics</h3>
          <p>Daily activity records for registered seniors.</p>
        </div>
        <span className="demo-tag">0 ASSESSED</span>
      </div>

      <div className="chart-content">
        {seniors.map((senior) => {
          const change = senior.baseline > 0
            ? ((senior.steps - senior.baseline) / senior.baseline) * 100
            : null;

          return (
            <div className="chart-row" key={senior.id}>
              <div className="chart-label">
                <strong>{senior.name}</strong>
                <span>
                  {senior.steps.toLocaleString("en-IN")} steps ·{" "}
                  {change === null
                    ? "Baseline not available"
                    : `${change > 0 ? "+" : ""}${change.toFixed(0)}% vs baseline`}
                </span>
              </div>

              <div className="bar-track">
                <div
                  className={`bar-fill ${
                    change !== null && change <= -30 ? "bar-warning" : ""
                  }`}
                  style={{
                    width: `${(senior.steps / maxSteps) * 100}%`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {seniors.length === 0 && <div className="empty-panel-state"><span>▥</span><strong>No activity data yet</strong><p>Activity trends will appear after senior profiles and records are added.</p></div>}
    </section>
  );
}

function SettingsPage() {
  return (
    <section className="panel analytics-placeholder">
      <div className="chart-icon">⚙</div>
      <h3>Workspace Settings</h3>
      <p>
        Coordinator preferences, account settings, and access controls can be
        configured here after the team confirms authentication requirements.
      </p>
      <span className="demo-tag">PROTOTYPE</span>
    </section>
  );
}

function SeniorForm({ onClose, onSave }) {
  const [error, setError] = useState("");

  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const age = Number(form.get("age"));
    if (!name || !age || age < 50 || age > 120) {
      setError("Enter the senior’s name and a valid age to continue.");
      return;
    }
    onSave({ name, age, city: String(form.get("city") || "").trim(), language: String(form.get("language") || "Hindi") });
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="alert-modal care-form-modal" role="dialog" aria-modal="true" aria-labelledby="senior-form-title">
      <div className="modal-header"><div><p className="eyebrow">CARE WORKSPACE</p><h2 id="senior-form-title">Add senior profile</h2></div><button className="close-button" onClick={onClose} aria-label="Close">×</button></div>
      <form onSubmit={submit}>
        <div className="care-form-grid"><label>Full name<input name="name" autoFocus placeholder="Enter name" /></label><label>Age<input name="age" type="number" min="50" max="120" placeholder="Age" /></label><label>City<input name="city" placeholder="City" /></label><label>Preferred language<select name="language"><option>Hindi</option><option>English</option><option>Hindi and English</option></select></label></div>
        <p className="care-form-privacy">Profile data stays in this browser session and clears when the page reloads. Connect a secure backend before entering real health data.</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Add profile</button></div>
      </form>
    </section>
  </div>;
}

function CheckinForm({ senior, onClose, onSave }) {
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const noteText = String(form.get("note") || "").trim();
    const followUp = form.get("followUp") === "on";
    const record = {
      steps: String(form.get("steps") || ""),
      sleepHours: String(form.get("sleepHours") || ""),
      bp: String(form.get("bp") || ""),
      sugar: String(form.get("sugar") || ""),
      spo2: String(form.get("spo2") || ""),
      weight: String(form.get("weight") || ""),
      medication: String(form.get("medication") || "Not recorded"),
      note: noteText,
      followUp,
    };
    if (!record.followUp && !record.note && !record.steps && !record.sleepHours && !record.bp && !record.sugar && !record.spo2 && !record.weight && record.medication === "Not recorded") {
      setError("Add at least one signal or note before saving.");
      return;
    }
    onSave(senior.id, record);
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="alert-modal care-form-modal" role="dialog" aria-modal="true" aria-labelledby="checkin-form-title">
      <div className="modal-header"><div><p className="eyebrow">{senior.name} · {senior.id}</p><h2 id="checkin-form-title">Record care check-in</h2></div><button className="close-button" onClick={onClose} aria-label="Close">×</button></div>
      <form onSubmit={submit}>
        <p className="care-form-section-title">Daily signals</p>
        <div className="care-form-grid care-form-grid-three"><label>Activity (steps)<input type="number" min="0" name="steps" placeholder="0" /></label><label>Sleep (hours)<input type="number" min="0" max="24" step="0.25" name="sleepHours" placeholder="0" /></label><label>Medication<select name="medication"><option value="Not recorded">Not recorded</option><option value="Taken">Taken</option><option value="Missed">Missed</option><option value="Not applicable">Not applicable</option></select></label></div>
        <p className="care-form-section-title">Vitals · optional</p>
        <div className="care-form-grid care-form-grid-four"><label>Blood pressure<input name="bp" placeholder="— / —" /></label><label>Blood sugar<input name="sugar" inputMode="decimal" placeholder="—" /></label><label>SpO₂ (%)<input name="spo2" type="number" min="0" max="100" placeholder="0" /></label><label>Weight (kg)<input name="weight" inputMode="decimal" placeholder="—" /></label></div>
        <label className="care-form-notes">Call note / wellbeing cue<textarea name="note" value={note} onChange={(event) => setNote(event.target.value)} rows="3" placeholder="Record what the senior or family reported." /></label>
        {findReportedCues(note).length > 0 && <p className="care-cue-preview"><strong>Possible cues in note:</strong> {findReportedCues(note).join(", ")} · Confirm with a human reviewer.</p>}
        <label className="care-followup-check"><input type="checkbox" name="followUp" /> Senior or family asked for a coordinator follow-up</label>
        <p className="care-form-privacy">This records reported information only. It does not diagnose or calculate a clinical risk score. Follow-up requests are routed for human review.</p>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Save check-in</button></div>
      </form>
    </section>
  </div>;
}

function findReportedCues(note) {
  const text = note.toLowerCase();
  const cuePatterns = [
    ["fall", /\bfall|fell|fallen|gir gaya|gir gayi|गिर/],
    ["pain", /\bpain|dard|दर्द/],
    ["appetite change", /appetite|not eating|khana nahi|भूख|खाना नहीं/],
    ["confusion", /confus|भ्रम|याद नहीं/],
    ["loneliness", /lonely|loneliness|akela|अकेला|अकेली/],
  ];
  return cuePatterns.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (path === "/dashboard" || path === "/admin") return <DashboardApp />;
  if (path === "/login" || path === "/register") return <LoginPage />;
  if (path === "/family") return <FamilyDashboard />;
  if (path === "/senior") return <SeniorDashboard />;
  if (path === "/operations") return <OperationsDashboard />;

  return <LandingPage />;
}

export default App;
