# Collaborator integration and website release — 30 October 2026

> Historical checkpoint: the current website is https://swasthsync.vercel.app/. Earlier website addresses below are retired; see [domain migration](DOMAIN_MIGRATION_2026_10_30.md).


Public website: https://samarth-care-codeburners.vercel.app/

The original development repository was fetched over HTTPS. Local `main` fast-forwarded from `df83e3c` to `edbcde91927bc243c57c3eee6cff600609f7dd7d`, incorporating `8071193` (UI polish) and `edbcde9` (SwasthSync branding). No GitHub push or showcase-repository update was performed.

Local uncommitted work was backed up before integration. Five conflicts were resolved in the public portal, account console, landing styles, workspace styles and main page. The result retains collaborator branding and design alongside mobile navigation, password controls, incoming phone help, SMS language understanding and the current cloud notification integration. All 28 previously untracked source files were restored without content loss. The local stash remains available as a recovery checkpoint.

## Deployment

- Deployment: `dpl_7EPioibzZfN4vRBbCVwM8iDh66r3`, production, READY.
- Existing Vercel project: `prj_qFF1AwMbffciaSOKVfsoMRfwCcwr`, CodeBurners.
- Runtime source: 264 files; SHA-256 `d21953bf16c092d41f3e5a856657f715161fc96828df0bef594a62ff2231aaf8`.
- This source includes local uncommitted work; it is not the unchanged upstream commit.
- Uploaded from a reviewed source folder outside Git, with credentials, local environment files, generated output, private tooling, test fixtures and documents excluded. The staged production build was verified before promotion to the existing domain.
- No database or scoring-algorithm changes were introduced by the collaborator commits. Existing Supabase phone/family notification changes remain active.

## Verification

The full local regression suite passed 456 tests. The production build and TypeScript check passed. The full lint command still reports 88 existing errors in CareExtensions, VoiceRoom and the main page. The affected portal/account components have no lint errors; the main page's error counts by rule match upstream. A merge-induced missing icon reference was fixed rather than suppressed.

The staged release passed real Supabase staff sign-in, secure cookies, role selection, the authorized phone queue, helpline configuration, rejection of unsigned ingestion/sending, an actual Android gateway probe and a signed heartbeat. Public production then passed staff login, queue/routing reads, home/demo/auth responses and anonymous queue rejection. Verification sent no SMS and did not change user passwords or create accounts.

Browser checks confirmed SwasthSync branding, desktop rendering, working Operations/family sign-in dialogs and public registration restricted to family/senior choices. At phone width there was no horizontal overflow; all four portal buttons were enabled and had 15px labels and approximately 48px height. Browser error logs were empty. The temporary viewport override was reset.

Family SMS delivery still requires the family member's confirmed SMS-enabled mobile number. The user chose to provide it later. Existing handset-delivery limitations are recorded separately in `SMS_DEPLOYMENT_2026_10_30.md`.
