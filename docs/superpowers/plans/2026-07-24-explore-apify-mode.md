# Explore Apify Discovery Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third, on-demand "Apify" discovery mode to the Explore page, alongside the existing free Scan and token-spending AI search modes, driven by `provider: apify` entries already supported in `portals.yml`.

**Architecture:** A new root-level script (`explore-apify.mjs`, outside `web/`'s Turbopack boundary) wraps the real `plugins/apify/_apify.mjs` (`runActor`) and `plugins/apify/index.mjs` (`normalizeItem`, `isHttpsUrl`) to run selected actors and stream NDJSON progress to stdout — never touching `jds/`. A new Next.js route (`/api/explore/apify`) gate-checks (plugin enabled, token configured, matching entries exist), spawns that script the same way `runDiscovery` already spawns `scan-ats-full.mjs`, and forwards its NDJSON lines to the browser. The Explore provider/UI get a third mode with its own source picker, confirm-before-run dialog, and simple queued/running/done per-source progress.

**Tech Stack:** Next.js 16 (Turbopack, App Router), TypeScript, `node:test` + `tsx` (web tests), plain Node ESM (root scripts), `node:child_process.spawn`, `js-yaml`.

## Global Constraints

- Turbopack's root is pinned to `web/` (`web/next.config.mjs`) — **no static import may reach outside `web/`** into root-level `.mjs` files. Cross the boundary only via `child_process.spawn`, exactly like `runDiscovery` → `scan-ats-full.mjs`.
- `web/` never loads the root `.env` into its own `process.env` — token presence is checked by reading the raw file (see `web/src/app/api/secrets/apify-token/route.ts`), and the spawned script loads `.env` itself via `dotenv.config({ quiet: true })` (same as `scan.mjs`), so a token change takes effect on the next run with no server restart.
- Nothing under this feature writes to `jds/` — `saveJd()` is deliberately never called from the new script.
- Every new/changed route file matching the existing test-covered pattern gets a `.test.ts`; every new root script gets a `tests/*.test.mjs` (auto-discovered by `test-all.mjs`'s `discoverTests()` — loose root-level `*.test.mjs` files are NOT auto-discovered, so the new script's test must live under `tests/`).
- No `console.log` in `web/` production code (repo-wide TypeScript rule).

---

## Task 1: `readPortalsDoc()` — extract the duplicated portals.yml read

**Files:**
- Modify: `web/src/lib/core/portals.ts`
- Create: `web/src/lib/core/portals.test.ts`
- Modify: `web/package.json:12` (add the new test file to `test:api`)

**Interfaces:**
- Produces: `readPortalsDoc(root: string): { doc: Record<string, unknown>; exists: boolean; malformed: boolean }` — exported from `web/src/lib/core/portals.ts`. `exists: false` only when the file is absent. `malformed: true` only when `yaml.load` throws (a value that parses but isn't an object still returns `doc: {}` with `malformed: false` — this exactly matches the current inline behavior in `web/src/app/api/portals/snapshot/route.ts`, which Task 2 will refactor to call this function instead of duplicating the logic).

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/core/portals.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPortalsDoc } from "./portals";

function makeTempRoot(content?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portals-doc-test-"));
  if (content !== undefined) fs.writeFileSync(path.join(dir, "portals.yml"), content, "utf8");
  return dir;
}

test("readPortalsDoc returns exists:false and an empty doc when portals.yml is absent", () => {
  const root = makeTempRoot();
  const r = readPortalsDoc(root);
  assert.deepEqual(r, { doc: {}, exists: false, malformed: false });
});

test("readPortalsDoc parses a valid document", () => {
  const root = makeTempRoot("title_filter:\n  positive:\n    - Intern\n");
  const r = readPortalsDoc(root);
  assert.equal(r.exists, true);
  assert.equal(r.malformed, false);
  assert.deepEqual((r.doc.title_filter as { positive: string[] }).positive, ["Intern"]);
});

test("readPortalsDoc reports malformed:true on invalid YAML, without throwing", () => {
  const root = makeTempRoot("not: [valid, yaml: {{{");
  const r = readPortalsDoc(root);
  assert.equal(r.exists, true);
  assert.equal(r.malformed, true);
  assert.deepEqual(r.doc, {});
});

test("readPortalsDoc treats a non-object document (e.g. a bare list) as an empty doc, not malformed", () => {
  const root = makeTempRoot("- just\n- a\n- list\n");
  const r = readPortalsDoc(root);
  assert.equal(r.exists, true);
  assert.equal(r.malformed, false);
  assert.deepEqual(r.doc, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --import tsx --test src/lib/core/portals.test.ts`
Expected: FAIL — `readPortalsDoc` is not exported from `./portals`.

- [ ] **Step 3: Add `readPortalsDoc` to `web/src/lib/core/portals.ts`**

Add near the top of the file, after the existing imports (the file already imports `fs`, `path`, `yaml` — no new imports needed):

```ts
export type PortalsDoc = { doc: Record<string, unknown>; exists: boolean; malformed: boolean };

/** Tolerant portals.yml reader shared by every read-only consumer (the Config
 *  snapshot, the Explore Apify picker, …). Never throws. `malformed` is true
 *  ONLY when the file exists but fails to parse — a file that parses to a
 *  non-object (e.g. a bare YAML list) is treated as an empty doc, matching
 *  the behavior this replaces in the snapshot route. Callers that need to
 *  REFUSE to write over a malformed file (web/src/app/api/portals/route.ts's
 *  PUT) keep their own stricter inline check — this helper is for reads. */
export function readPortalsDoc(root: string): PortalsDoc {
  const file = path.join(root, "portals.yml");
  if (!fs.existsSync(file)) return { doc: {}, exists: false, malformed: false };
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    const doc = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    return { doc, exists: true, malformed: false };
  } catch {
    return { doc: {}, exists: true, malformed: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node --import tsx --test src/lib/core/portals.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Add the new test file to `test:api`**

In `web/package.json`, change the `test:api` script (line 12) from:

```
"test:api": "node --import tsx --test src/app/api/portals/route.test.ts src/app/api/portals/snapshot/route.test.ts src/app/api/automation/route.test.ts src/app/api/blacklist/route.test.ts src/app/api/secrets/apify-token/route.test.ts src/app/api/automation/log/route.test.ts"
```

to (prepend the new file):

```
"test:api": "node --import tsx --test src/lib/core/portals.test.ts src/app/api/portals/route.test.ts src/app/api/portals/snapshot/route.test.ts src/app/api/automation/route.test.ts src/app/api/blacklist/route.test.ts src/app/api/secrets/apify-token/route.test.ts src/app/api/automation/log/route.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/core/portals.ts web/src/lib/core/portals.test.ts web/package.json
git commit -m "$(cat <<'EOF'
feat(web): extract readPortalsDoc() shared portals.yml reader

Behavior-preserving extraction of the parse-with-defaults logic that
was inline in the snapshot route, so the upcoming Explore Apify route
doesn't duplicate it a third time.
EOF
)"
```

---

## Task 2: wire `readPortalsDoc()` into the snapshot route + add `apifySources`

**Files:**
- Modify: `web/src/app/api/portals/snapshot/route.ts`
- Modify: `web/src/app/api/portals/snapshot/route.test.ts`

**Interfaces:**
- Consumes: `readPortalsDoc` from `@/lib/core/portals` (Task 1).
- Produces: the snapshot GET response gains `apifySources: { name: string; actor: string; enabled: boolean }[]` — every `tracked_companies` entry with `provider === "apify"`, regardless of its `enabled` flag (Explore's picker, built in Task 8, must show disabled-for-cron entries too).

- [ ] **Step 1: Write the failing tests**

Add to `web/src/app/api/portals/snapshot/route.test.ts` (after the existing tests):

```ts
test("GET surfaces provider:apify tracked_companies entries as apifySources, regardless of enabled", async () => {
  const root = makeTempRoot(`
tracked_companies:
  - name: "Indeed India — DS/ML Intern (via Apify)"
    provider: apify
    actor: misceres/indeed-scraper
    input: { position: "Data Science Intern" }
    enabled: true
  - name: "LinkedIn — India (via Apify)"
    provider: apify
    actor: bebity/linkedin-jobs-scraper
    enabled: false
  - name: "Palantir"
    careers_url: "https://jobs.lever.co/palantir"
`);
  const res = await callGet(root);
  const data = await res.json();
  assert.equal(data.apifySources.length, 2);
  const indeed = data.apifySources.find((s: any) => s.name === "Indeed India — DS/ML Intern (via Apify)");
  assert.equal(indeed.actor, "misceres/indeed-scraper");
  assert.equal(indeed.enabled, true);
  const linkedin = data.apifySources.find((s: any) => s.name === "LinkedIn — India (via Apify)");
  assert.equal(linkedin.enabled, false); // still present — enabled only gates cron, not the picker
});

test("GET returns an empty apifySources list when no provider:apify entries exist", async () => {
  const root = makeTempRoot(`tracked_companies:\n  - name: Anthropic\n    careers_url: https://job-boards.greenhouse.io/anthropic\n`);
  const res = await callGet(root);
  const data = await res.json();
  assert.deepEqual(data.apifySources, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && node --import tsx --test src/app/api/portals/snapshot/route.test.ts`
Expected: FAIL — `data.apifySources` is `undefined`, `.length` throws.

- [ ] **Step 3: Refactor the route**

In `web/src/app/api/portals/snapshot/route.ts`, replace the imports and the GET body's read block. Full new file:

```ts
import { careerOpsRoot } from "@/lib/career-ops";
import { readPortalsDoc } from "@/lib/core/portals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATS_VENDORS = [
  { id: "greenhouse", test: (h: string) => /^job-boards(\.eu)?\.greenhouse\.io$/.test(h) || h === "boards.greenhouse.io" },
  { id: "ashby", test: (h: string) => h === "jobs.ashbyhq.com" },
  { id: "lever", test: (h: string) => /^jobs\.(eu\.)?lever\.co$/.test(h) },
  { id: "workday", test: (h: string) => /\.myworkdayjobs\.com$/.test(h) },
] as const;

function detectVendor(careersUrl: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(careersUrl).hostname;
  } catch {
    return null;
  }
  return ATS_VENDORS.find((v) => v.test(hostname))?.id ?? null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

const EMPTY_SNAPSHOT = { positive: [], negative: [], alwaysAllow: [], block: [], apify: null, companies: [], searchSources: [], apifySources: [] };

export async function GET() {
  const { doc, exists, malformed } = readPortalsDoc(careerOpsRoot());
  if (!exists) return Response.json(EMPTY_SNAPSHOT);
  if (malformed) return Response.json({ ...EMPTY_SNAPSHOT, malformed: true });

  const tf = isObj(doc.title_filter) ? doc.title_filter : {};
  const lf = isObj(doc.location_filter) ? doc.location_filter : {};
  const companies = Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [];
  const apifyEntry = companies.find((c) => isObj(c) && c.provider === "apify") as Record<string, unknown> | undefined;
  const input = apifyEntry && isObj(apifyEntry.input) ? apifyEntry.input : {};
  const searchQueries = Array.isArray(doc.search_queries) ? doc.search_queries : [];

  return Response.json({
    positive: strList(tf.positive),
    negative: strList(tf.negative),
    alwaysAllow: strList(lf.always_allow),
    block: strList(lf.block),
    apify: apifyEntry
      ? {
          present: true,
          enabled: apifyEntry.enabled !== false,
          position: typeof input.position === "string" ? input.position : "",
          country: typeof input.country === "string" ? input.country : "",
          area: typeof input.location === "string" ? input.location : "",
          maxItems: typeof input.maxItems === "number" ? input.maxItems : 25,
        }
      : null,
    companies: companies
      .filter((c: unknown) => isObj(c) && c.source === "web-ui")
      .map((c: any) => ({ name: c.name, careersUrl: c.careers_url, vendor: detectVendor(String(c.careers_url ?? "")) })),
    // Each search_queries entry is a free WebSearch (site: filter), not tied to
    // any ATS vendor — surfaced read/toggle-only so a non-technical client can
    // turn a platform (LinkedIn, Glassdoor, Naukri, ...) on/off without editing
    // the query text itself (that stays AI/CLI-edited, same as title_filter).
    searchSources: searchQueries
      .filter((q): q is Record<string, unknown> => isObj(q) && typeof q.name === "string")
      .map((q) => ({
        name: q.name as string,
        query: typeof q.query === "string" ? q.query : "",
        enabled: q.enabled !== false,
      })),
    // Every provider:apify entry, for the Explore page's on-demand Apify mode
    // picker — deliberately NOT filtered by `enabled` (that flag only gates
    // scan.mjs's unattended cron path; a client can run a source here even if
    // it's off for cron, and vice versa — see docs/superpowers/specs/
    // 2026-07-24-explore-apify-mode-design.md).
    apifySources: companies
      .filter((c): c is Record<string, unknown> => isObj(c) && c.provider === "apify" && typeof c.name === "string")
      .map((c) => ({
        name: c.name as string,
        actor: typeof c.actor === "string" ? c.actor : "",
        enabled: c.enabled !== false,
      })),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && node --import tsx --test src/app/api/portals/snapshot/route.test.ts`
Expected: PASS (all tests, including the pre-existing 4).

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/portals/snapshot/route.ts web/src/app/api/portals/snapshot/route.test.ts
git commit -m "$(cat <<'EOF'
feat(web): expose provider:apify entries as apifySources on the snapshot

Additive field for the upcoming Explore Apify mode picker — separate
from searchSources (WebSearch-only today) since the earlier method-
tagged unification spec was never built. Not filtered by `enabled`:
that flag governs scan.mjs's cron path only.
EOF
)"
```

---

## Task 3: `ApifyScanEvent` type + `ExploreMode` extension

**Files:**
- Modify: `web/src/lib/explore.ts`

**Interfaces:**
- Produces: `ApifyScanEvent` union type; `ExploreMode = "scan" | "ai" | "apify"`. Both consumed by Tasks 6, 7, 9, 10.

- [ ] **Step 1: Add the type**

In `web/src/lib/explore.ts`, change line 69 from:

```ts
export type ExploreMode = "scan" | "ai";
```

to:

```ts
export type ExploreMode = "scan" | "ai" | "apify";
```

Then, immediately after the existing `ScanEvent` type (after line 93, before the `cleanChips` import block), add:

```ts
/** Stream event grammar for Apify-mode discovery (NDJSON, same transport as
 *  ScanEvent but a DIFFERENT shape — Apify's API gives no companies/scanned/
 *  total figures, so this is a separate union rather than shoehorning fake
 *  numbers into ScanEvent's ats-shaped fields). */
export type ApifyScanEvent =
  | { kind: "sourceStart"; source: string }
  | { kind: "sourceDone"; source: string; count: number }
  | { kind: "sourceError"; source: string; message: string }
  | { kind: "offer"; offer: DiscoveredOffer }
  | { kind: "error"; message: string }
  | { kind: "done"; count: number; offers: DiscoveredOffer[] };
```

- [ ] **Step 2: Verify types compile**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors (existing 2-mode `ExploreMode` consumers — `explore-mode-toggle.tsx`'s two buttons, `explore-provider.tsx`'s `mode === "ai"` checks — are still valid subsets of the 3-value union; TypeScript doesn't require exhaustive handling of a widened string-literal union unless a `switch` lacks a `default`, and neither consumer has one).

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/explore.ts
git commit -m "feat(web): add ApifyScanEvent type and widen ExploreMode to include apify"
```

---

## Task 4: `explore-apify.mjs` — the spawned Apify runner script

**Files:**
- Create: `explore-apify.mjs` (repo root)
- Create: `tests/explore-apify.test.mjs`

**Interfaces:**
- Produces (importable, for the test): `processEntry(entry, token, emit, deps?)`, `mapItem(item, entry)`, `runAll(entries, token, emit, deps?)` where `deps = { runActorFn }` defaults to the real `runActor`.
- Produces (CLI): `node explore-apify.mjs --entries <path-to-json-file>` — reads `APIFY_TOKEN` from `.env` (via `dotenv.config({ quiet: true })`, same convention as `scan.mjs`), reads the entries array from the given JSON file, writes one JSON object per line to stdout per the `ApifyScanEvent`-shaped grammar defined in Task 3, and a final `{"kind":"done", ...}` line.
- Consumes: `runActor` from `./plugins/apify/_apify.mjs`, `normalizeItem` + `isHttpsUrl` from `./plugins/apify/index.mjs` — both already exist, unmodified.

- [ ] **Step 1: Write the failing test**

Create `tests/explore-apify.test.mjs`:

```js
// tests/explore-apify.test.mjs — DI-based tests for explore-apify.mjs's
// event-emission contract. No real Apify calls: runActorFn is stubbed.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nexplore-apify.mjs');

const mod = await import(pathToFileURL(join(ROOT, 'explore-apify.mjs')).href);
const { processEntry, mapItem, runAll } = mod;

const ENTRY = {
  name: 'LinkedIn — India (via Apify)',
  actor: 'bebity/linkedin-jobs-scraper',
  input: { keywords: 'Data Scientist' },
  field_map: { title: 'title', url: 'url', company: 'company', location: 'location' },
};

// mapItem — pure mapping, no network.
{
  const offer = mapItem({ title: 'ML Engineer', url: 'https://example.com/j/1', company: 'Acme', location: 'Remote' }, ENTRY);
  if (offer && offer.title === 'ML Engineer' && offer.url === 'https://example.com/j/1' && offer.ats === ENTRY.name && offer.source === 'apify') {
    pass('mapItem() maps a dataset item to a DiscoveredOffer with ats=entry.name, source="apify"');
  } else {
    fail(`mapItem() returned ${JSON.stringify(offer)}`);
  }
}
{
  const offer = mapItem({ title: 'No URL Here' }, ENTRY);
  if (offer === null) pass('mapItem() returns null for an item missing a usable url');
  else fail(`mapItem() should have rejected a url-less item, got ${JSON.stringify(offer)}`);
}
{
  const offer = mapItem({ title: 'Bad scheme', url: 'javascript:alert(1)' }, ENTRY);
  if (offer === null) pass('mapItem() rejects a non-https url');
  else fail(`mapItem() should have rejected a javascript: url, got ${JSON.stringify(offer)}`);
}

// processEntry — success path, injected runActorFn.
{
  const events = [];
  const fakeRunActor = async (actor, input, opts) => {
    if (actor === ENTRY.actor && opts.token === 'tok') {
      return [
        { title: 'A', url: 'https://x.example/a', company: 'X', location: 'Remote' },
        { title: 'B', url: 'https://x.example/b', company: 'X', location: 'Remote' },
      ];
    }
    throw new Error('unexpected call');
  };
  await processEntry(ENTRY, 'tok', (e) => events.push(e), { runActorFn: fakeRunActor });
  const kinds = events.map((e) => e.kind);
  if (kinds[0] === 'sourceStart' && kinds.includes('offer') && kinds.at(-1) === 'sourceDone') {
    pass('processEntry() emits sourceStart, offer(s), then sourceDone on success');
  } else {
    fail(`processEntry() success-path event kinds: ${JSON.stringify(kinds)}`);
  }
  const done = events.find((e) => e.kind === 'sourceDone');
  if (done && done.count === 2) pass('processEntry() sourceDone.count matches the number of mapped offers');
  else fail(`processEntry() sourceDone was ${JSON.stringify(done)}`);
}

// processEntry — failure path, one bad source must not throw.
{
  const events = [];
  const failingRunActor = async () => {
    throw new Error('Apify run failed: TIMED-OUT');
  };
  await processEntry(ENTRY, 'tok', (e) => events.push(e), { runActorFn: failingRunActor });
  const err = events.find((e) => e.kind === 'sourceError');
  if (err && /TIMED-OUT/.test(err.message) && err.source === ENTRY.name) {
    pass('processEntry() emits sourceError (not a throw) when runActorFn rejects');
  } else {
    fail(`processEntry() failure-path events: ${JSON.stringify(events)}`);
  }
}

// runAll — one entry fails, one succeeds; both must be represented, in parallel.
{
  const events = [];
  const entries = [ENTRY, { ...ENTRY, name: 'Naukri — India (via Apify)', actor: 'other/actor' }];
  const mixedRunActor = async (actor) => {
    if (actor === 'other/actor') throw new Error('boom');
    return [{ title: 'C', url: 'https://x.example/c', company: 'X', location: '' }];
  };
  const offers = await runAll(entries, 'tok', (e) => events.push(e), { runActorFn: mixedRunActor });
  const sourceDone = events.filter((e) => e.kind === 'sourceDone');
  const sourceError = events.filter((e) => e.kind === 'sourceError');
  if (sourceDone.length === 1 && sourceError.length === 1 && offers.length === 1) {
    pass('runAll() lets one source error while the other succeeds, returning only successful offers');
  } else {
    fail(`runAll() mixed-result: sourceDone=${sourceDone.length} sourceError=${sourceError.length} offers=${offers.length}`);
  }
}

process.exit(process.exitCode || 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/explore-apify.test.mjs`
Expected: FAIL — `explore-apify.mjs` does not exist yet (module not found).

- [ ] **Step 3: Write `explore-apify.mjs`**

Create at the repo root:

```js
#!/usr/bin/env node

/**
 * explore-apify.mjs — spawned by the web app's /api/explore/apify route to
 * run selected provider:apify portals.yml entries live, on demand, and
 * stream NDJSON progress to stdout.
 *
 * Why this exists instead of importing plugins/apify/_apify.mjs directly
 * into the Next.js route: web/next.config.mjs pins Turbopack's root to
 * web/, which refuses to bundle modules outside it (see the identical
 * problem already documented in web/src/lib/tracker-table.mjs). Spawning a
 * separate process is how the web app already crosses this boundary — see
 * runDiscovery() in web/src/lib/core/scan.ts spawning scan-ats-full.mjs.
 *
 * Deliberately NOT scan.mjs and NOT plugins/apify/index.mjs's default
 * fetch() export: that fetch() unconditionally writes JD-cache files to
 * jds/ (saveJd()) with no --dry-run awareness. This script only calls
 * runActor() + the pure mapping helpers, so an Explore "preview" click
 * never writes to disk — see docs/superpowers/specs/
 * 2026-07-24-explore-apify-mode-design.md.
 *
 * Usage:
 *   node explore-apify.mjs --entries <path-to-json-file>
 *
 * The entries file is a JSON array of portals.yml provider:apify entries
 * (already filtered by the caller): [{ name, actor, input, field_map,
 * timeout_ms? }, ...]. Emits one JSON object per line to stdout:
 *   {"kind":"sourceStart","source":"..."}
 *   {"kind":"offer","offer":{...}}
 *   {"kind":"sourceDone","source":"...","count":N}
 *   {"kind":"sourceError","source":"...","message":"..."}
 *   {"kind":"done","count":N,"offers":[...]}
 */

import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { runActor } from './plugins/apify/_apify.mjs';
import { normalizeItem, isHttpsUrl } from './plugins/apify/index.mjs';

/** Map one raw Apify dataset item to a DiscoveredOffer, or null if unusable.
 *  ats = the full portals.yml entry name (specific and unambiguous — e.g.
 *  "LinkedIn — India (via Apify)"); source = "apify" (the discovery
 *  MECHANISM, mirroring how AI-search offers set source: "ai-search"). */
export function mapItem(item, entry) {
  const normalized = normalizeItem(item, entry.field_map, entry.defaults);
  if (!normalized.title || !normalized.url || !isHttpsUrl(normalized.url)) return null;
  return { ...normalized, postedAt: '', ats: entry.name, source: 'apify' };
}

/** Run one entry's actor and emit its events. Never throws — a failing
 *  source becomes a sourceError event so runAll's other entries proceed. */
export async function processEntry(entry, token, emit, deps = {}) {
  const runActorFn = deps.runActorFn || runActor;
  emit({ kind: 'sourceStart', source: entry.name });
  try {
    const opts = { token };
    if (entry.timeout_ms != null) opts.timeoutMs = entry.timeout_ms;
    const items = await runActorFn(entry.actor, entry.input || {}, opts);
    let count = 0;
    for (const item of items) {
      const offer = mapItem(item, entry);
      if (offer) {
        emit({ kind: 'offer', offer });
        count++;
      }
    }
    emit({ kind: 'sourceDone', source: entry.name, count });
    return count;
  } catch (err) {
    emit({ kind: 'sourceError', source: entry.name, message: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

/** Run every entry IN PARALLEL (one failing source must not block the
 *  others), returning only the offers from entries that succeeded. */
export async function runAll(entries, token, emit, deps = {}) {
  const collected = [];
  const collectingEmit = (e) => {
    if (e.kind === 'offer') collected.push(e.offer);
    emit(e);
  };
  await Promise.allSettled(entries.map((entry) => processEntry(entry, token, collectingEmit, deps)));
  return collected;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  try {
    const { config } = await import('dotenv');
    // quiet: this script's stdout is a strict NDJSON contract the web route
    // parses line-by-line — dotenv's banner would corrupt it.
    config({ quiet: true });
  } catch {
    // dotenv is optional — fall back to ambient process.env
  }

  const args = process.argv.slice(2);
  const entriesFlagIdx = args.indexOf('--entries');
  const entriesPath = entriesFlagIdx >= 0 ? args[entriesFlagIdx + 1] : null;
  if (!entriesPath) {
    process.stderr.write('explore-apify.mjs: missing required --entries <path>\n');
    process.exit(1);
  }

  let entries;
  try {
    entries = JSON.parse(readFileSync(entriesPath, 'utf8'));
    if (!Array.isArray(entries)) throw new Error('entries file must contain a JSON array');
  } catch (err) {
    process.stderr.write(`explore-apify.mjs: could not read --entries file: ${err.message}\n`);
    process.exit(1);
  }

  const emit = (e) => process.stdout.write(JSON.stringify(e) + '\n');
  const token = process.env.APIFY_TOKEN || '';
  const offers = await runAll(entries, token, emit);
  emit({ kind: 'done', count: offers.length, offers });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/explore-apify.test.mjs`
Expected: all `pass()` lines, no `fail()` lines, exit code 0.

- [ ] **Step 5: Sanity-check the CLI path with a fake token (no real Apify call — expect a clean sourceError, not a crash)**

```bash
echo '[{"name":"Test Entry","actor":"nonexistent/actor","input":{},"field_map":{"title":"title","url":"url"}}]' > /tmp/explore-apify-smoke.json
APIFY_TOKEN=fake node explore-apify.mjs --entries /tmp/explore-apify-smoke.json
rm /tmp/explore-apify-smoke.json
```

Expected output: three NDJSON lines — `sourceStart`, then `sourceError` (401/403 from Apify, since `fake` isn't a real token), then `done` with `count:0`. No stack trace, no non-JSON output, no `jds/` files created (`git status` should show nothing new).

- [ ] **Step 6: Commit**

```bash
git add explore-apify.mjs tests/explore-apify.test.mjs
git commit -m "$(cat <<'EOF'
feat: add explore-apify.mjs, a spawnable NDJSON runner for Apify sources

Wraps plugins/apify/_apify.mjs's runActor() and the pure mapping
helpers from plugins/apify/index.mjs — deliberately skips saveJd(), so
a live discovery run never writes to jds/. Lives at the repo root
(not web/) because Turbopack's root is pinned to web/ and refuses
modules outside it; the web route will spawn this the same way
runDiscovery() already spawns scan-ats-full.mjs.
EOF
)"
```

---

## Task 5: shared Apify-gate helpers (`isApifyPluginEnabled`, `isApifyTokenConfigured`)

**Files:**
- Create: `web/src/lib/core/apify-discover.ts`
- Create: `web/src/lib/core/apify-discover.test.ts`
- Modify: `web/src/app/api/secrets/apify-token/route.ts` (reuse `isApifyTokenConfigured`, DRY — same regex existed twice otherwise)
- Modify: `web/package.json:12` (add the new test file)

**Interfaces:**
- Produces: `isApifyPluginEnabled(root: string): boolean` — reads `config/plugins.yml`, true only if `plugins.apify.enabled === true`. `isApifyTokenConfigured(root: string): boolean` — reads the raw `.env` file, true if an `APIFY_TOKEN=<non-empty>` line exists. Both consumed by Task 6's route.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/core/apify-discover.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isApifyPluginEnabled, isApifyTokenConfigured } from "./apify-discover";

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apify-discover-test-"));
}

test("isApifyPluginEnabled is false when config/plugins.yml doesn't exist", () => {
  const root = makeTempRoot();
  assert.equal(isApifyPluginEnabled(root), false);
});

test("isApifyPluginEnabled is false when apify isn't enabled", () => {
  const root = makeTempRoot();
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config", "plugins.yml"), "plugins:\n  apify:\n    enabled: false\n");
  assert.equal(isApifyPluginEnabled(root), false);
});

test("isApifyPluginEnabled is true when apify is enabled", () => {
  const root = makeTempRoot();
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config", "plugins.yml"), "plugins:\n  apify:\n    enabled: true\n");
  assert.equal(isApifyPluginEnabled(root), true);
});

test("isApifyPluginEnabled is false on malformed YAML, never throws", () => {
  const root = makeTempRoot();
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config", "plugins.yml"), "not: [valid: {{{");
  assert.equal(isApifyPluginEnabled(root), false);
});

test("isApifyTokenConfigured is false when .env doesn't exist", () => {
  const root = makeTempRoot();
  assert.equal(isApifyTokenConfigured(root), false);
});

test("isApifyTokenConfigured is true when APIFY_TOKEN is set", () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, ".env"), "OTHER=1\nAPIFY_TOKEN=apify_api_abc123\n");
  assert.equal(isApifyTokenConfigured(root), true);
});

test("isApifyTokenConfigured is false when the line is present but empty", () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, ".env"), "APIFY_TOKEN=\n");
  assert.equal(isApifyTokenConfigured(root), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && node --import tsx --test src/lib/core/apify-discover.test.ts`
Expected: FAIL — module `./apify-discover` does not exist.

- [ ] **Step 3: Write `web/src/lib/core/apify-discover.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Is the apify plugin turned on in config/plugins.yml? Mirrors the
 *  `configured` half of plugins/_engine.mjs's pluginStatus() for this one
 *  known plugin — that helper needs full manifest discovery machinery we
 *  don't otherwise need here, and can't be imported anyway (it's outside
 *  web/'s Turbopack root). Fail-closed (false) on any read/parse error. */
export function isApifyPluginEnabled(root: string): boolean {
  const file = path.join(root, "config", "plugins.yml");
  if (!fs.existsSync(file)) return false;
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    if (!isObj(parsed) || !isObj(parsed.plugins)) return false;
    const apify = parsed.plugins.apify;
    return isObj(apify) && apify.enabled === true;
  } catch {
    return false;
  }
}

const TOKEN_KEY = "APIFY_TOKEN";

/** Is APIFY_TOKEN set (non-empty) in the root .env? Raw line read, same
 *  pattern as web/src/app/api/secrets/apify-token/route.ts's GET — never
 *  loads the value into this process's own process.env. */
export function isApifyTokenConfigured(root: string): boolean {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return false;
  try {
    const lines = fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n");
    return lines.some((l) => new RegExp(`^${TOKEN_KEY}=.+`).test(l.trim()));
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && node --import tsx --test src/lib/core/apify-discover.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Reuse `isApifyTokenConfigured` in the existing secrets route (DRY)**

In `web/src/app/api/secrets/apify-token/route.ts`, the `isConfigured(lines)` helper duplicates the same regex now centralized in Task 5's Step 3. Replace the file's `GET` to use the shared helper instead (keep `readLines`/`envPath`/`isConfigured` as-is for the `PUT` handler, which still needs line-level read/write — only `GET` changes):

Change:

```ts
export async function GET() {
  const lines = readLines(careerOpsRoot());
  return Response.json({ configured: isConfigured(lines) });
}
```

to:

```ts
export async function GET() {
  return Response.json({ configured: isApifyTokenConfigured(careerOpsRoot()) });
}
```

And add the import at the top of the file:

```ts
import { isApifyTokenConfigured } from "@/lib/core/apify-discover";
```

(`isConfigured` stays defined and used by `PUT`'s response at the bottom of the file — do not remove it.)

- [ ] **Step 6: Run the existing secrets route test to confirm no regression**

Run: `cd web && node --import tsx --test src/app/api/secrets/apify-token/route.test.ts`
Expected: PASS, unchanged (this was a behavior-preserving swap — same regex, same file, same semantics).

- [ ] **Step 7: Add the new test file to `test:api`**

In `web/package.json`, prepend `src/lib/core/apify-discover.test.ts` to the `test:api` script (same pattern as Task 1 Step 5).

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/core/apify-discover.ts web/src/lib/core/apify-discover.test.ts web/src/app/api/secrets/apify-token/route.ts web/package.json
git commit -m "$(cat <<'EOF'
feat(web): add isApifyPluginEnabled/isApifyTokenConfigured gate helpers

Shared, testable checks for the upcoming Explore Apify route's
pre-flight gates. Also de-duplicates the APIFY_TOKEN-presence regex
that previously only lived inline in the secrets route.
EOF
)"
```

---

## Task 6: `POST /api/explore/apify` — the streaming route

**Files:**
- Create: `web/src/app/api/explore/apify/route.ts`
- Create: `web/src/app/api/explore/apify/route.test.ts`
- Modify: `web/package.json:12` (add the new test file)

**Interfaces:**
- Consumes: `readPortalsDoc` (Task 1), `isApifyPluginEnabled` + `isApifyTokenConfigured` (Task 5), `careerOpsRoot` + `rootScript` (`@/lib/career-ops`, pre-existing).
- Produces: `POST` handler. Request body `{ sources: string[] }`. Streams `application/x-ndjson` lines shaped as `ApifyScanEvent` (Task 3). 400 with `{error}` for: no sources in body, plugin disabled, token missing, none of the requested names match a `provider: apify` entry.

- [ ] **Step 1: Write the failing tests (gate logic only — the actual spawn isn't unit-tested, matching this repo's existing precedent: neither `/api/explore` nor `/api/explore/ai`, which also spawn/stream, have a route.test.ts)**

Create `web/src/app/api/explore/apify/route.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(opts: { portalsYaml?: string; pluginsYaml?: string; env?: string } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "explore-apify-route-test-"));
  if (opts.portalsYaml !== undefined) fs.writeFileSync(path.join(dir, "portals.yml"), opts.portalsYaml, "utf8");
  if (opts.pluginsYaml !== undefined) {
    fs.mkdirSync(path.join(dir, "config"), { recursive: true });
    fs.writeFileSync(path.join(dir, "config", "plugins.yml"), opts.pluginsYaml, "utf8");
  }
  if (opts.env !== undefined) fs.writeFileSync(path.join(dir, ".env"), opts.env, "utf8");
  return dir;
}

const ENABLED_PLUGINS = "plugins:\n  apify:\n    enabled: true\n";
const WITH_TOKEN = "APIFY_TOKEN=apify_api_test\n";
const PORTALS_WITH_ENTRY = `
tracked_companies:
  - name: "LinkedIn — India (via Apify)"
    provider: apify
    actor: bebity/linkedin-jobs-scraper
    input: { keywords: "Data Scientist" }
    field_map: { title: title, url: url }
`;

async function callPost(root: string, body: unknown) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/explore/apify", { method: "POST", body: JSON.stringify(body) });
  return mod.POST(req);
}

test("POST 400s when no sources are given", async () => {
  const root = makeTempRoot({ portalsYaml: PORTALS_WITH_ENTRY, pluginsYaml: ENABLED_PLUGINS, env: WITH_TOKEN });
  const res = await callPost(root, { sources: [] });
  assert.equal(res.status, 400);
});

test("POST 400s when the apify plugin isn't enabled", async () => {
  const root = makeTempRoot({ portalsYaml: PORTALS_WITH_ENTRY, pluginsYaml: "plugins:\n  apify:\n    enabled: false\n", env: WITH_TOKEN });
  const res = await callPost(root, { sources: ["LinkedIn — India (via Apify)"] });
  assert.equal(res.status, 400);
  const d = await res.json();
  assert.match(d.error, /apify|plugin/i);
});

test("POST 400s when config/plugins.yml doesn't exist at all", async () => {
  const root = makeTempRoot({ portalsYaml: PORTALS_WITH_ENTRY, env: WITH_TOKEN });
  const res = await callPost(root, { sources: ["LinkedIn — India (via Apify)"] });
  assert.equal(res.status, 400);
});

test("POST 400s when no APIFY_TOKEN is configured", async () => {
  const root = makeTempRoot({ portalsYaml: PORTALS_WITH_ENTRY, pluginsYaml: ENABLED_PLUGINS });
  const res = await callPost(root, { sources: ["LinkedIn — India (via Apify)"] });
  assert.equal(res.status, 400);
  const d = await res.json();
  assert.match(d.error, /token/i);
});

test("POST 400s when none of the requested source names match a provider:apify entry", async () => {
  const root = makeTempRoot({ portalsYaml: PORTALS_WITH_ENTRY, pluginsYaml: ENABLED_PLUGINS, env: WITH_TOKEN });
  const res = await callPost(root, { sources: ["Nonexistent Source"] });
  assert.equal(res.status, 400);
});

test("POST passes all gates and returns a streaming NDJSON response", async () => {
  const root = makeTempRoot({ portalsYaml: PORTALS_WITH_ENTRY, pluginsYaml: ENABLED_PLUGINS, env: WITH_TOKEN });
  const res = await callPost(root, { sources: ["LinkedIn — India (via Apify)"] });
  // Gates all pass, so the route spawns explore-apify.mjs with a fake token —
  // the spawned process will itself fail against the real Apify API (no
  // network mocking here), but the ROUTE's job (gate checks + starting the
  // stream) is what this test verifies, matching this repo's existing
  // precedent of not unit-testing the spawn/network behavior of streaming
  // discovery routes (/api/explore, /api/explore/ai have no route.test.ts
  // for the same reason). explore-apify.mjs's own logic is covered by
  // tests/explore-apify.test.mjs (Task 4) with a fully injected runActorFn.
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/x-ndjson; charset=utf-8");
  // Drain the stream so the spawned child (which will exit quickly on a
  // fake token) doesn't linger past the test.
  const reader = res.body!.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && node --import tsx --test src/app/api/explore/apify/route.test.ts`
Expected: FAIL — `./route.ts` does not exist.

- [ ] **Step 3: Write `web/src/app/api/explore/apify/route.ts`**

```ts
import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { readPortalsDoc } from "@/lib/core/portals";
import { isApifyPluginEnabled, isApifyTokenConfigured } from "@/lib/core/apify-discover";
import type { ApifyScanEvent } from "@/lib/explore";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function POST(req: NextRequest) {
  let body: { sources?: unknown } = {};
  try {
    body = (await req.json()) as { sources?: unknown };
  } catch {
    /* empty body → no sources, caught below */
  }
  const requested = Array.isArray(body.sources) ? body.sources.filter((s): s is string => typeof s === "string") : [];
  if (requested.length === 0) {
    return Response.json({ error: "no sources selected" }, { status: 400 });
  }

  const root = careerOpsRoot();

  if (!isApifyPluginEnabled(root)) {
    return Response.json({ error: "The Apify plugin isn't enabled — turn it on in Config → Search Sources." }, { status: 400 });
  }
  if (!isApifyTokenConfigured(root)) {
    return Response.json({ error: "No Apify token configured — add one in Config → Search Sources." }, { status: 400 });
  }

  const { doc } = readPortalsDoc(root);
  const companies = Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [];
  const entries = companies.filter(
    (c): c is Record<string, unknown> =>
      isObj(c) && c.provider === "apify" && typeof c.name === "string" && requested.includes(c.name),
  );
  if (entries.length === 0) {
    return Response.json({ error: "none of the requested sources are configured" }, { status: 400 });
  }

  const entriesFile = path.join(os.tmpdir(), `career-ops-apify-${randomUUID()}.json`);
  fs.writeFileSync(
    entriesFile,
    JSON.stringify(
      entries.map((e) => ({
        name: e.name,
        actor: e.actor,
        input: e.input ?? {},
        field_map: e.field_map,
        timeout_ms: e.timeout_ms,
      })),
    ),
    "utf8",
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: ApifyScanEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* stream already closed client-side */
        }
      };

      const child = spawn(process.execPath, [rootScript("explore-apify"), "--entries", entriesFile], { cwd: root });

      let buf = "";
      child.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        const parts = buf.split(/\r?\n/);
        buf = parts.pop() ?? "";
        for (const line of parts) {
          if (!line.trim()) continue;
          try {
            send(JSON.parse(line) as ApifyScanEvent);
          } catch {
            /* skip an unparsable line rather than crashing the stream */
          }
        }
      });

      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          fs.unlinkSync(entriesFile);
        } catch {
          /* best-effort cleanup */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      child.on("error", (err) => {
        send({ kind: "error", message: err.message });
        finish();
      });
      child.on("close", finish);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && node --import tsx --test src/app/api/explore/apify/route.test.ts`
Expected: PASS (6/6). The last test spawns the real `explore-apify.mjs` against a fake token — it will exit quickly with a `sourceError` (Apify rejects the fake token), which is fine; the test only asserts the route itself started a 200 NDJSON stream and drains it to let the child exit cleanly.

- [ ] **Step 5: Add the new test file to `test:api`**

In `web/package.json`, append `src/app/api/explore/apify/route.test.ts` to the `test:api` script.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/explore/apify/route.ts web/src/app/api/explore/apify/route.test.ts web/package.json
git commit -m "$(cat <<'EOF'
feat(web): add POST /api/explore/apify streaming discovery route

Gate-checks plugin-enabled + token-configured + at least one matching
provider:apify entry before spawning explore-apify.mjs, then forwards
its NDJSON lines to the browser — same spawn pattern runDiscovery()
already uses for scan-ats-full.mjs.
EOF
)"
```

---

## Task 7: `explore-mode-toggle.tsx` — third Apify pill

**Files:**
- Modify: `web/src/components/explore/explore-mode-toggle.tsx`

**Interfaces:**
- Consumes: `ExploreMode` (now 3-valued, Task 3).
- Produces: the toggle now calls `onChange("apify")` for the new middle pill; no new props (the component already takes `mode`/`onChange`/`cliConfigured` — `cliConfigured` is irrelevant to the Apify pill and left unused by it, exactly as `CostBadge`'s `free-network` pill ignores it today).

- [ ] **Step 1: There is no meaningful "failing test" for a static button — this is a visual/behavioral change verified by a manual check in Step 3, per this component having no existing test file (mirrors the rest of `web/src/components/explore/*.tsx`, none of which have `.test.tsx` files — coverage here lives in the underlying route/provider logic already tested in Tasks 1–6, and in Task 8's picker's own test).**

- [ ] **Step 2: Add the middle "Apify" pill**

In `web/src/components/explore/explore-mode-toggle.tsx`, add `Zap` to the `lucide-react` import (line 3) and insert a new button between the existing `Scan` and `AI search` buttons:

```ts
import { Compass, Sparkles, Zap } from "lucide-react";
```

Insert this block after the `Scan` button's closing `</button>` (currently ending at line 36) and before the `AI search` button (currently starting at line 37):

```tsx
      <button
        type="button"
        onClick={() => onChange("apify")}
        aria-pressed={mode === "apify"}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition-colors sm:flex-none sm:gap-2 sm:px-3 max-sm:min-h-[44px]",
          mode === "apify" ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground",
        )}
      >
        <Zap className="size-4" />
        <span className="font-medium">Apify</span>
        <span className="hidden sm:inline-flex">
          <CostBadge kind="spend" size="xs" />
        </span>
      </button>
```

(Reuses the existing `kind="spend"` `CostBadge` variant — Apify credits and AI tokens are both "this costs something," and `CostBadge` doesn't currently distinguish the two; introducing a third badge variant is out of scope for this plan.)

- [ ] **Step 3: Manual verification**

Run: `cd web && npm run dev`, open `/explore`. Expected: three pills — Scan, Apify, AI search — in that order, each clickable, the active one highlighted. (Full end-to-end behavior isn't wired yet — Tasks 8–10 make the Apify pill actually do something — this step only confirms the toggle renders and `onChange` fires without a console error.)

- [ ] **Step 4: Commit**

```bash
git add web/src/components/explore/explore-mode-toggle.tsx
git commit -m "feat(web): add the Apify pill to the Explore mode toggle"
```

---

## Task 8: `apify-source-picker.tsx` — dynamic Sources row for Apify mode

**Files:**
- Create: `web/src/components/explore/apify-source-picker.tsx`

**Interfaces:**
- Consumes: `GET /api/portals/snapshot`'s `apifySources` field (Task 2).
- Produces: `ApifySourcePicker({ selected, onChange }: { selected: string[]; onChange: (names: string[]) => void })` — a pill row, config-driven (unlike `filter-builder.tsx`'s hardcoded `ATS_SOURCES` row). Also exports `type ApifySource = { name: string; actor: string; enabled: boolean }` for `explore-provider.tsx` (Task 9) to use when deciding empty/blocked state.

- [ ] **Step 1: There is no existing `.test.tsx` precedent anywhere in `web/src/components/explore/` (confirmed: `filter-builder.tsx`, `discovery-card.tsx`, `explore-mode-toggle.tsx` all have zero test coverage — this codebase tests the data layer, not component rendering, for this feature area). This component is verified manually in Step 3, consistent with that pattern.**

- [ ] **Step 2: Write `web/src/components/explore/apify-source-picker.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ApifySource = { name: string; actor: string; enabled: boolean };

export function ApifySourcePicker({
  selected,
  onChange,
  onLoaded,
}: {
  selected: string[];
  onChange: (names: string[]) => void;
  /** Fires once with the fetched list, so the parent (explore-provider) can
   *  decide the empty/blocked state without a second fetch. */
  onLoaded?: (sources: ApifySource[]) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<ApifySource[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portals/snapshot");
        const data = (await res.json()) as { apifySources?: ApifySource[] };
        const list = data.apifySources ?? [];
        if (!cancelled) {
          setSources(list);
          onLoaded?.(list);
        }
      } catch {
        if (!cancelled) onLoaded?.([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="size-3.5 animate-spin" /> Loading Apify sources…
      </div>
    );
  }

  if (sources.length === 0) return null; // parent renders the empty state instead

  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((s) => {
        const on = selected.includes(s.name);
        return (
          <button
            key={s.name}
            type="button"
            onClick={() => toggle(s.name)}
            title={s.enabled ? undefined : "Not scheduled for unattended scanning — still runnable here"}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px]",
              on ? "border-brand/40 bg-brand-soft text-brand" : "border-border text-muted hover:text-foreground",
              !s.enabled && !on && "opacity-70",
            )}
          >
            {s.name}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

With no `provider: apify` entries in the dev checkout's `portals.yml` yet, confirm `GET /api/portals/snapshot` returns `apifySources: []` and the component renders nothing (not an empty box):

```bash
curl -s http://localhost:3000/api/portals/snapshot | python3 -c "import json,sys; print(json.load(sys.stdin)['apifySources'])"
```

Expected: `[]`. Then temporarily add a `provider: apify` entry to a scratch `portals.yml` (or point `CAREER_OPS_ROOT` at the fixture used in Task 6's tests) and re-check that the pill(s) render, are independently toggleable, and a disabled-for-cron entry still appears (title tooltip visible on hover).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/explore/apify-source-picker.tsx
git commit -m "feat(web): add ApifySourcePicker, the dynamic Sources row for Apify mode"
```

---

## Task 9: wire Apify mode into `explore-provider.tsx`

**Files:**
- Modify: `web/src/components/explore/explore-provider.tsx`

**Interfaces:**
- Consumes: `ApifyScanEvent` (Task 3), `ApifySource` (Task 8).
- Produces (added to `ExploreCtx`): `apifySelected: string[]`, `setApifySelected: (names: string[]) => void`, `apifyAvailable: ApifySource[]`, `setApifyAvailable: (s: ApifySource[]) => void`, `apifyProgress: Record<string, { state: "queued" | "running" | "done" | "error"; count?: number; message?: string }>`, `apifyConfirming: boolean`, `requestApifyConfirm: () => void`, `cancelApifyConfirm: () => void`, `discoverApify: () => Promise<void>`.

- [ ] **Step 1: No isolated unit test for this task — `explore-provider.tsx` has no existing `.test.tsx` (it's a client-only React context provider; this codebase's test coverage for Explore lives in the route/type layer, Tasks 1–6). Verified via Task 10's manual end-to-end check, which exercises this provider through the real UI.**

- [ ] **Step 2: Extend the imports**

In `web/src/components/explore/explore-provider.tsx`, change the import from `@/lib/explore` (lines 5–17) to also pull `ApifyScanEvent`:

```ts
import {
  DEFAULT_FILTERS,
  ATS_LABEL,
  filtersToParams,
  aiToParams,
  isBroadSearch,
  parseExplorePatch,
  type ApifyScanEvent,
  type AtsSource,
  type DiscoveredOffer,
  type ExploreFilters,
  type ExploreMode,
  type ScanEvent,
} from "@/lib/explore";
import type { ApifySource } from "./apify-source-picker";
```

- [ ] **Step 3: Add the new state and type additions**

Add `ApifySourceProgress` near the existing `SourceState` type (after line 40):

```ts
export type ApifySourceProgress = { state: "queued" | "running" | "done" | "error"; count?: number; message?: string };
```

Add the new fields to `ExploreCtx` (inside the type, after the `aiCost: AiCost;` line at line 73):

```ts
  // ── Apify mode ──
  apifySelected: string[];
  setApifySelected: (names: string[]) => void;
  apifyAvailable: ApifySource[];
  setApifyAvailable: (s: ApifySource[]) => void;
  apifyProgress: Record<string, ApifySourceProgress>;
  apifyConfirming: boolean;
  requestApifyConfirm: () => void;
  cancelApifyConfirm: () => void;
  discoverApify: () => Promise<void>;
```

Add the corresponding `useState` hooks inside `ExploreProvider` (after the existing `const [aiCost, ...]` line, currently line 129):

```ts
  const [apifySelected, setApifySelected] = useState<string[]>([]);
  const [apifyAvailable, setApifyAvailable] = useState<ApifySource[]>([]);
  const [apifyProgress, setApifyProgress] = useState<Record<string, ApifySourceProgress>>({});
  const [apifyConfirming, setApifyConfirming] = useState(false);
```

- [ ] **Step 4: Add `discoverApify()` and the confirm helpers**

Add this new callback after the existing `discoverAI` callback (after its closing `}, []);` at line 439):

```ts
  const requestApifyConfirm = useCallback(() => setApifyConfirming(true), []);
  const cancelApifyConfirm = useCallback(() => setApifyConfirming(false), []);

  // Apify mode — run the selected provider:apify sources live, on demand.
  // Every click costs real Apify credits, so this is only ever invoked after
  // requestApifyConfirm()'s dialog is explicitly accepted (see
  // ExplorerView's Apify branch, Task 10) — never on a bare button click.
  const discoverApify = useCallback(async () => {
    if (runningRef.current) return;
    const sources = apifySelected;
    if (sources.length === 0) return;
    setApifyConfirming(false);
    runningRef.current = true;
    setPhase("casting");
    setOffers([]);
    setMatchCount(0);
    setError("");
    setStatus("Running selected sources on Apify…");
    const initProgress: Record<string, ApifySourceProgress> = {};
    for (const s of sources) initProgress[s] = { state: "queued" };
    setApifyProgress(initProgress);

    const acc: DiscoveredOffer[] = [];
    let sawError = "";
    try {
      const r = await fetch("/api/explore/apify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources }),
      });
      if (r.status === 400) {
        const d = await r.json().catch(() => ({}));
        sawError = d.error || "Apify discovery isn't available.";
      } else if (!r.body) {
        sawError = "No response stream.";
      } else {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let ev: ApifyScanEvent;
            try {
              ev = JSON.parse(line) as ApifyScanEvent;
            } catch {
              continue;
            }
            switch (ev.kind) {
              case "sourceStart":
                setApifyProgress((p) => ({ ...p, [ev.source]: { state: "running" } }));
                break;
              case "sourceDone":
                setApifyProgress((p) => ({ ...p, [ev.source]: { state: "done", count: ev.count } }));
                break;
              case "sourceError":
                setApifyProgress((p) => ({ ...p, [ev.source]: { state: "error", message: ev.message } }));
                break;
              case "offer":
                acc.push(ev.offer);
                setOffers((o) => [...o, ev.offer]);
                setMatchCount(acc.length);
                break;
              case "error":
                sawError = ev.message;
                break;
              default:
                break;
            }
          }
        }
      }
    } catch (e) {
      sawError = e instanceof Error ? e.message : "stream error";
    }

    runningRef.current = false;
    if (acc.length > 0) {
      setMatchCount(acc.length);
      setPhase("revealing");
      setStatus(`${acc.length} role${acc.length === 1 ? "" : "s"} found via Apify.`);
      window.setTimeout(() => setPhase("results"), 850);
    } else if (sawError) {
      setError(sawError);
      setPhase("failed");
    } else {
      setPhase("empty-loose");
    }
  }, [apifySelected]);
```

- [ ] **Step 5: Wire the new fields into the context value**

In the `value = useMemo(...)` block (currently lines 496–505), add the new fields to both the object and the dependency array:

```ts
  const value = useMemo(
    () => ({
      filters, setFilters, initFilters, phase,
      running: phase === "casting" || phase === "scanning" || phase === "revealing" || phase === "hunting",
      offers, sources, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, status, partial, error, added, adding,
      discover, addToPipeline, applyPatch, reset,
      mode, setMode, aiIntent, setAiIntent, discoverAI, aiTrace, aiCost,
      apifySelected, setApifySelected, apifyAvailable, setApifyAvailable, apifyProgress,
      apifyConfirming, requestApifyConfirm, cancelApifyConfirm, discoverApify,
    }),
    [filters, setFilters, initFilters, phase, offers, sources, matchCount, companiesScanned, companiesAvailable, capHit, droppedNoDate, status, partial, error, added, adding, discover, addToPipeline, applyPatch, reset, mode, setMode, aiIntent, discoverAI, aiTrace, aiCost, apifySelected, apifyAvailable, apifyProgress, apifyConfirming, requestApifyConfirm, cancelApifyConfirm, discoverApify],
  );
```

- [ ] **Step 6: `setMode` already preserves results across mode switches (line 444's `setMode` only stops a running search, never clears state) — no change needed there; Apify's own state (`apifySelected`/`apifyProgress`) simply persists alongside `offers` exactly like AI search's `aiTrace` does today.**

- [ ] **Step 7: Verify types compile**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/explore/explore-provider.tsx
git commit -m "$(cat <<'EOF'
feat(web): wire Apify mode into ExploreProvider

Adds apifySelected/apifyAvailable/apifyProgress state, a confirm-
before-run gate (requestApifyConfirm/cancelApifyConfirm), and
discoverApify() — streams /api/explore/apify's NDJSON into the same
offers/matchCount state Scan and AI search already share.
EOF
)"
```

---

## Task 10: render Apify mode in `explorer-view.tsx`

**Files:**
- Modify: `web/src/components/explore/explorer-view.tsx`

**Interfaces:**
- Consumes: everything added in Task 9 (`useExplore()`'s new fields), `ApifySourcePicker` (Task 8).
- Produces: a third rendering branch in `ExplorerView`, alongside the existing `isAi ? ... : ...` split — empty state (no sources configured), blocked state (plugin/token gate failed — reuses `BlockedCard`-style messaging pointing at Config), the picker + confirm-gated Discover button, per-source progress pills, and results.

- [ ] **Step 1: No component test — consistent with Task 7/8/9 (this whole directory has zero `.test.tsx` files; verified manually in Step 4).**

- [ ] **Step 2: Extend the destructured `useExplore()` call and imports**

In `web/src/components/explore/explorer-view.tsx`, change the `useExplore()` destructure (line 40) to also pull the Apify fields:

```ts
  const {
    filters, setFilters, initFilters, phase, running, offers, discover, status, error, mode, setMode, aiIntent, setAiIntent, discoverAI,
    companiesScanned, companiesAvailable, capHit, droppedNoDate, partial,
    apifySelected, setApifySelected, apifyAvailable, setApifyAvailable, apifyProgress, apifyConfirming, requestApifyConfirm, cancelApifyConfirm, discoverApify,
  } = useExplore();
```

Add imports (near the top, alongside the existing `lucide-react` import on line 4 and component imports):

```ts
import { Zap } from "lucide-react"; // add to the existing lucide-react import line
import { ApifySourcePicker, type ApifySource } from "./apify-source-picker";
import type { ApifySourceProgress } from "./explore-provider";
```

- [ ] **Step 3: Add the Apify rendering branch**

The component currently branches on `isAi ? (...) : (...)` (line 131 onward). Restructure the top-level branch to a three-way switch. Replace the block starting at `const isAi = mode === "ai";` (line 97) through the closing `)}` of the outer conditional (line 233) with:

```tsx
  const isAi = mode === "ai";
  const isApify = mode === "apify";
  if (running) return isAi ? <AiHuntView cliName={cli.name} /> : mode === "apify" ? <ApifyRunningView progress={apifyProgress} /> : <DiscoveringState />;

  const canDiscover = filters.ats.length > 0;
  const isResults = phase === "results";

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <Compass className="size-6 text-brand" />
            <h1 className={`${instrumentSerif.className} text-3xl text-foreground`}>Explore</h1>
            <span className="rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-text">New</span>
          </div>
          <div className="w-full sm:ml-auto sm:w-auto">
            <ExploreModeToggle mode={mode} onChange={setMode} cliConfigured={!!cli.id} />
          </div>
        </div>
        {!isResults && (
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
            {isAi
              ? "Describe the role in plain language — an AI hunts the open web for it, on your own AI. Candidates are unverified until you evaluate."
              : isApify
                ? "Run LinkedIn, Glassdoor, Naukri, or Indeed on demand via Apify — costs Apify credits per run, so pick your sources and confirm."
                : "Scan the public ATS network — Greenhouse, Lever, Ashby, Workday. Fresh postings matched to you, zero tokens. You only spend when you choose to evaluate one."}
          </p>
        )}
      </header>

      {!rootExists && (
        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          Your ApplyDeck home isn’t set up yet — discovery needs a checkout with a profile to seed from.
        </div>
      )}

      {isApify ? (
        <ApifyModeBody
          selected={apifySelected}
          setSelected={setApifySelected}
          available={apifyAvailable}
          setAvailable={setApifyAvailable}
          confirming={apifyConfirming}
          requestConfirm={requestApifyConfirm}
          cancelConfirm={cancelApifyConfirm}
          onDiscover={discoverApify}
          phase={phase}
          progress={apifyProgress}
          error={error}
          isResults={isResults}
          offers={enriched}
        />
      ) : isAi ? (
        phase === "blocked" ? (
          <BlockedCard />
        ) : (
          <div className="space-y-6">
            <AiSearchBox
              intent={aiIntent}
              onIntent={setAiIntent}
              onSubmit={() => void discoverAI()}
              cliConfigured={!!cli.id}
              cliName={cli.name}
              onRunScan={() => setMode("scan")}
            />
            {phase === "results" && <ResultsList offers={enriched} />}
            {phase === "empty-loose" && (
              <EmptyState
                tone="loose"
                title="No public matches — yet."
                body="AI search reads what's public. Try broader intent, or run the free Scan over the ATS network."
                onRerun={() => setMode("scan")}
                rerunLabel="Run the free Scan"
              />
            )}
            {phase === "failed" && <FailedCard msg={error || status} onRetry={() => void discoverAI()} />}
          </div>
        )
      ) : (
        <>
          {isResults ? (
            <div className="mb-6 rounded-xl border border-border bg-surface/30">
              <button type="button" onClick={() => setRefineOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-foreground">
                <Compass className="size-4 text-brand" /> Refine search
                <ChevronDown className={cn("ml-auto size-4 text-muted transition-transform", refineOpen && "rotate-180")} />
              </button>
              {refineOpen && (
                <div className="space-y-4 border-t border-border p-4">
                  <FilterBuilder filters={filters} onChange={setFilters} seededFrom={seed.seededFrom} />
                  <DiscoverBar canDiscover={canDiscover} onDiscover={discover} label="Re-cast (free)" />
                </div>
              )}
            </div>
          ) : (
            <div className="mb-6 rounded-2xl border border-border bg-surface/30 p-5">
              <FilterBuilder filters={filters} onChange={setFilters} seededFrom={seed.seededFrom} />
              <div className="mt-5">
                <DiscoverBar canDiscover={canDiscover} onDiscover={discover} label="Discover (free)" />
              </div>
            </div>
          )}

          {isResults && firstRun && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <p className="text-[13px] leading-relaxed text-foreground">
                These are live roles that match your CV. <span className="text-emerald-600 dark:text-emerald-400">Nothing here cost you a token.</span> Pick the one you&apos;re most curious about — Evaluate it and I&apos;ll tell you exactly how you score, and why.
              </p>
            </div>
          )}

          {isResults && capHit && (
            <CappedBanner companiesScanned={companiesScanned} companiesAvailable={companiesAvailable} onRefine={() => setRefineOpen(true)} />
          )}
          {isResults && <ResultsList offers={enriched} />}

          {phase === "empty-current" && (
            <EmptyState
              tone="good"
              title="You're all caught up."
              body="Nothing new since your last scan. Your pipeline is current — that's the goal."
              note={scanNote}
              onRerun={() => {
                setFilters({ ...filters, sinceDays: Math.max(filters.sinceDays, 30) });
                void discover();
              }}
              rerunLabel="Look back 30 days"
            />
          )}
          {phase === "empty-loose" && (
            <EmptyState
              tone="loose"
              title="No fresh matches — yet."
              body="Discovery is free — loosen and re-cast as often as you want."
              note={scanNote}
              onRerun={() => {
                setFilters({ ...filters, sinceDays: 30, block: [], allow: [] });
                void discover();
              }}
              rerunLabel="Widen to 30 days · clear location"
            />
          )}
          {phase === "degraded" && (
            <DegradedCard
              onRetry={() => void discover()}
              companiesScanned={companiesScanned}
              companiesAvailable={companiesAvailable}
              capHit={capHit}
              droppedNoDate={droppedNoDate}
              partial={partial}
            />
          )}
          {phase === "failed" && <FailedCard msg={error || status} onRetry={() => void discover()} />}
        </>
      )}
    </div>
  );
}
```

Note the `isResults` phase check now applies across all three modes identically (`phase === "results"`), so `ResultsList` rendering inside `ApifyModeBody` (below) reuses the exact same `enriched` offers array Scan/AI already build.

- [ ] **Step 4: Add the new sub-components**

Add these after the existing `DiscoverBar` function (after its closing brace, currently line 255):

```tsx
function ApifyRunningView({ progress }: { progress: Record<string, ApifySourceProgress> }) {
  const entries = Object.entries(progress);
  return (
    <div className="mx-auto max-w-2xl px-5 py-16 text-center">
      <Zap className="mx-auto size-8 animate-pulse text-brand" />
      <h2 className={`${instrumentSerif.className} mt-4 text-2xl text-foreground`}>Running on Apify…</h2>
      <ul className="mt-6 space-y-2 text-left">
        {entries.map(([name, p]) => (
          <li key={name} className="flex items-center justify-between rounded-lg border border-border bg-surface/30 px-3.5 py-2 text-sm">
            <span className="truncate text-foreground">{name}</span>
            <span
              className={cn(
                "text-xs font-medium",
                p.state === "running" && "text-brand",
                p.state === "done" && "text-emerald-500",
                p.state === "error" && "text-red-500",
                p.state === "queued" && "text-faint",
              )}
            >
              {p.state === "queued" && "queued"}
              {p.state === "running" && "running…"}
              {p.state === "done" && `done · ${p.count ?? 0} found`}
              {p.state === "error" && "error"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApifyModeBody({
  selected,
  setSelected,
  available,
  setAvailable,
  confirming,
  requestConfirm,
  cancelConfirm,
  onDiscover,
  phase,
  progress,
  error,
  isResults,
  offers,
}: {
  selected: string[];
  setSelected: (n: string[]) => void;
  available: ApifySource[];
  setAvailable: (s: ApifySource[]) => void;
  confirming: boolean;
  requestConfirm: () => void;
  cancelConfirm: () => void;
  onDiscover: () => void;
  phase: string;
  progress: Record<string, ApifySourceProgress>;
  error: string;
  isResults: boolean;
  offers: EnrichedOffer[];
}) {
  const loaded = useRef(false);
  return (
    <>
      <div className="mb-6 rounded-2xl border border-border bg-surface/30 p-5">
        <p className="mb-2 text-[13px] font-medium text-foreground">Sources</p>
        <ApifySourcePicker
          selected={selected}
          onChange={setSelected}
          onLoaded={(s) => {
            if (!loaded.current) {
              loaded.current = true;
              setAvailable(s);
            }
          }}
        />
        {available.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border bg-surface/40 px-3.5 py-3 text-sm text-muted">
            No Apify sources configured yet —{" "}
            <Link href="/config" className="font-medium text-brand hover:underline">
              add one in Config
            </Link>
            .
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={requestConfirm}
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground shadow-sm transition-all hover:brightness-110 disabled:opacity-50 max-sm:min-h-[44px]"
            >
              <Zap className="size-4" /> Discover
            </button>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
              <span className="size-1.5 rounded-full bg-amber-500" />
              Uses your Apify credits — {selected.length} source{selected.length === 1 ? "" : "s"} selected.
            </span>
          </div>
        )}
      </div>

      {confirming && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm font-medium text-foreground">
            Run {selected.length} source{selected.length === 1 ? "" : "s"} on Apify — uses your Apify credits?
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={onDiscover} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-brand-foreground transition hover:brightness-110">
              Confirm
            </button>
            <button onClick={cancelConfirm} className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground transition hover:border-brand/40">
              Cancel
            </button>
          </div>
        </div>
      )}

      {isResults && <ResultsList offers={offers} />}
      {phase === "failed" && <FailedCard msg={error} onRetry={onDiscover} />}
      {phase === "empty-loose" && (
        <div className="rounded-2xl border border-border bg-surface/30 px-6 py-12 text-center">
          <Zap className="mx-auto size-6 text-brand" />
          <h2 className={`${instrumentSerif.className} mt-4 text-2xl text-foreground`}>No matches from those sources.</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">Try different sources, or check back later — these actors reflect what's live on each platform right now.</p>
        </div>
      )}
    </>
  );
}
```

Add `useRef` to the existing React import at the top of the file if not already present (it already is, per line 3: `useEffect, useMemo, useRef, useState` — no change needed there).

- [ ] **Step 5: Run the type checker**

Run: `cd web && npx tsc --noEmit`
Expected: no errors. Fix any prop-shape mismatches (e.g. `EnrichedOffer` import already exists at the top of the file per line 15 — confirm it's still imported since `ApifyModeBody` now references it in its props type).

- [ ] **Step 6: Manual end-to-end verification**

```bash
cd web && npm run dev
```

Then, in a browser at `/explore`:
1. Click the **Apify** pill. With no `provider: apify` entries configured, confirm the "No Apify sources configured yet" message appears with a working Config link, and Discover is not shown at all.
2. Point `CAREER_OPS_ROOT` (via `web/.env.local`) at a scratch checkout with one `provider: apify` entry, restart `npm run dev`, reload `/explore`, click Apify again — confirm the source pill renders and is selectable.
3. Select it, click Discover, confirm the "Run 1 source on Apify — uses your Apify credits?" dialog appears; click Cancel — confirm nothing runs.
4. Click Discover again, Confirm — with no real `APIFY_TOKEN` configured, confirm the flow lands on the "Couldn't finish the search" failed state with a token-related error message (from the route's 400 gate), not a crash.
5. Check the browser console and terminal for errors throughout.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/explore/explorer-view.tsx
git commit -m "$(cat <<'EOF'
feat(web): render Apify mode in ExplorerView

Empty state (no sources configured), the source picker + cost-confirm
dialog, running/done-per-source progress, and results — reusing the
same ResultsList/FailedCard/EnrichedOffer pipeline Scan and AI search
already share.
EOF
)"
```

---

## Task 11: full verification pass + push

**Files:** none (verification only)

- [ ] **Step 1: Run the full web API test suite**

Run: `cd web && npm run test:api`
Expected: all tests pass (the pre-existing suite plus every test added in Tasks 1, 2, 5, 6).

- [ ] **Step 2: Run the web type checker**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the web build (catches anything `tsc --noEmit` alone misses, e.g. a genuine Turbopack module-resolution failure — the exact class of bug Task 4's redesign was created to avoid)**

Run: `cd web && npm run build`
Expected: builds successfully. If this fails specifically on `explore-apify.mjs` or `plugins/apify/*` being pulled into the bundle, that means something still statically imports across the `web/` boundary — check `web/src/app/api/explore/apify/route.ts` for an accidental static import instead of `rootScript()` + `spawn()`.

- [ ] **Step 4: Run the root project's own test suite (confirms `explore-apify.mjs` didn't break anything root-side, and gets picked up by `discoverTests()`)**

Run: `node test-all.mjs --only explore-apify`
Expected: the `tests/explore-apify.test.mjs` suite passes. Then run the full suite:

Run: `node test-all.mjs --quick`
Expected: no new failures versus the pre-existing baseline (some pre-existing failures may be unrelated to this change — compare against a run on `main` before this branch if anything is red).

- [ ] **Step 5: Review the full diff before pushing**

Run: `git status --short && git log --oneline main..HEAD` (or the relevant range) to confirm every commit from Tasks 1–10 is present and nothing unrelated (e.g. `K_Prem_Resume_Final.docx`, seen untracked in earlier `git status` output this session) got swept in.

- [ ] **Step 6: Push**

```bash
git push origin main
```

(Or the current branch, if not on `main` — check `git branch --show-current` first.)
