# Prepared SIM voice check-in bridge

The website has a protected queue for a Hindi or English four-question phone check-in. A deliberately started Linux worker can originate a call through Asterisk's Bluetooth mobile channel and an existing SIM. The answered channel asks for recording permission, then records four short answers and sends each to the local speech service. Signed transcripts enter the coordinator's review queue; the worker never approves them or invents a health observation.

This is prepared code, not a verified working connection to the Realme Narzo 50 Pro. The available computer is Windows and no Linux system was supplied. No Linux installation, Bluetooth pairing, outbound call, SIM charge or recipient recording was performed. A USB connection used for Android SMS does not provide this Bluetooth call audio path. Ordinary WSL is not treated as a verified Bluetooth host.

## What “free” covers

This route has no telephone API vendor or per-minute model fee. It still uses the existing SIM/carrier plan, a compatible Linux Bluetooth controller, local CPU resources and the owner's authorized test destination. Existing plan limits and carrier charges apply. n8n Pro does not supply carrier minutes, verified phone numbers, audio routing or model inference simply by orchestrating a workflow.

The Android SMS relay remains a separate path documented in `TELEPHONY.md`. Its actual delivery status comes from the phone gateway. A call queue entry, Asterisk CLI exit, recorded answer, transcript, family delivery and completed human follow-up are different events.

## Prepared files

| File | Purpose |
|---|---|
| `bridge/asterisk/chan_mobile.conf.sample` | One paired Bluetooth adapter and one mobile device; placeholders require local configuration. |
| `bridge/asterisk/extensions.conf.sample` | Dedicated answered-call context, four-minute absolute duration and a closed unsolicited inbound context. |
| `bridge/asterisk/prompts.json` | Hindi and English consent, four questions, decline and closing text. |
| `bridge/asterisk/generate_prompts.py` | Optional local eSpeak NG prompt generation; supplies no online voice service. |
| `bridge/asterisk/samarth_checkin.py` | Local AGI protocol; recording starts only after the recipient presses 1. |
| `bridge/asterisk/adapter.mjs` | Validated destination/device tokens, fixed spool paths and shell-free command arguments. Importing it never dials. |
| `scripts/check-call-bridge.mjs` | Read-only local prerequisites; no installation, module loading, pairing or calling. |
| `scripts/sim-call-worker.mjs` | Normal coordinator login, signed single-use claim, one originate attempt, terminal evidence and reviewed transcript drafts. Defaults to check-only. |
| `tests/sim-call-hosted-rollback.sql` | Administrator-run database authorization/state regression with rollback; makes no calls. |

## Linux preparation, when a Linux host is available

Use a distribution-supported Asterisk build with the optional `chan_mobile.so` driver, BlueZ, a compatible Bluetooth controller, Python 3, and Node.js 22.13 or later. The mobile driver is optional and not assumed to be installed or enabled. The Realme/Android combination must be tested for two-way speech audio, DTMF, answer state and reliable hangup. A working Bluetooth headset connection by itself does not prove Asterisk compatibility. Follow the installed Asterisk version's instructions; do not expose a public SIP or manager endpoint for this prototype.

Read the installed Asterisk directory settings before installing the dedicated AGI script. Merge the provided dedicated contexts into the existing dialplan; preserve unrelated configuration. Use the current build's mobile config filename: current upstream reads `chan_mobile.conf` and has a legacy `mobile.conf` fallback. The older mobile-channel manual names `mobile.conf`; the checked-in sample follows current upstream source.

Prepare these fixed private directories for the same service account that runs the worker and AGI:

```text
/var/lib/samarth
/var/lib/samarth/jobs
/var/lib/samarth/results
/var/lib/samarth/recordings
/var/lib/samarth/control
/var/lib/asterisk/sounds/samarth/hi
/var/lib/asterisk/sounds/samarth/en
```

The spool directories must be real directories, not symbolic links, and must not be writable by another account. Use private permissions such as `0700` and files `0600`. Keep the Asterisk control socket accessible only to the service account that needs it. Store the supplied AGI script in the installed AGI directory and make it executable. No manager connection is required by this worker; the sample manager interface remains disabled.

Install or record the seven prompts per language as uncompressed 8 kHz mono 16-bit PCM WAV files in the corresponding sound directories. Confirm they are understandable on the basic phone's speaker. The AGI rejects missing, invalid or overly long prompts. Each question allows at most 30 seconds of audio, `#` finishes the answer, and three seconds of silence ends a recording. The dialplan imposes an absolute 240-second answered-call limit. The CLI originate path uses Asterisk's own 30-second dialing timeout. Neither limit proves that a particular handset always hangs up correctly; verify this before enabling it.

Run the local speech service on the **same Linux host**, paired with the application's secret and exact origin. A Windows virtual environment cannot be copied into Linux. Follow `LOCAL_SPEECH.md` for model, dependency and receipt requirements; the Windows setup helper is not a claim that Linux speech dependencies are already installed. The worker only sends audio to `http://127.0.0.1:8766`, never to a URL returned from a call note. Hindi/English recognition remains subject to explicit human review.

## Private configuration and enable boundary

Create an ignored `.dev.vars.sim-call-worker` on the future Linux host. Placeholder values below are not credentials:

```dotenv
SAMARTH_APP_URL="https://samarth-care.abloomgecko40.chatgpt.site"
SAMARTH_RELAY_EMAIL="YOUR_ASSIGNED_COORDINATOR_EMAIL"
SAMARTH_RELAY_PASSWORD="YOUR_PRIVATE_PASSWORD"
SAMARTH_SIM_BRIDGE_SECRET="A_PRIVATE_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS"
SAMARTH_ASTERISK_DEVICE="samarthphone"
SAMARTH_SIM_AUDIO_VERIFIED="false"
```

The application requires the matching private `SAMARTH_SIM_BRIDGE_SECRET` and `SAMARTH_SIM_VOICE_ENABLED=true` before accepting a live queue request. Keep that flag disabled while hardware and owned-number validation are pending. Use the app's administrator-controlled contact setup to save the verified test contact and channel consent. Database validation also requires that saved contact, so an arbitrary environment-only destination cannot bypass it. Family calls additionally require current family-sharing consent.

The speech service's allowed origins must include the exact `SAMARTH_APP_URL` origin. Keep all passwords/signing secrets in private server/local settings. The worker uses a normal assigned coordinator account and its scoped database permissions; a Supabase service-role key is neither required nor accepted as a substitute for that account.

The read-only command is safe to run without these credentials:

```text
node scripts/sim-call-worker.mjs --check
```

After the owner has verified two-way audio and hangup on an authorized controlled destination, set `SAMARTH_SIM_AUDIO_VERIFIED=true` privately. Only this explicit Linux command permits one queued call attempt:

```text
node scripts/sim-call-worker.mjs --allow-calls
```

For a manually supervised queue worker, add `--watch`. It still processes one call at a time. Running the script with no arguments performs only a check. It does not infer permission from a scheduled workflow, queued row, expired lease or a browser login.

## Actual protocol and evidence

1. A coordinator chooses a saved verified contact, Hindi/English, and explicit destination-owner consent. A stable request UUID makes an HTTP retry idempotent. The contact is limited to ten requests in a rolling day; the server and database enforce scope and current consent.
2. The worker signs its requests and logs in as an assigned coordinator. A durable nonce rejects replay. It reserves the shared single caller and claims the job once. The phone number appears only in that protected claim, not the public job list or n8n payload.
3. The worker stages a private fixed-path manifest and durable submission marker before executing one validated `execFile` command with `shell:false`. An existing manifest, result or submission marker stops processing. No arbitrary dialplan, filename, shell fragment or destination text is accepted.
4. A successful CLI process exit records only `originated`. Current Asterisk source starts the originate operation asynchronously; its exit does not prove ringing, answer, consent, audio, person identity or a care outcome. Only bounded local AGI channel evidence can report answered-channel and recorded-audio facts.
5. The answered context requires the recipient to press 1 before any answer is recorded. Decline, disconnection and partial recording remain distinct. Raw audio stays in the private Linux spool. Recorded answers become signed local transcript drafts. The coordinator must correct and approve each draft before it becomes an input to health-cue extraction.
6. If a submission response or terminal evidence is uncertain, the job becomes `submission_unknown` when the protected receipt can be saved; otherwise the existing claim remains held. The worker stops and never requeues or redials it. Caller-lock expiry alone never permits another call. A human must inspect Asterisk, the handset and private spool before an administrator performs any recovery. There is no automatic lock-clearing endpoint.

## Retention and verification limits

The private spool intentionally retains manifests, submission markers, terminal metadata and audio for inspection; the current worker does not silently delete medical recordings. Use synthetic showcase answers, obtain recording permission, and manually remove retained audio under the project's agreed retention procedure after the demonstration. A stale `worker.lock` also requires inspection; the script does not automatically steal it from another process.

The tests exercise signatures, replay, caller serialization, one-way transitions, consent, shell/path validation, unknown-outcome handling and mocked AGI audio protocol. They are software checks, not a successful real phone call. No paired Bluetooth device, carrier delivery, speech accuracy for the owner's phone or real recipient interaction has been verified by those tests.

Primary references checked 29 October 2026: [Asterisk mobile prerequisites](https://docs.asterisk.org/Configuration/Channel-Drivers/Mobile-Channel/Mobile-Channel-Requirements/), [current upstream mobile config and optional driver](https://github.com/asterisk/asterisk/blob/master/addons/chan_mobile.c), [current sample configuration](https://github.com/asterisk/asterisk/blob/master/configs/samples/chan_mobile.conf.sample), [CLI originate behavior and timeout](https://github.com/asterisk/asterisk/blob/master/res/res_clioriginate.c), and [AGI RECORD FILE command](https://docs.asterisk.org/Latest_API/API_Documentation/AGI_Commands/record_file/).
