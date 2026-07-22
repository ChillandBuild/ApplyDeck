# Autonomous Pipeline — Design Spec

**Date:** 2026-07-22
**Status:** Approved by user (conversation), implementation pending

## Goal

Extend career-ops so the full loop — scan → evaluate → draft → submit — can run
unattended on a schedule, while every safety-critical decision (caps,
thresholds, allow-lists) is made by a deterministic script, never by LLM
judgment, and anything ambiguous degrades to "drafted, awaiting human review."

## User decisions (locked)

| Decision | Choice |
|---|---|
| Automation ceiling | Auto-submit where provably safe; hold for review otherwise |
| Trigger | Scheduled/recurring (`/loop` or cron), no session open |
| Safety caps | All customizable via `config/profile.yml` (`automation:` block) |
| Approach | #1 — deterministic gate script + LLM orchestrator mode |
| Apify | Folded in as an optional discovery source (config-only, no code) |

## Architecture

```
[cron or /loop schedule]
        │
        ▼
modes/autonomous-pipeline.md          ← NEW: orchestrator mode (AI-driven)
        │
        ├─ scan.mjs                   ← existing, zero-AI (includes Apify if enabled)
        ├─ evaluate via oferta/batch  ← existing modes, headless workers
        ├─ autonomy-gate.mjs          ← NEW: deterministic verdict engine (zero-AI)
        ├─ headless Playwright submit ← performed by the agent, only on auto_submit
        └─ data/autonomy-log.tsv      ← NEW: append-only audit log (via autonomy-log.mjs)
```

Division of labor: **AI does judgment** (reading JDs, scoring, drafting
answers, driving the browser). **Scripts do counting and gating** (caps,
allow-lists, thresholds, audit). The gate is consulted after evaluation,
before any submit attempt; its verdict is final for that run.

## Configuration (`config/profile.yml`, user layer)

```yaml
automation:
  tier: draft            # draft | autonomous   ← kill switch; default draft
  score_threshold: 4.5   # min score for auto-submit eligibility
  daily_submit_cap: 3    # max auto-submits per calendar day
  per_run_cap: 2         # max auto-submits in a single scheduled run
  company_allowlist: []  # empty = disabled (any company eligible); non-empty = only these
  safe_vendors: [greenhouse, ashby]   # ATS vendors proven scriptable
  schedule_hours: 6      # suggested cadence for /loop or cron
```

Absent block or `tier: draft` ⇒ byte-identical to today's behavior.

## Gate verdict order (first failure wins)

1. `tier` is `autonomous` — else `draft_only: tier_off`
2. score ≥ `score_threshold` — else `draft_only: below_threshold`
3. company not in `data/blacklist.md` — else `blocked: blacklisted`
4. company in `company_allowlist` (when non-empty) — else `draft_only: not_allowlisted`
5. vendor in `safe_vendors` — else `draft_only: unsafe_vendor`
6. today's `submitted` count < `daily_submit_cap` — else `draft_only: daily_cap`
7. this run's submit count < `per_run_cap` — else `draft_only: run_cap`

Output JSON: `{"verdict": "auto_submit"|"draft_only"|"blocked", "reason", "checks"}`.
The gate never reads a JD, never calls a model, never touches the network.

## Orchestrator flow per tick (`modes/autonomous-pipeline.md`)

1. `node scan.mjs` → new URLs into `data/pipeline.md`
2. Per pending URL: standard evaluation (liveness gate, blacklist gate,
   reserved report numbers, pre-screen, spend tier) → report + PDF + tracker TSV
3. `node autonomy-gate.mjs …` → verdict
4. `auto_submit` → agent drives headless Playwright with `modes/apply.md`
   guardrails as hard subordinate rules. Abort → draft on: knock-out question,
   legal/visa/demographic/salary field not answerable from `config/profile.yml`,
   captcha, vendor-quirk failure (keep safely-filled fields). On success:
   `set-status.mjs → Applied`, `followup-seed.mjs`, report gets
   `## Application Answers` with `State: submitted`.
5. `draft_only`/aborted → report + Section H answers saved, status `Evaluated`
6. Every outcome appended to `data/autonomy-log.tsv` via `autonomy-log.mjs`
7. `merge-tracker.mjs` at end of run

## Audit log (`data/autonomy-log.tsv`, user layer, gitignored)

```
timestamp  report_num  company  verdict  reason  score  vendor  outcome
```

`outcome` ∈ `submitted | drafted | blocked | submit_failed_captcha |
submit_failed_error | submit_aborted_knockout | submit_aborted_sensitive_field`.
The daily cap counts today's `submitted` lines — the counter can never drift
from what actually happened.

## Error posture

Every failure degrades toward **less** automation: unreadable config/gate →
`draft_only`; log write failure → abort the submit (an unauditable submit does
not happen); Playwright crash → draft + logged. Captchas are never bypassed.
Legal/visa/salary questions absent from `config/profile.yml` are never
auto-answered.

## Scheduling

- `/loop`: recurring tick every `schedule_hours`
- cron: `0 */6 * * * cd <repo> && claude -p "Run career-ops autonomous-pipeline mode"`

Concurrency assumption: one tick at a time (both /loop and a single cron entry
guarantee this). The per-run cap is passed by the orchestrator as `--run-count`.

## Apify (config-only, optional)

1. `APIFY_TOKEN` in `.env`
2. `config/plugins.yml`: `plugins: { apify: { enabled: true } }`
3. `portals.yml` entry with `provider: apify`, an `actor`, `input`
   (cap `maxItems` conservatively — each tick costs actor-run money), `field_map`

## Out of scope

Captcha bypass (never), auto-answering sensitive fields not in profile (never),
Gmail/Notion plugins, the web UI, upstream contribution of this feature.
