# 💙 Samarth Care — Care, a Little Earlier

### AI-Powered Senior Care & Preventive Wellness

**Samarth Care** is a technology-driven platform focused on making senior care smarter, more accessible, and proactive. Our goal is to help elderly individuals and their caregivers through technology-enabled wellness support.

🌐 **Live Demo:** [Visit Samarth Care](https://samarth-care-codeburners.vercel.app/)

[Round 1 presentation](docs/round1/CodeBurner-DEVS09-Samarth-Care-Round1.pptx) · [Concept brief](docs/Samarth-Care-Technical-Writeup.pdf) · [Demo script](docs/DEMO_SCRIPT.md)

**Latest algorithm release:** [personal-risk-v3](docs/ALGORITHM_V3_2026_10_30.md) adds representative identity groups, actionable reported concerns during reference collection, additional bilingual phrases and consistent evidence reports. It builds on [v2's robust personal references, calibrated Isolation Forest and sustained-change detection](docs/ALGORITHM_UPGRADE_2026_10_30.md). The release notes show measured results, coordinator workload and limitations; older presentation/PDF figures are dated checkpoints.

## 🎯 Problem We Solve

Senior citizens may face challenges accessing timely care, monitoring their well-being, and receiving consistent support. Samarth Care aims to make senior care more accessible through a user-friendly digital experience.

## ✨ Key Features

* 💙 Senior-focused and user-friendly interface
* 🧠 Daily rules, personal baselines and an anomaly model with reasons and suggested human follow-up
* 📊 Dated vitals, medication logs, Hindi/English/Hinglish notes, graphs and day/week/month history
* ❤️ Focus on preventive care and early attention
* 📱 Responsive design for different devices
* 🔐 Separate Operations Manager, coordinator, family and senior access, assigned scopes and family-sharing consent
* 📝 Evidence-backed weekly drafts with coordinator review; optional configured n8n/LLM generation

The showcase uses **200 fictional seniors over 90 calendar days**, with reference-informed synthetic histories and explicit missing entries. It contains no real patient cohort. Scores flag concerns for a person to review; they never establish a diagnosis. The project draws on Samarth's public operating context and is not affiliated with its private care systems. See [data provenance](docs/DATA_REALISM.md), [requirements](docs/REQUIREMENTS.md) and [official company context](docs/SAMARTH_CONTEXT.md).

## 🛠️ Tech Stack

* **Frontend:** React 19 and Next.js 16; Recharts and accessible SVG charts
* **Styling:** Tailwind CSS
* **Storage and access:** Supabase Auth, Postgres and row-level policies; Cloudflare D1 for local fixtures
* **Algorithms:** Local JavaScript Isolation Forest, robust median/MAD references, repeated-change rules and bilingual lexical NLP
* **Optional integrations:** n8n report orchestration, local Whisper transcription, Android SIM SMS relay
* **Deployment:** Vercel website and Supabase scheduled Edge processor

## 🚀 Getting Started

Requires Node.js 22.13 or newer, npm and Git. For the isolated local fixture showcase:

```text
git clone https://github.com/mayank7720/Deviathon-2.O-Samarth-Care-.git
cd Deviathon-2.O-Samarth-Care-
npm ci
npm run db:init
npm run dev
```

Open the loopback URL printed by the server, normally port 5173. Fixture roles are available only in explicit loopback development. They do not exercise hosted authentication. To use the connected Supabase workspace, stop that server, then run `npm run supabase:configure` and `npm run dev:supabase`, or double-click **Start Samarth Care.cmd** on Windows. Hosted access requires an assigned account; private credentials and local environment files are excluded from Git. See [Supabase setup](docs/SUPABASE.md), [accounts](docs/ACCOUNTS.md) and [Vercel hosting](docs/VERCEL.md).

Run `npm test` for behavior checks, `npm run evaluate:representative` for the current profile-stratified and historical split reports, and `npm run evaluate:realistic -- --metrics-only` for the current algorithms on the historical identity allocation. Results go into ignored `outputs/`. The [v3 evaluation](docs/evaluation/personal-risk-v3.json) includes exact case counts, subgroup coverage, calibration, workload and limitations. Clinical precision, recall and F1 remain unestablished; unlabelled days are not confirmed healthy.

## Integration status and next work

Computed reports and local scoring require no paid inference service. The user's n8n subscription does not itself provide free model or telephone service. New n8n generation remains configured for the local application; the public site serves computed reports and saved authorized reports. Android SMS needs the paired device, approved destination and SIM plan; local speech needs its paired process. A prepared call bridge is not proof of an autonomous call. See [n8n setup](docs/N8N.md), [telephony](docs/TELEPHONY.md), [local speech](docs/LOCAL_SPEECH.md) and [algorithm status](docs/ALGORITHM_V3_2026_10_30.md).

## 🔮 Future Scope

* Independent clinician-adjudicated evaluation and representative language/device studies
* Measured coordinator workload, accessibility and 10,000-person operating costs
* Validated real-world call automation and any clinically reviewed medicine-interaction capability

## AI and third-party disclosure

The prototype was developed with AI coding assistance (Codex) and open-source software. Team members remain responsible for reviewing and understanding the implementation. Optional model reports select evidence-backed facts and remain drafts until human review. The synthetic data uses public Synthea aggregate references, documented in [DATA_REALISM.md](docs/DATA_REALISM.md). Model/method references and limits appear in the [technical write-up](docs/TECHNICAL_WRITEUP.md) and current algorithm notes.

## 👥 Team

**Team CodeBurners**

💻 [GitHub Repository](https://github.com/mayank7720/Deviathon-2.O-Samarth-Care-) | 🌐 [Live Project](https://samarth-care-codeburners.vercel.app/)

## 💙 Our Vision

**Care, a little earlier. Support, a little closer.**
