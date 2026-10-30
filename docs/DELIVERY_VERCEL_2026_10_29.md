# Vercel release checkpoint — 29 October 2026

> Historical checkpoint: the current website is https://swasthsync.vercel.app/. Earlier website addresses below are retired; see [domain migration](DOMAIN_MIGRATION_2026_10_30.md).


**Production:** https://samarth-care-codeburners.vercel.app/

- Workspace/project: CodeBurners / `samarth-care`, existing Hobby plan.
- Application source: `ed29b82380c9ac861e1f8dcabd457fccf35f78a2`, pushed to GitHub `main` with collaborator commits preserved.
- Deployment: `dpl_CNtVob2YUXGVsMYRpwbQFA9NXfLv`, READY, production, approximately 51 seconds from building to ready.
- Method: reviewed source upload using the Vercel connector. Only tracked source files required by the application/build were included; ignored credentials, outputs, phone tools and local runtime state were excluded.
- Hosting: native installed Next.js 16.3.4, Mumbai function region. The project Node setting is 22.x; the package's broad engine range can permit newer supported Node majors and should be pinned before a future controlled runtime upgrade.

## Verified on the actual HTTPS origin

- Anonymous home page, authentication status, manifest and service worker return HTTP 200.
- Anonymous bootstrap returns HTTP 401; hosted fixture access is disabled.
- Real Supabase owner login succeeds with Secure, HttpOnly, SameSite=Strict cookies.
- Switching the four existing assigned memberships succeeds. Coordinator and operations bootstrap each return 200 seniors; senior and family each return their one assigned senior.
- Runtime date is 2026-10-29. The existing lightweight `/api/health` response still contains the older legacy fixture date; it is not the authoritative workspace clock.
- Logout returns the session to unauthenticated state.
- Android bridge configuration is present and reports online through the new origin. The private relay was migrated and restarted; this check did not send a new SMS or place a call.
- The local speech service accepts the exact new origin. A ticket issued by the Vercel app authorized genuine local faster-whisper/base transcription of the public 11-second English JFK fixture in approximately 2.8 seconds; replay was rejected with HTTP 409. No care note was created and no audio was sent to a speech provider. This is not Hindi/clinical accuracy validation or browser microphone acceptance.
- The Vercel error/fatal runtime-log scan returned no entries during the release checks. No external log drains or continuous uptime monitor were established by this release.

Source checks: **279 tests passed**, native Next.js production build passed, retained Vite/Cloudflare build passed, and targeted lint passed. Two new boundary tests ensure environment fixture flags and forged hosting headers cannot bypass Supabase authentication on the Node host.

Browser control remains disabled in the desktop application's settings. Current visual layout, browser interaction and mobile microphone/local-network prompts have not been re-verified on Vercel. HTTP/API checks are not substituted for those browser checks.

## Configuration and feature boundaries

Existing Supabase accounts, data, RLS, consent and background scheduler remain in place. Required server credentials were configured privately in Vercel production environment variables; no service-role credential is used for normal requests.

New public n8n generation remains disabled under the previous user decision to keep generation local. Computed reports and saved authorized reports remain available. Existing n8n workflow callbacks have not been switched from their earlier origin. Autonomous carrier calls remain unfinished. The [pre-show audit](PRE_SHOW_AUDIT_2026_10_29.md) continues to describe the other unresolved correctness/evaluation/stretch-goal work.

The public website runs without the laptop. Android SMS and local speech still require their paired phone/laptop services. Browser push must be enrolled again on this new origin. Existing real SMS and n8n report receipts remain separate historical integration evidence.

## GitHub automation is pending

GitHub confirms `RageRizzzler/Samarth-Care` is a **private**, accessible repository shared with collaborators. Vercel still reports `repo_not_found` for its Git-link operation after the user reported connecting GitHub and granting the Vercel app repository access. Vercel's Git namespace listing remains empty. The precise credential/installation visibility cause is unresolved; no duplicate project, repository visibility change or paid upgrade was used to work around it.

The existing Vercel project must be connected through **Project Settings → Git → Connect** or an authenticated `vercel git connect`. A successful direct deployment does not establish automatic redeployment on a future GitHub push. The repository is current; the deployed application source commit is recorded above.

For this private personal repository, Vercel's Hobby rules can also restrict automatic deployments of collaborator-authored commits. Confirm the actual commit-author policy before relying on every collaborator push to publish automatically. See [Vercel Git connection](https://vercel.com/docs/cli/git), [private repository deployment rules](https://vercel.com/docs/git#deploying-private-git-repositories) and [installation troubleshooting](https://vercel.com/docs/errors/error-list#github-app-installation-not-found).
