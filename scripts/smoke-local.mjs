import assert from "node:assert/strict";

const base = new URL(process.argv[2] || "http://127.0.0.1:5173");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname),
  "This smoke test is restricted to a local synthetic showcase.",
);
const jars = new Map();
async function api(path, role, method = "GET", body, expected = 200) {
  const headers = {};
  if (role && jars.has(role)) headers.cookie = jars.get(role);
  if (body) {
    headers["content-type"] = "application/json";
    headers.origin = base.origin;
  }
  const response = await fetch(new URL("/api/" + path, base), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${payload.error || response.status}`,
  );
  if (role && response.headers.get("set-cookie"))
    jars.set(role, response.headers.get("set-cookie").split(";")[0]);
  return payload;
}

const auth = await api("auth");
assert.equal(
  auth.localDemo,
  true,
  "Run against npm run dev or the loopback npm start preview.",
);
assert.equal(auth.authorized, false);
await api("bootstrap", null, "GET", undefined, 401);
for (const role of ["coordinator", "senior", "family", "operations"]) {
  await api("auth/local-login", role, "POST", { role });
  const overview = await api("bootstrap", role);
  assert.equal(overview.session.role, role);
  assert.equal(
    overview.seniors.length,
    ["senior", "family"].includes(role) ? 1 : 200,
  );
}
const analysis = await api("analysis/S001", "coordinator");
assert.equal(analysis.analysis.domains.length, 9);
assert.equal(analysis.analysis.forecast.points.length, 3);
const alerts = await api("alerts", "coordinator");
assert.ok(alerts.alerts.length > 0);
await api("analysis/S002", "senior", "GET", undefined, 403);
await api("session", "family", "POST", { role: "coordinator" }, 403);
await api(
  "signals",
  "family",
  "POST",
  { seniorId: "S002", type: "note", note: "This out-of-scope fixture write must be denied." },
  403,
);

const message = await api(
  "communications",
  "coordinator",
  "POST",
  {
    seniorId: "S001",
    channel: "in_app",
    recipientRole: "senior",
    template: "checkin",
    language: "hi",
  },
  201,
);
assert.equal(message.message.externalDelivery, false);
const inbox = await api("communications", "senior");
assert.ok(inbox.messages.some((row) => row.id === message.message.id));
await api(`communications/${message.message.id}`, "senior", "PATCH", {
  read: true,
});

let phone = await api("ivr?seniorId=S001&language=hi", "senior");
for (const digit of ["3", "1", "1", "2"])
  phone = await api("ivr", "senior", "POST", {
    seniorId: "S001",
    state: phone.state,
    digit,
  });
assert.equal(phone.complete, true);
assert.equal(phone.recorded, true);
assert.equal(phone.helpRequested, true);
const help = (await api("alerts", "coordinator")).alerts.find(
  (row) => row.seniorId === "S001",
);
assert.ok(help.urgent && help.helpRequested);
await api(
  `alerts/${help.id}`,
  "coordinator",
  "PATCH",
  { status: "snoozed", snoozeHours: 2 },
  409,
);

const priorConsent = (await api("seniors/S001", "coordinator")).senior
  .familyConsent;
try {
  await api("consent", "coordinator", "POST", {
    seniorId: "S001",
    allowed: false,
  });
  const revoked = await api("bootstrap", "family");
  assert.deepEqual(revoked.seniors, []);
  await api("summaries/S001", "family", "GET", undefined, 403);
} finally {
  await api("consent", "coordinator", "POST", {
    seniorId: "S001",
    allowed: priorConsent,
  });
}

const simulated = await api(
  "communications",
  "coordinator",
  "POST",
  {
    seniorId: "S001",
    channel: "sms_simulator",
    recipientRole: "senior",
    template: "followup",
    language: "en",
  },
  201,
);
assert.equal(simulated.message.status, "simulated");
assert.equal(simulated.message.externalDelivery, false);
console.log(
  "PASS: four local identities, role restrictions, nine-domain analysis, three-day projection, alerts, Hindi in-app messaging, read receipt, four-step help check-in, consent revocation, and explicitly simulated SMS.",
);
console.log(
  "This test saved synthetic messages, one phone check-in and audit events. It did not call a telephone, send SMS, use a paid API, or open a microphone.",
);
