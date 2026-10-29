# Samarth operating context and showcase scope

Checked against public primary sources on **29 October 2026**. This independent DEV_104 hackathon demonstration uses fictional people and synthetic observations. References to Samarth explain the operating context; they do not establish endorsement, employment, access to its systems or an integration with its commercial services. Company statements below are attributed claims, not independently verified service outcomes.

## What the official sources say

| Published source | Relevant company statement | Product consequence for this showcase |
| --- | --- | --- |
| [Care Team](https://care.samarth.community/care-team/) | Families have designated Care Counsellors and Care Leaders. A counsellor generally supports no more than two families. | Represent the person who knows a family separately from the staff member reviewing a wider urgent queue. The two-family model is a published general practice, not a universal staffing guarantee. |
| [Care Counsellor recruitment](https://samarth.care/joincc/) | The role includes weekly or fortnightly visits, coordinating support and appointments, accompanying elders, help with technology and social engagement. It describes local travel and Hindi, English and local-language skills. | Record ordinary conversations, visit outcomes and wellbeing context alongside vitals. Mobile forms support staff; seniors can still provide input through an ordinary human call. |
| [Our Technology](https://care.samarth.community/app-for-elderly-care/) | Samarth describes an existing AI-supported system for health, service and engagement signals; interaction reports, family chat, service tracking and a distinct senior interface. It also advertises optional safety devices and emergency coordination. | Pitch a testable early-warning and follow-up workflow alongside existing apps. Do not claim that Samarth has no family app, no AI or no monitoring. The website does not disclose model validity or implementation details. |
| [Samarth Care for Seniors, publisher listing](https://play.google.com/store/apps/details?id=com.samarth.care) | The listed publisher is Samarth Life. Its description addresses children supporting parents at home through care teams and dedicated counsellors. | A family-facing app already exists. The showcase family view demonstrates consent-limited communication, rather than claiming to replace the publisher's product. Store descriptions are publisher claims. |
| [Care services overview](https://care.samarth.community/) | Samarth describes support at home across health, emergencies, practical assistance, safety and companionship, with families able to reach designated staff. | Escalation is a human operational responsibility. Saving an alert in this prototype does not dispatch Samarth staff, a doctor or an emergency response team. |
| [Membership terms](https://samarth.community/terms/) | The published terms distinguish subscriber, elder and designated next-of-kin members. They allow up to two elders in the same household under the stated care plans. | A family/household and a senior are different concepts. Do not interpret the two-elders-per-plan provision as the two-families-per-counsellor statement. These terms are not adopted as this prototype's service contract. |

Public pages can change and may describe different product editions. We do not combine city counts, marketing claims or app-store descriptions into a verified performance measure. No patient records, staff identities or private operational documents from Samarth were used.

## Our interpretation for DEV_104

The brief asks a coordinator to review many seniors, while the published counsellor model emphasizes a close relationship with a small number of families. We interpret those as different work responsibilities: a counsellor knows the household and performs local follow-up; a coordinator reviews the ranked queue and tracks whether a concern reached the right person. A designated leader and backup provide an explicit route when the primary person cannot respond. The exact city-lead structure, backup rota, case states and response deadlines below are **showcase design choices**, not claims about Samarth's internal procedures.

The useful proposition is: **join recorded signals, explain a change against the senior's own baseline, name the person responsible for follow-up, and preserve evidence of what happened next.** An existing family app can consume an approved summary in a future authorized integration. This repository does not establish that integration, and the published technology page itself already claims early-intervention capabilities. The differentiator we can demonstrate is transparent evidence, personal baselines, honest missing-data handling and an inspectable human follow-up trail; a live comparison with Samarth's private system is not available.

## Showcase operating choices

The care-operations extension models fictional local counsellors, designated leaders and backup staff. Names, workloads and assignments are generated demonstration data. They are not a directory of real Samarth employees, their availability or contact details.

| Concept | Meaning in the prototype | Boundary |
| --- | --- | --- |
| Family responsibility | A named counsellor with a small assigned family list, plus a leader and backup for escalation | A display assignment does not create an Auth membership or widen a person's data access. Two families is the default illustrative allocation, not proof of real staffing capacity. |
| Coordinator queue | Staff review the urgency-ranked signals for seniors inside their verified access scope | Queue access and local counsellor responsibility remain separate. An assignment override must not grant access to an out-of-scope senior. |
| Contact attempt | A staff member records an attempt, channel and outcome, including no answer | A manual record is an attestation by that staff member. It is not a telecom receipt, answered-call proof or a completed check-in. |
| Contact confirmed | Staff explicitly record that they reached the relevant person and what follow-up is needed | Gateway acceptance, handset delivery and opening a dialer are insufficient evidence of contact. |
| Escalation | A case records a responsible leader or backup and the reason for escalation | Recording the state alone does not notify a real company, dispatch a responder or guarantee acknowledgment. |
| Resolution | A staff member records an outcome after follow-up | Closing a workflow item is not a medical all-clear. Fresh urgent evidence can still require review. |
| Assignment override | A full-scope coordinator administrator records a fictional assignment, with verified actor and history | Database capacity and revision checks prevent conflicting changes. Scoped coordinators record cases within their existing access scope. |

The operating trail should survive a busy communication feed. A history that happens to fall outside a recent-event limit must not reset a resolved case or discard an assignment. Staff-only case details must not appear in family or senior responses. Only a separately approved, consent-checked family summary belongs in the family inbox. Backend and UI acceptance for these choices is recorded in [requirements](REQUIREMENTS.md); this document is not a test report.

## Integration and claims boundary

No public Samarth API, webhook contract, authentication handoff or integration permission has been established from the inspected pages. Do not invent endpoint names, scrape real care records, copy the company's logo or present fictional counsellors as its staff. A future connection requires an authorized partner contract, explicit scope and consent, documented data mapping and separate acceptance testing.

The prototype's optional n8n workflow is our own orchestration path; its existence does not connect it to Samarth's platform. The Android relay uses the owner's paired phone and approved test destination. The trial-provider voice bot, browser audio and simulated IVR each retain their actual delivery labels. The app does not operate Samarth's advertised emergency service.

Use the existing [technical write-up](TECHNICAL_WRITEUP.md), [data provenance](DATA_REALISM.md), [phone setup](TELEPHONY.md), [n8n guide](N8N.md) and [Supabase setup](SUPABASE.md) for the implemented model, synthetic evaluation and external services that still require configuration. None of the company claims above validates our risk thresholds or converts this project into a diagnosis tool.
