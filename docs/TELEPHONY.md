# Real telephone delivery for the showcase

Samarth Care has a real Android SMS adapter, an assisted Android call path and an optional trial-provider Hindi/English check-in bot. The earlier **SMS simulation** and **Phone / IVR simulation** remain explicitly simulated. Use **Phone & SMS** for the real-device queue and its receipts.

The Android relay software adds **no SMS API vendor fee**. Sending an SMS or making a call still uses the phone's SIM, carrier plan, network coverage and allowance. A plan may charge, throttle or reject messages. The hackathon's n8n Pro allocation was reported as 10,000 monthly workflow executions; the exact workspace meter still needs inspection. Workflow executions and AI Workflow Builder credits do not themselves supply SMS, telephone minutes or model inference. No unlimited or permanently free carrier service is claimed.

On 29 October 2026, the official secure SMS Gateway v1.78.0 was installed from its verified release, the user's phone was USB-authorized, and port 8080 was forwarded locally. With the user-confirmed included-SMS plan, **one generic English SMS was delivered through SIM 2** to an approved number owned by the user. The public app saved accepted, sent and handset-delivery receipts. No human-read status or answered call is inferred. Gateway credentials and the number remain private; the relay is configured for Local Server mode with Cloud Server off.

## Quick launch on this Windows computer

| Action | Start here | What it actually starts |
| --- | --- | --- |
| Open the local care website | Double-click `Start Samarth Care.cmd` | The local website with real Supabase sign-in; if already running, opens that instance |
| Use local speech recognition | Double-click `Start Local Transcription.cmd` | The installed offline recognition service; keep its window open while transcribing |
| Check the USB phone without changing it | `npm run phone:check` | Read-only Android authorization, device model/version and forwarding/configuration checks |
| Process approved SMS requests | `npm run android:relay` | The authenticated relay, after the phone gateway and private settings are ready |
| Inspect the prepared SIM voice bridge | `npm run sim:check` | Read-only prerequisites; no dialing, installation or Bluetooth pairing |

The configured phone is a user-owned Realme Narzo 50 Pro running Android 14. Its presence and authorization must be checked live; neither the model name nor a past USB connection proves current readiness. If the device check says **unauthorized**, unlock the phone and accept its **Allow USB debugging** prompt. If it says **not connected**, reconnect it using a data-capable cable. Samarth Care never grants this permission itself.

The public website stays available without the laptop. Sending through your Android SIM needs the laptop relay and phone online. Local recognition needs the paired laptop service. The autonomous own-SIM voice bridge additionally needs the Linux environment described below. These are separate services, and starting the website does not silently start sending or calling.

## 1. Approve a destination you control

Sign in as a coordinator who is also the workspace administrator. Open **Phone & SMS**, expand **Approve a test phone number you control**, select the linked synthetic senior and recipient role, enter the international-format number, and confirm control and consent. Saving this contact sends nothing. This is the administrator's explicit control attestation, not an OTP verification.

Contacts are stored privately. The normal contact selector shows a masked destination. A family destination also requires current sharing consent for its linked senior. A queued request chooses the saved contact, a fixed generic care prompt, a language and a channel; it cannot supply arbitrary text or an arbitrary destination. Every request requires its own consent checkbox. The showcase caps requests to a contact at ten per 24-hour window.

Administrators may instead provision contacts through the server-only `SAMARTH_TELEPHONY_CONTACTS_JSON` setting. Never commit that setting, a real telephone number, account password or bridge secret. Contact rows are care records, not public demo data.

## 2. Pair the Android SMS gateway locally

Use a phone you own with an active SIM and a plan that permits the intended test. Install **SMS Gateway for Android** from its [official open-source project](https://github.com/capcom6/android-sms-gateway) or its linked [installation instructions](https://docs.sms-gate.app/installation/). Review the app and grant `SEND_SMS` on the phone. The showcase installation was explicitly authorized; the relay itself never installs software, grants permissions or enables debugging.

In the gateway app, enable **Local Server** and start it. Its home screen supplies the gateway's Basic Authentication username and password. The relay uses this local mode, not the third-party public cloud. Keep those credentials private. The application's [local-server guide](https://docs.sms-gate.app/getting-started/local-server/) documents `POST /message` and local authentication.

Install Google's Android Platform Tools on the computer if they are not already available. Connect the phone using USB, enable USB debugging, and accept the computer's debugging authorization on the device. Verify that only the intended device is connected:

```powershell
adb devices
adb forward tcp:8080 tcp:8080
```

On this prepared checkout, `npm run phone:check` automatically finds the ignored bundled Platform Tools executable when no explicit private `SAMARTH_ADB_PATH` is configured. It omits device serial numbers and private credential values from its report. It does not create the port forwarding, install an APK, inspect SMS history or send a test message. A report that is ready for a gateway probe still does not prove working carrier delivery.

The second command maps the computer's `127.0.0.1:8080` to the phone gateway. It does not expose the phone or gateway to the public Internet. The relay deliberately rejects private-LAN, arbitrary remote and credential-bearing gateway URLs. HTTP is accepted only for the loopback gateway connection; the public care application must use HTTPS.

If the secure gateway version requires a different local TLS setup, follow its official documentation and use a trusted local proxy or supported loopback arrangement. Do not disable certificate verification or switch to an insecure public gateway build to bypass that setup.

## 3. Configure the private relay

Create `.dev.vars.android-relay` in the project folder. This name is already excluded by `.gitignore`. Replace the placeholders locally; do not paste passwords or secrets into chat, command arguments, screenshots or source control.

```dotenv
SAMARTH_APP_URL=https://your-deployed-care-origin
SAMARTH_ANDROID_BRIDGE_SECRET=<the same random 32-or-more-character secret configured on the care server>
SAMARTH_ANDROID_GATEWAY_URL=http://127.0.0.1:8080
SAMARTH_ANDROID_GATEWAY_USERNAME=<from the phone gateway>
SAMARTH_ANDROID_GATEWAY_PASSWORD=<from the phone gateway>
SAMARTH_ANDROID_SIM_SLOT=2
SAMARTH_RELAY_EMAIL=<verified assigned coordinator email>
SAMARTH_RELAY_PASSWORD=<that account password>
SAMARTH_ANDROID_DIALER_ENABLED=false
```

`SAMARTH_ANDROID_SIM_SLOT=2` pins outgoing messages to the phone's second SIM using the gateway's 1-based `simNumber` field; `1` selects the first SIM. Other configured values fail before any gateway request. Omit the setting only when you intend to use the gateway's phone preference, which may include rotation. A previously accepted message ID is inspected and never resent merely because this setting changed. See the official [multi-SIM guide](https://docs.sms-gate.app/features/multi-sim/).

The relay needs an assigned coordinator account. Its ordinary server-mediated login obtains HttpOnly session cookies; its HMAC secret does not grant a role or replace database access checks. The server setting `SAMARTH_ANDROID_BRIDGE_SECRET` must match this file. Its signature covers the exact body, request method, API path, timestamp and nonce. Claims and receipts store durable nonce identities, and jobs use compare-and-swap leases to prevent competing relays sending the same request. Set `SAMARTH_APP_URL` to the public website origin to process its requests; a relay pointed at the local website polls that local origin instead. The phone gateway itself stays on loopback in either case.

For the local fixture showcase only, use the local origin and `SAMARTH_RELAY_LOCAL_DEMO=true` instead of coordinator credentials. This fixture shortcut is rejected for a non-loopback origin. It cannot be used to enter the hosted project.

Start the relay manually from the repository:

```powershell
node scripts/android-relay.mjs
# One inspection/processing pass instead of a persistent relay:
node scripts/android-relay.mjs --once
```

Keep the computer, USB connection, phone gateway and SIM available while demonstrating. The relay checks the authenticated loopback gateway, reports a heartbeat, and polls the care application every 15 seconds. **Device connected** means a recent signed heartbeat after a local gateway check; it does not prove carrier service or a successful SMS.

## 4. Send and verify one real SMS

In **Phone & SMS**, choose the approved test contact, **Actual SMS through Android SIM**, Hindi or English, and one generic care prompt. Confirm the contact owner's permission and queue the request. The phone relay claims the assigned job and calls the gateway with the job's stable message ID and delivery reports enabled. It checks for an existing message ID before enqueueing, so a lost response is not treated as permission to resend.

Only one short SMS segment is allowed: at most 160 ASCII characters or 70 characters for the Hindi templates. The message contains no vital reading, raw call note, diagnosis, score or family weekly report. The actual reviewed family summary remains in the protected inbox.

| Recorded state | Evidence and meaning |
| --- | --- |
| Queued | Saved in the care application; no carrier dispatch yet |
| Device claimed request | The authenticated relay holds the job lease |
| Gateway accepted | The gateway queued/prepared the request; sending is still unconfirmed |
| Carrier accepted SMS | Android's SMS API reported carrier acceptance |
| Delivery report received | The gateway reported the recipient handset's delivery receipt |
| Device reported failure | The gateway reported a sending failure |
| Human read | Never inferred from an SMS delivery report |

The relay polls for state changes for about three minutes. Some carriers omit delivery reports, and the gateway may remain at **Processed** when Android's confirmation is lost. An indeterminate state must stay indeterminate; do not blindly resend. The upstream [status-tracking documentation](https://docs.sms-gate.app/features/status-tracking/) distinguishes these states and their limitations.

To cancel, use **Cancel queued request** before the relay dispatches it. A message already accepted by the handset/carrier cannot be unsent by deleting a UI row. Consent is checked again before a job reaches the device, but a later withdrawal cannot undo a message already sent.

## 5. Assisted real calls with the same SIM

Choose **Assisted phone call**. **Get approved phone action** returns a `tel:` link only for the saved, consented destination. Open it on the phone and press **Call** in the device dialer. Alternatively set `SAMARTH_ANDROID_DIALER_ENABLED=true` in the private relay file; its USB action opens Android's `ACTION_DIAL` for the assigned destination, and the device owner still presses **Call**.

Opening a dialer records **Press Call on the phone**, not ringing, answer, completion or successful delivery. The coordinator can conduct a normal call and record its answers through the care check-in workflow. There is no automatic call recording or transcript upload. Android documents that [ACTION_DIAL requires the user to press Call](https://developer.android.com/guide/components/intents-common#Phone).

An ordinary third-party Android app cannot use the privileged `VOICE_CALL` audio source to capture both sides of a SIM call: `CAPTURE_AUDIO_OUTPUT` is reserved for system components. Therefore this relay does not pretend the stock Android SIM is an autonomous talking bot. See [Android's audio-source reference](https://developer.android.com/reference/android/media/MediaRecorder.AudioSource#VOICE_CALL).

## 6. Optional credited-provider Hindi bot

The provider path is separate from the free Android relay. It requires an enabled Twilio **Trial** account, an authorized source number, an allowed destination and actual usable voice credits for the intended country. `startTrialVoiceCall()` refuses a paid/full account. `SAMARTH_TWILIO_TRIAL_ENABLED` remains disabled until the account is deliberately connected. Current provider/country eligibility and trial restrictions must be checked in the provider dashboard; no allowance is assumed.

The server uses `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` and its configured HTTPS `SAMARTH_PUBLIC_URL`. These values belong only in protected server configuration. n8n dispatch receives an opaque saved job ID; the telephone number is resolved by the care server after contact/scope/consent checks. The optional n8n workflow is described in [N8N.md](N8N.md).

The bot asks four deterministic wellbeing questions in Hindi or English with spoken prompts and keypad responses. It uses TwiML `Gather` and a supported Google Hindi/Indian-English voice. Callbacks require the provider's HMAC signature, the assigned call ID, a private per-call credential, expiry and the saved step cursor. Final answers produce one care signal and any human follow-up; provider acceptance, ringing, answered, completed and completion of all four questions remain distinct evidence.

No speech-to-text or free-text external audio processing is enabled by this keypad flow. [Twilio's Gather documentation](https://www.twilio.com/docs/voice/twiml/gather) and [text-to-speech voice list](https://www.twilio.com/docs/voice/twiml/say/text-speech) describe the provider primitives. The user's hackathon calling-credit details are still pending, so a real autonomous carrier call has not been accepted as tested.

## 7. Prepared own-SIM voice bridge and local transcription

**Phone & SMS** includes a separate **Hindi / English voice check-in** section. Its read-only status and history are available to assigned coordinators and operations staff. Only a coordinator can queue a call, and only to an already approved contact with call permission. Each request needs its own consent confirmation. The request keeps the same idempotency key after a network error, so retrying that save does not deliberately create another call.

Live queue controls stay disabled until the server has deliberately enabled the SIM voice bridge and a recent signed bridge heartbeat is present. On this Windows setup no Linux bridge is running. The prepared bridge requires Linux, Asterisk with the Bluetooth mobile module, a paired phone, installed spoken prompts, verified two-way audio and reliable hangup. See [FREE_CALL_BRIDGE.md](FREE_CALL_BRIDGE.md) for its deployment and acceptance checklist. Do not enable the server flag just to make the button clickable.

`npm run sim:worker` defaults to the same safe inspection as `npm run sim:check`. The live worker requires the operator to pass `--allow-calls` explicitly after completing that setup. It must never interpret an accepted command as an answered call or automatically redial an uncertain submission.

The bot requests recording permission first, asks four Hindi or English wellbeing questions, and records only after permission. Audio remains on the local bridge. A completed recording can be passed to the paired recognition service; only signed transcript drafts enter the care workspace. Use **Voice notes & transcripts** to check and correct the words. Approval by a coordinator creates the care note; an unreviewed or rejected draft does not become a risk signal. See [LOCAL_SPEECH.md](LOCAL_SPEECH.md) for model setup and limitations.

## Acceptance and current limit

The code tests exercise the real adapter request format, idempotent job identity, leases, scope, consent, HMAC replay protection, accepted/sent/delivered distinctions, trial-account guard, four-question state and signed callbacks using controlled fixtures. They do not send real SMS or dial a real number.

The own-number SIM 2 SMS test has passed actual delivery acceptance, separately from fixture tests. The authenticated relay remains running against the public application and can process approved jobs while the computer, phone and Local Server remain online. Android job updates are protected by the applied database guard for scoped claims, fixed prompts, fresh consent, bounded leases, monotonic receipts and immutable terminal states; its hosted rollback regression passed. Do not repeat the completed test merely to recreate a receipt.

No carrier call has been made. An assisted call needs the device owner to press Call. A provider bot needs actual usable credits and a live callback check; the own-SIM bot needs verified Linux/Bluetooth audio and consented recording instead. Those acceptance gaps remain; a green fixture test is never presented as answered-call proof.
