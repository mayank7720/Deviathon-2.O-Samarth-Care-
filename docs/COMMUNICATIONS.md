# Original in-app and simulated communications

This page documents the original inbox, simulation and browser-audio module. The new real-device SMS, assisted call and optional credited-provider bot are described separately in [TELEPHONY.md](TELEPHONY.md); [N8N.md](N8N.md) describes orchestration. The source includes these adapters, while live acceptance still needs the user's device/credit configuration. Statements below about simulated SMS/PSTN apply to the original simulator channels, not the new real-device queue.

Samarth Care uses no paid AI, SMS, telephone, or relay API in this showcase. The application can save an in-app message, demonstrate an SMS preview, and run a Hindi or English phone-flow simulation. All delivery records state whether anything actually left the application.

## Available channels

| Channel                | Actual behavior                                                                              | Delivery label                        |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------- |
| In-app message         | Persists a message in the authorized care inbox                                              | `delivered_in_app`                    |
| SMS simulation         | Saves the proposed text and outcome for a demonstration; no phone number is contacted        | `simulated`                           |
| Phone / IVR simulation | Runs four prompts and keypad choices, then records the answers for coordinator review        | `simulated`                           |
| Browser voice room     | Uses direct WebRTC audio between two authorized browser participants on a compatible network | Actual browser audio connection state |
| Generic browser push | Explicitly enrolled browser receives a generic notification through its push service | Outbox records queued, delivered/service-accepted, failed or read |
| Signed phone input | A trusted operator or bridge submits four structured answers with HMAC authentication | Ingestion acknowledgment; no outbound call receipt |

An in-app delivery label does not prove that a person has read the message. It also does not mean an email, push notification, SMS, or telephone call was delivered. Phone and SMS simulations never present a telecom delivery receipt.

The daily delivery center is a separate workflow from manually saved inbox messages. It deduplicates weekly family updates and serious alerts, checks current recipient access and consent at processing time, and records attempts and failures. Weekly drafts remain `pending_review` until a coordinator approves them; families see a pending placeholder rather than the draft. Approved, processed updates appear in their inbox with independent read status. Browser push requires explicit subscription and configured VAPID keys; no permission prompt runs on page load. Push text contains no names, readings, messages or health notes. The recipient opens the authenticated care inbox for details. A push-service acceptance is not a recipient read receipt.

## Consent and message content

The server must authorize the sender, recipient, workspace, and senior assignment on every action. A family member can only use their assigned senior's consent-approved care channel. Consent is required for family-directed messages and is checked again when reading the inbox. Senior and family replies go to the assigned coordinator; operations can inspect outcomes but cannot send care instructions.

Generated English and Hindi templates request a human check-in or review. They do not name a disease or prescribe treatment. The optional custom-message validator rejects several direct diagnostic assertions; it is a limited safeguard, not a complete medical-language classifier. A coordinator remains responsible for human-authored communication.

`redactText` masks common email, telephone, and identifier formats in a demonstration export. Names, contextual descriptions, rare identifiers, and other details can remain. This helper is not sufficient for sharing real health records with an external service. The free showcase has no external inference service.

## Four-question phone flow

`buildIvrPrompt` and `processIvrAnswer` implement the same deterministic questions in Hindi and English:

1. Is today's wellbeing usual, changed, or in need of support?
2. Were medicines taken according to the agreed plan, was a dose missed, or is a plan review needed?
3. Are eating and sleeping usual, has eating reduced, or has sleep reduced?
4. Is a routine call, a call today, or prompt support requested?

Each step accepts only 1, 2, or 3. Earlier answers must be valid before the next question is accepted. The final note reflects selected answers, without inventing additional symptoms. A request for support remains flagged even if later answers describe an ordinary routine. The final result supplies `helpRequested`, `callRequested`, `requiresHumanReview`, and a plain-language note so the server can create an appropriate coordinator task.

The web simulation does not call a basic phone. A coordinator can ask the four questions during an ordinary call and record the answers from their own authorized device; the senior needs no app. The [signed phone gateway](PHONE_GATEWAY.md) accepts the same bounded answers from a trusted operator or self-hosted bridge. A real carrier/SIP bridge still needs phone infrastructure, caller identity, tested consent and actual delivery handling; this repository does not establish that such a bridge is connected or free to operate.

## Browser voice rooms

`app/components/VoiceRoom.tsx` provides a free browser-to-browser audio option. The user must choose **Start browser voice call** or **Answer** before microphone permission is requested. It does not request a camera, record audio, transcribe a call, or send audio to a model. The browser handles media negotiation and transport through WebRTC. See the [WebRTC peer connection guide](https://webrtc.org/getting-started/peer-connections-advanced) and [W3C WebRTC specification](https://www.w3.org/TR/webrtc/).

The application exchanges offer, answer, and ICE connection information through role-checked server endpoints. Signaling data can contain network information and temporary connection credentials. The routes expose it only to the initiator and one atomically claimed recipient, enforce senior scope and current consent, reject late signals after a room ends, and expire abandoned rooms after 15 minutes. End deletes connection signals immediately; new room creation also removes signals older than 30 minutes. This connection metadata is distinct from the audio stream.

The connection uses `iceServers: []`: no external STUN server and no paid TURN relay. This keeps the showcase independent of those services but means different networks, strict firewalls, or NAT configurations may prevent audio. Demonstrate with two authorized accounts on the same Wi-Fi or local network. Use headphones to avoid feedback. This feature is not a telephone call, guaranteed delivery channel, or emergency service.

Microphone access requires a supported browser and a secure context such as HTTPS or loopback development. The browser controls the permission prompt. [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

The component stops local media tracks and closes the peer connection on End, unmount, page leave, or failure to revalidate room access. Family consent withdrawal blocks both parties from further signaling; the polling client stops local media when access is denied. It cancels an unanswered connection after 60 seconds and limits a showcase call to 15 minutes. If a microphone permission request resolves after cancellation, the returned tracks are immediately stopped. A failed server update cannot prevent local microphone cleanup. Remote audio has visible controls in case a browser requires an additional Play gesture.

### Voice signaling API contract

| Request                                             | Purpose                                           |
| --------------------------------------------------- | ------------------------------------------------- |
| `POST /api/voice/rooms` with `{seniorId}`           | Create an authorized ringing room                 |
| `GET /api/voice/rooms`                              | List authorized active rooms                      |
| `GET /api/voice/rooms/:id`                          | Read room state and authorized connection signals |
| `POST /api/voice/rooms/:id/signal` with `{payload}` | Save an offer, answer, or ICE candidate           |
| `PATCH /api/voice/rooms/:id` with `{status}`        | Claim recipient slot as active, or end a room     |

The component expects `session.userId`, `room.createdBy`, and `signal.senderId` to use the same stable identity. It ignores its own signals and deduplicates received signal IDs. It queues ICE candidates until a remote description has been installed, as required by the [addIceCandidate API](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addIceCandidate).

## Verification

Run `node --test tests/communications.test.mjs tests/communication-routes.test.mjs`. Tests cover simulated delivery labeling, role and consent boundaries, safe generated templates, invalid payloads, contact-format masking, complete English/Hindi IVR sequences, help persistence, invalid/replayed answers, and a mocked WebRTC lifecycle. Route tests use SQLite to verify persisted inbox scope, recipient read receipts, final IVR save-once behavior, participant claiming, private signaling, consent revocation, expiry, and End cleanup. The mocked tests establish controller behavior; they do not establish microphone quality, NAT traversal, or an actual two-device audio connection. Live audio remains a manual acceptance check with two authorized participants.
