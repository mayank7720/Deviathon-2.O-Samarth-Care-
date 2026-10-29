import test from "node:test";
import assert from "node:assert/strict";
import { LocalD1 } from "./helpers/d1.mjs";
import { handleCommunicationRoute } from "../lib/communication-routes.mjs";

const STAFF = {
  role: "coordinator",
  userId: "coordinator-1",
  name: "Care Coordinator",
  seniorId: null,
  scope: ["*"],
};
const SENIOR = {
  role: "senior",
  userId: "senior-1",
  name: "Senior",
  seniorId: "S001",
  scope: ["S001"],
};
const FAMILY = {
  role: "family",
  userId: "family-1",
  name: "Family",
  seniorId: "S001",
  scope: ["S001"],
};
const OPS = {
  role: "operations",
  userId: "operations-1",
  name: "Operations",
  seniorId: null,
  scope: ["*"],
};

function fixture() {
  const db = new LocalD1();
  for(const member of [STAFF,SENIOR,FAMILY,{...OPS,isAdmin:true}])db.db.prepare('INSERT INTO care_memberships (id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,status,is_admin,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),'primary',member.userId,`${member.userId}@example.test`,member.name,member.role,member.seniorId||'',JSON.stringify(member.scope),'active',member.isAdmin?1:0,new Date().toISOString());
  const profiles = new Map([
    ["S001", { id: "S001", name: "Synthetic One", familyConsent: true }],
    ["S002", { id: "S002", name: "Synthetic Two", familyConsent: true }],
  ]);
  const event = (
    db,
    owner,
    kind,
    seniorId,
    payload,
    id = crypto.randomUUID(),
  ) =>
    db
      .prepare(
        "INSERT INTO care_events (id,owner,kind,senior_id,payload,created_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        id,
        owner,
        kind,
        seniorId,
        JSON.stringify(payload),
        new Date().toISOString(),
      );
  async function storeMutation(db, owner, kind, seniorId, payload, actor, id) {
    await db.batch([
      event(db, owner, kind, seniorId, payload, id),
      event(db, owner, "audit", seniorId, { actor, action: kind }),
    ]);
  }
  function rows(owner = "workspace:primary") {
    return db.db
      .prepare(
        "SELECT * FROM care_events WHERE owner = ? ORDER BY created_at,rowid",
      )
      .all(owner)
      .map((row) => ({
        ...row,
        ...JSON.parse(row.payload),
        seniorId: row.senior_id,
        createdAt: row.created_at,
      }));
  }
  async function call(
    path,
    {
      method = "GET",
      body,
      session = STAFF,
      owner = "workspace:primary",
      authenticated = true,
      asOfDate,
      onMutation,
    } = {},
  ) {
    const request = new Request(`https://care.example/api/${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const response = await handleCommunicationRoute({
      path: path.split("?")[0],
      request,
      body,
      db,
      context: { authenticated, authorized: true, owner, session },
      rows: rows(owner),
      event,
      storeMutation,
      asOfDate,
      onMutation,
      getSenior(id) {
        if (!profiles.has(id))
          throw Object.assign(new Error("Senior not found"), { status: 404 });
        if (!session.scope.includes("*") && !session.scope.includes(id))
          throw Object.assign(new Error("Senior is outside your assignment"), {
            status: 403,
          });
        return profiles.get(id);
      },
    });
    return response
      ? { status: response.status, data: await response.json() }
      : null;
  }
  return { db, call, rows, profiles, event };
}

test("message delivery persists explicit simulation status and respects sender/recipient scope", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const sent = await f.call("communications", {
    method: "POST",
    body: {
      seniorId: "S001",
      channel: "sms_simulator",
      recipientRole: "senior",
      template: "checkin",
      language: "hi",
    },
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.message.status, "simulated");
  assert.equal(sent.data.message.externalDelivery, false);
  const inbox = await f.call("communications", { session: SENIOR });
  assert.equal(inbox.data.messages.length, 1);
  assert.equal(inbox.data.messages[0].senderId, STAFF.userId);
  const otherSenior = {
    ...SENIOR,
    userId: "senior-2",
    seniorId: "S002",
    scope: ["S002"],
  };
  assert.deepEqual(
    (await f.call("communications", { session: otherSenior })).data.messages,
    [],
  );
  assert.deepEqual(
    (await f.call("communications", { owner: "other-workspace" })).data
      .messages,
    [],
  );
});

test("read receipts are recipient-only and avoid overwriting message history", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const sent = await f.call("communications", {
    method: "POST",
    body: {
      seniorId: "S001",
      channel: "in_app",
      recipientRole: "senior",
      template: "followup",
    },
  });
  const id = sent.data.message.id;
  assert.equal(
    (
      await f.call(`communications/${id}`, {
        method: "PATCH",
        body: { read: true },
        session: STAFF,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(`communications/${id}`, {
        method: "PATCH",
        body: { read: true },
        session: SENIOR,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call(`communications/${id}`, {
        method: "PATCH",
        body: { read: true },
        session: SENIOR,
      })
    ).status,
    200,
  );
  const inbox = await f.call("communications", { session: SENIOR });
  assert.equal(inbox.data.messages[0].read, true);
  assert.equal(
    f.rows().filter((row) => row.kind === "communication_read").length,
    1,
  );
});

test('targeted household conversations support Operations admin, safe replies and a second linked senior',async t=>{
 const f=fixture();t.after(()=>f.db.close());
 f.db.db.prepare('INSERT INTO care_memberships (id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,status,is_admin,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),'primary','family-other','family-other@example.test','Another family member','family','S001','["S001"]','active',0,new Date().toISOString());
 const directory=await f.call('communications/recipients?seniorId=S001',{session:SENIOR});assert.equal(directory.status,200);assert.ok(directory.data.recipients.some(item=>item.userId===FAMILY.userId));assert.equal(directory.data.recipients.some(item=>item.email||item.phone),false);
 const ambiguous=await f.call('communications',{session:{...OPS,isAdmin:true},method:'POST',body:{seniorId:'S001',channel:'in_app',recipientRole:'family',template:'followup'}});assert.equal(ambiguous.status,400);
 const sent=await f.call('communications',{session:{...OPS,isAdmin:true},method:'POST',body:{seniorId:'S001',channel:'in_app',recipientRole:'family',recipientId:FAMILY.userId,template:'followup',message:'Please let us know a convenient time for a call.'}});assert.equal(sent.status,201);
 assert.equal((await f.call('communications',{session:FAMILY})).data.messages[0].isRecipient,true);
 assert.equal((await f.call('communications',{session:{...FAMILY,userId:'family-other'}})).data.messages.length,0);
 const peer=await f.call('communications',{session:SENIOR,method:'POST',body:{seniorId:'S001',channel:'in_app',recipientRole:'family',recipientId:FAMILY.userId,template:'followup',message:'I have shared today’s wellbeing update.'}});assert.equal(peer.status,201);
 const second=await f.call('communications',{session:{...FAMILY,scope:['S001','S002']},method:'POST',body:{seniorId:'S002',channel:'in_app',recipientRole:'coordinator',recipientId:STAFF.userId,template:'followup',message:'Please check on our second linked senior.'}});assert.equal(second.status,201);
});

test("family consent revocation removes inbox access and blocks new family messages", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  await f.call("communications", {
    method: "POST",
    body: {
      seniorId: "S001",
      channel: "in_app",
      recipientRole: "family",
      template: "weekly_summary",
    },
  });
  assert.equal(
    (await f.call("communications", { session: FAMILY })).data.messages.length,
    1,
  );
  f.profiles.get("S001").familyConsent = false;
  assert.deepEqual(
    (await f.call("communications", { session: FAMILY })).data.messages,
    [],
  );
  assert.equal(
    (
      await f.call("communications", {
        method: "POST",
        session: FAMILY,
        body: {
          seniorId: "S001",
          channel: "in_app",
          recipientRole: "coordinator",
          template: "followup",
          message: "Please call today.",
        },
      })
    ).status,
    403,
  );
});

test("family input creates an NLP note, while operations and diagnostic messages are rejected", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const message = {
    seniorId: "S001",
    channel: "in_app",
    recipientRole: "coordinator",
    template: "followup",
    message: "Khana kam khaya. Please check in today.",
  };
  assert.equal(
    (
      await f.call("communications", {
        method: "POST",
        session: FAMILY,
        body: message,
      })
    ).status,
    201,
  );
  assert.equal(
    f.rows().find((row) => row.kind === "signal").record.source,
    "family-message",
  );
  assert.equal(
    (
      await f.call("communications", {
        method: "POST",
        session: OPS,
        body: message,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("communications", {
        method: "POST",
        body: {
          ...message,
          recipientRole: "senior",
          message: "You have diabetes.",
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call("communications", {
        method: "POST",
        session: SENIOR,
        body: { ...message, channel: "sms_simulator" },
      })
    ).status,
    403,
  );
});

test("server-owned Hindi IVR answers finish once and open a human follow-up", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  let result = await f.call("ivr?seniorId=S001&language=hi", {
    session: SENIOR,
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.state.step, 0);
  assert.ok(result.data.state.id);
  assert.equal(result.data.state.userId, undefined);
  assert.match(result.data.prompt.prompt, /नमस्ते/u);
  let previous;
  for (const digit of ["3", "2", "2", "3"]) {
    previous = result.data.state;
    result = await f.call("ivr", {
      method: "POST",
      session: SENIOR,
      body: { seniorId: "S001", state: previous, digit },
    });
    assert.equal(result.status, 200);
  }
  assert.equal(result.data.complete, true);
  assert.equal(result.data.helpRequested, true);
  assert.match(result.data.note, /दवा नहीं ली/u);
  assert.equal(f.rows().filter((row) => row.kind === "signal").length, 1);
  assert.equal(f.rows().filter((row) => row.kind === "task").length, 1);
  assert.equal(result.data.recorded, true);
  const completedSignal = f.rows().find((row) => row.kind === "signal");
  assert.equal(completedSignal.helpRequested, true);
  assert.equal(completedSignal.mood, "help");
  assert.equal(
    (
      await f.call("ivr", {
        method: "POST",
        session: SENIOR,
        body: { seniorId: "S001", state: previous, digit: "3" },
      })
    ).status,
    409,
  );
  assert.equal(f.rows().filter((row) => row.kind === "task").length, 1);
});

test("a losing concurrent IVR answer cannot insert a contradictory follow-up", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  let response = await f.call("ivr?seniorId=S001&language=en", {
    session: SENIOR,
  });
  for (const digit of ["1", "1", "1"])
    response = await f.call("ivr", {
      method: "POST",
      session: SENIOR,
      body: { seniorId: "S001", state: response.data.state, digit },
    });
  const prior = response.data.state;
  const batch = f.db.batch.bind(f.db);
  f.db.batch = async (statements) => {
    const saved = f.rows().find((row) => row.id === prior.id).state;
    const winner = {
      ...saved,
      step: 4,
      answers: { ...saved.answers, support: "routine" },
    };
    f.db.db
      .prepare("UPDATE care_events SET payload = ? WHERE id = ?")
      .run(JSON.stringify({ state: winner }), prior.id);
    return batch(statements);
  };
  const lost = await f.call("ivr", {
    method: "POST",
    session: SENIOR,
    body: { seniorId: "S001", state: prior, digit: "3" },
  });
  assert.equal(lost.status, 409);
  assert.equal(f.rows().filter((row) => row.kind === "task").length, 0);
  assert.equal(f.rows().filter((row) => row.kind === "signal").length, 0);
});

test("IVR rejects foreign account IDs, stale cursors and unsupported roles", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const started = await f.call("ivr?seniorId=S001&language=en", {
    session: SENIOR,
  });
  const state = started.data.state;
  assert.equal(
    (
      await f.call("ivr", {
        method: "POST",
        session: STAFF,
        body: { seniorId: "S001", state, digit: "1" },
      })
    ).status,
    403,
  );
  const next = await f.call("ivr", {
    method: "POST",
    session: SENIOR,
    body: { seniorId: "S001", state, digit: "1" },
  });
  assert.equal(next.status, 200);
  assert.equal(
    (
      await f.call("ivr", {
        method: "POST",
        session: SENIOR,
        body: { seniorId: "S001", state, digit: "1" },
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.call("ivr?seniorId=S001", { session: FAMILY })).status,
    403,
  );
  assert.equal(
    (await f.call("ivr?seniorId=S001", { session: OPS })).status,
    403,
  );
});

async function newRoom(f) {
  const result = await f.call("voice/rooms", {
    method: "POST",
    body: { seniorId: "S001" },
  });
  assert.equal(result.status, 201);
  return result.data.room;
}
test("voice room keeps SDP private until a callee atomically claims the recipient slot", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const room = await newRoom(f);
  assert.equal(
    (
      await f.call(`voice/rooms/${room.id}/signal`, {
        method: "POST",
        body: { payload: { type: "offer", sdp: "synthetic-offer" } },
      })
    ).status,
    201,
  );
  const list = await f.call("voice/rooms", { session: SENIOR });
  assert.equal(list.data.rooms.length, 1);
  assert.equal(list.data.rooms[0].signals, undefined);
  assert.equal(
    (await f.call(`voice/rooms/${room.id}`, { session: SENIOR })).status,
    403,
  );
  assert.equal(
    (
      await f.call(`voice/rooms/${room.id}`, {
        method: "PATCH",
        session: SENIOR,
        body: { status: "active" },
      })
    ).status,
    200,
  );
  const other = { ...SENIOR, userId: "another-authorized-senior" };
  assert.equal(
    (
      await f.call(`voice/rooms/${room.id}`, {
        method: "PATCH",
        session: other,
        body: { status: "active" },
      })
    ).status,
    409,
  );
  const detail = await f.call(`voice/rooms/${room.id}`, { session: SENIOR });
  assert.equal(detail.data.signals[0].payload.sdp, "synthetic-offer");
  assert.equal(
    (await f.call(`voice/rooms/${room.id}`, { session: other })).status,
    403,
  );
  assert.equal(
    (await f.call(`voice/rooms/${room.id}`, { session: OPS })).status,
    403,
  );
});

test("voice offers and answers are bound to participants; End deletes signals and prevents further writes", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const room = await newRoom(f);
  await f.call(`voice/rooms/${room.id}`, {
    method: "PATCH",
    session: SENIOR,
    body: { status: "active" },
  });
  assert.equal(
    (
      await f.call(`voice/rooms/${room.id}/signal`, {
        method: "POST",
        session: SENIOR,
        body: { payload: { type: "offer", sdp: "wrong-role" } },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(`voice/rooms/${room.id}/signal`, {
        method: "POST",
        body: { payload: { type: "answer", sdp: "wrong-role" } },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(`voice/rooms/${room.id}/signal`, {
        method: "POST",
        session: SENIOR,
        body: { payload: { type: "answer", sdp: "synthetic-answer" } },
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await f.call(`voice/rooms/${room.id}/signal`, {
        method: "POST",
        session: SENIOR,
        body: { payload: { type: "answer", sdp: "duplicate-answer" } },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call(`voice/rooms/${room.id}`, {
        method: "PATCH",
        session: SENIOR,
        body: { status: "ended" },
      })
    ).status,
    200,
  );
  assert.equal(f.rows().filter((row) => row.kind === "voice_signal").length, 0);
  assert.equal(
    (
      await f.call(`voice/rooms/${room.id}/signal`, {
        method: "POST",
        body: {
          payload: {
            type: "ice",
            candidate: { candidate: "test", sdpMid: "0" },
          },
        },
      })
    ).status,
    409,
  );
});

test("voice consent revocation blocks connection data for both parties while still allowing cleanup", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const room = await newRoom(f);
  assert.equal(
    (
      await f.call(`voice/rooms/${room.id}`, {
        method: "PATCH",
        session: FAMILY,
        body: { status: "active" },
      })
    ).status,
    200,
  );
  f.profiles.get("S001").familyConsent = false;
  assert.equal((await f.call(`voice/rooms/${room.id}`)).status, 403);
  assert.equal(
    (await f.call(`voice/rooms/${room.id}`, { session: FAMILY })).status,
    403,
  );
  assert.deepEqual(
    (await f.call("voice/rooms", { session: FAMILY })).data.rooms,
    [],
  );
  assert.equal(
    (
      await f.call(`voice/rooms/${room.id}`, {
        method: "PATCH",
        session: FAMILY,
        body: { status: "ended" },
      })
    ).status,
    200,
  );
});

test("expired voice rooms never disclose connection signals and cannot be reactivated", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const room = await newRoom(f);
  f.db.db
    .prepare(
      "UPDATE care_events SET payload=json_set(payload,'$.expiresAt',?) WHERE id=?",
    )
    .run(Date.now() - 1, room.id);
  assert.deepEqual(
    (await f.call("voice/rooms", { session: SENIOR })).data.rooms,
    [],
  );
  const detail = await f.call(`voice/rooms/${room.id}`);
  assert.equal(detail.data.room.status, "ended");
  assert.deepEqual(detail.data.signals, []);
  assert.equal(
    (
      await f.call(`voice/rooms/${room.id}`, {
        method: "PATCH",
        session: SENIOR,
        body: { status: "active" },
      })
    ).status,
    410,
  );
});

test("communication routes require authentication and do not capture unrelated paths", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  assert.equal(
    (await f.call("communications", { authenticated: false })).status,
    401,
  );
  assert.equal(await f.call("unrelated"), null);
});
