# Explore — Interactive Apify Discovery Mode — Design Spec

**Date:** 2026-07-24
**Status:** Approved by user (conversation), implementation pending

## Goal

Add a third discovery mode to the Explore page — **Apify** — sitting next to the existing `Scan` (free, ATS APIs) and `AI search` (agent-driven WebSearch, uses tokens) modes. Lets the client trigger LinkedIn/Glassdoor/Naukri/Indeed discovery live, on demand, streamed into the same results grid, instead of only via the unattended cron path.

## Relationship to the existing Search Sources spec

This is additive to [2026-07-24-search-sources-apify-design.md](2026-07-24-search-sources-apify-design.md), not a replacement:

- The earlier spec owns: adding `provider: apify` `tracked_companies` entries for LinkedIn/Glassdoor/Naukri to `portals.yml`, the Config page's Search Sources card with method badges, the migrated Apify token field, and `scan.mjs` picking up `enabled: true` entries on a schedule/cron.
- This spec adds: a live, on-demand **Apify mode** in Explore that reads the *same* `provider: apify` entries — independent of each entry's `enabled` flag, which governs cron only.
- **Build order is decoupled**: if no `provider: apify` entries exist yet, Explore's Apify tab shows an empty state pointing at Config. This spec does not require the earlier one to ship first, though in practice both should land before either is very useful.

## User decisions (locked)

| Decision | Choice |
|---|---|
| Should Apify discovery be interactive-only, or also scheduled/cron? | **Both** — this Explore mode, plus the Config-page toggle feeding `scan.mjs`'s cron path (already covered by the earlier spec) |
| Which sources does the Explore "Discover" click run? | **Its own per-run picker**, independent of the Config page's `enabled` flags — a client can select a source here even if it's toggled off for unattended cron, and vice versa |
| UI placement | **Third pill** next to Scan/AI search in the existing mode toggle, not a separate route/page — same results grid |
| Cost guardrail | **Confirm before running** — unlike Scan (free) and AI search (gated behind a configured CLI), every Apify click costs real Apify credits, so a lightweight confirm dialog precedes the run |
| Progress granularity | **Simple `queued → running → done` per source**, no live item counter — Apify's API doesn't cheaply expose partial dataset progress, and Scan mode's live counter isn't worth the extra polling calls to replicate here |
| Backend approach | **Direct Apify call from the web route** (Approach B), not a `scan.mjs` subprocess (Approach A) — see rationale below |

## Backend approach: why direct-call, not a `scan.mjs` subprocess

Two approaches were considered:

- **A — reuse `scan.mjs` as a subprocess**, the same engine the cron path runs. Would require adding a new `--json` streaming mode to `scan.mjs` (it currently only has human-readable stdout) and fixing a real gap found during design: `plugins/apify/index.mjs`'s `saveJd()` writes JD-cache files to `jds/` unconditionally, with no `--dry-run` awareness — reusing this path for a live "preview" click would silently leave files on disk on every click, which is the opposite of what a preview button should do.
- **B — call the Apify transport directly from the new web route**, importing `runActor` from `plugins/apify/_apify.mjs` and the pure mapping helpers already exported from `plugins/apify/index.mjs` (`normalizeItem`, `isFieldSpec`, `isHttpsUrl`), skipping the file-writing wrapper (`saveJd`) entirely.

**Chosen: B.** Reasons:
1. Avoids inheriting the dry-run/JD-caching bug rather than working around it.
2. Smaller blast radius — doesn't modify `scan.mjs`, the shared script the cron path and the earlier spec both depend on.
3. Matches the existing behavior of Scan/AI search: nothing is written to disk until the client explicitly clicks "Add to pipeline" (`/api/explore/add`, which only needs `{title, url, company, location}` — confirmed by reading its implementation; no JD body text is required at add-time for any existing mode). JD caching stays a cron-only optimization for unattended entries where nobody manually re-verifies each URL before evaluation; Explore's interactive modes have never needed it.

Both approaches read the same `portals.yml` entries (same actor, input, `field_map`), so the two trigger paths (click vs. cron) behave identically in terms of *what* gets scraped — they just don't share literal code for *how*.

## UI

- Explore's mode toggle becomes three pills: `Scan (FREE)` | `Apify (USES CREDITS)` | `AI search (USES TOKENS)`.
- Apify mode has its own **Sources row** — visually similar to Scan mode's Greenhouse/Lever/Ashby/Workday pills, but populated dynamically from `portals.yml`'s `tracked_companies` entries where `provider === "apify"`. The earlier spec's full `searchSources` unification (method-tagged merge of `search_queries` + apify entries, migrating the Indeed form out of `TargetingCard`) was never actually built — only its WebSearch-toggle half shipped. Rather than block on that unfinished work, `/api/portals/snapshot` gains a small, separate `apifySources: { name: string; actor: string; enabled: boolean }[]` field, additive and decoupled from `searchSources`. When the earlier spec's unification eventually ships, it can fold this field in or replace it — out of scope here. Because it's config-driven rather than a fixed list, the picker is a new component (`apify-source-picker.tsx`), not a reuse of `filter-builder.tsx`'s hardcoded ATS row.
- **Empty state**: zero `provider: apify` entries configured → "No Apify sources configured yet — add one in Config" (mirrors AI search's "blocked" phase for no-CLI-configured).
- **Blocked state**: entries exist but can't run (apify plugin disabled in `config/plugins.yml`, or no `APIFY_TOKEN` in `.env`) → Discover is disabled with a message linking to the Config page's Search Sources card.
- **Confirm-before-run**: clicking Discover with N sources selected shows "Run {N} sources on Apify — uses your Apify credits?" before firing.
- **Progress**: each selected source shows `queued → running → done` (or `error`). Sources run in parallel and don't wait on each other — offers stream into the results grid as each source's run completes, same merge behavior Scan mode already has across multiple ATS boards at once.
- Picker options are NOT filtered by each entry's `enabled: true/false` flag in `portals.yml` — that flag controls cron consumption only, per the locked decision above. A source disabled for cron still appears here, selectable.

## Data flow

```
Client picks sources in the Apify tab, confirms
        │
        ▼
POST /api/explore/apify { sources: string[] }
        │
        ▼
1. readPortalsDoc() [new shared helper — see below] → filter tracked_companies
   to provider === "apify" && name in `sources`
2. Gate checks (400 + clear message if either fails, before any Apify credit
   is spent):
   - config/plugins.yml → plugins.apify.enabled === true
   - process.env.APIFY_TOKEN present
3. For each matched entry, IN PARALLEL (Promise.allSettled):
   - emit { kind: "sourceStart", source: entry.name }
   - runActor(entry.actor, entry.input, { token, timeoutMs: entry.timeout_ms })
     — imported directly from plugins/apify/_apify.mjs
   - map each dataset item via normalizeItem()/isHttpsUrl() from
     plugins/apify/index.mjs (imported, not reimplemented); saveJd() is
     never called — no jds/ writes from this path
   - emit { kind: "offer", offer } per mapped item
       offer.ats = short slug derived from entry.name (e.g. "linkedin")
       offer.source = entry.name (full)
     (same fallback convention AI-search offers already use — offer.ats:
     "other" — discovery-card.tsx renders the raw string when it has no
     ATS_LABEL entry, so no new label mapping is needed)
   - emit { kind: "sourceDone", source: entry.name, count } on success, or
     { kind: "sourceError", source: entry.name, message } on failure — one
     source failing does not abort the others
4. emit { kind: "done", count, offers }
```

## New/changed code

- **`web/src/lib/core/portals.ts`**: new `readPortalsDoc()` — extracts the `yaml.load` + `isObj` parsing currently duplicated between the snapshot route and the PUT route (this new route would otherwise be a third copy). Both existing routes are refactored to use it; behavior-preserving, existing tests must keep passing unchanged.
- **`web/src/lib/explore.ts`**: new `ApifyScanEvent` union type (`sourceStart` / `sourceDone` / `sourceError` / `offer` / `done`) — kept separate from `ScanEvent` rather than extended, since Apify has no `companies`/`scanned`/`total` figures to report and forcing them in would mean fake numbers. `ExploreMode` gains `"apify"`.
- **`web/src/app/api/explore/apify/route.ts`** (new): the streaming route described above. Node runtime, `maxDuration = 300` (matches `/api/explore`'s budget; individual actors default to a 180s timeout via `plugins/apify/_apify.mjs`'s `DEFAULT_RUN_TIMEOUT_MS`, so parallel sources fit comfortably within the route budget).
- **`web/src/components/explore/explore-provider.tsx`**: new `discoverApify(sources: string[])` action alongside `discover()`/`discoverAI()`, plus per-source progress state for the picker's pills.
- **`web/src/components/explore/apify-source-picker.tsx`** (new): the dynamic Sources row for Apify mode.

## Error handling

- No `provider: apify` entries → empty state, not an error.
- Plugin disabled / token missing → blocked before any run starts, checked synchronously so no Apify credits are spent on a doomed request.
- One source's actor failing (bad actor id, Apify-side timeout, revoked token) → that source shows an error pill; the rest continue; partial results still render — same "degraded, not empty" posture Scan mode already applies to unreachable ATS boards.
- Stream/network interruption → same try/catch-around-the-stream pattern `/api/explore` already uses.

## Testing

- Unit tests for the new `readPortalsDoc()` extraction — existing snapshot-route tests must pass unchanged against the refactored implementation.
- Route tests for `/api/explore/apify`: plugin-disabled → 400, no-token → 400, successful multi-source run with `runActor` mocked, one-source-fails-others-succeed, empty `sources` array → no-op.
- The picker must show entries regardless of their `enabled: true/false` flag (Scenario B from the brainstorm — a source disabled for cron still appears here).
- No live Apify calls in CI — `runActor` is mocked at the module boundary.

## Non-goals

- Not building a live item-count/progress bar mid-run — explicitly declined in favor of simple queued/running/done, matching what Apify's API cheaply supports.
- Not adding a `--json` streaming mode to `scan.mjs`, and not fixing its `saveJd()` dry-run gap — sidestepped entirely by the direct-call approach; that gap remains a latent issue in the cron path, out of scope for this spec.
- Not selecting/verifying the exact LinkedIn/Glassdoor/Naukri Apify actors — that's the earlier spec's concern; this spec only depends on whatever `provider: apify` entries exist at the time, whichever platforms they cover.
- Not changing `data/pipeline.md`'s write path or `/api/explore/add` — Apify-sourced offers flow through the exact same "Add to pipeline" mechanism Scan/AI-search offers already use.
