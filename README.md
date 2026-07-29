<h1 align="center">ApplyDeck</h1>

<p align="center"><em>Your job search command center — evaluate offers, tailor CVs, scan portals, track applications.</em></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT"></a>
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
</p>

<p align="center">
  <sub>Runs on any agent-skill-standard CLI. See <a href="docs/SUPPORTED_CLIS.md">Supported CLIs</a>.</sub><br>
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Antigravity_CLI-4285F4?style=flat&logo=google&logoColor=white" alt="Antigravity CLI">
  <img src="https://img.shields.io/badge/Codex-412991?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Qwen-615CED?style=flat" alt="Qwen">
  <img src="https://img.shields.io/badge/Kimi-FF4B4B?style=flat" alt="Kimi">
  <img src="https://img.shields.io/badge/GitHub_Copilot-000?style=flat&logo=githubcopilot&logoColor=white" alt="GitHub Copilot">
  <img src="https://img.shields.io/badge/Grok_Build_CLI-000?style=flat&logo=x&logoColor=white" alt="Grok Build CLI">
</p>

---

> **ApplyDeck is a fork of [career-ops](https://github.com/santifer/career-ops)** by
> [Santiago Fernández de Valderrama Aparicio](https://santifer.io) (santifer), used under the MIT
> License. The evaluation engine, mode system, scanner, and scoring model are his work. ApplyDeck
> renames the product, adds a web experience, and evolves the system from there.
> See [Credits & Lineage](#credits--lineage).

## What Is This

ApplyDeck turns any AI coding CLI into a full job search command center. Instead of tracking
applications in a spreadsheet, you get a pipeline that:

- **Evaluates offers** with a structured A–F evaluation (five scoring dimensions feeding a holistic 1.0–5.0 score)
- **Generates tailored PDFs** — ATS-optimized CVs customized per job description
- **Scans portals** automatically (Greenhouse, Ashby, Lever, company pages)
- **Processes in batch** — evaluate 10+ offers in parallel with sub-agents
- **Tracks everything** in a single source of truth with integrity checks
- **Researches companies and finds the right person to contact** — applications get you in the queue; research gets you a conversation

> **Important: this is NOT a spray-and-pray tool.** ApplyDeck is a filter — it helps you find the
> few offers worth your time out of hundreds. The system strongly recommends against applying to
> anything scoring below 4.0/5. Your time is valuable, and so is the recruiter's. Always review
> before submitting.

ApplyDeck is agentic: whichever AI coding CLI you choose navigates career pages with Playwright,
evaluates fit by reasoning about your CV against the job description (not keyword matching), and
adapts your resume per listing.

> **Heads up: the first evaluations won't be great.** The system doesn't know you yet. Feed it
> context — your CV, your career story, your proof points, your preferences, what you're good at,
> what you want to avoid. The more you nurture it, the better it gets. Think of it as onboarding a
> new recruiter: the first week they need to learn about you, then they become invaluable.

<p align="center">
  <img src="docs/demo.gif" alt="ApplyDeck demo" width="800">
</p>

<sub>Demo recorded from the upstream career-ops CLI; the pipeline and commands are identical.</sub>

## Features

| Feature                  | Description                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-Pipeline**        | Paste a URL, get a full evaluation + PDF + tracker entry                                                                                 |
| **6-Block Evaluation**   | Role summary, CV match, level strategy, comp research, personalization, interview prep (STAR+R) — plus a Block G posting-legitimacy check that flags scams and ghost jobs |
| **Interview Story Bank** | Accumulates STAR+Reflection stories across evaluations — 5–10 master stories that answer any behavioral question                         |
| **Negotiation Scripts**  | Salary negotiation frameworks, geographic discount pushback, competing offer leverage                                                    |
| **ATS PDF Generation**   | Keyword-injected CVs with Space Grotesk + DM Sans design                                                                                 |
| **Cover Letter Generator** | Research-backed cover letters with keyword mirroring, four interactive angle prompts (why/problems/approach/tone), draft-in-chat approval gate, and A4 PDF via the same HTML + Playwright pipeline as CVs |
| **Application Email Drafts** | Formal recruiter/referral/cold application emails from a report or pasted JD, with subject line, attachment checklist, source-backed fit points, and a profile-driven contact block. Draft-only — ApplyDeck never sends, submits, or clicks anything. |
| **Portal Scanner**       | 45+ companies pre-configured (Anthropic, OpenAI, ElevenLabs, Retool, n8n...) + custom queries across Ashby, Greenhouse, Lever, Wellfound |
| **Batch Processing**     | Parallel evaluation with headless CLI workers (`claude -p` / `opencode run`)                                                             |
| **Dashboard TUI**        | Terminal UI to browse, filter, and sort your pipeline                                                                                    |
| **Web Dashboard**        | Local Next.js UI — table view of applications, CV editor, portal config (see [`web/README.md`](web/README.md))                          |
| **Human-in-the-Loop**    | AI evaluates and recommends, you decide and act. The system never submits an application — you always have the final call                |

## Quick Start

```bash
git clone https://github.com/ChillandBuild/ApplyDeck.git
cd ApplyDeck
npm ci                            # installs pinned dependencies
npx playwright install chromium   # only needed for PDF generation
```

Then open your AI CLI in that directory:

```bash
claude   # or codex / opencode / qwen / agy / grok
```

**On first launch, ApplyDeck walks you through setup — your CV, profile, and target roles — just by
chatting. Nothing to edit by hand.**

> 💡 Node.js is the only hard prerequisite. Already using a Claude Code / Antigravity / Codex CLI?
> Then you already have it.

<details>
<summary><b>Prefer to configure it by hand?</b></summary>

```bash
# 1. Check setup
npm run doctor                                     # validates all prerequisites

# 2. Configure
cp config/profile.example.yml config/profile.yml   # edit with your details
cp templates/portals.example.yml portals.yml       # customize companies

# 3. Add your CV
# Create cv.md in the project root with your CV in markdown

# 4. Open your AI CLI in this directory
claude   # or codex / opencode / qwen / agy / grok

# Then ask your CLI to adapt the system to you:
# "Change the archetypes to backend engineering roles"
# "Add these 5 companies to portals.yml"
# "Update my profile with this CV I'm pasting"

# 5. Start using
# Paste a job URL or JD text to trigger auto-pipeline
```

</details>

> **The system is designed to be customized by your AI coding CLI itself.** Modes, archetypes,
> scoring weights, negotiation scripts — just ask it to change them. It reads the same files it
> uses, so it knows exactly what to edit.

See [docs/SETUP.md](docs/SETUP.md) for the full setup guide,
[docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md) for running cheaply on custom or local
models, [docs/APPLY_AUTOFILL.md](docs/APPLY_AUTOFILL.md) for the ATS auto-fill flow, and
[docs/FAQ.md](docs/FAQ.md) for common setup questions.

### A note on the command name

The slash command is **`/career-ops`**, not `/applydeck`. The skill identifier is internal wiring —
renaming it would break the CLI integrations, saved state, and on-disk paths for anyone already
using the system. ApplyDeck is the product name; `career-ops` remains the command.

## Usage

ApplyDeck uses a shared command router. In CLIs that register slash commands, it looks like this:

```
/career-ops                → Show all available commands
/career-ops {paste a JD}   → Full auto-pipeline (evaluate + PDF + tracker)
/career-ops scan           → Scan portals for new offers
/career-ops pdf            → Generate ATS-optimized CV
/career-ops cover          → Cover letter generator (paste JD or /career-ops cover {slug})
/career-ops email          → Formal application email draft (draft-only; never sends, submits, or clicks)
/career-ops batch          → Batch evaluate multiple offers
/career-ops tracker        → View application status
/career-ops apply          → Fill application forms with AI
/career-ops pipeline       → Process pending URLs
/career-ops contacto       → Find hiring manager / recruiter / peer + draft a ≤300-char LinkedIn message per contact type
/career-ops deep           → Generate a structured 6-axis research prompt (AI strategy, recent moves, culture, challenges, competitors, candidate angle)
/career-ops training       → Evaluate a course/cert
/career-ops project        → Evaluate a portfolio project
```

Or just paste a job URL or description directly — ApplyDeck auto-detects it and runs the full
pipeline.

In Codex, slash commands are not guaranteed. Use the same mode names in a prompt instead, or call
them from `codex exec`.

## CLI Integrations

### Antigravity CLI

ApplyDeck supports Antigravity CLI natively, the same way it supports Claude Code and OpenCode. All
slash commands are available through the shared skill entrypoint, using the same `modes/*.md`
evaluation logic.

Google has transitioned consumer Gemini CLI access to Antigravity CLI. `GEMINI.md` is now a no-op
compatibility guard so Antigravity does not duplicate the full project instructions when it reads
both `AGENTS.md` and `GEMINI.md`.

```bash
cd ApplyDeck
agy

# Use the unified /career-ops command with subcommands:
/career-ops "Senior AI Engineer at Anthropic..."
/career-ops pipeline
/career-ops scan
/career-ops pdf
/career-ops tracker
```

The skill is defined using the open standard in `.agents/skills/career-ops/SKILL.md` and
symlinked/referenced for each supported CLI (e.g. `.claude/`, `.qwen/`, `.antigravitycli/`, `.grok/`).

### Codex

ApplyDeck supports Codex through the same shared router, but the invocation model differs from CLIs
that auto-register slash commands. For the full guide, see [docs/CODEX.md](docs/CODEX.md).

```bash
cd ApplyDeck
codex
```

Slash commands are not guaranteed in Codex. If `/career-ops` is unavailable, ask Codex to run the
mode directly in plain language:

```text
Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123
Run the career-ops scan mode and summarize new matches.
Run the career-ops pipeline mode for data/pipeline.md.
Run the career-ops pdf mode for the latest evaluated role.
Run the career-ops tracker mode and summarize the current statuses.
```

One-shot:

```bash
codex exec "Evaluate this JD with career-ops auto-pipeline: https://company.com/jobs/123"
codex exec "Run career-ops scan mode in this repo and summarize new matches."
codex exec "Run career-ops pdf mode for the latest evaluated role."
```

### Grok Build CLI

`AGENTS.md` is auto-loaded as project rules, and all slash commands are available through the
shared skill entrypoint.

```bash
cd ApplyDeck
grok

/career-ops "Senior AI Engineer at Anthropic..."
/career-ops scan
/career-ops tracker
```

For headless batch workers, use `grok -p "prompt"` (add `--yolo` to auto-approve tool executions).

### Standalone Gemini API script (no CLI install needed)

```bash
# 1. Get a free API key at https://aistudio.google.com/apikey
cp .env.example .env
# Edit .env, set GEMINI_API_KEY=your_key_here

# 2. Evaluate a job description
node gemini-eval.mjs "We are looking for a Senior AI Engineer..."
node gemini-eval.mjs --file ./jds/my-job.txt
node agent-inbox.mjs add "..."   # queue a request for the next session
npm run gemini:eval -- "JD text here"
```

> **Free tier:** Both options work without billing. Native CLI uses Google OAuth; the API script
> uses `gemini-2.5-flash` (15 RPM, 1M tokens/day free). See [docs/FREE_TIER.md](docs/FREE_TIER.md).

## How It Works

```
You paste a job URL or description
        │
        ▼
┌──────────────────┐
│  Archetype       │  Classifies: LLMOps / Agentic / PM / SA / FDE / Transformation
│  Detection       │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A-F Evaluation  │  Match, gaps, comp research, STAR stories
│  (reads cv.md)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
  .md   .pdf   .tsv
```

## Pre-configured Portals

The scanner comes with **45+ companies** ready to scan and **19 search queries** across major job
boards. Copy `templates/portals.example.yml` to `portals.yml` and add your own:

**AI Labs:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Voice AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**AI Platforms:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Contact Center:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Automation:** n8n, Zapier, Make.com
**European:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Job boards searched:** 21 provider modules cover ATS APIs, board-wide feeds, XML/RSS feeds,
markdown feeds, and local parsers. See
[Supported job boards](docs/SUPPORTED_JOB_BOARDS.md) for the full table.

By default `node scan.mjs` (a.k.a. `npm run scan`) trusts what each ATS feed returns. Some companies
leave stale postings in their public API even after the role is closed, so those expired entries can
leak into `pipeline.md`. Pass `--verify` to launch Playwright after the API pass and drop expired
postings before they hit the pipeline:

```bash
node scan.mjs --verify          # zero-token discovery + Playwright liveness check
```

The verification is sequential and only runs against new offers (after dedup), so the cost stays
bounded.

## Dashboards

**Terminal UI** — browse your pipeline without leaving the shell:

```bash
npm run serve:dashboard   # launch the TUI
npm run build:dashboard   # optional: build the standalone binary
```

Features: 6 filter tabs, 4 sort modes, grouped/flat view, lazy-loaded previews, inline status changes.

**Web UI** — a local Next.js app reading the exact same files:

```bash
cd web && npm ci && npm run dev
```

Nothing runs unless you start it, and nothing leaves your machine. See
[`web/README.md`](web/README.md).

## Project Structure

```
ApplyDeck/
├── AGENTS.md                    # Canonical agent instructions (all CLIs)
├── CLAUDE.md                    # Claude Code wrapper (imports AGENTS.md)
├── CODEX.md                     # Codex wrapper (imports AGENTS.md)
├── OPENCODE.md                  # OpenCode wrapper (imports AGENTS.md)
├── GEMINI.md                    # Legacy no-op guard to avoid Antigravity duplicate context
├── cv.md                        # Your CV (create this)
├── article-digest.md            # Your proof points (optional)
├── config/
│   └── profile.example.yml      # Template for your profile
├── modes/                       # Skill modes
│   ├── _shared.md               # Shared context
│   ├── _profile.md              # Your personalization (never auto-updated)
│   ├── oferta.md                # Single evaluation
│   ├── pdf.md                   # PDF generation
│   ├── cover.md                 # Cover letter generation
│   ├── email.md                 # Formal application email drafts
│   ├── scan.md                  # Portal scanner
│   ├── batch.md                 # Batch processing
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS-optimized CV template
│   ├── portals.example.yml      # Scanner config template
│   └── states.yml               # Canonical statuses
├── batch/
│   ├── batch-prompt.md          # Self-contained worker prompt
│   └── batch-runner.sh          # Orchestrator script
├── dashboard/                   # Go TUI pipeline viewer
├── web/                         # Next.js web dashboard
├── data/                        # Your tracking data (gitignored)
├── reports/                     # Evaluation reports (gitignored)
├── output/                      # Generated PDFs (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Setup, customization, budget guide, architecture
└── examples/                    # Sample CV, report, proof points
```

## Tech Stack

- **Agent**: AI coding CLI with shared skills and modes (`AGENTS.md` + CLI wrapper)
- **PDF**: Playwright + HTML template
- **Cover letters**: HTML template + Playwright (A4 PDF, same pipeline as CVs)
- **Scanner**: Playwright + Greenhouse/Ashby/Lever APIs + WebSearch
- **Terminal dashboard**: Go + Bubble Tea + Lipgloss (Catppuccin Mocha theme)
- **Web dashboard**: Next.js 16 + React 19 + Tailwind
- **Data**: Markdown tables + YAML config + TSV batch files

## FAQ

**What is ApplyDeck?**
ApplyDeck is an open-source, CLI-agnostic job-search command center. It turns any AI coding CLI into
a pipeline that evaluates job offers against your CV, generates ATS-tailored PDFs, finds the right
person to contact, and tracks everything in one place — while you keep the final decision. It is a
fork of [career-ops](https://github.com/santifer/career-ops).

**Can I run it for free, or on a cheaper / local model?**
Yes. ApplyDeck is CLI-agnostic and runs on free and local models — via OpenRouter free models,
Ollama, or any OpenAI-compatible endpoint — so you are not tied to a paid subscription. See
[docs/RUNNING_ON_A_BUDGET.md](docs/RUNNING_ON_A_BUDGET.md).

**Which AI CLIs does it work with?**
Claude Code, Codex, Antigravity, OpenCode, Grok, Qwen, Kimi, Copilot and more — through the open
Agent Skill Standard, so it is never locked to a single vendor. Use the CLI you already have.

**How do I install on Windows?**
ApplyDeck runs on Windows. If skills fail to load with a symlink error during install, the fix is in
[docs/FAQ.md](docs/FAQ.md). Full steps are in [docs/SETUP.md](docs/SETUP.md).

**Does it auto-apply to jobs for me?**
No. ApplyDeck is a filter, not a spray-and-pray auto-applier. The AI evaluates, ranks and drafts;
you review and decide. It never submits, sends, or clicks anything — you always have the final call.
That human-in-the-loop design is the whole point.

**Why is the command `/career-ops` and not `/applydeck`?**
Because the skill identifier is internal wiring. See
[A note on the command name](#a-note-on-the-command-name).

## Credits & Lineage

ApplyDeck is a fork of **[career-ops](https://github.com/santifer/career-ops)**, created by
**[Santiago Fernández de Valderrama Aparicio](https://santifer.io)** (santifer). The evaluation
engine, mode system, portal scanner, scoring model, and the CareerOps concept are his work, and the
MIT copyright notice in [LICENSE](LICENSE) remains his.

career-ops is the first reference implementation of the
[CareerOps Manifesto](https://career-ops.org/manifesto) — read it, and if it says what you believe,
sign it (`npm run manifesto`).

Upstream also publishes **[cv-santiago](https://github.com/santifer/cv-santiago)**, an open-source
portfolio site. If you need a portfolio to showcase alongside your job search, fork it and make it
yours.

The upstream project's press coverage, community, and track record belong to career-ops, not to this
fork. For the original project, its case study, and its Discord, go to
[career-ops.org](https://career-ops.org).

## Disclaimer

**ApplyDeck is a local, open-source tool, NOT a hosted service.** By using this software, you
acknowledge:

1. **You control your data.** Your CV, contact info, and personal data stay on your machine and are
   sent directly to the AI provider you choose (Anthropic, OpenAI, Google, etc.). We do not collect,
   store, or have access to any of your data.
2. **You control the AI.** The default prompts instruct the AI not to auto-submit applications, but
   AI models can behave unpredictably. If you modify the prompts or use different models, you do so
   at your own risk. **Always review AI-generated content for accuracy before submitting.**
3. **You comply with third-party ToS.** You must use this tool in accordance with the Terms of
   Service of the career portals you interact with (Greenhouse, Lever, Workday, LinkedIn, etc.). Do
   not use this tool to spam employers or overwhelm ATS systems.
4. **No guarantees.** Evaluations are recommendations, not truth. AI models may hallucinate skills or
   experience. The authors are not liable for employment outcomes, rejected applications, account
   restrictions, or any other consequences.

See [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) for full details. This software is provided under the
[MIT License](LICENSE) "as is", without warranty of any kind.

## License & Trademark

The code is licensed under [MIT](LICENSE), copyright © 2026 Santiago Fernández de Valderrama.

The **"career-ops"** name and brand are governed by upstream's [Trademark Policy](TRADEMARK.md),
which explicitly permits naming a fork distinctly and describing its lineage with attribution.
"ApplyDeck" is that distinct name; this README states the lineage accordingly.
