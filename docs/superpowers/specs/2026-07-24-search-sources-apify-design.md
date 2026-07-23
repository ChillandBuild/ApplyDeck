# Search Sources — Per-Platform WebSearch/Apify Choice — Design Spec

**Date:** 2026-07-24
**Status:** Approved by user (conversation), implementation pending

## Goal

Let the client choose, per job-board platform (LinkedIn, Glassdoor, Naukri, Indeed), whether that platform is scanned via free WebSearch (agent-driven, chat-time only) or via a paid Apify actor (zero-agent-token, can run unattended/scheduled) — or both. Extend the existing Search Sources card (Config page) so this choice is a simple toggle, with no new UI paradigm and no Apify-specific setup exposed beyond ON/OFF.

## Background — why this isn't just "add more sources"

Traced through `scan.mjs`, `modes/scan.md`, and `plugins/_engine.mjs`: there are two structurally different execution paths for "find jobs," not one:

- **`tracked_companies` (local parser, ATS JSON APIs, `provider: apify`)** — run by `node scan.mjs`, a plain Node script. Zero LLM/agent tokens. Can run unattended on a schedule/cron with no AI agent involved. Apify entries cost Apify's own run-credits and need `APIFY_TOKEN`.
- **`search_queries` (WebSearch, Level 3)** — run by the AI agent itself per `modes/scan.md`, not by `scan.mjs`. Free, but only executes while an agent is actively working, and results can be weeks-stale (must be Playwright-reverified before trusting a hit — already enforced, unchanged by this design).

Indeed already has a `provider: apify` entry (`misceres/indeed-scraper`). LinkedIn/Glassdoor/Naukri currently only have `search_queries` entries (added earlier this session). This design adds the missing `provider: apify` option for those three, and unifies how all four platforms' sourcing method is chosen and displayed.

## User decisions (locked)

| Decision | Choice |
|---|---|
| Should LinkedIn/Glassdoor/Naukri be able to run unattended/scheduled? | Yes — this is why Apify support matters here, not just as a quality upgrade |
| WebSearch vs Apify per platform | **Both, independently toggled** — a client can run the free version, the Apify version, both, or neither, per platform (Option A of 3 mocked up) |
| Apify UI depth | **ON/OFF toggle only** — no actor/input fields in the UI; actor selection + `field_map` setup is done once via an AI assistant, same as WebSearch query text today |
| Indeed's existing dedicated Apify form (Targeting card) | **Migrated** into the same unified Search Sources list as everyone else — the old per-field editor (position/country/area/max-items) is removed, not kept as a special case |

## Actors (existence confirmed, exact pick is an implementation task)

Verified via Apify Store search that real, maintained actors exist for all three platforms — exact actor choice and output-field mapping (`field_map`) requires reading each candidate's actual dataset schema, which happens during implementation, not here:

- LinkedIn: e.g. `bebity/linkedin-jobs-scraper`, `valig/linkedin-jobs-scraper`
- Glassdoor: e.g. `bebity/glassdoor-jobs-scraper`, `valig/glassdoor-jobs-scraper`
- Naukri: e.g. `bovi/naukri-jobs-scraper`, `easyapi/naukri-jobs-scraper`

New entries ship with `enabled: false` by default (no verified actor/token wired yet) — the client turns them on once set up, same "opt-in, fail-open" posture as the rest of `plugins/`.

**Note on platform ToS:** scraping LinkedIn/Glassdoor in particular carries real Terms-of-Service risk (LinkedIn especially enforces against automated scraping). This design doesn't change the project's existing ToS stance (`README.md`'s "you must comply with the Terms of Service of the career portals you interact with") — it's the client's call whether to enable these, same as choosing to use any Apify actor today.

## Data model (`portals.yml`)

Three new `tracked_companies` entries, same shape as the existing Indeed one:

```yaml
- name: "LinkedIn — India DS/ML/GenAI (via Apify)"
  provider: apify
  actor: <verified-actor-slug>
  input: { keywords: "Data Scientist", location: "Tamil Nadu", maxItems: 25 }
  field_map:
    title: [title, jobTitle]
    url: [url, jobUrl]
    company: [company, companyName]
    location: [location]
  enabled: false
```

(and the same for Glassdoor, Naukri.) No schema changes needed — `provider: apify` already generalizes to multiple entries; the only reason it didn't work today is that the API routes assumed exactly one.

## API changes

### `GET /api/portals/snapshot`

`searchSources` becomes the union of `search_queries` entries and `tracked_companies` entries with `provider: apify`, each tagged with its method:

```ts
type SearchSource = {
  name: string;
  method: "websearch" | "apify";
  query?: string;   // websearch only
  actor?: string;    // apify only
  enabled: boolean;
};
```

Response also gains a top-level `apifyTokenConfigured: boolean` (reusing the existing `hasToken()` check from `plugins/apify/_apify.mjs`) — the token is global, not per-source, so it's surfaced once, not per row.

The old single-entry `apify: {...}` field (position/country/area/maxItems) is **removed** from the response — nothing will read it once `TargetingCard` no longer renders that form.

### `PUT /api/portals`

`toggleSearchSource` gains a required `method` field, since the same `name` can now appear once per method:

```ts
toggleSearchSource?: { name: string; method: "websearch" | "apify"; enabled: boolean };
```

- `method: "websearch"` → same as today, matches in `search_queries`.
- `method: "apify"` → matches in `tracked_companies` where `provider === "apify" && name === name`.

The old `patch.apify` (field-editor) branch is **deleted** — no caller remains after `TargetingCard`'s form is removed. Deleting dead code per this project's YAGNI convention rather than leaving it unreachable.

## Component changes

- **`SearchSourcesCard`**: each row gains a method badge (`Free web search` / `Apify`). Apify rows additionally show a small warning when `apifyTokenConfigured` is false ("needs a token — set one up below"). The card gains a compact "Apify token" input (moved from `TargetingCard`, same `/api/secrets/apify-token` endpoint, same never-echo-back behavior) since Apify-method rows now live here.
- **`TargetingCard`**: loses all Apify-related state and UI (the `apifyPresent/apifyEnabled/apifyPosition/apifyCountry/apifyArea/apifyMaxItems/apifyTokenConfigured/typedApifyToken/tokenSaving/tokenError` state and the form rendering it) — becomes purely role keywords + location allow/block. `scheduleHours` is unrelated to Apify and stays untouched.

## Data flow (unchanged, now user-controlled per platform)

```
Client flips a Search Sources toggle
        │
        ▼
PUT /api/portals { toggleSearchSource: { name, method, enabled } }
        │
        ▼
portals.yml: search_queries[].enabled  OR  tracked_companies[provider=apify].enabled
        │
        ├─ method=apify      → node scan.mjs picks it up next run (zero agent tokens,
        │                       works on a schedule/cron, needs APIFY_TOKEN)
        └─ method=websearch  → the agent's Level-3 sweep picks it up next time an
                                agent runs /career-ops scan (per modes/scan.md,
                                unchanged — including the mandatory Playwright
                                re-verification of stale hits)
```

## Testing

- Extend `web/src/app/api/portals/route.test.ts`: `toggleSearchSource` now requires `method`; add cases for toggling an `apify`-method row, ambiguity when the same `name` exists under both methods, 404 on `(name, method)` not found.
- Extend `web/src/app/api/portals/snapshot/route.test.ts`: assert the merged list includes both methods with correct tagging, and `apifyTokenConfigured` reflects `.env` state.
- Remove tests for the deleted `patch.apify` field-editor branch (`route.test.ts`'s existing "updates the matched apify entry's input fields" and "returns 400 when apify body sent but no apify entry exists" cases) — replaced by the generalized toggle tests.
- No new Playwright/E2E needed — this is config plumbing, same risk profile as the existing toggle already shipped and tested.

## Non-goals

- Not building per-platform input-field editing in the UI (explicitly declined — AI-assisted setup instead).
- Not selecting/verifying the exact Apify actor or its `field_map` in this spec — that's implementation work, tracked as a concrete task, not left as an open question.
- Not changing WebSearch/Level-3 execution semantics (staleness handling, mandatory Playwright reverification) — untouched.
- Not addressing ToS/legal risk of scraping LinkedIn/Glassdoor beyond the existing project-wide disclaimer — flagged for the client's awareness, not solved in code.
