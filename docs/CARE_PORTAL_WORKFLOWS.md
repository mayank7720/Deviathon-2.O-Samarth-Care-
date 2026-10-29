# Care follow-ups, wellbeing updates and conversations

## Shared follow-ups

The Follow-ups page is available to an assigned coordinator, the Operations administrator, the senior, and consented family accounts linked to that senior. A household member can request support, acknowledge a follow-up, or report their part completed. Only care staff can accept, assign, progress, cancel, or complete a follow-up. Completion requires a recorded outcome. Care staff can choose an actual assigned care account as the owner; the illustrative planning roster does not grant account access.

Each update appends a revision to `care_events` as `care_request` or `care_request_state`. The database locks each request during a revision change and rejects stale, duplicate, closed-request, and unauthorized transitions. The activity list shows the saved updates. Shared request text is visible to that senior's authorized household, so confidential staff notes belong in the separate care-case record. Older private `task` records remain visible only to staff.

## Wellbeing check-in

A check-in records four answers about wellbeing, the agreed medicine plan, eating/sleeping, and preferred contact time, in Hindi or English. Staff can record answers from an ordinary phone conversation. A senior or family member can optionally submit an online reply. Family entries are labelled as family-reported observations.

Saving commits the answer record, a dated note for risk analysis, an audit record, and—when support or review is indicated—a shared follow-up in one database transaction. A failed write leaves none of these partially saved. Retrying the same check-in identifier returns its existing result. The recorded note describes reported answers; it does not name a diagnosis. The page displays recent check-in history and whether a follow-up was created.

The online check-in is not an outbound phone call. Browser voice rooms and configured phone/SMS delivery are separate communication features. A senior can continue to use a basic telephone and have the coordinator record their answers.

## Care conversations

The recipient selector lists active accounts assigned to the selected senior. It includes assigned care staff and, where sharing consent permits it, linked family and senior accounts. The server resolves and verifies the selected user ID; choosing a role alone cannot broadcast to several household members. The selector exposes a name, role and account identifier, without email addresses or phone numbers.

Each in-app message stores its exact recipient, sender and senior. Authorized assigned staff can review scoped care conversations. Household members see their own sent and received messages. Only the exact recipient can mark a message read. Participants can see its acknowledgement. Reply selects the original sender when that account is still an available contact. Older messages without an exact recipient remain read-only for staff rather than being disclosed to every account with the same role.

Family consent is checked again on reads and writes. Withdrawal removes family access to conversations, recipient lists, check-ins and shared follow-ups. Account suspension and revocation are enforced by the existing database membership checks.

SMS and telephone simulations are labelled and do not claim external delivery. Real phone/SMS delivery uses the separately configured gateway and verified account contacts. A browser voice room requests microphone access only when a person joins; opening the page does not connect a call.

## Verification

`tests/portal-care-routes.test.mjs` verifies shared request transitions, Operations management, linked-family scope, consent withdrawal, bilingual check-in persistence, retries, and rollback on write failure. Communication route tests cover exact recipients, multiple family accounts, second linked seniors, receipts, browser voice scope and consent. `tests/portal-care-hosted-rollback.sql` checks the database policies and transitions with temporary accounts and rolls back all fixtures.
