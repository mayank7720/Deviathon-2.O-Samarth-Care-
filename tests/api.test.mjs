import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleApi } from "../lib/api.mjs";

// Exercise the actual SQL and authorization paths against SQLite, not mocked responses.
class LocalD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    for (const file of readdirSync("drizzle").filter((f) => f.endsWith(".sql")))
      this.db.exec(readFileSync(`drizzle/${file}`, "utf8"));
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    const wrapper = (args = []) => ({
      bind: (...values) => wrapper(values),
      all: async () => ({ results: statement.all(...args) }),
      first: async () => statement.get(...args) ?? null,
      run: async () => statement.run(...args),
    });
    return wrapper();
  }
  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
let db;
before(() => {
  db = new LocalD1();
  db.db.prepare('INSERT INTO care_workspaces(id,owner_user_id,created_at) VALUES(?,?,?)').run('primary','tester','2026-10-29');
  for(const role of ['coordinator','operations','senior','family']) {
    const linked=['senior','family'].includes(role);
    db.db.prepare('INSERT INTO care_memberships(id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('assigned-'+role,'primary','tester','owner@example.test','Assigned test user',role,linked?'S001':'',linked?'["S001"]':'["*"]',role==='operations'?1:0,'active','2026-10-29');
  }
});
after(() => db.db.close());
async function call(
  path,
  {
    method = "GET",
    body,
    cookie,
    owner = "tester",
    origin,
    local = false,
  } = {},
) {
  const headers = {
    "oai-authenticated-user-id": owner,
    "oai-authenticated-user-email":
      owner === "tester" ? "owner@example.test" : `${owner}@example.test`,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const response = await handleApi(
    new Request(`http://localhost/api/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    db,
    { local, env: { SAMARTH_BOOTSTRAP_OWNER_EMAIL: "owner@example.test" } },
  );
  return { status: response.status, data: await response.json(), response };
}
async function role(name) {
  const result = await call("session", {
    method: "POST",
    body: { role: name },
  });
  assert.equal(result.status, 200);
  return result.response.headers.get("set-cookie").split(";")[0];
}

test("bootstrap ranks all 200 synthetic seniors and reports honest model metrics", async () => {
  const { status, data } = await call("bootstrap");
  assert.equal(status, 200);
  assert.equal(data.seniors.length, 200);
  assert.ok(
    data.seniors.every((s, i, list) => !i || list[i - 1].urgencyRank < s.urgencyRank || (list[i - 1].urgencyRank === s.urgencyRank && (list[i - 1].score ?? -1) >= (s.score ?? -1))),
  );
  assert.equal(data.stats.total, 200);
  assert.ok(data.metrics.precision > 0 && data.metrics.precision <= 1);
});
test("production API requires platform identity and local showcase requires explicit login", async () => {
  const response = await handleApi(
    new Request("https://example.com/api/bootstrap"),
    db,
  );
  assert.equal(response.status, 401);
  assert.equal(
    (
      await handleApi(new Request("http://127.0.0.1/api/bootstrap"), db, {
        local: true,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await handleApi(
        new Request("https://attacker.example/api/bootstrap"),
        db,
        { local: true },
      )
    ).status,
    401,
  );
});
test("family receives only the linked consent-approved weekly summary", async () => {
  const cookie = await role("family");
  const { data } = await call("bootstrap", { cookie });
  assert.equal(data.seniors.length, 1);
  assert.equal(data.seniors[0].id, "S001");
  assert.equal(data.seniors[0].phone, undefined);
  assert.equal(data.seniors[0].latest.note, undefined);
  assert.equal(data.seniors[0].latest.vitals, undefined);
  assert.deepEqual(data.audit, []);
  assert.deepEqual(data.tasks, []);
  assert.equal((await call("seniors/S002", { cookie })).status, 403);
  assert.equal(
    (
      await call("signals", {
        cookie,
        method: "POST",
        body: { seniorId: "S001", type: "note", note: "test" },
      })
    ).status,
    403,
  );
});
test("consent revocation prevents family data access, including direct detail route", async () => {
  await call("consent", {
    method: "POST",
    body: { seniorId: "S001", allowed: false },
  });
  const cookie = await role("family");
  const { data } = await call("bootstrap", { cookie });
  assert.deepEqual(data.seniors, []);
  assert.equal(data.consentDenied, true);
  assert.equal((await call("seniors/S001", { cookie })).status, 403);
  await call("consent", {
    method: "POST",
    body: { seniorId: "S001", allowed: true },
  });
});
test("vitals, medications and bilingual note persist and rescore the selected senior", async () => {
  let result = await call("signals", {
    method: "POST",
    body: {
      seniorId: "S100",
      type: "vitals",
      vitals: { spo2: 87, systolic: 184 },
    },
  });
  assert.equal(result.status, 201);
  assert.ok(result.data.senior.score >= 60);
  result = await call("signals", {
    method: "POST",
    body: {
      seniorId: "S100",
      type: "medication",
      medication: { taken: 0, prescribed: 3 },
    },
  });
  assert.equal(result.status, 201);
  result = await call("signals", {
    method: "POST",
    body: {
      seniorId: "S100",
      type: "note",
      note: "कल गिर गई थी। Pain while walking.",
    },
  });
  assert.equal(result.status, 201);
  const detail = await call("seniors/S100");
  assert.equal(detail.data.senior.latest.vitals.spo2, 87);
  assert.equal(detail.data.senior.latest.medication.taken, 0);
  assert.ok(detail.data.senior.cues.some((c) => c.cue === "fall"));
});
test("bad values and nonexistent seniors are rejected without saving", async () => {
  assert.equal(
    (
      await call("signals", {
        method: "POST",
        body: { seniorId: "S100", type: "vitals", vitals: { spo2: 200 } },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("signals", {
        method: "POST",
        body: {
          seniorId: "S100",
          type: "medication",
          medication: { taken: 4, prescribed: 2 },
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("signals", {
        method: "POST",
        body: { seniorId: "S999", type: "note", note: "test" },
      })
    ).status,
    404,
  );
});
test('saved observations retain measurement timing and historical detail cannot reveal later days',async()=>{
 const saved=await call('signals',{method:'POST',body:{seniorId:'S105',type:'vitals',date:'2026-09-02',observationTime:'08:15',timezone:'Asia/Kolkata',vitals:{systolic:125}}});
 assert.equal(saved.status,201);
 const before=await call('seniors/S105');
 const entry=before.data.records.find(r=>r.source==='coordinator'&&r.date==='2026-09-02');
 assert.equal(entry.observedAt,'2026-09-02T02:45:00.000Z');assert.equal(entry.timePrecision,'minute');assert.ok(entry.recordedAt);assert.ok(entry.id);
 const invalid=await call('signals',{method:'POST',body:{seniorId:'S105',type:'note',date:'2026-09-02',observedAt:'2026-09-03T02:45:00Z',note:'Should not be saved'}});assert.equal(invalid.status,400);
 const ops=await role('operations');
 try{
  assert.equal((await call('runtime',{cookie:ops,method:'POST',body:{mode:'replay',date:'2026-08-31'}})).status,200);
  const history=await call('seniors/S105');assert.equal(history.status,200);assert.ok(history.data.records.every(r=>r.date<='2026-08-31'));
 }finally{assert.equal((await call('runtime',{cookie:ops,method:'POST',body:{mode:'replay',date:'2026-10-27'}})).status,200);}
});
test("care task lifecycle persists, records response outcome and audit", async () => {
  const created = await call("tasks", {
    method: "POST",
    body: { seniorId: "S001", action: "Call and verify the report" },
  });
  assert.equal(created.status, 201);
  const updated = await call(`tasks/${created.data.task.id}`, {
    method: "PATCH",
    body: { status: "completed", outcome: "Call completed; visit scheduled" },
  });
  assert.equal(updated.status, 200);
  const { data } = await call("bootstrap");
  assert.ok(
    data.tasks.some(
      (t) => t.id === created.data.task.id && t.status === "completed",
    ),
  );
  assert.ok(data.audit.some((a) => a.action === "task_updated"));
  assert.ok(data.operations.completedTasks >= 1);
});
test("uninvited visitors cannot read or modify shared care-workspace records", async () => {
  const created = await call("tasks", {
    method: "POST",
    body: { seniorId: "S003", action: "Private owner task" },
  });
  const unauthorized = await call("bootstrap", { owner: "other-owner" });
  assert.equal(unauthorized.status, 403);
  assert.equal(unauthorized.data.tasks, undefined);
  assert.equal(
    (
      await call(`tasks/${created.data.task.id}`, {
        owner: "other-owner",
        method: "PATCH",
        body: { status: "completed" },
      })
    ).status,
    403,
  );
});
test("operations administrator can manage clinical signals", async () => {
  const cookie = await role("operations");
  assert.equal((await call("bootstrap", { cookie })).status, 200);
  assert.equal(
    (
      await call("signals", {
        cookie,
        method: "POST",
        body: { seniorId: "S001", type: "note", note: "test" },
      })
    ).status,
    201,
  );
});
test("phone simulator records a Hindi help request for linked senior and opens care action", async () => {
  const cookie = await role("senior");
  const response = await call("checkin", {
    cookie,
    method: "POST",
    body: {
      mood: "help",
      language: "hi",
      channel: "phone-simulator",
      seniorId: "S999",
    },
  });
  assert.equal(response.status, 201);
  assert.equal(response.data.simulated, true);
  const { data } = await call("bootstrap");
  assert.ok(
    data.tasks.some(
      (t) => t.seniorId === "S001" && t.action.includes("help requested"),
    ),
  );
  assert.equal((await call("seniors/S001", { cookie })).status, 403);
});
test("cross-origin mutations and invalid roles are rejected", async () => {
  assert.equal(
    (await call("session", { method: "POST", body: { role: "admin" } })).status,
    400,
  );
  assert.equal(
    (
      await call("consent", {
        method: "POST",
        origin: "https://evil.example",
        body: { seniorId: "S001", allowed: false },
      })
    ).status,
    403,
  );
});
test("an expired role-selection cookie cannot grant permissions and assigned roles remain usable", async () => {
  const stale = "samarth_session=00000000-0000-4000-8000-000000000000";
  const expired = await call("bootstrap", { cookie: stale });
  assert.equal(expired.status, 200);
  assert.equal(expired.data.session.role, "operations");
  const reset = await call("session", {
    cookie: stale,
    method: "POST",
    body: { role: "coordinator" },
  });
  assert.equal(reset.status, 200);
  assert.match(
    reset.response.headers.get("set-cookie"),
    /HttpOnly; SameSite=Strict/,
  );
});

test("all five signal types feed the same personal analysis and severe sensor input enters the urgent inbox", async () => {
  const lifestyle = await call("signals", {
    method: "POST",
    body: {
      seniorId: "S199",
      type: "lifestyle",
      lifestyle: {
        steps: 550,
        sleepHours: 4,
        meals: 1,
        waterGlasses: 3,
        mood: "lonely",
        painScore: 5,
      },
    },
  });
  assert.equal(lifestyle.status, 201);
  const sensor = await call("signals", {
    method: "POST",
    body: {
      seniorId: "S199",
      type: "sensor",
      sensor: { impactG: 3.2, postureChange: true, inactiveMinutes: 210 },
    },
  });
  assert.equal(sensor.status, 201);
  assert.ok(sensor.data.senior.cues.some((cue) => cue.cue === "fall"));
  const analysis = await call("analysis/S199");
  assert.equal(analysis.status, 200);
  assert.equal(analysis.data.analysis.domains.length, 9);
  assert.equal(analysis.data.analysis.sensor.fallSuspected, true);
  const alerts = await call("alerts");
  const urgent = alerts.data.alerts.find((alert) => alert.seniorId === "S199");
  assert.ok(urgent.urgent);
  assert.equal(urgent.status, "open");
  assert.equal(
    (
      await call(`alerts/${urgent.id}`, {
        method: "PATCH",
        body: { status: "snoozed", snoozeHours: 2 },
      })
    ).status,
    409,
  );
});

test("signal date validation rejects impossible and future days without server errors", async () => {
  for (const date of ["2026-09-31", "2026-10-28", "2026-99-99", "invalid"]) {
    assert.equal(
      (
        await call("signals", {
          method: "POST",
          body: {
            seniorId: "S100",
            type: "note",
            date,
            note: "Synthetic date validation example",
          },
        })
      ).status,
      400,
    );
  }
});

test("an email-bound scoped staff invitation limits every care endpoint and export", async () => {
  const invitation = await call("access/invites", {
    method: "POST",
    body: {
      email: "scoped@example.test",
      role: "coordinator",
      scopeSeniorIds: ["S001"],
    },
  });
  assert.equal(invitation.status, 201);
  const token = new URL(invitation.data.inviteUrl).hash.split("=")[1];
  assert.equal(
    (
      await call("access/accept", {
        owner: "scoped",
        method: "POST",
        body: { token },
      })
    ).status,
    200,
  );
  const bootstrap = await call("bootstrap", { owner: "scoped" });
  assert.deepEqual(
    bootstrap.data.seniors.map((s) => s.id),
    ["S001"],
  );
  for (const path of ["seniors/S002", "analysis/S002", "summaries/S002"])
    assert.equal((await call(path, { owner: "scoped" })).status, 403);
  assert.equal(
    (
      await call("signals", {
        owner: "scoped",
        method: "POST",
        body: { seniorId: "S002", type: "note", note: "Out-of-scope change" },
      })
    ).status,
    403,
  );
  const exported = await handleApi(
    new Request("http://localhost/api/export", {
      headers: {
        "oai-authenticated-user-id": "scoped",
        "oai-authenticated-user-email": "scoped@example.test",
      },
    }),
    db,
    { env: { SAMARTH_BOOTSTRAP_OWNER_EMAIL: "owner@example.test" } },
  );
  assert.equal(exported.status, 200);
  const csv = await exported.text();
  assert.ok(csv.includes("S001"));
  assert.ok(!csv.includes("S002"));
});

test("a Hindi four-question help request stays urgent in the real API and saves exactly once", async () => {
  const cookie = await role("senior");
  let result = await call("ivr?seniorId=S001&language=hi", { cookie });
  assert.equal(result.status, 200);
  let lastState;
  for (const digit of ["3", "1", "1", "1"]) {
    lastState = result.data.state;
    result = await call("ivr", {
      cookie,
      method: "POST",
      body: { seniorId: "S001", state: lastState, digit },
    });
    assert.equal(result.status, 200);
  }
  assert.equal(result.data.recorded, true);
  assert.equal(result.data.helpRequested, true);
  const alerts = await call("alerts");
  const help = alerts.data.alerts.find((alert) => alert.seniorId === "S001");
  assert.ok(help.urgent);
  assert.ok(help.helpRequested);
  assert.equal(
    (
      await call("ivr", {
        cookie,
        method: "POST",
        body: { seniorId: "S001", state: lastState, digit: "3" },
      })
    ).status,
    409,
  );
});
