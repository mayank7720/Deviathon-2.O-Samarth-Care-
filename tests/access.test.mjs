import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalD1 } from "./helpers/d1.mjs";
import {
  getAccessContext,
  handleAccessRoute,
  canAccessSenior,
  requireAccess,
  requireAdmin,
  isWorkspaceAdmin,
  canManageCare,
} from "../lib/access.mjs";

const env = { SAMARTH_BOOTSTRAP_OWNER_EMAIL: "owner@example.test" };
function request(
  path = "auth",
  {
    userId = "owner-id",
    email = "owner@example.test",
    method = "GET",
    cookie,
    body,
  } = {},
) {
  const headers = {};
  if (userId) headers["oai-authenticated-user-id"] = userId;
  if (email) headers["oai-authenticated-user-email"] = email;
  if (cookie) headers.cookie = cookie;
  if (body) headers["content-type"] = "application/json";
  return new Request("https://care.example/api/" + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function route(db, path, options = {}) {
  const req = request(path, options);
  const context = await getAccessContext(req, db, { env });
  try {
    const response = await handleAccessRoute(
      path,
      req,
      db,
      options.body,
      context,
    );
    return {
      response,
      status: response.status,
      data: await response.json(),
      context,
    };
  } catch (error) {
    return { status: error.status, error, context };
  }
}
async function invite(
  db,
  role = "family",
  seniorId = "S001",
  email = "family@example.test",
) {
  const result = await route(db, "access/invites", {
    method: "POST",
    body: { email, role, seniorId },
  });
  assert.equal(result.status, 201);
  return { result, token: new URL(result.data.inviteUrl).hash.split("=")[1] };
}

test("anonymous access status reveals no patient records or memberships", async () => {
  const db = new LocalD1();
  try {
    const result = await route(db, "auth", { userId: null, email: null });
    assert.equal(result.status, 200);
    assert.equal(result.data.authenticated, false);
    assert.deepEqual(result.data.memberships, []);
    assert.equal(result.data.seniors, undefined);
  } finally {
    db.close();
  }
});
test("a signed-in stranger cannot bootstrap themselves or choose a privileged role", async () => {
  const db = new LocalD1();
  try {
    const result = await route(db, "auth", {
      userId: "stranger",
      email: "stranger@example.test",
    });
    assert.equal(result.data.authorized, false);
    assert.equal(result.data.needsInvitation, true);
    const select = await route(db, "session", {
      userId: "stranger",
      email: "stranger@example.test",
      method: "POST",
      body: { role: "coordinator" },
    });
    assert.equal(select.status, 403);
  } finally {
    db.close();
  }
});
test("only the verified configured site-owner email initializes the workspace", async () => {
  const db = new LocalD1();
  try {
    await route(db, "auth", {
      userId: "stranger",
      email: "stranger@example.test",
    });
    assert.equal(
      db.db.prepare("SELECT count(*) count FROM care_workspaces").get().count,
      0,
    );
    const owner = await route(db, "auth");
    assert.equal(owner.data.authorized, true);
    assert.equal(owner.data.memberships.length, 1);
    assert.ok(owner.data.session.isAdmin);
    assert.equal(owner.data.session.role, "operations");
    assert.deepEqual(owner.data.session.availableRoles, ["operations"]);
  } finally {
    db.close();
  }
});
test("owner-email configuration cannot take over an already initialized workspace", async () => {
  const db = new LocalD1();
  try {
    await route(db, "auth");
    const context = await getAccessContext(
      request("auth", { userId: "new-owner", email: "new@example.test" }),
      db,
      { env: { SAMARTH_BOOTSTRAP_OWNER_EMAIL: "new@example.test" } },
    );
    assert.equal(context.authorized, false);
  } finally {
    db.close();
  }
});
test("invitation stores a hash and is bound to email, role and senior", async () => {
  const db = new LocalD1();
  try {
    await route(db, "auth");
    const { result, token } = await invite(db);
    assert.equal(token.length, 64);
    const stored = db.db
      .prepare("SELECT * FROM care_invitations WHERE id=?")
      .get(result.data.id);
    assert.notEqual(stored.token_hash, token);
    assert.equal(stored.senior_id, "S001");
    assert.equal(result.data.emailSent, false);
    const wrong = await route(db, "access/accept", {
      method: "POST",
      userId: "other",
      email: "other@example.test",
      body: { token },
    });
    assert.equal(wrong.status, 403);
    const accepted = await route(db, "access/accept", {
      method: "POST",
      userId: "family-id",
      email: "family@example.test",
      body: { token },
    });
    assert.equal(accepted.status, 200);
    const auth = await route(db, "auth", {
      userId: "family-id",
      email: "family@example.test",
    });
    assert.equal(auth.data.session.role, "family");
    assert.equal(auth.data.session.seniorId, "S001");
    assert.ok(!auth.data.session.isAdmin);
    assert.ok(canAccessSenior(auth.context, "S001"));
    assert.ok(!canAccessSenior(auth.context, "S002"));
  } finally {
    db.close();
  }
});
test("accepted invitations cannot be replayed and expired invitations cannot be claimed", async () => {
  const db = new LocalD1();
  try {
    await route(db, "auth");
    const { token } = await invite(db);
    const options = {
      method: "POST",
      userId: "family-id",
      email: "family@example.test",
      body: { token },
    };
    assert.equal((await route(db, "access/accept", options)).status, 200);
    assert.equal((await route(db, "access/accept", options)).status, 410);
    const next = await invite(db, "senior", "S002", "senior@example.test");
    db.db
      .prepare("UPDATE care_invitations SET expires_at=0 WHERE id=?")
      .run(next.result.data.id);
    assert.equal(
      (
        await route(db, "access/accept", {
          method: "POST",
          userId: "senior-id",
          email: "senior@example.test",
          body: { token: next.token },
        })
      ).status,
      410,
    );
  } finally {
    db.close();
  }
});
test("assigned family role cannot become staff by changing a cookie or selector", async () => {
  const db = new LocalD1();
  try {
    await route(db, "auth");
    const { token } = await invite(db);
    await route(db, "access/accept", {
      method: "POST",
      userId: "family-id",
      email: "family@example.test",
      body: { token },
    });
    const selected = await route(db, "session", {
      method: "POST",
      userId: "family-id",
      email: "family@example.test",
      body: { role: "operations" },
    });
    assert.equal(selected.status, 403);
    const auth = await route(db, "auth", {
      userId: "family-id",
      email: "family@example.test",
      cookie: "samarth_session=coordinator; samarth_demo=coordinator",
    });
    assert.equal(auth.data.session.role, "family");
  } finally {
    db.close();
  }
});
test("revoking a membership takes effect even if a role-selection session still exists", async () => {
  const db = new LocalD1();
  try {
    await route(db, "auth");
    const { token } = await invite(db);
    await route(db, "access/accept", {
      method: "POST",
      userId: "family-id",
      email: "family@example.test",
      body: { token },
    });
    const selected = await route(db, "session", {
      method: "POST",
      userId: "family-id",
      email: "family@example.test",
      body: { role: "family" },
    });
    const cookie = selected.response.headers.get("set-cookie").split(";")[0];
    const member = db.db
      .prepare("SELECT id FROM care_memberships WHERE user_id='family-id'")
      .get();
    assert.equal(
      (
        await route(db, `access/members/${member.id}`, {
          method: "PATCH",
          body: { status: "revoked" },
        })
      ).status,
      200,
    );
    const context = await getAccessContext(
      request("auth", {
        userId: "family-id",
        email: "family@example.test",
        cookie,
      }),
      db,
      { env },
    );
    assert.equal(context.authorized, false);
    assert.throws(() => requireAccess(context), /invitation/);
  } finally {
    db.close();
  }
});
test("members cannot list access records, create invitations or revoke the owner", async () => {
  const db = new LocalD1();
  try {
    await route(db, "auth");
    const { token } = await invite(db);
    await route(db, "access/accept", {
      method: "POST",
      userId: "family-id",
      email: "family@example.test",
      body: { token },
    });
    assert.equal(
      (
        await route(db, "access", {
          userId: "family-id",
          email: "family@example.test",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await route(db, "access/invites", {
          method: "POST",
          userId: "family-id",
          email: "family@example.test",
          body: { email: "x@example.test", role: "coordinator" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await route(db, "access/members/owner-operations", {
          method: "PATCH",
          body: { status: "revoked" },
        })
      ).status,
      409,
    );
  } finally {
    db.close();
  }
});
test("local fixture logins only work on explicit loopback development, not the hosted app", async () => {
  const db = new LocalD1();
  try {
    const hosted = await route(db, "auth/local-login", {
      method: "POST",
      body: { role: "coordinator" },
      userId: null,
      email: null,
    });
    assert.equal(hosted.status, 404);
    const req = new Request("http://127.0.0.1/api/auth/local-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "senior" }),
    });
    const context = await getAccessContext(req, db, { local: true });
    const response = await handleAccessRoute(
      "auth/local-login",
      req,
      db,
      { role: "senior" },
      context,
    );
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const selected = await getAccessContext(
      new Request("http://127.0.0.1/api/auth", { headers: { cookie } }),
      db,
      { local: true },
    );
    assert.equal(selected.session.role, "senior");
    assert.ok(!selected.session.isAdmin);
    const notLocal = await getAccessContext(
      new Request("https://care.example/api/auth", { headers: { cookie } }),
      db,
      { local: true },
    );
    assert.equal(notLocal.authorized, false);
  } finally {
    db.close();
  }
});

test('an explicitly empty coordinator scope cannot become wildcard access',async()=>{
 const db=new LocalD1();
 try {
  await route(db,'auth');
  const result=await route(db,'access/invites',{method:'POST',body:{email:'scoped@example.test',role:'coordinator',scopeSeniorIds:[]}});
  assert.equal(result.status,400);
  assert.equal((await db.prepare('SELECT * FROM care_invitations').all()).results.length,0);
 }finally{db.close();}
});
test('duplicate invitations do not create duplicate active grants and revocation removes historical duplicates',async()=>{
 const db=new LocalD1();
 try {
  await route(db,'auth');
  for(let i=0;i<2;i++) {
   const {token}=await invite(db);
   assert.equal((await route(db,'access/accept',{method:'POST',userId:'family-id',email:'family@example.test',body:{token}})).status,200);
  }
  let members=(await db.prepare("SELECT * FROM care_memberships WHERE user_id='family-id' AND status='active'").all()).results;
  assert.equal(members.length,1);
  const m=members[0];
  await db.prepare('INSERT INTO care_memberships (id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind('legacy-duplicate',m.workspace_id,m.user_id,m.email,m.display_name,m.role,m.senior_id,m.scope_json,0,'active',m.created_at).run();
  assert.equal((await route(db,`access/members/${m.id}`,{method:'PATCH',body:{status:'revoked'}})).status,200);
  members=(await db.prepare("SELECT * FROM care_memberships WHERE user_id='family-id' AND status='active'").all()).results;
  assert.equal(members.length,0);
  assert.equal((await route(db,'auth',{userId:'family-id',email:'family@example.test'})).context.authorized,false);
 }finally{db.close();}
});

test('only an operations administrator has administration; care management does not imply account management', () => {
  const coordinator = { role: 'coordinator', isAdmin: true };
  const operations = { role: 'operations', isAdmin: false };
  const administrator = { role: 'operations', isAdmin: true };
  assert.equal(isWorkspaceAdmin(coordinator), false);
  assert.equal(isWorkspaceAdmin(operations), false);
  assert.equal(isWorkspaceAdmin(administrator), true);
  assert.equal(canManageCare(coordinator), true);
  assert.equal(canManageCare(administrator), true);
  assert.equal(canManageCare(operations), false);
  assert.equal(canManageCare({ role: 'family', isAdmin: true }), false);
  assert.throws(() => requireAdmin({ authenticated: true, authorized: true, session: coordinator }), error => error.status === 403);
  assert.doesNotThrow(() => requireAdmin({ authenticated: true, authorized: true, session: administrator }));
});

test('invited staff cannot promote themselves or manage invitations and memberships', async () => {
  const db = new LocalD1();
  try {
    await route(db, 'auth');
    for (const role of ['coordinator']) {
      const email = `${role}@example.test`, userId = `invited-${role}`;
      const { token } = await invite(db, role, '', email);
      assert.equal((await route(db, 'access/accept', { method: 'POST', userId, email, body: { token, isAdmin: true } })).status, 200);
      const auth = await route(db, 'auth', { userId, email });
      assert.equal(auth.data.session.isAdmin, false);
      assert.equal((await route(db, 'access', { userId, email })).status, 403);
      assert.equal((await route(db, 'access/invites', { method: 'POST', userId, email, body: { email: 'next@example.test', role: 'operations', isAdmin: true } })).status, 403);
      assert.equal((await route(db, 'access/members/owner-operations', { method: 'PATCH', userId, email, body: { status: 'revoked' } })).status, 403);
    }
  } finally { db.close(); }
});

test('one family account sees the union of active senior links and loses a revoked link immediately', async () => {
  const db = new LocalD1();
  const family = { userId: 'family-two', email: 'two@example.test' };
  try {
    await route(db, 'auth');
    for (const seniorId of ['S001', 'S002']) {
      const { token } = await invite(db, 'family', seniorId, family.email);
      assert.equal((await route(db, 'access/accept', { ...family, method: 'POST', body: { token } })).status, 200);
    }
    // A family link names one senior; a legacy wildcard must never add others.
    db.db.prepare("UPDATE care_memberships SET scope_json='[\"*\"]' WHERE user_id='family-two'").run();
    const auth = await route(db, 'auth', family);
    assert.deepEqual(auth.data.session.scope.sort(), ['S001', 'S002']);
    assert.equal(canAccessSenior(auth.context, 'S003'), false);
    const selected = await route(db, 'session', { ...family, method: 'POST', body: { role: 'family', seniorId: 'S002' } });
    assert.deepEqual(selected.data.session.scope.sort(), ['S001', 'S002']);
    const cookie = selected.response.headers.get('set-cookie').split(';')[0];
    const first = db.db.prepare("SELECT id FROM care_memberships WHERE user_id='family-two' AND senior_id='S001'").get();
    assert.equal((await route(db, `access/members/${first.id}`, { method: 'PATCH', body: { status: 'revoked' } })).status, 200);
    const after = await route(db, 'auth', { ...family, cookie });
    assert.equal(after.data.session.seniorId, 'S002');
    assert.deepEqual(after.data.session.scope, ['S002']);
    assert.equal(canAccessSenior(after.context, 'S001'), false);
    assert.equal(canAccessSenior(after.context, 'S002'), true);
  } finally { db.close(); }
});

test('a senior membership remains single-senior even if its legacy stored scope is broad', async () => {
  const db = new LocalD1();
  const senior = { userId: 'single-senior', email: 'single@example.test' };
  try {
    await route(db, 'auth');
    const { token } = await invite(db, 'senior', 'S001', senior.email);
    await route(db, 'access/accept', { ...senior, method: 'POST', body: { token } });
    db.db.prepare("UPDATE care_memberships SET scope_json='[\"*\",\"S002\"]',is_admin=1 WHERE user_id='single-senior'").run();
    const auth = await route(db, 'auth', senior);
    assert.deepEqual(auth.data.session.scope, ['S001']);
    assert.equal(auth.data.session.isAdmin, false);
    assert.equal(canAccessSenior(auth.context, 'S002'), false);
  } finally { db.close(); }
});

test('local operations is the only administrator and older fixture flags are repaired', async () => {
  const db = new LocalD1();
  const local = role => new Request('http://localhost/api/auth', { headers: { cookie: `samarth_local=${role}` } });
  try {
    let coordinator = await getAccessContext(local('coordinator'), db, { local: true });
    assert.equal(coordinator.session.isAdmin, false);
    db.db.prepare("UPDATE care_memberships SET is_admin=CASE WHEN role='coordinator' THEN 1 ELSE 0 END WHERE id like 'fixture-%'").run();
    const operations = await getAccessContext(local('operations'), db, { local: true });
    coordinator = await getAccessContext(local('coordinator'), db, { local: true });
    assert.equal(operations.session.isAdmin, true);
    assert.equal(coordinator.session.isAdmin, false);
    assert.doesNotThrow(() => requireAdmin(operations));
    assert.throws(() => requireAdmin(coordinator), error => error.status === 403);
    assert.equal(db.db.prepare('SELECT count(*) count FROM care_memberships WHERE is_admin=1').get().count, 1);
  } finally { db.close(); }
});


test('Operations account creation cannot be granted through an invitation',async()=>{const db=new LocalD1();try{await route(db,'auth');const result=await route(db,'access/invites',{method:'POST',body:{email:'extra@example.test',role:'operations'}});assert.equal(result.status,400);}finally{db.close();}});
