# Apify Composer + Pilot page + Scout page — Design & Implementation Plan

> **Status:** Design approved in conversation 2026-07-24. Implementation NOT started.
> **For the implementing agent:** This plan is self-contained — it captures every decision, the rationale, the current codebase state, the hard constraints, and a phased task breakdown. Read the whole thing before writing code. Build in the three phases given; each phase is independently shippable and testable. The plan author (the human) will review the built result.

---

## 1. Problem / motivation

The Explore page's "Apify" discovery mode currently has two hard limitations the user hit in practice:

1. **Only Indeed shows up** — `portals.yml` has exactly one `provider: apify` entry (Indeed), so the picker only ever lists Indeed. No LinkedIn / Glassdoor / Naukri.
2. **The query is hardcoded** — that one entry bakes in `position: "Data Science Intern", country: "IN", location: "Tamil Nadu"`. The client can't choose what to search for from the UI the way the free Scan lets them pick keywords.

Root cause: Apify was modeled as "run a pre-configured named source" instead of "compose a search." The free Scan, by contrast, is a live composer (pick keywords + platforms + run). This plan brings Apify (and, as it turns out, the whole discovery surface) up to that model, and reorganizes the pages around a clean mental model discovered during the design conversation.

---

## 2. The unifying model: 3 channels × 2 faces

Every discovery channel has an **on-demand** face (run it now, you're watching) and a **scheduled** face (runs automatically on a timer). The three channels:

| Channel | Mechanism | Cost | On-demand face | Scheduled face |
|---|---|---|---|---|
| **Free ATS** | Greenhouse/Lever/Ashby/Workday public APIs | zero-token | Explore "Scan" tab | Pilot scheduled toggle |
| **Apify** | paid platform scraper actors | Apify credits (+ rental for LinkedIn) | Explore "Apify" composer | Pilot scheduled composer |
| **Web search** | agent (on-demand) / search API (scheduled) | CLI tokens / Serper key | Scout "AI search" | Scout "Scheduled web searches" |

**Web search is special**: unlike the other two (which split their faces across Explore/Pilot), *both* of its faces live together on their **own dedicated page (Scout)**, because it's the agent/API-driven channel with a distinct cost model. This was a deliberate user decision.

---

## 3. Locked decisions (with rationale)

1. **Apify = query composer**, not named pre-configured sources. Matches the free Scan's feel.
2. **Multi-keyword fan-out**: the composer takes a *list* of keywords; each keyword × each selected platform = one actor run. A single keyword is just the N=1 case, so this subsumes the simple "one search box" behavior. **Cost is `keywords.length × platforms.length` actor runs** — the UI MUST show this before running (see #6).
3. **All 4 platforms** (LinkedIn, Indeed, Glassdoor, Naukri), each pill **cost-labeled**: `usage` (per-run credits) or `rental` (LinkedIn's best actors are often a paid monthly subscription ~$30–45/mo on top of credits). Nothing paid runs unless the user knowingly selects it. Actor slugs + input schemas are **verified against the live Apify store during implementation** (see §9).
4. **Apify keyword list is its own**, seeded *once* from Job Targeting but independent thereafter. Rationale: Job Targeting has ~16 chips; running 16 × 4 platforms = 64 credits/click would be a foot-gun. The Apify list is trimmed to the few the user actually wants to pay for.
5. **`apify_search:` block** in `portals.yml` (Option A — clean unified storage). Replaces the single `provider: apify` entry. Both the ad-hoc composer and the cron scanner (`scan.mjs`) expand it through the same registry.
6. **Confirm-before-run** for Apify (already exists for the current Apify mode) shows the fan-out cost: `N keywords × M platforms = X runs · ~X credits`.
7. **Progress granularity**: `queued → running → done` per (platform × keyword) job. No live item counter (Apify's API doesn't cheaply expose it). Already the pattern in the current Apify mode.
8. **New `/pilot` page** = the automation cockpit. **New `/scout` page** = the web-search channel (both faces).
9. **Page moves:**
   - **Job Targeting** (roles + locations) → moves from Config to **Pilot**. Rationale: the autopilot *owns* it (cron reads `title_filter`/`location_filter` every cycle as its standing instruction set); manual searches only *seed* from it ephemerally.
   - **Automation Safety** + **Automation Activity Log** → Config to Pilot.
   - **Search Sources** (the saved `site:` query toggles) → Config to **Scout** (reframed as the "Scheduled web searches" section).
   - **AI search** (on-demand plain-language) → moves *out of Explore* to **Scout**. Explore shrinks to Scan + Apify.
   - **Apify token** + **Serper key** + **Do-Not-Apply blacklist** → stay on **Config** (shared credentials/policy, consumed at runtime by both manual and auto; no single owner).
10. **Web search backend split** (falls out of "distinct styles"):
    - **On-demand AI search** = plain language → **CLI tokens** (Claude Code interprets + hunts). Unchanged mechanism, just relocated to Scout.
    - **Scheduled web searches** = structured `site:` queries → **Serper search API**, **headless, LLM-free**: run the query → get URLs → filter against `title_filter` → liveness-check → add to pipeline. No CLI, no agent, runs unattended. This is the piece that makes scheduled web search actually runnable at 3am.
11. **Serper** is the search-API provider (built as a pluggable provider, like the Apify plugin). Chosen because it speaks Google `site:` syntax natively, so the existing `search_queries` work unchanged. Key `SERPER_API_KEY` in `.env`, configured on Config.

---

## 4. Final information architecture

| **Config** — *who I am* | **Explore** — *on-demand, deterministic* | **Pilot** (NEW) — *scheduled automation* | **Scout** (NEW) — *web search, both faces* |
|---|---|---|---|
| CV / profile | Scan (free ATS) | Job Targeting (roles + locations) | On-demand AI search (CLI tokens) |
| Company list | Apify composer | Scheduled: ATS toggle · Apify composer | Scheduled web searches (Serper) |
| Apify token + **Serper key** | | Schedule interval (3h/6h/12h/24h) | |
| Do-Not-Apply blacklist | | Automation Safety + Activity Log | |

Nav gets two new top-level items: **Pilot** and **Scout**.

---

## 5. Current codebase state (what already exists — this plan MODIFIES it)

The Apify *mode* was built earlier on 2026-07-24 (commits `8fc015f`..`81b7649`). It uses the **old "named source" model** and must be **reworked** into the composer:

| File | Current behavior | This plan's change |
|---|---|---|
| `explore-apify.mjs` (root) | Spawned NDJSON runner. Takes a JSON file of pre-built portals.yml `provider: apify` entries (`{name, actor, input, field_map}`), runs each via `runActor` (from `plugins/apify/_apify.mjs`), maps via `normalizeItem`/`isHttpsUrl` (from `plugins/apify/index.mjs`), never writes `jds/`. | **Rework** to take composer jobs `{platform, query, location, country, max}` and resolve actor/input/field_map from the NEW platform registry. |
| `web/src/app/api/explore/apify/route.ts` | POST body `{sources: string[]}` (entry names). Gates: plugin enabled + token + matching entries. Spawns `explore-apify.mjs`, streams NDJSON. | **Rework** body to `{keywords[], platforms[], location, country, max}`. Fan out keywords × platforms → jobs. |
| `web/src/components/explore/apify-source-picker.tsx` | Reads `apifySources` from snapshot, renders selectable pills of portals.yml entries. | **Replace** with the composer component. |
| `web/src/components/explore/explore-provider.tsx` | `discoverApify()`, `apifySelected: string[]` (names), `apifyProgress`. | **Rework** state for composer (keywords, platforms, location, country, max). |
| `web/src/components/explore/explore-mode-toggle.tsx` | Three pills: Scan / Apify / AI search. | **AI search pill removed** (moves to Scout). Becomes Scan / Apify. |
| `web/src/app/api/portals/snapshot/route.ts` | Emits `apifySources` (provider:apify entries) + `searchSources` (search_queries). | `apifySources` becomes unused (composer uses the code registry, not portals.yml entries) — remove or repurpose. `searchSources` still needed (Scout reads it). |
| `web/src/lib/explore.ts` | `ExploreMode = "scan" | "ai" | "apify"`, `ApifyScanEvent`. | `ExploreMode` may drop `"ai"` from Explore (AI search moves to Scout, which can own its own mode/state). Keep `ApifyScanEvent`; extend event shape for keyword-labeled jobs. |
| `web/src/lib/core/apify-discover.ts` | `isApifyPluginEnabled`, `isApifyTokenConfigured`. | Reuse. Add `isSerperConfigured` sibling (Phase 3). |
| `web/src/lib/core/portals.ts` | `readPortalsDoc()`. | Reuse. Add `apify_search` read/write helpers. |
| `web/src/components/targeting-card.tsx` | The Config "Job Targeting" card + the fixed Indeed Apify form + token field + schedule. | **Split apart**: Job Targeting → Pilot; Apify scheduled config → Pilot (as the composer); token stays on Config; schedule → Pilot. The fixed Indeed form is deleted. |
| `web/src/components/search-sources-card.tsx` | Search Sources toggle list (reads/writes `search_queries.enabled`). | **Move** to Scout as the "Scheduled web searches" section. Logic unchanged. |
| `web/src/components/automation-safety-card.tsx`, `automation-activity-log.tsx` | On Config. | **Move** to Pilot. Logic unchanged. |
| `plugins/apify/*` | The Apify provider plugin (`runActor`, `normalizeItem`, `isHttpsUrl`). | Reuse unchanged. |
| `portals.yml` | Single `provider: apify` Indeed entry + `search_queries` + `title_filter`/`location_filter`. | Migrate the Indeed entry → `apify_search` block. `search_queries` unchanged. `title_filter`/`location_filter` unchanged (now edited from Pilot). |

---

## 6. Hard constraints (the implementing agent MUST respect these)

These are non-obvious and have already bitten this codebase:

1. **Turbopack root is pinned to `web/`** (`web/next.config.mjs`). **No static import from `web/` into a root-level `.mjs`** — the build fails. Cross the boundary ONLY via `child_process.spawn` (how `web/src/lib/core/scan.ts` spawns `scan-ats-full.mjs`, and how `explore-apify.mjs` is spawned today). The platform registry, the fan-out expander, and the Serper runner that must be reachable by root scripts live at ROOT, not in `web/`. If the web UI needs registry *metadata* (platform labels/costs), expose it via a `node explore-apify.mjs --platforms` JSON dump that the web route spawns — do NOT mirror the registry in `web/` (drift).
2. **`web/` never loads the root `.env`.** Check key presence by reading the `.env` file directly (see `web/src/app/api/secrets/apify-token/route.ts` and `web/src/lib/core/apify-discover.ts`). Spawned root scripts load `.env` themselves via `dotenv.config({ quiet: true })` (quiet so stdout stays clean NDJSON).
3. **Never write to `jds/` from an interactive preview path.** `plugins/apify/index.mjs`'s `saveJd()` writes JD cache files unconditionally — `explore-apify.mjs` deliberately calls `runActor` + the pure mappers only, never `saveJd`. Keep it that way.
4. **Root tests** live in `tests/*.test.mjs`, are auto-discovered by `test-all.mjs`, use `pass`/`fail` from `tests/helpers.mjs`, and **must NOT call `process.exit()`** (breaks discovery). Web tests use `node --import tsx --test` and are listed in `web/package.json`'s `test:api` script.
5. **New root `.mjs` files must be registered** in `update-system.mjs`'s `SYSTEM_PATHS`, or `validate-system-paths-coverage.mjs` fails the suite.
6. **Cost honesty** (`web/src/lib/explore-cost.ts` + `CostBadge`): existing classes `free-network`, `spend`, `spend-apify`. Add a class for the Serper/web-search scheduled cost if its label differs. Tooltips must be *accurate per channel* (a prior bug reused the AI-eval tooltip for Apify — don't repeat).
7. **Ethical rails (`AGENTS.md`)**: never auto-submit applications; discovery only adds to the pipeline for user review. Scheduled web search results are `unverified` until liveness-checked (Level-3 hits can be weeks stale — `check-liveness.mjs` exists for ATS URLs).
8. **`scan.mjs` is the shared cron script.** Changes to its Apify read path (Phase 2) must be test-covered and must not break the existing ATS scan.

---

## 7. Architecture components to build

### 7a. Platform registry (root, new: `apify-platforms.mjs`)
One entry per platform. Pure data + adapter functions:
```js
export const PLATFORMS = {
  indeed:    { id:'indeed',    label:'Indeed',    cost:'usage',
               actor:'misceres/indeed-scraper',
               buildInput: ({query, location, country, max}) => ({ position: query, location, country, maxItems: max }),
               field_map: { title:['positionName','title'], url:'url', company:['company','companyName'], location:['location','formattedLocation'] } },
  linkedin:  { id:'linkedin',  label:'LinkedIn',  cost:'rental', actor:'<verify>', buildInput: ..., field_map: ... },
  glassdoor: { id:'glassdoor', label:'Glassdoor', cost:'usage',  actor:'<verify>', buildInput: ..., field_map: ... },
  naukri:    { id:'naukri',    label:'Naukri',    cost:'usage',  actor:'<verify>', buildInput: ..., field_map: ... },
};
export function platformMeta() { /* returns [{id,label,cost}] for the UI */ }
export function expand(keywords, platformIds, {location, country, max}) {
  /* returns jobs: [{platform, query, location, country, max}] — the fan-out */
}
```
Single source of truth for: the Explore composer, the Pilot scheduled composer, and `scan.mjs`'s cron fan-out. Verified actors + input schemas filled in during implementation (§9).

### 7b. Serper provider (root, new — mirror `plugins/apify/` structure)
A pluggable search provider: `runSerperQuery(query, {apiKey}) → [{title, url, snippet}]`. HTTP POST to Serper's `/search` endpoint with `q=<the site: query>`. LLM-free.

### 7c. Scheduled web-search runner (root, new: e.g. `web-search-run.mjs`)
Spawnable, like `explore-apify.mjs`. Reads enabled `search_queries`, runs each via the Serper provider, filters results against `title_filter`, dedupes against `scan-history.tsv`, liveness-checks, appends to `data/pipeline.md` (via the canonical writers, same as the ATS scan). NDJSON progress to stdout. Registered in `SYSTEM_PATHS`.

### 7d. Web routes (Next.js, respect the boundary — spawn, don't import)
- `POST /api/explore/apify` (rework): body `{keywords[], platforms[], location, country, max}` → spawn `explore-apify.mjs` with fanned-out jobs.
- `GET /api/apify/platforms` (new): spawn `node explore-apify.mjs --platforms` → return `[{id,label,cost}]` for the composer pills.
- `POST /api/scout/web-search` (new, Phase 3): on-demand — orchestrate the CLI AI search (moved from `/api/explore/ai`) OR spawn the Serper runner for a one-off. (On-demand AI search keeps its current CLI-spawn mechanism from `/api/explore/ai/route.ts` — just relocated conceptually to Scout.)
- `PUT /api/secrets/serper-key` (new, Phase 3): mirror `apify-token/route.ts` exactly (set/clear in `.env`, never echo back).

### 7e. Pages / components
- `web/src/app/pilot/page.tsx` + nav entry.
- `web/src/app/scout/page.tsx` + nav entry.
- `ApifyComposer` component (shared by Explore + Pilot): keyword chips + location + country + max + cost-labeled platform pills (from `/api/apify/platforms`) + fan-out cost preview + action button.
- Move `AutomationSafetyCard`, `AutomationActivityLog`, Job Targeting fields → Pilot. Move `SearchSourcesCard` → Scout. Move AI-search UI → Scout.

---

## 8. Phased implementation plan

Each phase ends green (tests pass, `tsc --noEmit`, `npm run build`, `node test-all.mjs --quick`) and is independently shippable. Follow TDD; commit per task.

### Phase 1 — Platform registry + Explore Apify composer (fixes the immediate pain)
1. **`apify-platforms.mjs`** (root) + `tests/apify-platforms.test.mjs`: `PLATFORMS`, `platformMeta()`, `expand()`. Verify actors for Indeed (known) first; LinkedIn/Glassdoor/Naukri actor slugs are placeholders until §9. Register in `SYSTEM_PATHS`.
2. **Rework `explore-apify.mjs`**: accept jobs `{platform, query, location, country, max}`, resolve via registry, keep the runActor + pure-mapper + no-`jds/` behavior. Add `--platforms` flag → prints `platformMeta()` JSON. Update `tests/explore-apify.test.mjs`.
3. **Rework `POST /api/explore/apify`**: body `{keywords[], platforms[], location, country, max}`; fan out via a small web-side call that spawns the registry expander (or fan out in the script — prefer script-side so the registry stays single-source). Update `route.test.ts`: gate cases + fan-out count.
4. **`GET /api/apify/platforms`** + test: spawn `--platforms`, return metadata.
5. **`ApifyComposer` component**: keyword chips (seeded once from snapshot `positive`), location, country, max, platform pills (from `/api/apify/platforms`, cost-labeled), fan-out cost preview (`N×M=X runs`), confirm-before-run. Replaces `apify-source-picker.tsx`.
6. **Rework `explore-provider.tsx`** state + `discoverApify()` for composer input.
7. **`explore-mode-toggle.tsx`**: keep Scan / Apify (AI search stays for now until Phase 3 moves it — or remove in Phase 3; do NOT orphan it).
8. Verify end-to-end in a browser with the real Apify token (Indeed works today; other platforms after §9). Full suites green. **Ship.**

### Phase 2 — Pilot page + scheduled Apify + Job Targeting move
1. **`apify_search` block**: `portals.yml` read/write helpers in `web/src/lib/core/portals.ts` + tests. Migrate the existing single Indeed entry → `apify_search` (a one-time migration or a `merge-tracker`-style migrate flag).
2. **`scan.mjs`**: read `apify_search`, expand via the registry (spawn or import — `scan.mjs` is root so it CAN import `apify-platforms.mjs`), run on the scheduled tick, feed the pipeline. Test-cover; don't break ATS scan.
3. **`/pilot` page + nav.** Compose: Job Targeting (moved fields), scheduled ATS toggle, scheduled `ApifyComposer` (writes `apify_search`), schedule interval, `AutomationSafetyCard`, `AutomationActivityLog`.
4. **Config cleanup**: remove Job Targeting + the fixed Indeed form + Safety/Activity from Config (they're on Pilot now). Keep CV/profile, company list, Apify token, blacklist.
5. Suites green. **Ship.**

### Phase 3 — Scout page + Serper web search
1. **Serper provider** (root) + tests: `runSerperQuery`. Mock HTTP in tests, no live calls in CI.
2. **`web-search-run.mjs`** (root) + tests: enabled `search_queries` → Serper → filter → dedupe → liveness → pipeline. LLM-free. Register in `SYSTEM_PATHS`.
3. **`isSerperConfigured`** in `apify-discover.ts` (or a sibling) + `PUT /api/secrets/serper-key` (mirror the Apify token route) + Config UI field.
4. **`/scout` page + nav.** Section ①: on-demand AI search (relocate the `/api/explore/ai` UI + route usage). Section ②: "Scheduled web searches" (the moved `SearchSourcesCard`) + schedule + run-via-Serper.
5. **Remove AI search from Explore** (`explore-mode-toggle.tsx` → Scan / Apify only; drop `"ai"` handling from `explorer-view.tsx`, relocate to Scout).
6. Wire the scheduled web-search runner into the automation loop/cron (alongside `scan.mjs`).
7. Suites green. **Ship.**

---

## 9. Must-verify at build time (do NOT assume)

- **Actor slugs + input schemas** for LinkedIn / Glassdoor / Naukri: check the live Apify store, confirm each runs with the user's token, read each actor's documented input to write `buildInput`, and read a real dataset item to write `field_map`. Candidates from prior research: LinkedIn `bebity/linkedin-jobs-scraper` (likely **rental** — confirm & label), Glassdoor `bebity/glassdoor-jobs-scraper`, Naukri `bovi/naukri-jobs-scraper` or `easyapi/naukri-jobs-scraper`. Indeed `misceres/indeed-scraper` is confirmed working.
- **Serper**: confirm the endpoint/response shape, that `site:` queries return as expected, and map its result fields → `{title, url}`. Test the *existing* `search_queries` against it before committing (Brave was rejected partly because its `site:` handling differs).
- **Rental cost gating**: if LinkedIn's chosen actor is rental, the pill shows `rental` and the confirm dialog notes the subscription — never run it silently.
- **ToS note** (`AGENTS.md` / README): LinkedIn/Glassdoor scraping carries Terms-of-Service risk; this is the user's call per-platform, surfaced via the label, not solved in code.

---

## 10. Non-goals

- No auto-submission of applications (hard ethical rail — discovery only fills the pipeline for review).
- No live per-item progress bar during Apify runs (queued/running/done only).
- Not unifying the Apify keyword list with the free-Scan keyword list (deliberately independent — cost safety).
- Not migrating the on-demand AI search away from the CLI (it stays CLI-token-powered; only the *scheduled* web search is Serper/headless).
- Not building Brave or other search providers now (Serper first; the provider is pluggable for later).

---

## 11. Review checklist (for when the human returns)

- [ ] Explore Apify tab is a composer (keywords + platforms + location + max), not a fixed picker.
- [ ] All 4 platforms appear, cost-labeled; LinkedIn labeled rental if applicable; nothing paid runs unopted.
- [ ] Fan-out cost preview is accurate (`keywords × platforms`), shown before the confirm.
- [ ] Real multi-platform run returns real results, correctly mapped, into the pipeline.
- [ ] `/pilot` exists with Job Targeting + scheduled ATS/Apify + Safety + Activity; Config no longer has them.
- [ ] `apify_search` block drives the scheduled scan; `scan.mjs` fans out; ATS scan still works.
- [ ] `/scout` exists with on-demand AI search (CLI) + scheduled web searches (Serper); AI search removed from Explore.
- [ ] Serper key set on Config, never echoed; scheduled web search runs headless (no CLI) and adds unverified-until-liveness results.
- [ ] All constraints in §6 honored (Turbopack boundary, no `jds/` writes on preview, tests registered, cost tooltips accurate).
- [ ] `npm run test:api`, `tsc --noEmit`, `npm run build`, `node test-all.mjs --quick` all green.
