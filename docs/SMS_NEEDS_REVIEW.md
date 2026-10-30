# Additional SMS needs: review boundaries

`sms-care-needs-v1` adds 14 authored categories alongside the existing Hindi/English/Hinglish note cues: medicine supply, extra dose, medicine-schedule questions, dizziness, fainting, mobility help, speech difficulty, vomiting, loose stools, fluid-intake difficulty, feeling feverish, swelling, urinary discomfort and help arranging care.

These are reported-language cues with bounded subject, negation and history checks. They do not establish a condition, medication interaction, event probability or clinical diagnosis. Each saved cue retains source evidence. The same request, contact matching, consent, duplicate protection and human-response workflow apply. No health text is sent to a remote model.

The trained synthetic intent model remains in shadow mode after failing its release gate. This lexicon expansion is not a newly trained model, and no clinical accuracy percentage is claimed. New data must be labelled independently by coordinators before any model-only alert path is enabled.

Reported extra doses, fainting, new speech difficulty and inability to stand or walk request prompt human verification. This is a conservative routing choice, not a validated triage instrument. A coordinator must use the actual context and local emergency support where needed. No dosage, antidote, catch-up dose or medication change is generated.

Primary safety references checked on 30 October 2026:

- [NHS sudden confusion](https://www.nhs.uk/symptoms/confusion/) explains why sudden confusion requires prompt assessment and cautions against self-diagnosis.
- [NHS stroke symptoms](https://www.nhs.uk/conditions/stroke/symptoms/) identifies new speech difficulty as a potentially urgent reported change. The app does not label a message as a stroke.
- [NHS Specialist Pharmacy Service: poisoning and toxicity resources](https://sps.nhs.uk/articles/poisoning-and-toxicity-resources-to-support-clinical-decisions/) treats accidental extra doses as medicine-specific professional-review questions. The app does not implement toxicology management.

These UK references inform conservative human escalation only; they do not supply India-specific service numbers, validate the parser or replace local clinical review. Tests cover supported bilingual phrases, denied symptoms, other-person reports, questions and historical events. A new real inbound SMS test is still needed to demonstrate the expanded categories through the physical gateway.
