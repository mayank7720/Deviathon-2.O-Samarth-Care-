/** Identity comes from the configured auth provider; stored memberships authorize every request. */
import {handleHouseholdRoute} from './household-routes.mjs';
export const ACCESS_ROLES = ["coordinator", "senior", "family", "operations"];
const WORKSPACE = "primary";
const DATA_OWNER = "workspace:primary";
const LOCAL = {
  coordinator: {
    name: "Ananya Sharma",
    email: "coordinator@samarth.test",
    admin: false,
  },
  operations: {
    name: "Rohan Mehta",
    email: "operations@samarth.test",
    admin: true,
  },
  senior: { name: "Meera Sharma", email: "senior@samarth.test", admin: false },
  family: { name: "Riya Sharma", email: "family@samarth.test", admin: false },
};
const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const reply = (value, status = 200, extra = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, ...extra },
  });
export class AccessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const check = (condition, status, message) => {
  if (!condition) throw new AccessError(status, message);
};
const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";
function cookieValue(request, name) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="))
    ?.slice(name.length + 1);
}
const secureCookie = (request, name, value, age = 86400) =>
  `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
function memberValue(row) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.display_name,
    role: row.role,
    seniorId: row.senior_id || null,
    scope: JSON.parse(row.scope_json || "[]"),
    isAdmin: row.role === "operations" && !!row.is_admin,
    status: row.status,
    createdAt: row.created_at,
  };
}
function memberInsert(
  db,
  {
    id,
    userId,
    email,
    name,
    role,
    seniorId = "",
    scope = ["*"],
    isAdmin = false,
  },
) {
  return db
    .prepare(
      "INSERT OR IGNORE INTO care_memberships (id,workspace_id,user_id,email,display_name,role,senior_id,scope_json,is_admin,status,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM care_memberships WHERE workspace_id = ? AND user_id = ? AND role = ? AND senior_id = ? AND status = 'active')",
    )
    .bind(
      id,
      WORKSPACE,
      userId,
      email,
      name,
      role,
      seniorId,
      JSON.stringify(scope),
      isAdmin ? 1 : 0,
      "active",
      new Date().toISOString(),
      WORKSPACE,
      userId,
      role,
      seniorId,
    );
}
async function localFixture(db) {
  const statements = [
    db
      .prepare(
        "INSERT OR IGNORE INTO care_workspaces (id,owner_user_id,created_at) VALUES (?,?,?)",
      )
      .bind(WORKSPACE, "local-operations", new Date().toISOString()),
  ];
  for (const [role, profile] of Object.entries(LOCAL)) {
    statements.push(
      memberInsert(db, {
        id: `fixture-${role}`,
        userId: `local-${role}`,
        email: profile.email,
        name: profile.name,
        role,
        seniorId: ["senior", "family"].includes(role) ? "S001" : "",
        scope: ["senior", "family"].includes(role) ? ["S001"] : ["*"],
        isAdmin: profile.admin,
      }),
    );
    // Keep older local fixtures aligned with the same administration hierarchy.
    statements.push(db.prepare("UPDATE care_memberships SET is_admin = ? WHERE id = ? AND user_id = ?")
      .bind(profile.admin ? 1 : 0, `fixture-${role}`, `local-${role}`));
  }
  await db.batch(statements);
}
async function initializeOwner(db, identity, email) {
  if (!email || normalizeEmail(identity.email) !== normalizeEmail(email))
    return;
  let workspace = await db
    .prepare("SELECT * FROM care_workspaces WHERE id = ?")
    .bind(WORKSPACE)
    .first();
  if (workspace) return;
  const statements = [
    db
      .prepare(
        "INSERT OR IGNORE INTO care_workspaces (id,owner_user_id,created_at) VALUES (?,?,?)",
      )
      .bind(WORKSPACE, identity.userId, new Date().toISOString()),
  ];
  // Account administration belongs to the operations owner, not a care role.
  statements.push(
      memberInsert(db, {
        id: "owner-operations",
        userId: identity.userId,
        email: normalizeEmail(identity.email),
        name: identity.name,
        role: "operations",
        scope: ["*"],
        isAdmin: true,
      }),
    );
  statements.push(
    db
      .prepare("UPDATE care_events SET owner = ? WHERE owner = ?")
      .bind(DATA_OWNER, identity.userId),
  );
  await db.batch(statements);
}
export async function getAccessContext(
  request,
  db,
  { local = false, env = {}, identity: verifiedIdentity = null, authMode = "sites" } = {},
) {
  const url = new URL(request.url);
  const localDemo =
    local && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  let identity = null;
  if (localDemo) {
    await localFixture(db);
    const role = cookieValue(request, "samarth_local");
    if (LOCAL[role])
      identity = {
        userId: `local-${role}`,
        email: LOCAL[role].email,
        name: LOCAL[role].name,
      };
  } else if (authMode === "supabase") {
    identity = verifiedIdentity;
    if (identity && typeof db.bootstrapOwner === 'function') await db.bootstrapOwner();
  } else {
    const userId = request.headers.get("oai-authenticated-user-id");
    if (userId) {
      const email = request.headers.get("oai-authenticated-user-email") || "";
      let name =
        request.headers.get("oai-authenticated-user-full-name") ||
        email.split("@")[0] ||
        "Care workspace member";
      if (
        request.headers.get("oai-authenticated-user-full-name-encoding") ===
        "percent-encoded-utf-8"
      ) {
        try {
          name = decodeURIComponent(name);
        } catch {}
      }
      identity = { userId, email: normalizeEmail(email), name };
      await initializeOwner(db, identity, env.SAMARTH_BOOTSTRAP_OWNER_EMAIL);
    }
  }
  const result = identity
    ? await db
        .prepare(
          "SELECT * FROM care_memberships WHERE workspace_id = ? AND user_id = ? AND status = ? ORDER BY created_at,id",
        )
        .bind(WORKSPACE, identity.userId, "active")
        .all()
    : { results: [] };
  const memberships = result.results.map(memberValue);
  const accountStatus=identity&&typeof db.accountStatus==='function'?await db.accountStatus():null;
  let selected =
    memberships.find(isWorkspaceAdmin) || memberships.find((m) => m.role === "coordinator") || memberships[0] || null;
  const token = cookieValue(request, "samarth_session");
  if (identity && token && /^[a-f0-9-]{36}$/i.test(token)) {
    const saved = await db
      .prepare(
        "SELECT * FROM demo_sessions WHERE id = ? AND owner = ? AND expires_at > ?",
      )
      .bind(token, identity.userId, Date.now())
      .first();
    if (saved)
      selected =
        memberships.find(
          (m) =>
            m.role === saved.role &&
            (m.seniorId || "") === (saved.senior_id || ""),
        ) || selected;
  }
  const session = selected
    ? {
        role: selected.role,
        name: selected.name || identity.name,
        userId: identity.userId,
        seniorId: selected.seniorId,
        isAdmin: isWorkspaceAdmin(selected),
        scope: membershipScope(memberships, selected),
        availableRoles: [...new Set(memberships.map((m) => m.role))],
        demoOnly: localDemo,
        localDemo,
    authMode: localDemo ? 'local' : authMode,
      }
    : null;
  const workspace = !identity && authMode === 'supabase' ? {id: WORKSPACE} : await db
    .prepare("SELECT id FROM care_workspaces WHERE id = ?")
    .bind(WORKSPACE)
    .first();
  return {
    identity,
    userId: identity?.userId,
    authenticated: !!identity,
    authorized: !!session,
    session,
    memberships,
    accountStatus,
    workspaceId: WORKSPACE,
    owner: DATA_OWNER,
    localDemo,
    needsInvitation: !!identity && !session,
    setupRequired: !workspace && !localDemo,
    authMode: localDemo ? 'local' : authMode,
    signInUrl: authMode === 'supabase' ? '/sign-in' : "/signin-with-chatgpt?return_to=%2F",
    signOutUrl: authMode === 'supabase' ? '/' : "/signout-with-chatgpt?return_to=%2F",
    allowSignup: authMode === 'supabase' && env.SAMARTH_ALLOW_SIGNUP === 'true',
  };
}
export function requireAccess(context) {
  check(context.authenticated, 401, "Sign in to access the care workspace.");
  check(context.authorized, 403, "This account needs a care-team invitation.");
}
export function requireAdmin(context) {
  requireAccess(context);
  check(
    isWorkspaceAdmin(context.session),
    403,
    "Only the operations administrator can manage accounts.",
  );
}
export function isWorkspaceAdmin(session) {
  return session?.role === "operations" && session.isAdmin === true;
}
export function canManageCare(session) {
  return session?.role === "coordinator" || isWorkspaceAdmin(session);
}
function membershipScope(memberships, selected) {
  if (selected.role === "family") {
    return [...new Set(memberships
      .filter(member => member.role === "family" && member.status === "active")
      .map(member => member.seniorId)
      .filter(id => /^S\d{3,6}$/.test(id || "")))];
  }
  if (selected.role === "senior") return selected.seniorId ? [selected.seniorId] : [];
  return selected.scope;
}
export function canAccessSenior(context, id) {
  if (!context.session) return false;
  return (
    context.session.scope.includes("*") ||
    context.session.seniorId === id ||
    context.session.scope.includes(id)
  );
}
async function digest(token) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function audit(db, context, action, detail) {
  await db
    .prepare(
      "INSERT INTO care_events (id,owner,kind,senior_id,payload,created_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      DATA_OWNER,
      "audit",
      "",
      JSON.stringify({ action, actor: context.identity.name, detail }),
      new Date().toISOString(),
    )
    .run();
}
export async function handleAccessRoute(path, request, db, body, context) {
  const household=await handleHouseholdRoute(path,request,db,body,context);
  if(household)return household;
  if (path === "auth" && request.method === "GET")
    return reply({
      authenticated: context.authenticated,
      authorized: context.authorized,
      identity: context.identity
        ? { name: context.identity.name, email: context.identity.email }
        : null,
      memberships: context.memberships,
      accountStatus: context.accountStatus,
      session: context.session,
      activeRole: context.session?.role,
      needsInvitation: context.needsInvitation,
      setupRequired: context.setupRequired,
      localDemo: context.localDemo,
      authMode: context.authMode,
      allowSignup: context.authMode === 'supabase' && context.allowSignup === true,
      signInUrl: context.signInUrl,
      signOutUrl: context.signOutUrl,
    });
  if (path === "auth/local-login" && request.method === "POST") {
    check(
      context.localDemo,
      404,
      "Local showcase accounts are unavailable on this host.",
    );
    check(LOCAL[body.role], 400, "Choose a valid showcase role.");
    return reply({ ok: true, role: body.role }, 200, {
      "set-cookie": secureCookie(request, "samarth_local", body.role),
    });
  }
  if (path === "auth/logout" && request.method === "POST") {
    const token = cookieValue(request, "samarth_session");
    if (token && context.userId)
      await db
        .prepare("DELETE FROM demo_sessions WHERE id = ? AND owner = ?")
        .bind(token, context.userId)
        .run();
    const response = reply({
      ok: true,
        signOutUrl: context.localDemo || context.authMode === 'supabase'
        ? "/"
        : "/signout-with-chatgpt?return_to=%2F",
    });
    response.headers.append(
      "set-cookie",
      secureCookie(request, "samarth_session", "", 0),
    );
    response.headers.append(
      "set-cookie",
      secureCookie(request, "samarth_local", "", 0),
    );
    response.headers.append(
      "set-cookie",
      secureCookie(request, "samarth_demo", "", 0),
    );
    return response;
  }
  if (path === "session" && request.method === "POST") {
    requireAccess(context);
    check(ACCESS_ROLES.includes(body.role), 400, "Unknown role.");
    const membership = context.memberships.find(
      (m) =>
        m.role === body.role &&
        (!body.seniorId || m.seniorId === body.seniorId),
    );
    check(membership, 403, "This role has not been assigned to your account.");
    const token = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          "DELETE FROM demo_sessions WHERE owner = ? AND expires_at <= ?",
        )
        .bind(context.userId, Date.now()),
      db
        .prepare(
          "INSERT INTO demo_sessions (id,owner,role,senior_id,expires_at) VALUES (?,?,?,?,?)",
        )
        .bind(
          token,
          context.userId,
          membership.role,
          membership.seniorId || "",
          Date.now() + 86400000,
        ),
    ]);
    return reply(
      {
        ok: true,
        session: {
          ...context.session,
          role: membership.role,
          seniorId: membership.seniorId,
          scope: membershipScope(context.memberships, membership),
          isAdmin: isWorkspaceAdmin(membership),
        },
      },
      200,
      { "set-cookie": secureCookie(request, "samarth_session", token) },
    );
  }
  if (path === "access" && request.method === "GET") {
    requireAdmin(context);
    if(typeof db.accessDirectory==='function')return reply(await db.accessDirectory());
    const [members, invites] = await Promise.all([
      db
        .prepare(
          "SELECT * FROM care_memberships WHERE workspace_id = ? ORDER BY created_at DESC",
        )
        .bind(WORKSPACE)
        .all(),
      db
        .prepare(
          "SELECT id,email,role,senior_id,status,expires_at,created_at FROM care_invitations WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(WORKSPACE)
        .all(),
    ]);
    return reply({
      members: members.results.map(memberValue),
      invites: invites.results.map((r) => ({
        ...r,
        seniorId: r.senior_id,
        expiresAt: r.expires_at,
        status:
          r.status === "pending" && r.expires_at < Date.now()
            ? "expired"
            : r.status,
      })),
    });
  }
  if (path === "access/invites" && request.method === "POST") {
    requireAdmin(context);
    const email = normalizeEmail(body.email);
    check(
      email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      400,
      "Enter a valid account email.",
    );
    check(['senior','family','coordinator'].includes(body.role), 400, "Choose senior, family or coordinator access. Operations is the sole administrator.");
    const linked = ["senior", "family"].includes(body.role);
    check(
      !linked || /^S\d{3,6}$/.test(body.seniorId || ""),
      400,
      "Select the senior linked to this account.",
    );
    let scope = linked ? [body.seniorId] : ["*"];
    if (!linked && body.scopeSeniorIds !== undefined) {
      check(
        Array.isArray(body.scopeSeniorIds) && body.scopeSeniorIds.length > 0 && body.scopeSeniorIds.length <= 200 &&
          body.scopeSeniorIds.every((id) => /^S\d{3,6}$/.test(id)),
        400,
        "Invalid care scope.",
      );
      scope = [...new Set(body.scopeSeniorIds)];
    }
    const token = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const id = crypto.randomUUID(),
      expiresAt = Date.now() + 7 * 86400000;
    if(typeof db.manageInvitation==='function'){
      await db.manageInvitation({action:'create',invitationId:id,details:{email,role:body.role,seniorId:linked?body.seniorId:'',scope,tokenHash:await digest(token),expiresAt}});
      return reply({ok:true,id,inviteUrl:new URL('/invitations?role='+body.role+'#invite='+token,request.url).toString(),expiresAt,email,role:body.role,emailSent:false},201);
    }
    await db
      .prepare(
        "INSERT INTO care_invitations (id,workspace_id,token_hash,email,role,senior_id,scope_json,created_by,status,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        WORKSPACE,
        await digest(token),
        email,
        body.role,
        linked ? body.seniorId : "",
        JSON.stringify(scope),
        context.userId,
        "pending",
        expiresAt,
        new Date().toISOString(),
      )
      .run();
    await audit(
      db,
      context,
      "invitation_created",
      `Invitation created for ${body.role}; no email was sent.`,
    );
    return reply(
      {
        ok: true,
        id,
        inviteUrl: new URL("/invitations?role=" + body.role + "#invite=" + token, request.url).toString(),
        expiresAt,
        email,
        role: body.role,
        emailSent: false,
      },
      201,
    );
  }
  const managedInvite=/^access\/invites\/([a-f0-9-]{36})$/i.exec(path);
  if(managedInvite&&['PATCH','DELETE'].includes(request.method)){
    requireAdmin(context);
    check(typeof db.manageInvitation==='function',503,'Invitation management requires the cloud care service.');
    if(request.method==='DELETE'||body?.action==='revoke')return reply(await db.manageInvitation({action:request.method==='DELETE'?'delete':'revoke',invitationId:managedInvite[1],details:{}}));
    const email=normalizeEmail(body?.email),role=body?.role,linked=['senior','family'].includes(role);
    check(email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'Enter a valid account email.');
    check(['senior','family','coordinator'].includes(role),400,'Choose senior, family or coordinator access.');
    check(!linked||/^S\d{3,6}$/.test(body.seniorId||''),400,'Choose an existing senior.');
    const scope=linked?[body.seniorId]:body.scopeSeniorIds||['*'];
    check(Array.isArray(scope)&&scope.length>0&&scope.length<=200&&scope.every(id=>id==='*'&&!linked||/^S\d{3,6}$/.test(id)),400,'Invalid care scope.');
    const token=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join(''),expiresAt=Date.now()+7*86400000;
    await db.manageInvitation({action:'update',invitationId:managedInvite[1],details:{email,role,seniorId:linked?body.seniorId:'',scope,tokenHash:await digest(token),expiresAt}});
    return reply({ok:true,inviteUrl:new URL('/invitations?role='+body.role+'#invite='+token,request.url).toString(),expiresAt,emailSent:false});
  }
  if (path === "access/accept" && request.method === "POST") {
    check(
      context.authenticated,
      401,
      "Sign in with the invited email before accepting.",
    );
    check(
      typeof body.token === "string" && /^[a-f0-9]{64}$/.test(body.token),
      400,
      "Invalid invitation link.",
    );
    if (typeof db.acceptInvitation === 'function') {
      const accepted = await db.acceptInvitation({ tokenHash: await digest(body.token), displayName: context.identity.name });
      check(accepted?.ok, 410, 'This invitation has expired or was already used.');
      // The checked claim transaction records the audit alongside the membership.
      return reply({ok:true,role:accepted.role});
    }
    const invitation = await db
      .prepare(
        "SELECT * FROM care_invitations WHERE token_hash = ? AND workspace_id = ?",
      )
      .bind(await digest(body.token), WORKSPACE)
      .first();
    check(
      invitation &&
        invitation.status === "pending" &&
        invitation.expires_at > Date.now(),
      410,
      "This invitation has expired or was already used.",
    );
    check(
      normalizeEmail(context.identity.email) === invitation.email,
      403,
      "Sign in using the email this invitation was issued to.",
    );
    const id = `invite-${invitation.id}`;
    const result = await db.batch([
      db
        .prepare(
          "UPDATE care_invitations SET status = ?, redeemed_by = ? WHERE id = ? AND status = ?",
        )
        .bind("accepted", context.userId, invitation.id, "pending"),
      memberInsert(db, {
        id,
        userId: context.userId,
        email: context.identity.email,
        name: context.identity.name,
        role: invitation.role,
        seniorId: invitation.senior_id,
        scope: JSON.parse(invitation.scope_json),
      }),
    ]);
    check(Number(result[0]?.meta?.changes ?? result[0]?.changes ?? 0) > 0,410,'This invitation was already accepted.');
    await audit(
      db,
      context,
      "invitation_accepted",
      `Assigned ${invitation.role} access.`,
    );
    return reply({ ok: true, role: invitation.role });
  }
  const member = path.match(/^access\/members\/([a-zA-Z0-9-]+)$/);
  if (member && request.method === "PATCH") {
    requireAdmin(context);
    check(body.status === "revoked", 400, "Only revocation is supported.");
    const target = await db
      .prepare(
        "SELECT * FROM care_memberships WHERE id = ? AND workspace_id = ?",
      )
      .bind(member[1], WORKSPACE)
      .first();
    check(target, 404, "Membership not found.");
    check(
      target.user_id !== context.userId,
      409,
      "The owner cannot revoke their own workspace access.",
    );
    await db
      .prepare(
        "UPDATE care_memberships SET status = ? WHERE workspace_id = ? AND user_id = ? AND role = ? AND senior_id = ?",
      )
      .bind("revoked", WORKSPACE, target.user_id, target.role, target.senior_id)
      .run();
    await db.prepare('DELETE FROM demo_sessions WHERE owner = ?').bind(target.user_id).run();
    await audit(
      db,
      context,
      "membership_revoked",
      `Revoked ${target.role} access.`,
    );
    return reply({ ok: true });
  }
  return null;
}
