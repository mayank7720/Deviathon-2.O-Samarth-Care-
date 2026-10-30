# Six-minute showcase walkthrough

Use one fictional senior throughout. Prepare the actual website, saved records and source files before evaluation. Hosted access needs an assigned account; never publish evaluator passwords.

| Time | Demonstration | Explain |
|---|---|---|
| 0:00-0:40 | Incoming help | A registered senior can send HELP without a website login. Voice-only access remains unfinished. |
| 0:40-1:40 | Matched HELP request and transport receipts | Show senior identity, assigned coordinator, issue labels and consented family routing. Plain HELP means the reason is unconfirmed. |
| 1:40-2:55 | Care queue and Risk & wellbeing | Explain one dated personal change, its supporting observations and the recommended human action. |
| 2:55-3:45 | Follow-ups | Show the responsible person, due date, contact outcome and saved history. Delivery is separate from completed care. |
| 3:45-4:30 | Medication patterns | Compare logged taken/missed/unknown outcomes and day/week/month grouping. No record is not a missed dose. |
| 4:30-5:30 | Existing weekly AI draft | Inspect evidence and model provenance, then explain review and named family sharing. A saved draft is not yet an approved family report. |
| 5:30-6:00 | Architecture and limitations | Explain the application, cloud store, model and transport boundaries. |

## Preparation

1. Use synthetic records. Confirm the cohort dates and current score version. Keep an existing genuine model draft available; another generation is optional and consumes allowance.
2. For a fresh SMS, verify a current Gateway/receiver heartbeat and the intended registered test contacts. Keep the phone, SIM and laptop online. Check queued work before starting a relay.
3. If hardware or network is unavailable, show actual previously stored request and delivery evidence, clearly labelled as historical. A screenshot or prerecorded backup must not be described as live.
4. Keep source files, the frozen evaluation and test results ready. Use [architecture](ARCHITECTURE.md) and [status](PROJECT_STATUS.md) for current claims.

## Fictional note example

> Aaj bhookh kam hai. Dawai bhool gayi. Feeling lonely this week.

Show the supported cues and their source. A change in evidence need not increase an already capped score. Do not fabricate a response, contact, sensor event or transport receipt to complete the demonstration.

## Technical explanation

The scorer combines explicit rules, measured personal references, a calibrated Isolation Forest and sustained changes. n8n handles a separate evidence-locked weekly report path. Postgres stores care records and workflow states; the Android relay supplies SMS transport. Human review owns the care decision.

## Measurements to quote correctly

The representative risk-v3 synthetic evaluation contains two authored cases and 40 labelled days. Review priority covers 28/40 days (70%); high priority covers 17/40 (42.5%). Mean first review is four days after authored onset. These figures do not establish clinical accuracy or early detection. Do not quote an earlier model's metrics as current results.

The separate SMS classifier remains in shadow mode after failed release gates. The AI call bot is under development and excluded from the live showcase. Two-way SMS check-ins have not completed physical question-and-reply acceptance. [Full boundaries](PROJECT_STATUS.md)
