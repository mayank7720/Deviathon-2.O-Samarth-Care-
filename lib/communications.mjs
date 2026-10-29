/**
 * Free, deterministic care communications. This module never sends a message
 * outside Samarth Care. Phone and SMS modes are explicitly simulations.
 */
export const COMMUNICATION_MODES = Object.freeze([
  {
    id: "in_app",
    label: "In-app message",
    status: "delivered_in_app",
    externalDelivery: false,
    description:
      "Saved in the authorized care inbox. No SMS or push notification is sent.",
  },
  {
    id: "sms_simulator",
    label: "SMS simulation",
    status: "simulated",
    externalDelivery: false,
    description:
      "Preview a short text-message workflow without contacting a phone number.",
  },
  {
    id: "phone_simulator",
    label: "Phone / IVR simulation",
    status: "simulated",
    externalDelivery: false,
    description:
      "Demonstrate Hindi or English phone prompts and keypad responses without placing a call.",
  },
]);

const CHANNELS = new Set(COMMUNICATION_MODES.map((mode) => mode.id));
const RECIPIENTS = new Set(["senior", "family", "coordinator", "operations"]);
const TEMPLATES = new Set([
  "checkin",
  "followup",
  "serious_alert",
  "weekly_summary",
]);
const LANGUAGES = new Set(["en", "hi"]);

export class CommunicationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CommunicationError";
    this.status = status;
  }
}
function ensure(condition, message, status) {
  if (!condition) throw new CommunicationError(message, status);
}

const COPY = Object.freeze({
  en: {
    checkin:
      "Hello. How are you feeling today? Please share a short wellbeing update with your care coordinator. If you need urgent help, use your usual emergency or care-team contact directly.",
    followup:
      "Your care team would like to arrange a friendly check-in. Please let your coordinator know a convenient time to talk.",
    serious_alert:
      "A change in the usual wellbeing pattern needs a prompt human review. Please contact the care coordinator. This is a request for follow-up, not a diagnosis. For immediate distress, use your usual emergency support directly.",
    weekly_summary:
      "Your care team has reviewed the available weekly wellbeing entries and will continue the agreed check-ins. A familiar conversation can help. Please contact the coordinator with any questions or changes.",
  },
  hi: {
    checkin:
      "नमस्ते। आज आप कैसा महसूस कर रहे हैं? कृपया अपनी देखभाल टीम को एक छोटा संदेश दें। तुरंत मदद की ज़रूरत हो तो अपने आपातकालीन या देखभाल संपर्क से सीधे बात करें।",
    followup:
      "आपकी देखभाल टीम आपसे बात करना चाहती है। कृपया बात करने का सुविधाजनक समय अपने केयर कोऑर्डिनेटर को बताएँ।",
    serious_alert:
      "रोज़ की सामान्य दिनचर्या में बदलाव की जल्द मानवीय समीक्षा ज़रूरी है। कृपया केयर कोऑर्डिनेटर से बात करें। यह किसी बीमारी का निदान नहीं है। तुरंत परेशानी हो तो सीधे अपनी आपातकालीन सहायता से संपर्क करें।",
    weekly_summary:
      "आपकी देखभाल टीम ने इस सप्ताह की उपलब्ध जानकारी देखी है और तय समय पर संपर्क जारी रखेगी। अपनों से बातचीत मददगार हो सकती है। कोई सवाल या बदलाव हो तो केयर कोऑर्डिनेटर को बताएँ।",
  },
});

/** Generated copy must route concerns to a human, never name a diagnosis. */
export function hasDiagnosticClaim(value) {
  const text = String(value || "").normalize("NFKC");
  return (
    /\b(?:you\s+(?:have|suffer\s+from|are\s+diagnosed\s+with)|(?:your\s+(?:mother|father|parent)|the\s+senior)\s+(?:has|is\s+diagnosed\s+with))\s+(?:(?:a|an|the|confirmed)\s+)?(?:diabetes|dementia|depression|pneumonia|cancer|stroke|heart\s+(?:disease|failure)|kidney\s+(?:disease|failure)|hypertension|hypoglyc[a-z]*|covid)/iu.test(
      text,
    ) ||
    /(?:आपको|उन्हें|इनको)\s+(?:मधुमेह|डायबिटीज|डिमेंशिया|कैंसर|निमोनिया|बीमारी)\s*(?:है|हो\s*गई)/u.test(
      text,
    ) ||
    /\b(?:diagnosis\s*:\s*|diagnosed\s+with\s+)(?:diabetes|dementia|depression|pneumonia|cancer|stroke|hypertension)/iu.test(
      text,
    )
  );
}

/**
 * Removes common contact/identifier formats for demonstration exports. It is
 * intentionally a limited format-based filter, not a de-identification system.
 */
export function redactText(value = "") {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[email masked]")
    .replace(
      /\b(?:aadhaar|aadhar|patient\s*id|medical\s*record\s*(?:id|number)|mrn)\s*[:#=-]?\s*[A-Z0-9][A-Z0-9 -]{3,24}/giu,
      "[identifier masked]",
    )
    .replace(
      /(?<!\w)(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){10,15}(?!\w)/gu,
      "[phone or numeric identifier masked]",
    )
    .replace(/\b\d{4}\s+\d{4}\s+\d{4}\b/gu, "[numeric identifier masked]");
}

export function buildCommunication(input, { senior, actor, recipient } = {}) {
  ensure(
    input && typeof input === "object" && !Array.isArray(input),
    "A communication request is required.",
  );
  const { channel, recipientRole, seniorId, template, language = "en" } = input;
  ensure(
    CHANNELS.has(channel),
    "Choose in-app messaging, SMS simulation or phone simulation.",
  );
  ensure(RECIPIENTS.has(recipientRole), "Choose an assigned care recipient.");
  ensure(TEMPLATES.has(template), "Choose a supported care message template.");
  ensure(LANGUAGES.has(language), "Choose English or Hindi.");
  ensure(
    typeof seniorId === "string" &&
      /^S\d{3,6}$/u.test(seniorId) &&
      senior?.id === seniorId,
    "The senior assignment is invalid.",
  );
  const role = typeof actor === "string" ? actor : actor?.role;
  ensure(
    ["coordinator", "operations", "senior", "family"].includes(role),
    "An authenticated care role is required.",
    403,
  );
  ensure(
    role !== "operations" || actor?.isAdmin===true,
    "Only the Operations administrator can send care messages.",
    403,
  );
  if (role === "senior" || role === "family") {
    ensure(
      recipientRole === "coordinator" || recipient&&recipient.userId===input.recipientId&&((recipientRole==='operations'&&recipient.isAdmin===true)||(role==='senior'&&recipientRole==='family')||(role==='family'&&recipientRole==='senior')),
      "Choose an assigned care staff member or linked family/senior recipient.",
      403,
    );
    ensure(
      actor.seniorId === seniorId || role==='family'&&actor.scope?.includes(seniorId),
      "You can only message your assigned care team.",
      403,
    );
  }
  if (recipientRole === "family")
    ensure(
      senior.familyConsent === true,
      "Family sharing consent is required before contacting family.",
      403,
    );
  if (role === "family")
    ensure(
      senior.familyConsent === true,
      "Family sharing consent has been withdrawn.",
      403,
    );
  ensure(input.consent !== false, "Communication consent was not given.", 403);
  let body = COPY[language][template];
  if (input.message != null && input.message !== "") {
    ensure(
      typeof input.message === "string" &&
        input.message.trim().length > 0 &&
        input.message.length <= 2000,
      "A message must contain 1 to 2,000 characters.",
    );
    body = input.message.trim();
    ensure(
      !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(body),
      "The message contains unsupported control characters.",
    );
    ensure(
      !hasDiagnosticClaim(body),
      "Use a human follow-up request instead of a diagnostic claim.",
    );
  }
  return {
    channel,
    recipientRole,
    seniorId,
    template,
    language,
    body,
    status: channel === "in_app" ? "delivered_in_app" : "simulated",
    externalDelivery: false,
    simulation: channel !== "in_app",
    deliveryNotice:
      channel === "in_app"
        ? "Saved to the care inbox. No external notification was sent."
        : "Showcase simulation only. No telephone call or SMS was sent.",
    senderRole: role,
    senderName: typeof actor==='object'?actor.name||role:role,
    ...(recipient?{recipientId:recipient.userId,recipientName:recipient.name}:{}),
    senderId:
      typeof actor === "object"
        ? (actor.userId ?? actor.identityId ?? null)
        : null,
    requiresHumanReview: template === "serious_alert",
    dataType: "synthetic-showcase",
  };
}

const QUESTIONS = {
  en: [
    {
      id: "wellbeing",
      prompt:
        "Hello from your care team. How are you feeling today? Press 1 if you feel as usual, 2 if something feels different, or 3 if you need support.",
      options: [
        ["1", "usual", "I feel as usual"],
        ["2", "changed", "Something feels different"],
        ["3", "help", "I need support"],
      ],
    },
    {
      id: "medicines",
      prompt:
        "Were you able to take your medicines according to your agreed plan? Press 1 for yes, 2 if a dose was missed, or 3 if you would like help checking the plan.",
      options: [
        ["1", "taken", "Taken according to plan"],
        ["2", "missed", "A dose was missed"],
        ["3", "review", "I would like a medicine-plan review"],
      ],
    },
    {
      id: "daily_routine",
      prompt:
        "How have eating and sleeping been? Press 1 if both feel usual, 2 if eating has reduced, or 3 if sleep has reduced.",
      options: [
        ["1", "usual", "Eating and sleeping feel usual"],
        ["2", "less_food", "Eating less"],
        ["3", "less_sleep", "Sleeping less"],
      ],
    },
    {
      id: "support",
      prompt:
        "Would you like your care coordinator to call you? Press 1 for the usual check-in, 2 for a call today, or 3 if you need prompt support. For an urgent emergency, contact your usual emergency support directly.",
      options: [
        ["1", "routine", "Usual check-in"],
        ["2", "today", "A call today"],
        ["3", "prompt", "Prompt support requested"],
      ],
    },
  ],
  hi: [
    {
      id: "wellbeing",
      prompt:
        "नमस्ते, आपकी देखभाल टीम की ओर से। आज आप कैसा महसूस कर रहे हैं? हमेशा जैसा ठीक है तो 1 दबाएँ, कुछ अलग लग रहा है तो 2, मदद चाहिए तो 3 दबाएँ।",
      options: [
        ["1", "usual", "हमेशा जैसा ठीक हूँ"],
        ["2", "changed", "कुछ अलग लग रहा है"],
        ["3", "help", "मदद चाहिए"],
      ],
    },
    {
      id: "medicines",
      prompt:
        "क्या आपने अपनी तय योजना के अनुसार दवाएँ लीं? हाँ के लिए 1 दबाएँ, कोई खुराक छूट गई तो 2, योजना समझने में मदद चाहिए तो 3 दबाएँ।",
      options: [
        ["1", "taken", "योजना के अनुसार दवा ली"],
        ["2", "missed", "दवा की खुराक छूट गई"],
        ["3", "review", "दवा की योजना की समीक्षा चाहिए"],
      ],
    },
    {
      id: "daily_routine",
      prompt:
        "खाना और नींद कैसी रही? दोनों हमेशा जैसे हैं तो 1 दबाएँ, खाना कम हुआ तो 2, नींद कम हुई तो 3 दबाएँ।",
      options: [
        ["1", "usual", "खाना और नींद सामान्य हैं"],
        ["2", "less_food", "खाना कम खाया"],
        ["3", "less_sleep", "नींद कम आई"],
      ],
    },
    {
      id: "support",
      prompt:
        "क्या आप केयर कोऑर्डिनेटर से बात करना चाहेंगे? सामान्य समय पर बात के लिए 1, आज बात के लिए 2, जल्दी मदद के लिए 3 दबाएँ। तुरंत परेशानी हो तो अपनी आपातकालीन सहायता से सीधे संपर्क करें।",
      options: [
        ["1", "routine", "सामान्य समय पर बात"],
        ["2", "today", "आज बात करना चाहेंगे"],
        ["3", "prompt", "जल्दी मदद चाहिए"],
      ],
    },
  ],
};

function normalizedIvrState(state = {}) {
  ensure(
    state && typeof state === "object" && !Array.isArray(state),
    "A phone-flow state is required.",
  );
  const language = state.language ?? "en";
  ensure(LANGUAGES.has(language), "Choose English or Hindi.");
  const step = state.step ?? 0;
  ensure(
    Number.isInteger(step) && step >= 0 && step <= 4,
    "The phone-flow step is invalid.",
  );
  const answers = state.answers ?? {};
  ensure(
    answers && typeof answers === "object" && !Array.isArray(answers),
    "The phone-flow answers are invalid.",
  );
  // Never accept arbitrary note text through the answer map.
  const clean = {};
  for (let i = 0; i < Math.min(step, 4); i++) {
    const question = QUESTIONS[language][i];
    ensure(
      question.options.some((option) => option[1] === answers[question.id]),
      "Complete the earlier phone questions in order.",
    );
    clean[question.id] = answers[question.id];
  }
  return { language, step, answers: clean };
}

function ivrNote(state) {
  const { language, answers } = state;
  const hi = language === "hi";
  const parts = [];
  if (answers.wellbeing)
    parts.push(
      hi
        ? {
            usual: "आज हमेशा जैसा ठीक महसूस कर रहे हैं।",
            changed: "आज कुछ अलग महसूस हो रहा है।",
            help: "मदद चाहिए; देखभाल टीम से बात करना चाहते हैं।",
          }[answers.wellbeing]
        : {
            usual: "Feeling as usual today.",
            changed: "Feeling different from the usual routine today.",
            help: "Help requested; would like to speak with the care team.",
          }[answers.wellbeing],
    );
  if (answers.medicines)
    parts.push(
      hi
        ? {
            taken: "तय योजना के अनुसार दवा ली।",
            missed: "दवा नहीं ली; एक खुराक छूट गई और समीक्षा चाहिए।",
            review: "दवा की योजना की समीक्षा चाहिए।",
          }[answers.medicines]
        : {
            taken: "Medicines recorded as taken according to the agreed plan.",
            missed: "Missed a medicine dose; coordinator review requested.",
            review: "A medicine-plan review was requested.",
          }[answers.medicines],
    );
  if (answers.daily_routine)
    parts.push(
      hi
        ? {
            usual: "खाना और नींद हमेशा जैसे हैं।",
            less_food: "खाना कम खाया; भूख कम है।",
            less_sleep: "नींद कम आई।",
          }[answers.daily_routine]
        : {
            usual: "Eating and sleeping are as usual.",
            less_food: "Eating less; low appetite mentioned.",
            less_sleep: "Sleeping less than usual.",
          }[answers.daily_routine],
    );
  if (answers.support)
    parts.push(
      hi
        ? {
            routine: "तय समय पर संपर्क जारी रखें।",
            today: "आज कोऑर्डिनेटर से बात करना चाहते हैं।",
            prompt: "जल्दी मानवीय मदद और संपर्क चाहिए।",
          }[answers.support]
        : {
            routine: "Continue the agreed routine check-in.",
            today: "A coordinator call today was requested.",
            prompt: "Prompt human follow-up requested.",
          }[answers.support],
    );
  return parts.filter(Boolean).join(" ");
}

export function buildIvrPrompt(state = {}) {
  const normalized = normalizedIvrState(state);
  const question = QUESTIONS[normalized.language][normalized.step];
  if (!question)
    return {
      questionId: null,
      prompt:
        normalized.language === "hi"
          ? "धन्यवाद। आपकी बात दर्ज हो गई है। देखभाल टीम इसकी समीक्षा करेगी।"
          : "Thank you. Your answers are saved for the care team to review.",
      options: [],
      nextStep: 4,
      complete: true,
      ...normalized,
    };
  return {
    ...normalized,
    questionId: question.id,
    prompt: question.prompt,
    options: question.options.map(([digit, value, label]) => ({
      digit,
      value,
      label,
    })),
    nextStep: normalized.step + 1,
    complete: false,
  };
}

export function processIvrAnswer(state, digit) {
  const current = normalizedIvrState(state);
  ensure(current.step < 4, "This phone check-in is already complete.");
  ensure(
    typeof digit === "string" || typeof digit === "number",
    "Press 1, 2 or 3.",
  );
  const question = QUESTIONS[current.language][current.step];
  const option = question.options.find((item) => item[0] === String(digit));
  ensure(option, "Press 1, 2 or 3.");
  const next = {
    language: current.language,
    step: current.step + 1,
    answers: { ...current.answers, [question.id]: option[1] },
  };
  const prompt = buildIvrPrompt(next);
  const helpRequested =
    next.answers.wellbeing === "help" || next.answers.support === "prompt";
  const callRequested =
    helpRequested ||
    next.answers.support === "today" ||
    next.answers.medicines === "review";
  return {
    ...prompt,
    state: next,
    note: prompt.complete ? ivrNote(next) : null,
    requiresHumanReview:
      helpRequested ||
      next.answers.medicines === "missed" ||
      next.answers.daily_routine === "less_food" ||
      next.answers.daily_routine === "less_sleep",
    helpRequested,
    callRequested,
    mood: helpRequested
      ? "help"
      : next.answers.wellbeing === "changed" || callRequested
        ? "okay"
        : "good",
    channel: "phone-simulator",
    externalDelivery: false,
  };
}

/**
 * Small testable WebRTC controller. Construction never opens a microphone.
 * start() / answer() must only be called from an explicit user action.
 * Dependencies make permission, signaling and cleanup behavior testable offline.
 */
export function createVoiceConnection({
  getMedia,
  createPeer,
  send,
  onRemoteStream = (_stream) => {},
  onState = (_state) => {},
}) {
  let peer = null;
  let stream = null;
  let stopped = false;
  let generation = 0;
  let pendingIce = [];
  let muted = false;
  async function prepare() {
    ensure(!stopped, "This voice connection has ended.");
    if (peer) return peer;
    const version = generation;
    const acquired = await getMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    if (stopped || version !== generation) {
      acquired.getTracks().forEach((track) => track.stop());
      throw new CommunicationError("The voice request was cancelled.");
    }
    stream = acquired;
    try {
      peer = createPeer({ iceServers: [] });
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.onicecandidate = (event) => {
        if (!event.candidate || stopped) return;
        Promise.resolve(
          send({ type: "ice", candidate: event.candidate.toJSON() }),
        ).catch(() => onState("signaling-error"));
      };
      peer.ontrack = (event) => {
        if (!stopped && event.streams?.[0]) onRemoteStream(event.streams[0]);
      };
      peer.onconnectionstatechange = () => {
        if (!stopped) onState(peer.connectionState);
      };
      onState("connecting");
      return peer;
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
      peer?.close();
      peer = null;
      throw error;
    }
  }
  async function flushIce() {
    if (!peer?.remoteDescription) return;
    const queued = pendingIce;
    pendingIce = [];
    for (const candidate of queued) await peer.addIceCandidate(candidate);
  }
  return {
    async start() {
      const connection = await prepare();
      const offer = await connection.createOffer();
      ensure(!stopped, "The voice request was cancelled.");
      await connection.setLocalDescription(offer);
      await send({
        type: "offer",
        sdp: connection.localDescription?.sdp ?? offer.sdp,
      });
    },
    async answer(offer) {
      ensure(
        offer?.type === "offer" && typeof offer.sdp === "string",
        "A caller offer is required.",
      );
      const connection = await prepare();
      await connection.setRemoteDescription({ type: "offer", sdp: offer.sdp });
      await flushIce();
      const answer = await connection.createAnswer();
      ensure(!stopped, "The voice request was cancelled.");
      await connection.setLocalDescription(answer);
      await send({
        type: "answer",
        sdp: connection.localDescription?.sdp ?? answer.sdp,
      });
    },
    async receive(payload) {
      ensure(
        payload && typeof payload === "object",
        "A voice signal is required.",
      );
      if (stopped) return;
      if (payload.type === "ice") {
        ensure(
          payload.candidate && typeof payload.candidate === "object",
          "An ICE candidate is required.",
        );
        if (!peer?.remoteDescription) pendingIce.push(payload.candidate);
        else await peer.addIceCandidate(payload.candidate);
      } else if (payload.type === "answer") {
        ensure(
          peer && typeof payload.sdp === "string",
          "Start a voice request before accepting an answer.",
        );
        if (peer.signalingState === "stable" && peer.remoteDescription) return;
        await peer.setRemoteDescription({ type: "answer", sdp: payload.sdp });
        await flushIce();
      } else if (payload.type !== "offer")
        throw new CommunicationError("Unsupported voice signal.");
    },
    setMuted(value) {
      muted = Boolean(value);
      stream?.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
      return muted;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      generation++;
      pendingIce = [];
      if (peer) {
        peer.onicecandidate = null;
        peer.ontrack = null;
        peer.onconnectionstatechange = null;
        peer.close();
      }
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      peer = null;
      onState("ended");
    },
    get active() {
      return !!peer && !stopped;
    },
    get muted() {
      return muted;
    },
  };
}
