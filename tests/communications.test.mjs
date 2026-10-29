import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMUNICATION_MODES,
  buildCommunication,
  buildIvrPrompt,
  processIvrAnswer,
  redactText,
  hasDiagnosticClaim,
  createVoiceConnection,
} from "../lib/communications.mjs";

const senior = { id: "S001", name: "Synthetic Senior", familyConsent: true };
const coordinator = { role: "coordinator", userId: "staff-1" };
const request = {
  channel: "in_app",
  recipientRole: "senior",
  seniorId: "S001",
  template: "checkin",
  language: "en",
};

test("all showcase modes explicitly avoid external delivery and paid services", () => {
  assert.equal(COMMUNICATION_MODES.length, 3);
  for (const mode of COMMUNICATION_MODES) {
    const result = buildCommunication(
      { ...request, channel: mode.id },
      { senior, actor: coordinator },
    );
    assert.equal(result.externalDelivery, false);
    assert.equal(
      result.status,
      mode.id === "in_app" ? "delivered_in_app" : "simulated",
    );
    assert.equal(result.simulation, mode.id !== "in_app");
    assert.match(
      result.deliveryNotice,
      mode.id === "in_app" ? /No external/u : /No telephone call or SMS/u,
    );
  }
});

test("family communication is blocked immediately when consent is absent", () => {
  assert.throws(
    () =>
      buildCommunication(
        { ...request, recipientRole: "family" },
        { senior: { ...senior, familyConsent: false }, actor: coordinator },
      ),
    (error) => error.status === 403,
  );
  assert.throws(
    () =>
      buildCommunication(
        { ...request, recipientRole: "coordinator" },
        {
          senior: { ...senior, familyConsent: false },
          actor: { role: "family", seniorId: "S001" },
        },
      ),
    (error) => error.status === 403,
  );
  assert.throws(
    () =>
      buildCommunication(
        { ...request, consent: false },
        { senior, actor: coordinator },
      ),
    (error) => error.status === 403,
  );
});

test("senior and family can only contact their assigned coordinator", () => {
  assert.equal(
    buildCommunication(
      { ...request, recipientRole: "coordinator" },
      {
        senior,
        actor: { role: "senior", seniorId: "S001", userId: "senior-1" },
      },
    ).senderId,
    "senior-1",
  );
  assert.throws(
    () =>
      buildCommunication(
        { ...request, recipientRole: "family" },
        { senior, actor: { role: "senior", seniorId: "S001" } },
      ),
    (error) => error.status === 403,
  );
  assert.throws(
    () =>
      buildCommunication(
        { ...request, recipientRole: "coordinator" },
        { senior, actor: { role: "family", seniorId: "S002" } },
      ),
    (error) => error.status === 403,
  );
  assert.throws(
    () =>
      buildCommunication(request, { senior, actor: { role: "operations" } }),
    (error) => error.status === 403,
  );
});

test("invalid channels, payloads and senior assignments cannot create messages", () => {
  for (const patch of [
    { channel: "sms" },
    { template: "diagnosis" },
    { language: "fr" },
    { seniorId: "S999" },
    { message: "x".repeat(2001) },
    { recipientRole: "anyone" },
  ]) {
    assert.throws(() =>
      buildCommunication(
        { ...request, ...patch },
        { senior, actor: coordinator },
      ),
    );
  }
});

test("all generated messages route to people without diagnosing a condition", () => {
  for (const language of ["en", "hi"])
    for (const template of [
      "checkin",
      "followup",
      "serious_alert",
      "weekly_summary",
    ]) {
      const result = buildCommunication(
        { ...request, language, template, recipientRole: "family" },
        { senior, actor: coordinator },
      );
      assert.ok(result.body.length > 30);
      assert.equal(hasDiagnosticClaim(result.body), false);
      assert.ok(!result.body.includes(senior.name));
    }
  assert.throws(
    () =>
      buildCommunication(
        { ...request, message: "You have diabetes." },
        { senior, actor: coordinator },
      ),
    /diagnostic claim/u,
  );
  assert.throws(
    () =>
      buildCommunication(
        { ...request, message: "आपको मधुमेह है।" },
        { senior, actor: coordinator },
      ),
    /diagnostic claim/u,
  );
  assert.equal(
    hasDiagnosticClaim("Please ask a clinician to review a change."),
    false,
  );
});

test("redaction masks common contact and medical identifier formats without inventing clinical facts", () => {
  const input =
    "Contact user@example.com or +91 98765 43210. Patient ID: ABC12345. Appetite is low.";
  const output = redactText(input);
  assert.ok(!output.includes("user@example.com"));
  assert.ok(!output.includes("98765"));
  assert.ok(!output.includes("ABC12345"));
  assert.match(output, /Appetite is low/u);
  assert.equal(redactText(null), "");
});

test("four English IVR questions preserve answers and produce an extractable final note", () => {
  let state = { language: "en", step: 0, answers: {} };
  const ids = [];
  let result;
  for (const digit of ["2", "2", "2", "2"]) {
    ids.push(buildIvrPrompt(state).questionId);
    result = processIvrAnswer(state, digit);
    state = result.state;
  }
  assert.deepEqual(ids, ["wellbeing", "medicines", "daily_routine", "support"]);
  assert.equal(result.complete, true);
  assert.equal(result.callRequested, true);
  assert.equal(result.helpRequested, false);
  assert.match(result.note, /Missed a medicine dose/u);
  assert.match(result.note, /low appetite/u);
  assert.equal(result.externalDelivery, false);
  assert.equal(result.mood, "okay");
});

test("Hindi IVR help request remains flagged even when later answers are usual", () => {
  let state = { language: "hi", step: 0, answers: {} };
  let result;
  for (const digit of ["3", "1", "1", "1"]) {
    result = processIvrAnswer(state, digit);
    state = result.state;
  }
  assert.equal(result.complete, true);
  assert.equal(result.helpRequested, true);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.mood, "help");
  assert.match(result.note, /मदद चाहिए/u);
  assert.match(result.prompt, /धन्यवाद/u);
});

test("IVR rejects missing prior answers, malformed steps, invalid digits and replayed completion", () => {
  for (const state of [
    { step: -1 },
    { step: 5 },
    { step: 2, answers: {} },
    { language: "xx" },
  ])
    assert.throws(() => buildIvrPrompt(state));
  assert.throws(
    () => processIvrAnswer({ language: "en", step: 0 }, "9"),
    /Press 1, 2 or 3/u,
  );
  let state = { language: "en", step: 0, answers: {} };
  for (const digit of ["1", "1", "1", "1"])
    state = processIvrAnswer(state, digit).state;
  assert.throws(() => processIvrAnswer(state, "1"), /already complete/u);
});

function voiceFixture() {
  const events = [],
    sent = [],
    tracks = [
      {
        enabled: true,
        stop() {
          events.push("track-stopped");
        },
      },
    ];
  const stream = { getTracks: () => tracks, getAudioTracks: () => tracks };
  const peer = {
    remoteDescription: null,
    localDescription: null,
    signalingState: "have-local-offer",
    connectionState: "new",
    addTrack() {
      events.push("track-added");
    },
    async createOffer() {
      return { type: "offer", sdp: "fake-offer" };
    },
    async createAnswer() {
      return { type: "answer", sdp: "fake-answer" };
    },
    async setLocalDescription(description) {
      this.localDescription = description;
      events.push("local-description");
    },
    async setRemoteDescription(description) {
      this.remoteDescription = description;
      events.push("remote-description");
    },
    async addIceCandidate(candidate) {
      assert.ok(
        this.remoteDescription,
        "must not add ICE before remote description",
      );
      events.push("ice-added");
    },
    close() {
      events.push("peer-closed");
    },
  };
  const connection = createVoiceConnection({
    getMedia: async (constraints) => {
      assert.equal(constraints.video, false);
      events.push("microphone-requested");
      return stream;
    },
    createPeer: (config) => {
      assert.deepEqual(config.iceServers, []);
      events.push("peer-created");
      return peer;
    },
    send: async (payload) => {
      sent.push(payload);
    },
    onState: (next) => events.push(next),
  });
  return { connection, events, sent, peer, tracks };
}

test("voice construction does not request microphone; start sends an offer and stop releases resources", async () => {
  const fixture = voiceFixture();
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.connection.active, false);
  await fixture.connection.start();
  assert.equal(
    fixture.events.filter((event) => event === "microphone-requested").length,
    1,
  );
  assert.deepEqual(fixture.sent, [{ type: "offer", sdp: "fake-offer" }]);
  fixture.connection.setMuted(true);
  assert.equal(fixture.tracks[0].enabled, false);
  fixture.connection.setMuted(false);
  assert.equal(fixture.tracks[0].enabled, true);
  fixture.connection.stop();
  fixture.connection.stop();
  assert.equal(
    fixture.events.filter((event) => event === "track-stopped").length,
    1,
  );
  assert.equal(
    fixture.events.filter((event) => event === "peer-closed").length,
    1,
  );
  assert.equal(fixture.connection.active, false);
});

test("voice queues ICE until an explicit answer installs remote description", async () => {
  const fixture = voiceFixture();
  await fixture.connection.receive({
    type: "ice",
    candidate: { candidate: "synthetic-candidate", sdpMid: "0" },
  });
  assert.deepEqual(fixture.events, []);
  await fixture.connection.answer({ type: "offer", sdp: "fake-remote-offer" });
  assert.ok(
    fixture.events.indexOf("remote-description") <
      fixture.events.indexOf("ice-added"),
  );
  assert.deepEqual(fixture.sent, [{ type: "answer", sdp: "fake-answer" }]);
  fixture.connection.stop();
});

test("caller receives an answer without opening a second microphone", async () => {
  const fixture = voiceFixture();
  await fixture.connection.start();
  await fixture.connection.receive({
    type: "ice",
    candidate: { candidate: "synthetic-candidate", sdpMid: "0" },
  });
  await fixture.connection.receive({
    type: "answer",
    sdp: "fake-remote-answer",
  });
  assert.equal(
    fixture.events.filter((event) => event === "microphone-requested").length,
    1,
  );
  assert.ok(fixture.events.includes("ice-added"));
  assert.equal(fixture.peer.remoteDescription.sdp, "fake-remote-answer");
  fixture.connection.stop();
});

test("cancelling while microphone permission is pending stops any subsequently returned track", async () => {
  let resolveMedia;
  const stopped = [];
  const connection = createVoiceConnection({
    getMedia: () =>
      new Promise((resolve) => {
        resolveMedia = resolve;
      }),
    createPeer: () => {
      throw new Error("Peer should not be created after cancellation");
    },
    send: async () => {},
  });
  const request = connection.start();
  connection.stop();
  resolveMedia({
    getTracks: () => [
      {
        stop() {
          stopped.push(true);
        },
      },
    ],
  });
  await assert.rejects(request, /cancelled/u);
  assert.equal(stopped.length, 1);
});
