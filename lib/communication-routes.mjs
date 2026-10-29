import { DEMO_DATE } from "./engine.mjs";
import {workflow} from './workflow-store.mjs';
import {canManageCare} from './access.mjs';
import {
  COMMUNICATION_MODES,
  CommunicationError,
  buildCommunication,
  buildIvrPrompt,
  processIvrAnswer,
} from "./communications.mjs";

const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const check = (condition, status, message) => {
  if (!condition) throw new CommunicationError(message, status);
};
const uuid = (value) =>
  typeof value === "string" && /^[a-f0-9-]{36}$/iu.test(value);
const changes = (result) =>
  Number(result?.meta?.changes ?? result?.changes ?? 0);
const CALL_DURATION = 15 * 60000;
const IVR_DURATION = 30 * 60000;

function safeRoom(room) {
  return {
    id: room.id,
    seniorId: room.seniorId,
    status: room.status,
    createdBy: room.createdBy,
    createdByRole: room.createdByRole,
    peerId: room.peerId ?? null,
    peerRole: room.peerRole ?? null,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
  };
}
function stateForClient(state) {
  return {
    id: state.id,
    seniorId: state.seniorId,
    language: state.language,
    step: state.step,
    answers: state.answers,
    complete: state.step >= 4,
  };
}

/** These routes receive an already authenticated, freshly authorized context. */
export async function handleCommunicationRoute({
  path,
  request,
  body,
  db,
  context,
  rows,
  getSenior,
  event,
  storeMutation,
  asOfDate = DEMO_DATE,
  onMutation,
  cachedSummary,
}) {
  if (!(
    path === "communications" ||
    path.startsWith("communications/") ||
    path === "ivr" ||
    path === "voice/rooms" ||
    path.startsWith("voice/rooms/")
  ))
    return null;
  try {
    check(/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) && Number.isFinite(Date.parse(asOfDate+'T00:00:00Z')) && new Date(Date.parse(asOfDate+'T00:00:00Z')).toISOString().slice(0,10)===asOfDate,400,'Use a valid check-in calendar date.');
    const { owner, session } = context;
    check(
      context.authenticated && context.authorized && session?.userId,
      401,
      "An assigned care account is required.",
    );
    const userId = session.userId;
    const role = session.role;
    check(role!=='operations'||canManageCare(session),403,'Only the Operations administrator has access to this care console.');
    const staff = role === "coordinator" || role === "operations";
    const url = new URL(request.url);
    async function recipientDirectory(id){
      const senior=await seniorFor(id);
      if(typeof db.conversationRecipients==='function')return db.conversationRecipients(id);
      const members=await workflow(db,'members_get',{workspaceId:session.workspaceId||'primary'});
      return members.filter(m=>m.status==='active'&&m.user_id!==userId).filter(m=>{
        const scope=typeof m.scope_json==='string'?JSON.parse(m.scope_json):m.scope_json||[];
        const assigned=m.senior_id===id||scope.includes('*')||scope.includes(id);
        if(!assigned)return false;
        if(m.role==='operations'&&!m.is_admin)return false;
        if(m.role==='family'&&!senior.familyConsent)return false;
        return staff||['coordinator','operations'].includes(m.role)||(role==='family'&&m.role==='senior')||(role==='senior'&&m.role==='family');
      }).map(m=>({userId:m.user_id,name:m.display_name||m.role,role:m.role,isAdmin:!!m.is_admin}));
    }
    async function seniorFor(id) {
      const senior = await getSenior(id);
      if (role === "family")
        check(
          senior.familyConsent === true,
          403,
          "Family sharing consent has been withdrawn.",
        );
      return senior;
    }
    async function canReadMessage(message) {
      try {
        await seniorFor(message.seniorId);
        return (
          staff ||
          ((role === "senior" || role === "family") &&
            (message.seniorId === session.seniorId || role === 'family' && session.scope?.includes(message.seniorId)) &&
            (message.recipientId===userId || message.senderId === userId))
        );
      } catch {
        return false;
      }
    }
    function recipient(message) {
      return message.recipientId===userId;
    }
    async function voiceSenior(id) {
      check(
        ["coordinator", "senior", "family"].includes(role),
        403,
        "Browser audio is available to the assigned coordinator, senior and consented family.",
      );
      return seniorFor(id);
    }
    function eligiblePeer(room) {
      if (room.createdBy === userId) return true;
      return room.createdByRole === "coordinator"
        ? role === "senior" || role === "family"
        : role === "coordinator";
    }
    async function getRoom(
      id,
      { participant = true, allowEnded = false, cleanup = false } = {},
    ) {
      check(uuid(id), 404, "Voice room not found.");
      const row = await db
        .prepare(
          "SELECT id, senior_id, payload, created_at FROM care_events WHERE id = ? AND owner = ? AND kind = ?",
        )
        .bind(id, owner, "voice_room")
        .first();
      check(row, 404, "Voice room not found.");
      const room = {
        ...JSON.parse(row.payload),
        id: row.id,
        seniorId: row.senior_id,
        createdAt: row.created_at,
      };
      const senior = cleanup
        ? await getSenior(room.seniorId)
        : await voiceSenior(room.seniorId);
      if (!cleanup)
        check(
          !(
            [room.createdByRole, room.peerRole].includes("family") &&
            !senior.familyConsent
          ),
          403,
          "Family consent was withdrawn. End this voice connection.",
        );
      check(
        eligiblePeer(room),
        403,
        "This account is not a voice-room recipient.",
      );
      if (participant)
        check(
          room.createdBy === userId || room.peerId === userId,
          403,
          "Choose Answer to join this voice room before reading connection signals.",
        );
      if (!allowEnded) {
        check(room.status !== "ended", 409, "This voice room has ended.");
        check(
          Number(room.expiresAt) > Date.now(),
          410,
          "This voice room has expired.",
        );
      }
      return room;
    }
    async function roomList() {
      if (role === "operations") return [];
      const result = [];
      for (const row of rows
        .filter(
          (row) =>
            row.kind === "voice_room" &&
            row.status !== "ended" &&
            Number(row.expiresAt) > Date.now(),
        )
        .slice(-30)
        .reverse()) {
        try {
          const senior = await voiceSenior(row.seniorId);
          if (
            [row.createdByRole, row.peerRole].includes("family") &&
            !senior.familyConsent
          )
            continue;
          if (
            eligiblePeer(row) &&
            (!row.peerId || row.peerId === userId || row.createdBy === userId)
          )
            result.push(safeRoom(row));
        } catch {
          /* Out-of-scope and revoked-consent rooms are not disclosed. */
        }
      }
      return result;
    }

    if(path==='communications/recipients'&&request.method==='GET'){
      const id=url.searchParams.get('seniorId')||session.seniorId;
      check(id,400,'Choose a linked senior.');
      return reply({recipients:await recipientDirectory(id)});
    }
    if (path === "communications" && request.method === "GET") {
      const messages = [];
      for (const row of rows
        .filter((row) => row.kind === "communication")
        .slice(-200)
        .reverse()) {
        if (!(await canReadMessage(row))) continue;
        const readBy = [
          ...new Set(
            rows
              .filter(
                (item) =>
                  item.kind === "communication_read" &&
                  item.messageId === row.id,
              )
              .map((item) => item.userId),
          ),
        ];
        messages.push({
          id: row.id,
          seniorId: row.seniorId,
          channel: row.channel,
          recipientRole: row.recipientRole,
          senderRole: row.senderRole,
          senderId: row.senderId,
          senderName: row.senderName||row.senderRole,
          recipientId:row.recipientId,
          recipientName:row.recipientName||row.recipientRole,
          isRecipient:recipient(row),
          template: row.template,
          language: row.language,
          body: row.body,
          status: row.status,
          externalDelivery: false,
          simulation: row.simulation,
          deliveryNotice: row.deliveryNotice,
          createdAt: row.createdAt,
          readBy,
          read: readBy.includes(userId),
        });
      }
      return reply({
        messages,
        rooms: await roomList(),
        modes: COMMUNICATION_MODES,
      });
    }
    if (path === "communications" && request.method === "POST") {
      const senior = await seniorFor(body.seniorId);
      check(role!=='operations'||canManageCare(session),403,'Only the Operations administrator can send care messages.');
      const directory=await recipientDirectory(senior.id);
      const matches=directory.filter(item=>item.role===body.recipientRole&&(!body.recipientId||item.userId===body.recipientId));
      check(matches.length===1,400,matches.length?'Choose the specific account who should receive this message.':'No assigned recipient is available for this senior.');
      const target=matches[0];
      const payload = buildCommunication({...body,recipientId:target.userId}, { senior, actor: session,recipient:target });
      if (role === "senior" || role === "family")
        check(
          payload.channel === "in_app",
          403,
          "Use the free in-app channel to contact your coordinator.",
        );
      const id = crypto.randomUUID();
      const statements=[event(db,owner,'communication',senior.id,payload,id),event(db,owner,'audit',senior.id,{actor:session.name,actorId:userId,action:'communication',role})];
      if (role === "family" && payload.recipientRole === "coordinator") {
        statements.push(event(db,owner,'signal',senior.id,{
            type: "note",
            record: {
              seniorId: senior.id,
              date: asOfDate,
              note: payload.body,
              source: "family-message",
            },
          }));
      }
      await db.batch(statements);
      if(role==='family'&&payload.recipientRole==='coordinator'&&typeof onMutation==='function')await onMutation({kind:'signal',seniorId:senior.id,asOfDate,source:'family-message'});
      return reply(
        {
          ok: true,
          message: { id, ...payload, createdAt: new Date().toISOString() },
        },
        201,
      );
    }
    const messageMatch = path.match(/^communications\/([a-f0-9-]{36})$/iu);
    if (messageMatch && request.method === "PATCH") {
      check(body?.read === true, 400, "Choose a read receipt.");
      const message = rows.find(
        (row) => row.id === messageMatch[1] && row.kind === "communication",
      );
      check(
        message && (await canReadMessage(message)),
        404,
        "Message not found.",
      );
      check(
        recipient(message),
        403,
        "Only a message recipient may mark it read.",
      );
      const prior = rows.find(
        (row) =>
          row.kind === "communication_read" &&
          row.messageId === message.id &&
          row.userId === userId,
      );
      if (!prior)
        await storeMutation(
          db,
          owner,
          "communication_read",
          message.seniorId,
          { messageId: message.id, userId },
          session.name,
        );
      return reply({ ok: true, read: true });
    }

    if (path === "ivr" && request.method === "GET") {
      check(
        role === "coordinator" || role === "senior",
        403,
        "Phone check-ins are available to the assigned senior and coordinator.",
      );
      const seniorId = url.searchParams.get("seniorId") || session.seniorId;
      const senior = await seniorFor(seniorId);
      const language = url.searchParams.get("language") || "en";
      check(
        language === "en" || language === "hi",
        400,
        "Choose English or Hindi.",
      );
      let state = rows
        .filter(
          (row) =>
            row.kind === "ivr_session" &&
            row.seniorId === senior.id &&
            row.state?.userId === userId &&
            row.state?.language === language &&
            row.state?.step < 4 &&
            Number(row.state?.expiresAt) > Date.now(),
        )
        .at(-1)?.state;
      if (!state) {
        const id = crypto.randomUUID();
        state = {
          id,
          seniorId: senior.id,
          userId,
          language,
          step: 0,
          answers: {},
          expiresAt: Date.now() + IVR_DURATION,
          signalId: crypto.randomUUID(),
          taskId: crypto.randomUUID(),
          auditId: crypto.randomUUID(),
        };
        await event(db, owner, "ivr_session", senior.id, { state }, id).run();
      }
      return reply({
        state: stateForClient(state),
        prompt: buildIvrPrompt(state),
        simulated: true,
        externalDelivery: false,
      });
    }
    if (path === "ivr" && request.method === "POST") {
      check(
        role === "coordinator" || role === "senior",
        403,
        "Phone check-ins are available to the assigned senior and coordinator.",
      );
      check(uuid(body?.state?.id), 400, "Start a phone check-in first.");
      const row = await db
        .prepare(
          "SELECT payload, senior_id FROM care_events WHERE id = ? AND owner = ? AND kind = ?",
        )
        .bind(body.state.id, owner, "ivr_session")
        .first();
      check(row, 404, "Phone check-in not found.");
      const saved = JSON.parse(row.payload).state;
      check(
        saved.userId === userId && saved.seniorId === body.seniorId,
        403,
        "This phone check-in belongs to another account or senior.",
      );
      await seniorFor(saved.seniorId);
      check(
        Number(saved.expiresAt) > Date.now(),
        410,
        "This phone check-in has expired.",
      );
      check(saved.step < 4, 409, "This phone check-in is already complete.");
      check(
        body.state.step === saved.step,
        409,
        "This phone check-in has moved on. Reload the current question.",
      );
      const next = processIvrAnswer(saved, body.digit);
      const state = { ...saved, ...next.state };
      const statements = [
        db
          .prepare(
            "UPDATE care_events SET payload = ? WHERE id = ? AND owner = ? AND kind = ? AND json_extract(payload, '$.state.step') = ?",
          )
          .bind(
            JSON.stringify({ state }),
            saved.id,
            owner,
            "ivr_session",
            saved.step,
          ),
      ];
      if (next.complete) {
        const insertedAt = new Date().toISOString();
        const insertOnce = (id, kind, payload) =>
          db
            .prepare(
              "INSERT OR IGNORE INTO care_events (id, owner, kind, senior_id, payload, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM care_events WHERE id = ? AND owner = ? AND kind = ? AND payload = ?)",
            )
            .bind(
              id,
              owner,
              kind,
              saved.seniorId,
              JSON.stringify(payload),
              insertedAt,
              saved.id,
              owner,
              "ivr_session",
              JSON.stringify({ state }),
            );
        statements.push(
          insertOnce(saved.signalId, "signal", {
            type: "note",
            mood: next.mood,
            helpRequested: next.helpRequested,
            record: {
              seniorId: saved.seniorId,
              date: asOfDate,
              note: next.note,
              source: "phone-simulator",
            },
            answers: next.state.answers,
            language: saved.language,
          }),
        );
        if (next.callRequested || next.requiresHumanReview)
          statements.push(
            insertOnce(saved.taskId, "task", {
              seniorId: saved.seniorId,
              action: next.helpRequested
                ? "Call senior promptly: support requested during phone check-in"
                : "Review phone check-in and arrange a coordinator call",
              status: "open",
              note: "Four-question phone-flow simulation completed",
              createdAt: insertedAt,
              asOfDate,
            }),
          );
        statements.push(
          insertOnce(saved.auditId, "audit", {
            action: "phone_checkin",
            actor: session.name,
            detail:
              "Four-question simulated phone check-in saved for human review",
          }),
        );
      }
      const result = await db.batch(statements);
      check(
        changes(result[0]) > 0,
        409,
        "This answer was already submitted. Reload the current question.",
      );
      if(next.complete && typeof onMutation==='function')await onMutation({kind:'signal',seniorId:saved.seniorId,asOfDate,source:'phone-simulator'});
      return reply({
        ok: true,
        state: stateForClient(state),
        prompt: buildIvrPrompt(state),
        complete: next.complete,
        recorded: next.complete,
        note: next.note,
        helpRequested: next.helpRequested,
        callRequested: next.callRequested,
        requiresHumanReview: next.requiresHumanReview,
        simulated: true,
        externalDelivery: false,
      });
    }

    if (path === "voice/rooms" && request.method === "GET")
      return reply({ rooms: await roomList() });
    if (path === "voice/rooms" && request.method === "POST") {
      const senior = await voiceSenior(body.seniorId);
      const current = rows.find(
        (row) =>
          row.kind === "voice_room" &&
          row.createdBy === userId &&
          row.seniorId === senior.id &&
          row.status !== "ended" &&
          Number(row.expiresAt) > Date.now(),
      );
      check(
        !current,
        409,
        "You already have an active voice request for this senior. End it before starting another.",
      );
      const id = crypto.randomUUID();
      const room = {
        id,
        seniorId: senior.id,
        createdBy: userId,
        createdByRole: role,
        peerId: null,
        status: "ringing",
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + CALL_DURATION,
      };
      await storeMutation(
        db,
        owner,
        "voice_room",
        senior.id,
        room,
        session.name,
        id,
      );
      // Retain connection metadata briefly; call media is never recorded.
      await db
        .prepare(
          "DELETE FROM care_events WHERE owner = ? AND kind = ? AND created_at < ?",
        )
        .bind(
          owner,
          "voice_signal",
          new Date(Date.now() - 30 * 60000).toISOString(),
        )
        .run();
      return reply({ room: safeRoom(room), externalDelivery: false }, 201);
    }
    const roomMatch = path.match(/^voice\/rooms\/([a-f0-9-]{36})$/iu);
    if (roomMatch && request.method === "GET") {
      const room = await getRoom(roomMatch[1], { allowEnded: true });
      if (room.status === "ended" || Number(room.expiresAt) <= Date.now())
        return reply({
          room: { ...safeRoom(room), status: "ended" },
          signals: [],
        });
      const result = await db
        .prepare(
          "SELECT id,payload FROM care_events WHERE owner = ? AND kind = ? AND json_extract(payload, '$.roomId') = ? ORDER BY created_at, rowid LIMIT 100",
        )
        .bind(owner, "voice_signal", room.id)
        .all();
      return reply({
        room: safeRoom(room),
        signals: result.results
          .map((row) => ({ id: row.id, ...JSON.parse(row.payload) }))
          .map(({ id, senderId, payload }) => ({ id, senderId, payload })),
      });
    }
    if (roomMatch && request.method === "PATCH") {
      check(
        body?.status === "active" || body?.status === "ended",
        400,
        "Choose an active or ended room state.",
      );
      const room = await getRoom(roomMatch[1], {
        participant: body.status === "ended",
        allowEnded: body.status === "ended",
        cleanup: body.status === "ended",
      });
      if (body.status === "active") {
        check(
          room.createdBy !== userId,
          400,
          "The recipient chooses Answer to join this room.",
        );
        const claim = await db
          .prepare(
            "UPDATE care_events SET payload = json_set(payload, '$.peerId', ?, '$.peerRole', ?, '$.status', 'active') WHERE id = ? AND owner = ? AND kind = ? AND (json_extract(payload, '$.peerId') IS NULL OR json_extract(payload, '$.peerId') = ?) AND json_extract(payload, '$.status') <> 'ended' AND json_extract(payload, '$.expiresAt') > ?",
          )
          .bind(userId, role, room.id, owner, "voice_room", userId, Date.now())
          .run();
        check(
          changes(claim) > 0,
          409,
          "Another participant has already answered, or the room has ended.",
        );
        return reply({
          room: safeRoom({
            ...room,
            peerId: userId,
            peerRole: role,
            status: "active",
          }),
        });
      }
      await db.batch([
        db
          .prepare(
            "UPDATE care_events SET payload = json_set(payload, '$.status', 'ended', '$.endedAt', ?) WHERE id = ? AND owner = ? AND kind = ?",
          )
          .bind(new Date().toISOString(), room.id, owner, "voice_room"),
        db
          .prepare(
            "DELETE FROM care_events WHERE owner = ? AND kind = ? AND json_extract(payload, '$.roomId') = ?",
          )
          .bind(owner, "voice_signal", room.id),
      ]);
      return reply({ room: safeRoom({ ...room, status: "ended" }) });
    }
    const signalMatch = path.match(/^voice\/rooms\/([a-f0-9-]{36})\/signal$/iu);
    if (signalMatch && request.method === "POST") {
      const room = await getRoom(signalMatch[1]);
      const signal = body?.payload;
      check(
        signal && ["offer", "answer", "ice"].includes(signal.type),
        400,
        "Provide a valid browser connection signal.",
      );
      let payload;
      if (signal.type === "offer" || signal.type === "answer") {
        check(
          typeof signal.sdp === "string" &&
            signal.sdp.length >= 1 &&
            signal.sdp.length <= 16000,
          400,
          "Connection description is invalid.",
        );
        check(
          signal.type === "offer"
            ? room.createdBy === userId
            : room.peerId === userId && room.createdBy !== userId,
          403,
          "Only the correct room participant may send this connection description.",
        );
        payload = { type: signal.type, sdp: signal.sdp };
        const existing = await db
          .prepare(
            "SELECT id FROM care_events WHERE owner = ? AND kind = ? AND json_extract(payload, '$.roomId') = ? AND json_extract(payload, '$.payload.type') = ? LIMIT 1",
          )
          .bind(owner, "voice_signal", room.id, signal.type)
          .first();
        check(!existing, 409, "This connection description was already sent.");
      } else {
        const candidate = signal.candidate;
        check(
          candidate &&
            typeof candidate === "object" &&
            !Array.isArray(candidate) &&
            typeof candidate.candidate === "string" &&
            candidate.candidate.length <= 2048,
          400,
          "ICE candidate is invalid.",
        );
        check(
          candidate.sdpMid == null ||
            (typeof candidate.sdpMid === "string" &&
              candidate.sdpMid.length <= 128),
          400,
          "ICE media identifier is invalid.",
        );
        check(
          candidate.sdpMLineIndex == null ||
            (Number.isInteger(candidate.sdpMLineIndex) &&
              candidate.sdpMLineIndex >= 0 &&
              candidate.sdpMLineIndex < 100),
          400,
          "ICE media index is invalid.",
        );
        check(
          candidate.sdpMid != null || candidate.sdpMLineIndex != null,
          400,
          "ICE candidate must name a media stream.",
        );
        check(
          candidate.usernameFragment == null ||
            (typeof candidate.usernameFragment === "string" &&
              candidate.usernameFragment.length <= 256),
          400,
          "ICE username fragment is invalid.",
        );
        payload = {
          type: "ice",
          candidate: {
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: candidate.sdpMLineIndex ?? null,
            ...(candidate.usernameFragment
              ? { usernameFragment: candidate.usernameFragment }
              : {}),
          },
        };
      }
      const count = await db
        .prepare(
          "SELECT COUNT(*) AS count FROM care_events WHERE owner = ? AND kind = ? AND json_extract(payload, '$.roomId') = ?",
        )
        .bind(owner, "voice_signal", room.id)
        .first();
      check(
        Number(count.count) < 100,
        429,
        "This room has reached the showcase connection-signal limit.",
      );
      const id =
        signal.type === "ice"
          ? crypto.randomUUID()
          : `voice-${signal.type}-${room.id}`;
      const result = await db
        .prepare(
          "INSERT OR IGNORE INTO care_events (id, owner, kind, senior_id, payload, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM care_events WHERE id = ? AND owner = ? AND kind = ? AND json_extract(payload, '$.status') <> 'ended' AND json_extract(payload, '$.expiresAt') > ? AND (json_extract(payload, '$.createdBy') = ? OR json_extract(payload, '$.peerId') = ?)) AND (SELECT COUNT(*) FROM care_events WHERE owner = ? AND kind = 'voice_signal' AND json_extract(payload, '$.roomId') = ?) < 100",
        )
        .bind(
          id,
          owner,
          "voice_signal",
          room.seniorId,
          JSON.stringify({ roomId: room.id, senderId: userId, payload }),
          new Date().toISOString(),
          room.id,
          owner,
          "voice_room",
          Date.now(),
          userId,
          userId,
          owner,
          room.id,
        )
        .run();
      check(
        changes(result) > 0,
        409,
        "The voice room ended before this signal was saved.",
      );
      return reply({ ok: true, signalId: id }, 201);
    }
    return reply({ error: "Communication endpoint not found." }, 404);
  } catch (error) {
    return reply(
      {
        error: error?.status
          ? error.message
          : "Unable to complete this care communication.",
      },
      error?.status ?? 500,
    );
  }
}
