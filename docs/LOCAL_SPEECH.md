# Local multilingual speech recognition

This service runs the actual multilingual faster-whisper model on the showcase computer. It accepts a recording, decodes it locally and returns a signed transcript receipt. No audio, transcript, senior identifier or actor identifier is sent to a speech API. Setup downloads public packages and model weights; inference does not download anything. The browser must obtain a short-lived ticket from the authenticated application first.

It is a coordinator recording tool, not a basic-phone calling provider. The senior can still speak over the separate assisted or configured telephone path. Recognition of Hindi, English and mixed speech can be imperfect; a person must check the transcript, especially medicine names, numbers and negation, before treating it as a care note. A model-generated language probability is not transcription accuracy or a clinical confidence score.

On 29 October 2026, the installed CPU/int8 base model transcribed the official Whisper 11-second English JFK fixture through an actual authenticated app ticket and HTTP upload in about 3.1 seconds. The consumed ticket returned 409 on replay. No speech API was contacted and the sample was not added to any senior's care notes. This checks one English recording; Hindi, mixed speech, health vocabulary and clinical accuracy are not validated by it.

The database also verifies the exact transcript receipt HMAC using its private Vault secret. Signed words and provenance cannot be replaced through direct Data API calls. Drafts and reviews are append-only. A scoped coordinator must approve the checked words before a single matching clinical note may be inserted. `tests/speech-hosted-rollback.sql` exercises these rules against the actual hosted database and rolls back every synthetic fixture.

## Explicit Windows setup

Use 64-bit Python 3.12 or 3.13. All Python packages stay in the checkout-local virtual environment. Choose `base` for the lower-resource default; `small` is an optional larger multilingual model. CUDA is optional and is not installed by this script.

```powershell
./scripts/setup-speech.ps1 -Python 'C:/path/to/python.exe' -Model base -DownloadModel
```

Without `-DownloadModel`, setup installs dependencies only. The explicit download uses the official Systran converted model, a fixed Git revision, and only the four required model files. It records revision, file sizes and SHA256 values in `.local-tools/speech/models/base/samarth-model.json` (or `small`). The complete installed dependency freeze is saved under `.local-tools/speech/installed-requirements.txt`. This is a recorded environment, not a fully hashed transitive dependency lock.

The configured revisions, verified against the official model repositories on 29 October 2026, are:

| Model | Revision |
|---|---|
| `base` | `ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66` |
| `small` | `536b0662742c02347bc0e980a01041f333bce120` |

Create the ignored `.dev.vars.speech` locally, with the same speech secret used by the app's ticket/receipt integration. Use at least 32 random characters, generated and stored privately. These values are examples except the secret placeholder:

```dotenv
SAMARTH_SPEECH_SECRET="REPLACE_WITH_A_PRIVATE_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS"
SAMARTH_SPEECH_ALLOWED_ORIGINS="http://127.0.0.1:5173,http://localhost:5173"
SAMARTH_SPEECH_MODEL="base"
SAMARTH_SPEECH_DEVICE="cpu"
SAMARTH_SPEECH_COMPUTE_TYPE="int8"
SAMARTH_SPEECH_THREADS="4"
```

Values may be plain strings or JSON-quoted strings. Blank lines and whole-line `#` comments are supported; shell substitutions are never evaluated. Environment values override this file. Secret/configuration files, `.local-tools/` and `outputs/` must remain ignored by Git. Do not place the secret in a browser bundle, URL, log or screenshot.

The showcase pairing additionally allows exactly `https://swasthsync.vercel.app`. The public app issues a ticket, while audio travels from the browser directly to this computer's loopback service. On the paired computer, open **Start Local Transcription.cmd**, then use **Check laptop service** in the public app. A supported browser may ask for local-network and microphone permission. Those permissions must be granted by the operator. A phone visiting the public site cannot use a service running on a different laptop at `127.0.0.1`. Browser permission acceptance is a separate check from the successful HTTP smoke test. The rest of the website runs independently of this service.

Start explicitly:

```powershell
& './.local-tools/speech/venv/Scripts/python.exe' './scripts/speech_service.py'
```

It binds only `127.0.0.1:8766`; there is no remote-listen option. `GET http://127.0.0.1:8766/health` returns engine, selected model, installed status and readiness, without local paths, account details or secrets. A missing or invalid model causes transcription to return 503; it never invokes a fallback download. Restart after installing/changing the model. For optional CUDA, configure a supported device/compute type locally and supply the appropriate CTranslate2 GPU prerequisites yourself; the CPU path needs no CUDA.

## HTTP contract

`POST /transcribe` sends raw audio bytes, never multipart data, a host path or a URL. Required headers:

```text
Origin: http://127.0.0.1:5173
Authorization: Bearer <base64url-payload>.<lowercase-hex-hmac>
Content-Type: audio/webm;codecs=opus
Content-Length: <actual byte length>
```

The ticket is issued by the app; the browser never knows the shared secret. The exact payload fields are:

```json
{"version":1,"id":"UUID","seniorId":"S001","actorId":"verified-actor-UUID-or-local-coordinator","origin":"http://127.0.0.1:5173","issuedAt":1800000000000,"expiresAt":1800000060000,"consent":true}
```

`actorId` must be a UUID or a `local-` identity containing only letters, digits, `_` and `-`. Epoch values use milliseconds. The ticket lifetime must be positive and at most five minutes; issuance allows at most 30 seconds of forward clock skew. Base64url uses UTF-8 JSON bytes without padding. Its signature is:

```text
hex(HMAC-SHA256(secret, UTF8("speech-ticket\n" + base64url_payload)))
```

The literal prefix contains one newline. The service verifies origin, host, method, ticket HMAC, schema, consent, expiry and payload bounds before reading audio. Origin values must match the configured origin and ticket exactly: no wildcard, suffix match, `null` or trailing slash. Valid browser preflight requests receive only the configured origin and `Authorization, Content-Type`; no credentials wildcard is used.

Limits are 8 MiB encoded data, one mono/stereo audio stream, 180 decoded seconds, 120 transcript segments and 6,000 transcript characters. Supported types are WAV, WebM, Ogg, MP3, MP4 and FLAC. The declared container selects a fixed PyAV demuxer; an encoded URL or playlist is not accepted as media. Decoding checks sample rate, channels, frame/sample counts, output length and work time before passing a bounded 16 kHz mono NumPy waveform to Whisper. The service does not hand untrusted filenames or a potentially unbounded encoded stream to Whisper.

Near-silence is rejected before model execution. Voice activity filtering is enabled; an empty recognition is an error, never a fabricated successful transcript. This reduces some silence hallucinations but is not a guarantee that every recognized word is correct. Large/invalid outputs are rejected rather than silently truncated. Requests are serialized; a second request gets `503 busy` without consuming its ticket or reading its recording.

A valid decoded, audible request claims its ticket ID durably in `outputs/speech-state.sqlite` before model inference. Replay returns 409 even after restart. Malformed, silent or busy requests do not consume the ticket. A recognition failure or empty ASR result after claim does consume it; request a new ticket. There is no cached transcript, so a lost successful response also requires a new ticket. SQLite retains only opaque ticket IDs, expiry and claim time, removing entries more than a day past expiry. It does not retain audio hashes, audio, transcripts, senior IDs or actor IDs.

Success is `{ "receipt": { "payload": "<raw UTF-8 JSON string>", "signature": "<hex HMAC>" } }`. The signed payload contains:

```text
version, ticketId, seniorId, actorId, origin,
model (faster-whisper:base or faster-whisper:small),
language, languageProbability, durationSeconds, audioSha256,
text, segments[{start,end,text}],
createdAt, expiresAt (createdAt + 24 hours), externalServiceUsed:false
```

Verify the exact returned payload string, without reparsing/reserializing it, using:

```text
hex(HMAC-SHA256(secret, UTF8("speech-receipt\n" + receipt.payload)))
```

The app must also recheck the current actor's role/senior scope, ticket identity, origin, expiry, consent and receipt replay before saving anything. A signature proves which configured local service produced the transcript, not who was speaking, what was medically true, or whether a person agreed with the transcript. Audio stays in process memory for the request; no recording is written by this service. Normal OS swap/crash capture and recordings independently saved by the browser remain device-management concerns. Use a computer and account appropriate for sensitive health conversations.

## Verification without pretending tests prove speech accuracy

```powershell
& './.local-tools/speech/venv/Scripts/python.exe' './tests/speech-service-test.py'
```

The boundary tests use an explicitly fake engine for HMAC binding, origin/host/method checks, durable nonce replay, limits, serialization, empty/silent outputs and generic errors. The PyAV fixture test runs only when the explicit runtime is installed. None is a clinical or Hindi speech-recognition benchmark. Tests do not open a listener or download models.

For an actual local model smoke test, import the internal helper and supply a legitimate consented recording yourself. This bypasses HTTP only for a local operator test; it does not produce a signed receipt or save a care note:

```python
import sys
from pathlib import Path
sys.path.insert(0, "scripts")
from speech_service import load_config, load_engine, transcribe_audio_bytes
config = load_config()
engine = load_engine(config)
result = transcribe_audio_bytes(Path("outputs/consented-test.wav").read_bytes(),
                               engine, mime_type="audio/wav", model=config.model)
# Inspect privately against what was actually spoken; do not publish health text.
```

Measure actual transcription time and compare English, Hindi, mixed speech, names, numbers and negation on the showcase microphone. Record only what was really tested. Never claim accuracy percentages from unit fixtures or a single synthetic utterance. This local process is for the demonstration computer; a public hosted Worker cannot access a developer's loopback service. A browser/device may also require explicit local-network permission. Remote production speech would need its own authenticated deployment and privacy review.

Primary references: [faster-whisper project](https://github.com/SYSTRAN/faster-whisper), [version 1.2.1 model/transcription implementation](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/transcribe.py), [official base model](https://huggingface.co/Systran/faster-whisper-base), [official small model](https://huggingface.co/Systran/faster-whisper-small), [PyAV audio API](https://pyav.org/docs/stable/api/audio.html), [official PyPI package](https://pypi.org/project/faster-whisper/1.2.1/). These document implementation, not our application's recognition quality.
