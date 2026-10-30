# Third-party acknowledgements and AI disclosure

This project uses the following components and references. Their respective licences and terms continue to apply; this document does not relicense them or grant a new licence for original project code.

| Component/reference | Use |
|---|---|
| [Next.js](https://github.com/vercel/next.js), [React](https://github.com/facebook/react), TypeScript | Website and application runtime |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss), Recharts, Lucide and UI dependencies | Styling, charts and controls; exact versions in the lockfile |
| [Supabase](https://supabase.com/docs) | Auth, Postgres, database policies and background functions |
| [Vercel](https://vercel.com/docs) | Public website hosting |
| [n8n](https://docs.n8n.io/) and configured GPT-5-mini service | Weekly report orchestration and bounded model plans; provider terms apply |
| [Android SMS Gateway](https://github.com/capcom6/android-sms-gateway) | User-owned SIM SMS transport |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Optional local transcription |
| [MITRE Synthea](https://synthetichealth.github.io/synthea/) | Aggregate synthetic reference distributions; provenance in `docs/DATA_REALISM.md` |
| [Isolation Forest, Liu, Ting and Zhou (2008)](https://doi.org/10.1109/ICDM.2008.17) | Methodological reference for the local anomaly implementation |
| [Twilio Voice](https://www.twilio.com/docs/voice), Asterisk | Experimental calling infrastructure; no completed application call acceptance |
| Organiser DEV_104 brief and presentation template | Problem context and submitted presentation structure |

Codex/ChatGPT and Claude assisted development and presentation preparation. Team members are responsible for understanding and reviewing the resulting implementation. The project does not claim third-party frameworks, methods, models or generated reference data as its original research.

Additional notices for vendored code remain beside their source. Dependencies and exact resolved versions are recorded in `package.json` and `package-lock.json`.
