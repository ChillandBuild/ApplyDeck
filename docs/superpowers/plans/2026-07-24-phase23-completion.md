# Phase 2/3 Completion Plan — wire up Pilot, Scout, scheduled runs

> **Baseline:** commit `420714c` (Phase 1 Apify composer done + Pilot/Scout scaffolding). This plan finishes the wiring the scaffolding left undone. Self-contained — another model executes it; the human reviews the result.
> **Method:** TDD where the file has a test peer; verify after each task (`tsc --noEmit`, `npm run test:api`, `node test-all.mjs --quick`, `npm run build`); commit per task.

---

## What's already done (do NOT rebuild)

Phase 1 works end-to-end and is verified: `apify-platforms.mjs` registry, reworked `explore-apify.mjs` (`--jobs`/`--platforms`), `POST /api/explore/apify` (composer body + fan-out), `GET /api/apify/platforms`, `ApifyComposer` UI, Explore toggle = Scan|Apify. Serper provider (`plugins/serper/index.mjs`) + `web-search-run.mjs` + `apify_search` helpers in `web/src/lib/core/portals.ts` + `/pilot` + `/scout` pages + `serper-key` secret route all EXIST WITH TESTS but are **not wired**. This plan wires them.

---

## The gaps (what this plan fixes, ranked)

1. **Cards duplicated.** `web/src/components/config-form.tsx:314-319` still renders `TargetingCard`, `SearchSourcesCard`, `AutomationSafetyCard`, `AutomationActivityLog` — which now ALSO render on `/pilot` and `/scout`. Same card, two pages.
2. **Pilot shows the OLD fixed Indeed form** (it embeds the whole `TargetingCard`, which still contains the hardcoded position/country/area form + the Apify token), not a scheduled composer.
3. **Nothing scheduled runs.** `scan.mjs` never reads `apify_search`; nothing invokes `web-search-run.mjs`. Scheduled Apify + scheduled web search are inert.
4. **Unsafe write landmine.** `updateApifySearchConfig` (`web/src/lib/core/portals.ts`) uses raw `fs.writeFileSync(file, yaml.dump(newDoc))` — no atomic write, no backup, non-standard dump options. Currently dead code (no callers), but Task 4 will call it, so harden first.
5. **Actors unverified.** `linkedin`/`glassdoor`/`naukri` slugs + `buildInput` + `field_map` in `apify-platforms.mjs` are candidate guesses. Only `indeed` (`misceres/indeed-scraper`) is confirmed.
6. **Minor:** orphaned `isAi` branches in `explorer-view.tsx` (unreachable — toggle no longer offers "ai"); `ApifyComposer` doesn't seed location/country (defaults country `"US"`); Serper is a direct-import module, not a registered plugin (no manifest).

---

## Constraints (unchanged — re-read before coding)

- **Turbopack root pinned to `web/`**: no static import from `web/` into a root `.mjs`. Cross the boundary via `child_process.spawn` only. `scan.mjs` is root, so it CAN `import` `apify-platforms.mjs`.
- `web/` never loads root `.env`; check key presence by reading the file (see `apify-token/route.ts`, `apify-discover.ts`). Spawned scripts load `.env` themselves.
- Never write `jds/` from a preview path.
- Root tests in `tests/*.test.mjs` (auto-discovered, `pass`/`fail` from `tests/helpers.mjs`, **no `process.exit()`**). Web tests registered in `web/package.json` `test:api`.
- New root `.mjs` files → register in `update-system.mjs` `SYSTEM_PATHS`.
- User-layer `portals.yml` writes MUST use `atomicWriteWithBackup(file, yaml.dump(doc, { lineWidth: 100, noRefs: true }))` (see `web/src/app/api/portals/route.ts`). Note: the load→dump cycle strips YAML comments — this is pre-existing behavior of every portals.yml writer, acceptable, but the atomic+backup part is mandatory.

---

## Task 1 — Harden `updateApifySearchConfig`

**File:** `web/src/lib/core/portals.ts`

Replace the raw write with the standard safe path. Add import:
```ts
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
```
Rewrite the function body's final write:
```ts
export function updateApifySearchConfig(root: string, update: Partial<ApifySearchConfig>): void {
  const file = path.join(root, "portals.yml");
  const { doc } = readPortalsDoc(root);
  const current = getApifySearchConfig(root);
  const updated: ApifySearchConfig = { ...current, ...update };
  const newDoc = { ...doc, apify_search: updated };
  atomicWriteWithBackup(file, yaml.dump(newDoc, { lineWidth: 100, noRefs: true }));
}
```
**Test:** add `web/src/lib/core/portals.test.ts` cases: `getApifySearchConfig` defaults when block absent; `updateApifySearchConfig` writes the block and preserves other top-level keys (e.g. `tracked_companies`, `search_queries`) in a temp root. Register the file is already in `test:api` (it is).

---

## Task 2 — Extract `ApifyTokenCard` (stays on Config)

The Apify token field currently lives INSIDE `TargetingCard` (the section being removed in Task 3). Extract it so Config keeps token management.

**Create** `web/src/components/apify-token-card.tsx`: a focused card with the token password field + "Using your own token / Clear" state, calling `GET`/`PUT /api/secrets/apify-token` (lift the exact `saveToken` logic + `apifyTokenConfigured`/`typedApifyToken`/`tokenSaving`/`tokenError` state out of `TargetingCard`). Never echoes the token (route already guarantees this).

No new route needed (reuses `apify-token/route.ts`). No test peer required (matches the other card components which have none), but a manual check: token set/clear round-trips.

---

## Task 3 — Slim `TargetingCard`; de-dup Config

**File:** `web/src/components/targeting-card.tsx`
- Remove the entire `apifyPresent && (...)` block (the "Indeed search" fixed form: position/country/area/max + enable toggle + the token sub-block — token now lives in `ApifyTokenCard`).
- Remove all Apify + token state (`apifyPresent/apifyEnabled/apifyPosition/apifyCountry/apifyArea/apifyMaxItems/apifyTokenConfigured/typedApifyToken/tokenSaving/tokenError`) and the `apify` branch in `save()`. Keep roles/negative/locations + `scheduleHours`.
- Result: `TargetingCard` = Job Targeting (roles + exclude + preferred/blocked locations) + schedule interval. Lives on Pilot only.

**File:** `web/src/components/config-form.tsx`
- Remove imports + render of `TargetingCard`, `SearchSourcesCard`, `AutomationSafetyCard`, `AutomationActivityLog` (lines ~314-318).
- Add `ApifyTokenCard` (Task 2). Config now renders: the existing profile/mode form + `CompanyListCard` + `ApifyTokenCard` + `BlacklistCard`.

**Verify:** `/config` shows profile + companies + Apify token + blacklist (no targeting/safety/activity/search-sources). `/pilot` shows targeting + safety + activity (Task 4 adds the scheduled composer). No card appears on two pages.

---

## Task 4 — Scheduled Apify config on Pilot + `apify_search` API route

**New route** `web/src/app/api/apify/search-config/route.ts` (+ `route.test.ts`, register in `test:api`):
- `GET` → `getApifySearchConfig(careerOpsRoot())` (from portals.ts).
- `PUT` → validate body `{enabled?, keywords?, platforms?, location?, country?, max?}`, call `updateApifySearchConfig`. Reject non-array keywords/platforms; clamp `max` to 1..100; platforms filtered to known registry ids (import the id list — but web can't import root `apify-platforms.mjs`; hardcode the 4 ids `["indeed","linkedin","glassdoor","naukri"]` as a small const in the route, or fetch via `/api/apify/platforms`). Use `atomicWriteWithBackup` path (Task 1 guarantees it).

**New component** `web/src/components/scheduled-apify-card.tsx`: a persistence editor (NOT the run-now `ApifyComposer`). Reuse the same visual patterns — keyword chips, platform pills (cost-labeled, from `/api/apify/platforms`), location/country/max inputs — plus an **enabled** toggle. On mount `GET`s `search-config`; on Save `PUT`s it. Shows a "runs every {scheduleHours}h" note (read-only mirror of the schedule set in `TargetingCard`). No confirm dialog (scheduled config, not an immediate spend).

**File** `web/src/app/pilot/page.tsx`: insert `<ScheduledApifyCard />` between `TargetingCard` and `AutomationSafetyCard`.

---

## Task 5 — `scan.mjs` reads `apify_search` and fans out

**File:** `scan.mjs` (root — CAN import the registry).
- Import `{ PLATFORMS, expand }` from `./apify-platforms.mjs` and `{ runActor }` from `./plugins/apify/_apify.mjs`, `{ normalizeItem, isHttpsUrl }` from `./plugins/apify/index.mjs` (or reuse `explore-apify.mjs`'s exported `jobToEntry`/`processEntry` — cleaner: `import { jobToEntry, processEntry } from './explore-apify.mjs'`).
- After the existing ATS scan, read `apify_search` from the portals doc. If `enabled !== false` and `APIFY_TOKEN` set and `keywords`+`platforms` non-empty: `expand(keywords, platforms, {location, country, max})` → for each job `jobToEntry` → run via `runActor` → map → dedupe against `scan-history.tsv` → append to `data/pipeline.md` via the **canonical writers** (`appendToPipeline`, `appendToScanHistory` already imported in `scan-ats-full.mjs`). Respect `--dry-run` (write nothing). Respect blacklist (existing `loadBlacklist`).
- **Gate on the plugin being enabled** (`config/plugins.yml` apify.enabled) — reuse `plugins/_engine.mjs` `pluginStatus` or a simple read.
- **Test:** `tests/scan-apify-search.test.mjs` — with a temp portals.yml containing an `apify_search` block and an injected `runActorFn` (or stub the module), assert it fans out `keywords×platforms` and appends deduped rows; assert `--dry-run` writes nothing. Don't break the existing ATS scan tests.

**Migration:** the existing single `provider: apify` Indeed entry in `portals.yml` is now redundant with `apify_search`. Either (a) leave it (harmless — `scan.mjs`'s existing provider path still runs it), or (b) add a one-time migrate that lifts it into `apify_search` and removes the `tracked_companies` entry. Prefer (b) behind a `--migrate-apify` flag to avoid double-scanning Indeed.

---

## Task 6 — Wire scheduled web search (Serper) to a trigger

`web-search-run.mjs` exists but nothing calls it. Two decisions for the executor:
- **Filtering gap:** its docstring claims it filters against `title_filter`/`location_filter` but the code does NOT. Either implement the filter (read `title_filter` from portals.yml, keep only results whose title matches a positive keyword and no negative) or fix the docstring. Recommended: implement a minimal title filter + dedupe against `scan-history.tsv` + append to `data/pipeline.md` via the canonical writers (mark rows `unverified` — Level-3/web hits are stale-prone per `AGENTS.md`; liveness-check ATS URLs via `check-liveness.mjs` where possible).
- **Trigger:** add it to the scheduled automation loop alongside `scan.mjs` (the agent loop / cron that the "Scan every Nh" interval drives). If there's no single cron entrypoint, expose a `POST /api/scout/web-search/run` that spawns `web-search-run.mjs` and streams NDJSON (mirror `/api/explore/apify`), and add a "Run now" button to Scout's Scheduled section. Register the script in `SYSTEM_PATHS` (already done).

---

## Task 7 — Verify the 3 unverified actors (needs the live Apify store + the user's token)

For `linkedin`, `glassdoor`, `naukri` in `apify-platforms.mjs`: confirm the actor slug exists and runs with the configured `APIFY_TOKEN`; read the actor's documented **input schema** to fix `buildInput`; read a real dataset item to fix `field_map`. **LinkedIn is likely rental — running it may incur a subscription charge; get explicit user sign-off before a live test.** Until verified, the pills are labeled and will error gracefully (no crash). Indeed is confirmed working (25 real results pulled during Phase 1 review).

---

## Task 8 — Minor cleanups

- `web/src/components/explore/explorer-view.tsx`: remove the now-unreachable `isAi`/`mode === "ai"` branches and the `AiSearchBox`/AI imports it only used (AI search lives on Scout now). Keep `ApifyComposer` wiring.
- `web/src/components/explore/apify-composer.tsx`: seed `location`/`country` from `/api/portals/snapshot` (e.g. `alwaysAllow[0]` → location) instead of blank/`"US"`.
- Optional: give Serper a real plugin manifest (`plugins/serper/manifest.json` + `config/plugins.example.yml` entry) so it's discoverable like `apify`, if you want it managed by the plugin engine rather than direct-imported.
- `web/src/components/explore/apify-source-picker.tsx` is now dead (composer replaced it) except the `ApifySource` type still imported by `explore-provider.tsx` — inline that type or delete the file and its import.

---

## Verification checklist (run before declaring done)

- [ ] Every moved card renders on exactly ONE page (no Config/Pilot/Scout duplication).
- [ ] `/config` = profile + companies + Apify token + blacklist. `/pilot` = targeting + scheduled Apify config + safety + activity. `/scout` = AI search + Serper key + scheduled web searches.
- [ ] `updateApifySearchConfig` uses `atomicWriteWithBackup`; a write preserves `tracked_companies`/`search_queries`.
- [ ] `scan.mjs` fans out `apify_search` (keywords×platforms), dedupes, respects `--dry-run` + blacklist; existing ATS scan still passes.
- [ ] Scheduled web search actually runs (via loop or a Scout "Run now"); results land in the pipeline marked unverified.
- [ ] No orphaned AI-search code in `explorer-view.tsx`.
- [ ] `tsc --noEmit` clean; `npm run test:api` green (new route tests registered); `node test-all.mjs --quick` green; `npm run build` OK.
- [ ] `.env` never staged; no secrets committed.
