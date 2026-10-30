# Navigation repair — 30 October 2026

Production origin: https://swasthsync.vercel.app/. No GitHub push is authorized or included.

## Destinations

| Destination | Path |
|---|---|
| Public home | `/` |
| Sign-in choices | `/sign-in` |
| Senior sign-in | `/sign-in/senior` |
| Family sign-in | `/sign-in/family` |
| Coordinator sign-in | `/sign-in/coordinator` |
| Operations sign-in | `/sign-in/operations` |
| Personal account choices | `/create-account` |
| Senior/family registration | `/create-account/senior`, `/create-account/family` |
| Invitation acceptance | `/invitations` |
| Public explanations | `/how-it-works`, `/for-families`, `/questions` |
| Workspace views | `/workspace/<view>` |

The old `#care-portals` landing fragment is no longer generated, and no sign-in link scrolls to that section. A saved bookmark containing that fragment is normalized in the browser to `/sign-in`. URL fragments are not sent to the server, so this conversion is client-side.

Sign-in is a dedicated page. The workspace URL selects its current section, so refresh and browser history preserve the destination. Sidebar entries are actual links, allowing normal link copying and opening another tab. Internal action buttons navigate to the same path map. Signing out opens sign-in; the public homepage stays a public homepage even when an account is signed in.

Unknown paths return 404. `/login` and `/signin` redirect to `/sign-in`; `/workspace` opens the default workspace route. Senior/family users cannot use an administrative route to change their role: the visible destination is limited to their assigned portal, and the existing server authorization remains in force.

## Invitations and notifications

New invitations use `/invitations?role=<role>#invite=<secret>`. The secret remains in the fragment, outside HTTP paths/query logs. Legacy root invitation bookmarks keep working. The sign-in/registration flow carries the invitation into acceptance. A requested workspace destination survives sign-in only if it is a known internal path permitted for the authenticated role; arbitrary external return URLs are rejected.

Browser notifications now open `/workspace/deliveries`, navigating an existing same-origin window before focusing it. Arbitrary notification payload URLs are ignored. The installed web app starts at `/workspace`, with sign-in/role checks applied. Existing phone/SMS links retain their explicit device-action behavior; release verification does not send a message or place a call.

## Verification

- New routing tests cover public paths, all four login types, personal-only registration, workspace paths, role-limited return destinations, legacy fragment conversion, invitation secret preservation and notification navigation.
- A local production-build HTTP check visited 14 public pages and every linked public destination, checked four invalid routes, three redirects and four protected deep-link shells. It also confirmed the retired sign-in anchor is absent and unauthenticated care data remains blocked.
- Full automated suite: 484 tests passed. Next.js production build and targeted lint passed.
- Browser control remains disabled in the current session; no new screenshot, browser history interaction or mobile visual acceptance is claimed.
- No database migration, calling/SMS enablement or GitHub publishing is required for this repair.

## Published release

- Vercel deployment `dpl_2Zqa5ipTPyE4csVXdkXbpyrVzLn4` on the existing project `swasthsync`, promoted to https://swasthsync.vercel.app/.
- Reviewed runtime: 277 files; SHA-256 `d6f92d8b074aeb313cd2d4a035a6415035f16ff8e5e1cbb5f1a3a18861d38cc6`.
- Staged HTTP checks passed for 14 public pages, 11 linked destinations, all four sign-in pages, four invalid routes, three redirects and four protected deep-link shells. Staff login, bootstrap and SMS check-in reads passed too.
- The published homepage and role sign-in pages were confirmed to contain the new links. The first immediate post-promotion request briefly received the prior version during alias propagation; a fresh direct check showed the current release.
