# Five-minute showcase: reference-informed mode

## Preparation

Use fictional inputs. Confirm `SAMARTH_DATA_MODE=reference-informed` and read the current cohort window. It contains 200 identities over 90 days, ending on the configured date. Do not quote an old fixed date or legacy benchmark. Hosted roles require assigned memberships. Local fixtures are loopback-only; sign out before entering another identity.

Run `node scripts/evaluate-realistic.mjs` and open `outputs/realistic-evaluation.json`. Keep the separate evaluation labels outside report-model input. The [four-page technical write-up](Samarth-Care-Technical-Writeup.pdf) now describes this reference-informed edition and its authored-scenario evaluation; it makes no clinical accuracy claim.

If demonstrating an LLM, verify the n8n workspace, model credentials and allowance first. If unavailable, show **Computed evidence report (no LLM)**. For a real call/SMS, prepare a verified, consented contact you control and the configured provider or Android/SIM path. Provider acceptance is not delivery. Do not contact an unintended number to fill a demo slot.

## 0:00-0:35 - A coordinator's daily decision

"A missed medicine, reduced activity and a quieter check-in can each look small. Samarth Care joins recorded signals so a coordinator can decide who needs attention, why, and what should happen next. The person makes the care decision."

Open the priority queue. Show its synthetic provenance and actual dates. Immediate concerns lead; incomplete data is unknown rather than reassuring green. Open a senior's personal reference, recent evidence and next human action.

## 0:35-1:25 - Realistic records and a traceable report

Show a dated BP reading or medicine count and its source. Missing medicine logs are excluded, not treated as missed doses. A fall is one incident, and recovery changes gradually.

"Starting distributions use aggregates from MITRE Synthea. It remains synthetic US EHR data, not real Indian patients. Daily correlation, gaps and schedules are explicit assumptions. We check for contradictory notes and impossible entries."

Generate an English or Hindi report. Follow a highlight to its evidence and coverage. Show the computed label or, after an actual configured n8n execution, provider/model and evidence-locked status.

"The model selects verified facts and a warm presentation. It cannot invent a reading, diagnosis, call or outcome. The server renders the facts and rejects unsupported claims. Family delivery requires coordinator review."

## 1:25-2:10 - A bilingual signal and human response

Add this fictional note:

> Aaj bhookh kam hai. Dawai bhool gayi. Feeling lonely this week.

Show cues, source wording and changed reasons. If the score is capped, show added evidence instead of promising a rise. Acknowledge the alert and document a fictional outcome. Explain why urgent reports cannot be snoozed and new urgent evidence can reopen a handled flag.

"The local Hindi, English and Hinglish extractor has bounded vocabulary, negation and subject handling. It supports verification, not general medical language understanding. Isolation Forest contributes anomaly evidence alongside personal rules."

## 2:10-3:00 - Low-tech input and optional sensors

Walk through four Hindi wellbeing questions. Show saved answers and a requested follow-up. State whether this is assisted entry, keypad simulation or a verified live provider call. For a tested call/SMS, show its actual provider/device state and receipt without revealing the private number.

"n8n coordinates. A telephone network or SIM carries a real call or text. We distinguish queued, accepted, delivered and answered. A browser simulation never counts as a completed phone call."

If prepared, show a short permissioned foreground motion session, then stop it. Never ask a senior to fall or perform a dangerous action. A motion candidate needs human verification; a still phone does not prove that its owner is inactive.

## 3:00-3:45 - Consent and family delivery

Approve the reviewed report in the delivery center. Distinguish processing, provider acceptance and recipient read. Push contains only a generic prompt; details require sign-in.

Switch to the linked family identity. Show consented information, then revoke sharing as coordinator and verify denied access. Explain email-bound invitations and fresh scope checks. Avoid real invitations or external messages unless those are specifically intended.

"A public landing does not make records public. Database policies enforce scope. n8n receives masked computed facts, not raw notes, contact details or a senior's identity. Masked health aggregates remain sensitive."

## 3:45-4:35 - Honest measurements and feedback

Show the active data-mode label and use these **seed-1042026 authored-scenario figures**:

- Existing review threshold **30**: **4/4 held-out scenarios**, **48/80 scenario-days (60.0%)**, mean first review **3.75 days after onset**.
- Existing high threshold **60**: **3/4 scenarios**, **16/80 days (20.0%)**. There are **49 high flags on unlabelled days**, not automatically false alarms.
- Clinical precision, recall, F1 and disease prediction are **not established**. Do not use the old 93.7% as current accuracy.

Show acknowledgment latency separately from completion duration. Mark usefulness and inspect its training state: enough balanced labels and an identity-group holdout are required. Until then it collects feedback. The usefulness model cannot lower an urgent flag.

## 4:35-5:00 - Stretch goals and honest boundaries

"The implemented paths cover Hindi voice check-in, evidence-locked weekly reports, foreground motion candidates, usefulness feedback and missed-dose patterns. We show whether a provider is configured and what actually happened. No output diagnoses a senior or changes medication."

Leave evidence and next human action visible. State any pending n8n credentials, provider/hardware, delivery or two-device acceptance. Next steps before real care use are adjudicated data, expert validation, accessibility testing and measured scale/cost. Synthetic realism alone is not clinical reliability.
