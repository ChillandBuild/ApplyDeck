# What's Next — remaining gaps after `ee20e62`

> **State:** The Apify composer + Pilot + Scout are built and coherent. Config is de-duplicated, the scheduled Apify config editor works, `scan.mjs` fans out `apify_search`, on-demand web search works, and the `--dry-run` cost leak is fixed. All green (2062 root + 77 web, tsc, build). What remains is turning "scheduled" from a label into a reality, verifying the untested actors, and two small correctness gaps.

---

## Gap 1 — "Scheduled" isn't actually scheduled (the big one)

**Symptom:** Scout's section is titled "Scheduled Web Searches," but nothing fires it on a timer — it only runs when a human clicks "Run now" (`POST /api/scout/web-search/run`). And `web-search-run.mjs` **streams NDJSON to stdout but never writes to the pipeline**, so even if a timer ran it headless, the results would vanish (no consumer). Scheduled Apify is closer — `scan.mjs` reads `apify_search` — but only when *something* actually invokes `scan.mjs` on a schedule.

**Two things to build:**

1. **`web-search-run.mjs` must write to the pipeline when run headless.** Add (guarded by a flag, e.g. `--write` or default-on when no `--stream`): dedupe each mapped offer against `data/scan-history.tsv`, append survivors to `data/pipeline.md` via the canonical writers (`appendToPipeline`, `appendToScanHistory` — the same ones `scan-ats-full.mjs` uses), and mark them **unverified** (web/Level-3 hits are stale-prone per `AGENTS.md`; liveness-check ATS URLs via `check-liveness.mjs` where possible). Keep the current stdout-NDJSON behavior for the on-demand `/api/scout/web-search/run` path (UI consumes it); the pipeline-write is for the *unattended* path.
2. **A real recurring trigger.** Decide the mechanism and wire both scheduled channels into it:
   - If the "Scan every Nh" interval drives an **agent loop** (`/loop` running `/career-ops scan`), have that loop also run `web-search-run.mjs` (and confirm it runs `scan.mjs`, which already picks up `apify_search`).
   - Or add a **cron/`/schedule`** entry that runs `scan.mjs` (covers ATS + scheduled Apify) and `web-search-run.mjs --write` (covers scheduled web search) on the interval.
   - Then either rename Scout's section honestly (if it stays on-demand) or show the next-run time (if it's truly scheduled).

**Test:** headless `web-search-run.mjs --write` with an injected `runQueryFn` appends deduped, unverified rows to a temp `pipeline.md` and skips `scan-history` dupes.

---

## Gap 2 — Verify the 3 unconfirmed actors (needs the live Apify store + the token)

`linkedin`, `glassdoor`, `naukri` in `apify-platforms.mjs` are still candidate guesses (slug + `buildInput` + `field_map`). Only `indeed` is confirmed (pulled 25 real results). For each: confirm the slug runs with the configured `APIFY_TOKEN`, read the actor's documented **input schema** to fix `buildInput`, and read a real dataset item to fix `field_map`.

⚠️ **LinkedIn is labeled `rental` — a live test may trigger a paid monthly subscription. Get explicit user sign-off before running it.** Glassdoor/Naukri are usage-based; a small `maxItems` test run costs little. Until verified, the pills work but those platforms will return errors, not results (graceful, no crash).

---

## Gap 3 — Two small correctness gaps

1. **Blacklist not applied to scheduled Apify.** `scan.mjs`'s `runApifySearchScan` filters by `titleFilter`/`locationFilter` but not the Do-Not-Apply blacklist. A blacklisted company can slip into scheduled Apify results. Fix: apply the existing `loadBlacklist` filter to `apifyOffers` before pushing to `newOffers` (mirror how the ATS path does it).
2. **Test coverage:** `tests/scan-apify-search.test.mjs` covers the happy path and the disabled case, but not (a) the `--dry-run` gate (no actor calls when dry-run) or (b) blacklist filtering. Add both once Gap 3.1 lands.

---

## Not-gaps (intentional, leave as-is)

- Config keeps the Apify token and (per earlier decision) the Serper key lives on Scout next to where it's used — both fine.
- The on-demand `web-search-run` stream-only behavior is correct for the button path; only the *unattended* path needs the pipeline-write (Gap 1.1).
- Actor `rental`/`usage` labels + the confirm-before-run cost dialog are working as designed.

---

## Verification checklist

- [ ] `web-search-run.mjs --write` appends unverified, deduped rows to `pipeline.md`; on-demand stream path unchanged.
- [ ] A real recurring trigger runs `scan.mjs` + `web-search-run.mjs` on the interval; Scout's label matches reality (scheduled or renamed).
- [ ] The 3 actors verified against the live store (LinkedIn only with user sign-off); `buildInput`/`field_map` corrected.
- [ ] Blacklist applied to scheduled Apify results; tests cover dry-run + blacklist.
- [ ] `tsc` clean, `npm run test:api` green, `node test-all.mjs --quick` green, `npm run build` OK; no secrets committed.
