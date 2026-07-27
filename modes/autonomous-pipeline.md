# Mode: autonomous-pipeline — Scheduled Scan → Evaluate → Gated Auto-Submit

Runs the full pipeline unattended on a schedule. The agent does judgment
(reading, scoring, drafting, driving the browser); `autonomy-gate.mjs` does
every cap/threshold/allow-list decision. **The gate's verdict is final for the
run — the agent never overrides `draft_only` or `blocked`, and never retries a
gated application within the same run.**

Enabled only when `config/profile.yml` has `automation.tier: autonomous`.
If the block is absent or `tier` is `draft`, run steps 1–2 only (scan +
evaluate + draft) and stop — that is the zero-touch-until-submit tier.

## Per-tick flow

1. **Scan.** Run `node scan.mjs`. New matches land in `data/pipeline.md`.
2. **Evaluate.** For each pending `data/pipeline.md` entry, run the full
   `auto-pipeline` mode (`modes/auto-pipeline.md`): liveness gate, blacklist
   gate, A–G evaluation, report, PDF, tracker TSV. Reserve report numbers via
   `node reserve-report-num.mjs` exactly as `modes/batch.md` prescribes.
   Respect the batch pre-screen gate and spend tier.
3. **Gate.** For each evaluation that produced a report, determine the ATS
   vendor from the APPLICATION form's hostname (after following any Apply
   redirect — see `modes/apply.md` "Job-board host ≠ application host"):
   `greenhouse.io`/`job-boards.greenhouse.io` → `greenhouse` ·
   `ashbyhq.com` → `ashby` · `lever.co` → `lever` ·
   `myworkdayjobs.com` → `workday` · anything else → `other`.
   Then run:

   ```bash
   node autonomy-gate.mjs --report {num} --company "{company}" \
     --vendor {vendor} --score {score} --run-count {submits_so_far_this_run}
   ```

4. **Act on the verdict.**
   - **`auto_submit`** → attempt a headless Playwright submission following
     `modes/apply.md` in full (preflight, blacklist, cross-channel, knock-out
     pre-scan, ATS quirks). The following are HARD ABORT conditions — abort
     the submit, keep safely-filled fields, and treat the application as
     `draft_only`:
       - any knock-out question detected (`submit_aborted_knockout`)
       - any legal / demographic / work-authorization / visa / sponsorship /
         salary / disability / veteran / background-check / self-identification
         field whose answer is not explicitly present in `config/profile.yml`
         (`submit_aborted_sensitive_field`)
       - any captcha (`submit_failed_captcha`) — NEVER attempt to bypass
       - any vendor-quirk failure or Playwright error (`submit_failed_error`)
     On successful submission:
       1. `node set-status.mjs {num} Applied`
       2. `node followup-seed.mjs {num} --json`
       3. `node application-answers.mjs --report reports/{file} --input {answers}.json --state submitted`
   - **`draft_only`** → save the report + `## H) Draft Application Answers`
     (per `modes/auto-pipeline.md` Step 4) and leave status `Evaluated`.
   - **`blocked`** → do nothing further with this application.
5. **Log.** After EVERY verdict, append the outcome:

   ```bash
   node autonomy-log.mjs add --report {num} --company "{company}" \
     --verdict {verdict} --reason {reason} --score {score} \
     --vendor {vendor} --outcome {outcome}
   ```

   `outcome` is `submitted`, `drafted`, `blocked`, or one of the abort codes
   above. **If this log append fails while a submit is pending, DO NOT
   submit** — an unauditable submission must not happen. Log verdicts you
   could not act on with the closest matching outcome.
6. **Merge.** `node merge-tracker.mjs` once at end of run.
7. **Summary.** End the run with a two-pile summary for the user's next
   check-in: "Sent for you" (submitted, with scores and times) and "Waiting
   on you" (drafts, each with its hold reason from the gate/abort).

## Failure posture

Every failure degrades toward LESS automation, never more. Unreadable config,
gate error, log error, browser crash → the application stays a draft. There
is no retry-of-submit within a run. A posting that failed submission is
eligible again only after the user reviews it.

## Scheduling

- `/loop`-capable CLI: recurring tick every `automation.schedule_hours` hours.
- cron: `0 */6 * * * cd <repo-root> && <headless-cmd> "Run ApplyDeck autonomous-pipeline mode"`
  (see AGENTS.md → Headless / Batch Mode for the per-CLI command).
- Assumption: ONE tick at a time. Do not schedule overlapping runs; the
  per-run counter is per-invocation and the daily counter is derived from the
  log at gate time.

## Optional discovery source: Apify

With `APIFY_TOKEN` in `.env`, `config/plugins.yml` enabling `apify`, and a
`provider: apify` entry in `portals.yml` (see `plugins/apify/skill.md`),
step 1 automatically includes Apify results. Cap the actor's `maxItems`
conservatively — every scheduled tick costs actor-run money.
