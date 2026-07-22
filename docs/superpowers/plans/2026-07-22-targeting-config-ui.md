# Targeting Config UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a "Job Targeting" card to the ApplyDeck web Config page so a non-technical user can edit role keywords, location preferences, one optional Apify (Indeed) source, and the scan schedule — all through form fields, with zero YAML editing.

**Architecture:** Extend the existing merge-safe, atomic-write API pattern (`web/src/app/api/portals/route.ts`, `web/src/app/api/profile/route.ts`) with two additions: a `PUT` handler on `/api/portals` for the new fields, and a new `/api/automation` route for the schedule. One new client component (`TargetingCard`) reuses the existing `KeywordField` chip input verbatim (extracted to a shared module — it currently lives private inside `filter-builder.tsx`). No new state store, no new file format — every write lands in `portals.yml` / `config/profile.yml`, the exact files the CLI/chat path already reads.

**Tech Stack:** Next.js 16 App Router, TypeScript, `js-yaml`, the repo's existing `atomicWriteWithBackup` (`web/src/lib/core/safe-write.ts`).

## Global Constraints

- **Never overwrite a malformed YAML file.** Follow the exact guard in `web/src/app/api/profile/route.ts:82-90`: if the file exists but fails to parse, return `409` with a clear message — do NOT fall back to an empty object and clobber it.
- **Preserve everything not being edited.** `portals.yml` has ~1,800 lines including 87 `tracked_companies` entries and extensive comments. Every write must load the existing doc, mutate ONLY the targeted keys, and `yaml.dump` the whole merged object back — never regenerate the file from scratch.
- **Cap all list inputs** the same way `web/src/app/api/portals/route.ts:27` already does (`.slice(0, 24)` for roles) — apply an equivalent cap to every new chip list (use 24) to prevent a client from pasting an unbounded list.
- **Apify `maxItems` must be capped at 50** server-side (not just in the UI) — credit-cost protection per the design conversation.
- **`schedule_hours` must be a positive integer**, clamp to `[1, 168]` (1 hour to 1 week) server-side.
- All new user-facing copy in plain English, no jargon ("Apify" must not appear in client-facing labels — call it "Indeed search").
- Run `cd web && npx tsc --noEmit` after every task — must exit 0.
- Commit after each task with the given message; do not push without being asked.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `web/src/components/keyword-field.tsx` | create | `KeywordField` extracted verbatim from `filter-builder.tsx` so both Explore and Config can import it — same component, same styling, same tests. |
| `web/src/components/explore/filter-builder.tsx` | modify | Replace its private `KeywordField` definition with an import from the new shared file. Zero behavior change. |
| `web/src/components/targeting-card.tsx` | create | The new Config-page card: roles/exclude/locations/block chip fields, the Indeed-via-Apify sub-section, the schedule selector, Save button. |
| `web/src/app/api/portals/route.ts` | modify | Add a `PUT` handler covering `title_filter.positive/negative`, `location_filter.always_allow/block`, and the one named `provider: apify` entry's `input` fields. Existing `POST` (onboarding) untouched. |
| `web/src/app/api/automation/route.ts` | create | `GET` returns current `automation` block (or defaults); `PUT` writes `automation.schedule_hours` into `config/profile.yml` via the same deep-merge pattern as `api/profile/route.ts`. |
| `web/src/components/config-form.tsx` | modify | Render `<TargetingCard />` below the existing AI Engine card. |
| `web/src/app/api/portals/route.test.ts` | create | Tests for the new `PUT` handler (cap enforcement, malformed-YAML guard, Apify entry matching). |
| `web/src/app/api/automation/route.test.ts` | create | Tests for schedule clamp + malformed-YAML guard. |

---

### Task 1: Extract `KeywordField` into a shared component

**Files:**
- Create: `web/src/components/keyword-field.tsx`
- Modify: `web/src/components/explore/filter-builder.tsx`

**Interfaces:**
- Consumes: `cleanChips` from `@/lib/explore` (already re-exported there per `web/src/lib/explore.ts`), `cn` from `@/lib/cn`.
- Produces (used by Task 3): `KeywordField({ values, tone, placeholder, onChange }: { values: string[]; tone: "inc" | "exc"; placeholder: string; onChange: (v: string[]) => void })` — a named export.

- [ ] **Step 1: Create the shared file with the exact existing implementation**

Create `web/src/components/keyword-field.tsx`:

```tsx
"use client";

import { useState } from "react";
import { X, Ban } from "lucide-react";
import { cn } from "@/lib/cn";
import { cleanChips } from "@/lib/explore";

// Shared chip-input control. Originally private to explore/filter-builder.tsx;
// extracted so config-form's TargetingCard can reuse the identical component
// (same commit-on-separator logic, same a11y, same styling) instead of a
// second implementation that could drift.
export const KEYWORD_FIELD_STYLE = `
.co-kf__chip{display:inline-flex;align-items:center;gap:.3rem;border-radius:999px;padding:.2rem .5rem .2rem .6rem;font-size:12.5px;line-height:1.2;border:1px solid transparent}
.co-kf__chip button{display:inline-flex;opacity:.6;transition:opacity .15s}
.co-kf__chip button:hover{opacity:1}
.co-kf__chip.inc{color:hsl(26 78% 42%);background:hsl(26 73% 51% / .11);border-color:hsl(26 73% 51% / .26)}
html.dark .co-kf__chip.inc{color:hsl(26 86% 70%);background:hsl(26 80% 55% / .14);border-color:hsl(26 80% 55% / .28)}
.co-kf__field{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;min-height:2.6rem;padding:.45rem .55rem;border-radius:.7rem}
.co-kf__field input{flex:1;min-width:7rem;background:transparent;border:none;outline:none;font-size:13.5px;color:inherit}
.co-kf__field input::placeholder{color:var(--co-faint,hsl(0 0% 60%))}
@media (max-width:639px){.co-kf__chip button{min-width:44px;min-height:44px;justify-content:center}.co-kf__chip{min-height:44px}.co-kf__field{min-height:44px}.co-kf__field input{min-height:32px}}
`;

export function KeywordField({
  values,
  tone,
  placeholder,
  onChange,
}: {
  values: string[];
  tone: "inc" | "exc";
  placeholder: string;
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const commit = (text: string) => {
    const parts = text.split(/[,\n;\t\r]+/);
    const next = cleanChips([...values, ...parts]);
    onChange(next);
    setDraft("");
  };
  return (
    <div className={cn("co-kf__field border border-border bg-surface/40 focus-within:border-brand/40 transition-colors")}>
      {values.map((v) => (
        <span key={v} className={cn("co-kf__chip", tone === "inc" ? "inc" : "border-border bg-surface-hover text-muted")}>
          {tone === "exc" && <Ban className="size-3 opacity-70" />}
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          const val = e.target.value;
          if (/[,\n;\t\r]$/.test(val)) commit(val);
          else setDraft(val);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text");
          const merged = draft + text;
          if (/[,;\n\t\r]/.test(text)) commit(merged);
          else setDraft(merged);
        }}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={values.length ? "" : placeholder}
      />
    </div>
  );
}
```

- [ ] **Step 2: Point `filter-builder.tsx` at the shared component**

In `web/src/components/explore/filter-builder.tsx`:
1. Delete the local `KeywordField` function definition (the block starting `function KeywordField({` through its closing `}` — currently lines ~30-89) and the CSS lines specific to `.co-fb__chip`/`.co-fb__field` inside the `STYLE` template string (keep any OTHER selectors in `STYLE` that aren't `.co-fb__chip`/`.co-fb__field`, if present — check before deleting the whole `STYLE` constant).
2. Add near the top imports: `import { KeywordField, KEYWORD_FIELD_STYLE } from "@/components/keyword-field";`
3. In the component's render, replace `<style>{STYLE}</style>` — if `STYLE` still has other CSS after step 1, change it to `<style>{STYLE}</style><style>{KEYWORD_FIELD_STYLE}</style>`; if `STYLE` becomes empty after removing the chip/field rules, replace the tag with just `<style>{KEYWORD_FIELD_STYLE}</style>` and delete the now-empty `STYLE` constant.
4. Every existing `className="co-fb__..."` reference to chip/field classes was inside the deleted function — nothing else in the file should reference `co-fb__chip`/`co-fb__field` directly (verify with grep in Step 3).

- [ ] **Step 3: Verify no dangling references and typecheck**

```bash
cd web
grep -n "co-fb__chip\|co-fb__field" src/components/explore/filter-builder.tsx
```
Expected: no output (both class names now live only in `keyword-field.tsx` as `co-kf__*`).

```bash
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Manual smoke test — Explore page unaffected**

With the dev server running (`PORT=3001 npm run dev` from `web/`, if not already up), open `http://localhost:3001/explore` and confirm the "Roles to find" / "Exclude" chip fields still render and accept typed + comma-separated input exactly as before (this page must show ZERO visible change — only the import path moved).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/keyword-field.tsx web/src/components/explore/filter-builder.tsx
git commit -m "refactor(web): extract KeywordField into a shared component"
```

---

### Task 2: `PUT /api/portals` — extended targeting writer

**Files:**
- Modify: `web/src/app/api/portals/route.ts`
- Create: `web/src/app/api/portals/route.test.ts`

**Interfaces:**
- Consumes: `careerOpsRoot` from `@/lib/career-ops`, `atomicWriteWithBackup` from `@/lib/core/safe-write` (both already imported in the file).
- Produces (used by Task 3's `TargetingCard`): `PUT /api/portals` accepting JSON body:
  ```ts
  {
    positive?: string[];      // title_filter.positive (full replace, like existing POST's roles)
    negative?: string[];      // title_filter.negative (full replace)
    alwaysAllow?: string[];   // location_filter.always_allow (full replace)
    block?: string[];         // location_filter.block (full replace)
    apify?: {                 // optional — only present if the client has an Apify entry
      enabled: boolean;       // controls tracked_companies[].enabled for the matched entry
      position?: string;      // → input.position
      country?: string;       // → input.country
      area?: string;          // → input.location
      maxItems?: number;      // → input.maxItems, clamped [1, 50]
    };
  }
  ```
  Response: `{ ok: true }` on success, `{ error: string }` with `400`/`409`/`500` on failure — same envelope shape as the existing `POST`.
  The Apify entry is matched by `provider === "apify"` on the FIRST such entry found in `tracked_companies` (this codebase has exactly one, added earlier — see `portals.yml`'s `"Indeed India — DS/ML Intern (via Apify)"` entry). If no `provider: apify` entry exists yet and the body includes `apify`, return `{ error: "no Apify source configured yet" }` with `400` — this route edits an existing entry, it does not create one (creating actor/field_map shape correctly is a chat/YAML task, out of scope here).

- [ ] **Step 1: Write the failing test**

Create `web/src/app/api/portals/route.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

// The route reads careerOpsRoot() from @/lib/career-ops, which resolves from
// CAREER_OPS_ROOT. Point it at a throwaway temp dir per test so we never touch
// the real repo's portals.yml.
function makeTempRoot(portalsYaml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portals-put-test-"));
  fs.writeFileSync(path.join(dir, "portals.yml"), portalsYaml, "utf8");
  return dir;
}

const BASE_YAML = `
title_filter:
  positive:
    - "Intern"
  negative:
    - "Senior"
location_filter:
  always_allow:
    - "India"
  block:
    - "Poland"
tracked_companies:
  - name: "Indeed India — DS/ML Intern (via Apify)"
    provider: apify
    actor: misceres/indeed-scraper
    input: { position: "Data Science Intern", country: "IN", location: "Tamil Nadu", maxItems: 25 }
    field_map:
      title: [positionName, title]
      url: url
      company: [company, companyName]
      location: [location, formattedLocation]
  - name: "Palantir"
    careers_url: "https://jobs.lever.co/palantir"
    enabled: true
`;

async function callPut(root: string, body: unknown) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`); // cache-bust across tests
  const req = new Request("http://x/api/portals", { method: "PUT", body: JSON.stringify(body) });
  return mod.PUT(req);
}

test("replaces title_filter positive/negative and location_filter lists", async () => {
  const root = makeTempRoot(BASE_YAML);
  const res = await callPut(root, {
    positive: ["Intern", "Machine Learning"],
    negative: ["Senior", "Staff"],
    alwaysAllow: ["India", "Coimbatore"],
    block: ["Poland"],
  });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  assert.deepEqual(doc.title_filter.positive, ["Intern", "Machine Learning"]);
  assert.deepEqual(doc.title_filter.negative, ["Senior", "Staff"]);
  assert.deepEqual(doc.location_filter.always_allow, ["India", "Coimbatore"]);
  // tracked_companies must survive untouched when apify is not in the body
  assert.equal(doc.tracked_companies.length, 2);
});

test("updates the matched apify entry's input fields and enabled flag", async () => {
  const root = makeTempRoot(BASE_YAML);
  const res = await callPut(root, {
    apify: { enabled: false, position: "ML Intern", country: "IN", area: "Coimbatore", maxItems: 999 },
  });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  const entry = doc.tracked_companies.find((c: any) => c.provider === "apify");
  assert.equal(entry.enabled, false);
  assert.equal(entry.input.position, "ML Intern");
  assert.equal(entry.input.location, "Coimbatore");
  assert.equal(entry.input.maxItems, 50); // clamped, not 999
  // the OTHER tracked_companies entry (Palantir) must be untouched
  const other = doc.tracked_companies.find((c: any) => c.name === "Palantir");
  assert.equal(other.careers_url, "https://jobs.lever.co/palantir");
});

test("caps positive/negative/location lists at 24 entries", async () => {
  const root = makeTempRoot(BASE_YAML);
  const many = Array.from({ length: 30 }, (_, i) => `Keyword${i}`);
  const res = await callPut(root, { positive: many });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  assert.equal(doc.title_filter.positive.length, 24);
});

test("returns 400 when apify body sent but no apify entry exists", async () => {
  const root = makeTempRoot(`
title_filter:
  positive: ["Intern"]
tracked_companies:
  - name: "Palantir"
    careers_url: "https://jobs.lever.co/palantir"
`);
  const res = await callPut(root, { apify: { enabled: true, maxItems: 25 } });
  assert.equal(res.status, 400);
});

test("refuses to write when portals.yml is malformed (409, no data loss)", async () => {
  const root = makeTempRoot("not: [valid, yaml: {{{");
  const before = fs.readFileSync(path.join(root, "portals.yml"), "utf8");
  const res = await callPut(root, { positive: ["Intern"] });
  assert.equal(res.status, 409);
  const after = fs.readFileSync(path.join(root, "portals.yml"), "utf8");
  assert.equal(after, before); // untouched
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --test src/app/api/portals/route.test.ts`
Expected: FAIL — the `PUT` export does not exist yet on `route.ts`.

- [ ] **Step 3: Implement the `PUT` handler**

In `web/src/app/api/portals/route.ts`, add this below the existing `POST` function (keep `POST` exactly as-is):

```ts
type TargetingPatch = {
  positive?: string[];
  negative?: string[];
  alwaysAllow?: string[];
  block?: string[];
  apify?: {
    enabled?: boolean;
    position?: string;
    country?: string;
    area?: string;
    maxItems?: number;
  };
};

function capList(v: unknown, max = 24): string[] {
  return (Array.isArray(v) ? v : []).map((r) => String(r).trim()).filter(Boolean).slice(0, max);
}

export async function PUT(req: Request) {
  let patch: TargetingPatch;
  try {
    patch = (await req.json()) as TargetingPatch;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const file = path.join(root, "portals.yml");
  if (!fs.existsSync(file)) {
    return Response.json({ error: "portals.yml does not exist yet — run onboarding first" }, { status: 409 });
  }
  let doc: Record<string, unknown>;
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    if (!isObj(parsed)) return Response.json({ error: "portals.yml is not a valid document — refusing to overwrite it." }, { status: 409 });
    doc = { ...parsed };
  } catch {
    return Response.json({ error: "portals.yml exists but is not valid YAML — refusing to overwrite it." }, { status: 409 });
  }

  if (patch.positive !== undefined) {
    const tf = isObj(doc.title_filter) ? { ...doc.title_filter } : {};
    tf.positive = capList(patch.positive);
    doc.title_filter = tf;
  }
  if (patch.negative !== undefined) {
    const tf = isObj(doc.title_filter) ? { ...doc.title_filter } : {};
    tf.negative = capList(patch.negative);
    doc.title_filter = tf;
  }
  if (patch.alwaysAllow !== undefined) {
    const lf = isObj(doc.location_filter) ? { ...doc.location_filter } : {};
    lf.always_allow = capList(patch.alwaysAllow);
    doc.location_filter = lf;
  }
  if (patch.block !== undefined) {
    const lf = isObj(doc.location_filter) ? { ...doc.location_filter } : {};
    lf.block = capList(patch.block);
    doc.location_filter = lf;
  }

  if (patch.apify !== undefined) {
    const companies = Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [];
    const idx = companies.findIndex((c) => isObj(c) && c.provider === "apify");
    if (idx === -1) {
      return Response.json({ error: "no Apify source configured yet" }, { status: 400 });
    }
    const entry = { ...(companies[idx] as Record<string, unknown>) };
    const input = isObj(entry.input) ? { ...entry.input } : {};
    if (patch.apify.enabled !== undefined) entry.enabled = !!patch.apify.enabled;
    if (patch.apify.position !== undefined) input.position = String(patch.apify.position).trim();
    if (patch.apify.country !== undefined) input.country = String(patch.apify.country).trim();
    if (patch.apify.area !== undefined) input.location = String(patch.apify.area).trim();
    if (patch.apify.maxItems !== undefined) {
      const n = Math.round(Number(patch.apify.maxItems));
      input.maxItems = Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : input.maxItems;
    }
    entry.input = input;
    const nextCompanies = [...companies];
    nextCompanies[idx] = entry;
    doc.tracked_companies = nextCompanies;
  }

  try {
    atomicWriteWithBackup(file, yaml.dump(doc, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node --test src/app/api/portals/route.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit` — Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/portals/route.ts web/src/app/api/portals/route.test.ts
git commit -m "feat(web): PUT /api/portals — targeting + apify entry writer"
```

---

### Task 3: `/api/automation` — schedule reader/writer

**Files:**
- Create: `web/src/app/api/automation/route.ts`
- Create: `web/src/app/api/automation/route.test.ts`

**Interfaces:**
- Consumes: `careerOpsRoot` from `@/lib/career-ops`, `atomicWriteWithBackup` from `@/lib/core/safe-write`, same `isObj`/`deepMerge` shape as `web/src/app/api/profile/route.ts` (duplicate the two small helpers locally — they're 4 lines each, not worth a shared module for this plan's scope, per YAGNI).
- Produces (used by Task 4):
  - `GET /api/automation` → `{ tier: "draft" | "autonomous", scheduleHours: number }` (reads `config/profile.yml`'s `automation` block; returns the `DEFAULT_AUTOMATION` shape from `autonomy-gate.mjs` — `{ tier: "draft", scheduleHours: 6 }` — if the file or block is absent).
  - `PUT /api/automation` body `{ scheduleHours: number }` → clamps to `[1, 168]`, writes `automation.schedule_hours` into `config/profile.yml`, preserving every other key in the `automation` block (tier, score_threshold, etc.) and the rest of the file. Response `{ ok: true, scheduleHours: number }`.
  - This route NEVER writes `tier` — flipping to `autonomous` is deliberately excluded from this UI (that decision needs the fuller safety context from `modes/autonomous-pipeline.md`, not a dropdown).

- [ ] **Step 1: Write the failing test**

Create `web/src/app/api/automation/route.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

function makeTempRoot(profileYaml?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "automation-test-"));
  fs.mkdirSync(path.join(dir, "config"), { recursive: true });
  if (profileYaml !== undefined) {
    fs.writeFileSync(path.join(dir, "config", "profile.yml"), profileYaml, "utf8");
  }
  return dir;
}

async function call(root: string, method: "GET" | "PUT", body?: unknown) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/automation", { method, body: body ? JSON.stringify(body) : undefined });
  return method === "GET" ? mod.GET(req) : mod.PUT(req);
}

test("GET returns defaults when profile.yml has no automation block", async () => {
  const root = makeTempRoot("candidate:\n  full_name: Test\n");
  const res = await call(root, "GET");
  const json = await res.json();
  assert.equal(json.tier, "draft");
  assert.equal(json.scheduleHours, 6);
});

test("PUT writes schedule_hours and preserves the rest of the automation block", async () => {
  const root = makeTempRoot(`
automation:
  tier: draft
  score_threshold: 4.5
  daily_submit_cap: 3
  schedule_hours: 6
`);
  const res = await call(root, "PUT", { scheduleHours: 12 });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8")) as any;
  assert.equal(doc.automation.schedule_hours, 12);
  assert.equal(doc.automation.tier, "draft"); // untouched
  assert.equal(doc.automation.score_threshold, 4.5); // untouched
});

test("PUT clamps out-of-range values", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { scheduleHours: 999 });
  const json = await res.json();
  assert.equal(json.scheduleHours, 168);
});

test("PUT refuses to write when profile.yml is malformed", async () => {
  const root = makeTempRoot("not: [valid, yaml: {{{");
  const res = await call(root, "PUT", { scheduleHours: 12 });
  assert.equal(res.status, 409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node --test src/app/api/automation/route.test.ts`
Expected: FAIL — module `./route.ts` does not exist.

- [ ] **Step 3: Implement the route**

Create `web/src/app/api/automation/route.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merge-safe reader/writer for config/profile.yml's `automation` block. Mirrors
// the guard pattern in api/profile/route.ts: never overwrite a file that fails
// to parse. This route deliberately never writes `tier` — switching to
// "autonomous" needs the full context in modes/autonomous-pipeline.md, not a
// dropdown in a form.

const DEFAULTS = { tier: "draft" as const, scheduleHours: 6 };

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function readProfile(root: string): { doc: Record<string, unknown> | null; malformed: boolean } {
  const file = path.join(root, "config", "profile.yml");
  if (!fs.existsSync(file)) return { doc: {}, malformed: false };
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    if (!isObj(parsed)) return { doc: null, malformed: true };
    return { doc: parsed, malformed: false };
  } catch {
    return { doc: null, malformed: true };
  }
}

export async function GET() {
  const { doc, malformed } = readProfile(careerOpsRoot());
  if (malformed || !doc) return Response.json(DEFAULTS);
  const a = isObj(doc.automation) ? doc.automation : {};
  const tier = a.tier === "autonomous" ? "autonomous" : "draft";
  const n = Number(a.schedule_hours);
  const scheduleHours = Number.isFinite(n) && n > 0 ? Math.min(168, Math.max(1, Math.round(n))) : DEFAULTS.scheduleHours;
  return Response.json({ tier, scheduleHours });
}

export async function PUT(req: Request) {
  let body: { scheduleHours?: number };
  try {
    body = (await req.json()) as { scheduleHours?: number };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const raw = Number(body.scheduleHours);
  if (!Number.isFinite(raw)) return Response.json({ error: "scheduleHours must be a number" }, { status: 400 });
  const scheduleHours = Math.min(168, Math.max(1, Math.round(raw)));

  const root = careerOpsRoot();
  const { doc, malformed } = readProfile(root);
  if (malformed || doc === null) {
    return Response.json({ error: "config/profile.yml exists but is not valid YAML — refusing to overwrite it." }, { status: 409 });
  }

  const automation = isObj(doc.automation) ? { ...doc.automation } : {};
  automation.schedule_hours = scheduleHours;
  const merged = { ...doc, automation };

  const file = path.join(root, "config", "profile.yml");
  try {
    atomicWriteWithBackup(file, yaml.dump(merged, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, scheduleHours });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node --test src/app/api/automation/route.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit` — Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/automation/route.ts web/src/app/api/automation/route.test.ts
git commit -m "feat(web): GET/PUT /api/automation — schedule_hours reader/writer"
```

---

### Task 4: `TargetingCard` component + wire into Config page

**Files:**
- Create: `web/src/components/targeting-card.tsx`
- Modify: `web/src/components/config-form.tsx`

**Interfaces:**
- Consumes: `KeywordField` from `@/components/keyword-field` (Task 1); `PUT /api/portals` and `GET`+`PUT /api/automation` (Tasks 2–3); `cn` from `@/lib/cn`; `Check`, `Loader2` icons from `lucide-react` (already used elsewhere in `config-form.tsx`, confirmed import available).
- Produces: `<TargetingCard />`, a self-contained client component with its own load/save state — rendered inside `ConfigForm`'s existing return block, after the "Save config" button section (i.e., as a sibling section within the same page, not a new route).

- [ ] **Step 1: Fetch current portals + automation state on mount**

Create `web/src/components/targeting-card.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { KeywordField, KEYWORD_FIELD_STYLE } from "@/components/keyword-field";

type PortalsSnapshot = {
  positive: string[];
  negative: string[];
  alwaysAllow: string[];
  block: string[];
  apify: {
    present: boolean;
    enabled: boolean;
    position: string;
    country: string;
    area: string;
    maxItems: number;
  } | null;
};

const SCHEDULE_OPTIONS = [3, 6, 12, 24];

export function TargetingCard() {
  const [loading, setLoading] = useState(true);
  const [positive, setPositive] = useState<string[]>([]);
  const [negative, setNegative] = useState<string[]>([]);
  const [alwaysAllow, setAlwaysAllow] = useState<string[]>([]);
  const [block, setBlock] = useState<string[]>([]);
  const [apifyPresent, setApifyPresent] = useState(false);
  const [apifyEnabled, setApifyEnabled] = useState(false);
  const [apifyPosition, setApifyPosition] = useState("");
  const [apifyCountry, setApifyCountry] = useState("");
  const [apifyArea, setApifyArea] = useState("");
  const [apifyMaxItems, setApifyMaxItems] = useState(25);
  const [scheduleHours, setScheduleHours] = useState(6);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [portalsRes, automationRes] = await Promise.all([
          fetch("/api/portals/snapshot"),
          fetch("/api/automation"),
        ]);
        const portals = (await portalsRes.json()) as PortalsSnapshot;
        const automation = (await automationRes.json()) as { scheduleHours: number };
        if (cancelled) return;
        setPositive(portals.positive ?? []);
        setNegative(portals.negative ?? []);
        setAlwaysAllow(portals.alwaysAllow ?? []);
        setBlock(portals.block ?? []);
        if (portals.apify) {
          setApifyPresent(portals.apify.present);
          setApifyEnabled(portals.apify.enabled);
          setApifyPosition(portals.apify.position);
          setApifyCountry(portals.apify.country);
          setApifyArea(portals.apify.area);
          setApifyMaxItems(portals.apify.maxItems);
        }
        setScheduleHours(automation.scheduleHours ?? 6);
      } catch {
        if (!cancelled) setError("Could not load current targeting — check the server is running.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const portalsBody: Record<string, unknown> = { positive, negative, alwaysAllow, block };
      if (apifyPresent) {
        portalsBody.apify = {
          enabled: apifyEnabled,
          position: apifyPosition,
          country: apifyCountry,
          area: apifyArea,
          maxItems: apifyMaxItems,
        };
      }
      const [r1, r2] = await Promise.all([
        fetch("/api/portals", { method: "PUT", body: JSON.stringify(portalsBody) }),
        fetch("/api/automation", { method: "PUT", body: JSON.stringify({ scheduleHours }) }),
      ]);
      if (!r1.ok || !r2.ok) {
        const j1 = await r1.json().catch(() => ({}));
        const j2 = await r2.json().catch(() => ({}));
        throw new Error(j1.error || j2.error || "save failed");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-10 flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading your targeting…
      </div>
    );
  }

  return (
    <div className="mt-10 border-t border-border pt-8">
      <style>{KEYWORD_FIELD_STYLE}</style>
      <h2 className="mb-1 text-lg font-medium text-foreground">🎯 Job Targeting</h2>
      <p className="mb-6 text-sm text-faint">What ApplyDeck hunts for. Changes apply from the next scan.</p>

      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">Roles I want</label>
          <KeywordField values={positive} tone="inc" placeholder="Intern, Machine Learning, LLM…" onChange={setPositive} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">Roles to exclude</label>
          <KeywordField values={negative} tone="exc" placeholder="Senior, Staff, Sales…" onChange={setNegative} />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">Preferred locations</label>
            <KeywordField values={alwaysAllow} tone="inc" placeholder="Coimbatore, Tamil Nadu, Remote…" onChange={setAlwaysAllow} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">Locations to block</label>
            <KeywordField values={block} tone="exc" placeholder="Poland…" onChange={setBlock} />
          </div>
        </div>

        {apifyPresent && (
          <div className="rounded-xl border border-border bg-surface/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Indeed search</span>
              <button
                type="button"
                role="switch"
                aria-checked={apifyEnabled}
                onClick={() => setApifyEnabled((v) => !v)}
                className={cn("relative h-6 w-11 rounded-full transition-colors", apifyEnabled ? "bg-brand" : "bg-surface-hover")}
              >
                <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", apifyEnabled ? "translate-x-[1.375rem]" : "translate-x-0.5")} />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted">
                Search for
                <input value={apifyPosition} onChange={(e) => setApifyPosition(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-muted">
                Country
                <input value={apifyCountry} onChange={(e) => setApifyCountry(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-muted">
                Area
                <input value={apifyArea} onChange={(e) => setApifyArea(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-muted">
                Max results <span className="text-faint">(caps at 50)</span>
                <input type="number" min={1} max={50} value={apifyMaxItems} onChange={(e) => setApifyMaxItems(Number(e.target.value))} className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm" />
              </label>
            </div>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">Scan every</label>
          <div className="flex gap-2">
            {SCHEDULE_OPTIONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setScheduleHours(h)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  scheduleHours === h ? "border-brand/50 bg-brand-soft text-brand" : "border-border bg-surface/50 text-muted hover:bg-surface-hover",
                )}
              >
                {h}h
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-faint">Runs through your connected AI tool. Takes effect on the next loop restart.</p>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-60 max-sm:min-h-[44px]"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
        {saving ? "Saving…" : saved ? "Saved" : "Save targeting"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add the snapshot read endpoint the component needs**

The component fetches `GET /api/portals/snapshot` — a small read-only route to expose the CURRENT values (the existing `POST`/new `PUT` on `/api/portals` are write-only). Create `web/src/app/api/portals/snapshot/route.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

export async function GET() {
  const file = path.join(careerOpsRoot(), "portals.yml");
  if (!fs.existsSync(file)) {
    return Response.json({ positive: [], negative: [], alwaysAllow: [], block: [], apify: null });
  }
  let doc: Record<string, unknown>;
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    doc = isObj(parsed) ? parsed : {};
  } catch {
    return Response.json({ positive: [], negative: [], alwaysAllow: [], block: [], apify: null, malformed: true });
  }
  const tf = isObj(doc.title_filter) ? doc.title_filter : {};
  const lf = isObj(doc.location_filter) ? doc.location_filter : {};
  const companies = Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [];
  const apifyEntry = companies.find((c) => isObj(c) && c.provider === "apify") as Record<string, unknown> | undefined;
  const input = apifyEntry && isObj(apifyEntry.input) ? apifyEntry.input : {};

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
  });
}
```

- [ ] **Step 3: Wire `TargetingCard` into the Config page**

In `web/src/components/config-form.tsx`:
1. Add the import: `import { TargetingCard } from "@/components/targeting-card";`
2. Find the closing of the main `ConfigForm` return's outer `<div>` (immediately after the `<span className="text-xs text-faint">Local-first · on our roadmap</span>` line and its closing tags, still inside the same top-level wrapper div). Insert `<TargetingCard />` as the next sibling, before that wrapper div's own closing `</div>`.

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc --noEmit` — Expected: exit 0.

- [ ] **Step 5: Live verification**

With the dev server running on port 3001:
```bash
curl -s http://localhost:3001/api/portals/snapshot | head -c 500
curl -s -X PUT http://localhost:3001/api/automation -d '{"scheduleHours":12}' | head -c 200
curl -s http://localhost:3001/api/automation
```
Expected: snapshot returns real `positive`/`alwaysAllow` arrays reflecting the current `portals.yml`; the `PUT` returns `{"ok":true,"scheduleHours":12}`; the follow-up `GET` shows `scheduleHours: 12`. Then revert with `curl -s -X PUT http://localhost:3001/api/automation -d '{"scheduleHours":6}'` to restore the value from before this test.

Open `http://localhost:3001/config` in a browser: confirm the Job Targeting card renders below the AI Engine card, pre-filled with the real chips (Intern, Machine Learning, LLM… / Coimbatore, Tamil Nadu, India, Remote…), the Indeed search sub-section appears (since an apify entry exists) with its fields populated, and clicking a chip's `×` then **Save targeting** persists after a page reload.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/targeting-card.tsx web/src/app/api/portals/snapshot/route.ts web/src/components/config-form.tsx
git commit -m "feat(web): Job Targeting card on the Config page"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** roles-to-find/exclude chips → Task 4 (`positive`/`negative`); preferred/blocked locations → Task 4 (`alwaysAllow`/`block`); Indeed-via-Apify plain-language sub-section (no "Apify" label) → Task 4's conditional block, backed by Task 2's writer; schedule selector → Task 4, backed by Task 3; merge-safe/non-destructive writes → Tasks 2–3 explicit malformed-YAML tests; credit-cost cap on Apify `maxItems` → enforced server-side in Task 2 Step 3 (`Math.min(50, ...)`), not just client-side.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code; the one deliberately-deferred item (creating a NEW Apify entry from scratch, vs. editing an existing one) is explicitly called out as out-of-scope with its reason, not left ambiguous.
- **Type consistency:** `PortalsSnapshot` shape in `targeting-card.tsx` matches exactly what `api/portals/snapshot/route.ts` returns (`positive/negative/alwaysAllow/block/apify{present,enabled,position,country,area,maxItems}`); the `PUT /api/portals` body shape in Task 2 matches what `targeting-card.tsx`'s `save()` sends in Task 4; `scheduleHours` (camelCase, client/API boundary) vs. `schedule_hours` (snake_case, YAML) is applied consistently — every route translates at its own boundary, never leaking one case style into the other layer.
