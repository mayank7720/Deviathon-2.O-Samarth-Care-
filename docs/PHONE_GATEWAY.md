# Voice input without a senior app

The free showcase supports a Hindi/English four-question keypad simulation, a coordinator recording answers from an ordinary conversation, and a signed ingestion boundary for a trusted telephone bridge. A senior can answer a human's simple call while the coordinator records the answers; the senior does not need to open the website. Samarth Care itself does not place that call. The browser simulator and browser audio room are separate from telephone-network delivery.

`lib/phone-gateway.mjs` verifies structured answers submitted by an authorized operator or self-hosted bridge. It uses the same questions and response meanings as the simulator and generates a bounded note for NLP, including explicit help and call-request flags. It accepts no arbitrary dictated note, contact number, browser role, or clinical diagnosis field. Audio is neither recorded nor transcribed by this gateway.

## Server configuration

Keep these settings server-side and outside Git:

```text
SAMARTH_PHONE_GATEWAY_SECRET=<at least 32 random characters>
SAMARTH_PHONE_SENIORS=S001,S002
```

The API binds the gateway to `workspace:primary`; a signed request cannot select a workspace or grant itself a role. In standalone Supabase mode, the operator must also have a verified coordinator session and assigned senior scope, so database requests continue under that user's RLS permissions. The D1-backed gateway, including local fixtures, accepts its configured HMAC credential without a browser login. Use a distinct, revocable secret for a trusted operator and an explicit senior assignment list. The signature authenticates possession of that operator secret; it does not authenticate the person speaking on the telephone. The operator remains responsible for matching the call to the correct senior and obtaining permission for recording structured answers.

## Request contract

Send `POST /api/phone/events` over HTTPS, or loopback during development, with `Content-Type: application/json`. The maximum body is 8,000 UTF-8 bytes.

```json
{
  "version": 1,
  "callId": "synthetic_call_001",
  "seniorId": "S001",
  "language": "hi",
  "observedDate": "2026-10-28",
  "answers": {
    "wellbeing": "help",
    "medicines": "missed",
    "daily_routine": "less_sleep",
    "support": "prompt"
  }
}
```

`callId` must be an opaque 8–96 character identifier using letters, numbers, `_` or `-`. Do not put a phone number, name or email in it. The application checks `observedDate` against its allowed workspace clock before storing the event; the validator itself checks calendar validity.

| Question | Accepted answer values |
| --- | --- |
| `wellbeing` | `usual`, `changed`, `help` |
| `medicines` | `taken`, `missed`, `review` |
| `daily_routine` | `usual`, `less_food`, `less_sleep` |
| `support` | `routine`, `today`, `prompt` |

Choose `en` or `hi` for the generated note. Each actual phone prompt has three keypad choices, numbered 1–3 in that table's order. All four answers are required. Requesting help in the first question remains urgent even when later answers are ordinary.

## Signing and replay handling

Generate a random nonce of 16–96 characters using letters, numbers, `_` or `-`. Set `x-samarth-timestamp` to the current Unix timestamp in seconds and `x-samarth-nonce` to the nonce. Calculate HMAC-SHA256 using the server secret over the exact string below and send its 64-character hexadecimal representation in `x-samarth-signature`:

```text
timestamp + "\n" + nonce + "\n" + exact JSON body
```

Changing whitespace after signing invalidates the signature. The server allows five minutes of clock skew. The signature uses Web Crypto verification rather than comparing secret strings. Missing or invalid signatures fail before the JSON is interpreted.

Successful validation returns a deterministic `eventId` derived from the nonce and a separate `callEventId` derived from the opaque call ID. The API commits the clinical signal and audit event together using both unique identities. Reusing either the nonce or call ID returns HTTP 409; the transaction rolls back without a partial signal or audit entry. Keep the same nonce and call ID when retrying after a connection failure. Validation alone does not implement replay protection; durable storage enforces it.

The acknowledgment confirms that answers were ingested. It does not establish that Samarth Care dialed a number, that a recipient heard a prompt, or that a clinician responded. Inspect actual care acknowledgment and outcome records separately.

## A real basic-phone demonstration

For a free demonstration, a coordinator can use an existing ordinary phone connection, ask the four questions, and enter the answers from their own authorized device. The senior only needs to speak or press keys. A self-hosted SIP/telephone bridge could sign the same structured request, but telephone hardware, carrier access, caller identity and actual network integration must be supplied and tested separately. This repository does not claim that such a bridge is running or that carrier calls/SMS are free.

Run `node --test tests/phone-gateway.test.mjs tests/api-workflows.test.mjs` for signature tampering, expiry, assignment restrictions, invalid input, help preservation and durable nonce/call-reuse checks. The API tests exercise actual SQLite transactions and duplicate rollback. Those tests use synthetic data and make no telephone calls.
