# Self-Serve Config Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the remaining "needs an admin to edit a file" gaps identified after the Targeting UI and Automation Safety UI shipped: a company blacklist a client can maintain themselves, a way to add a new company to scan without knowing its ATS platform, a way for a client to supply their own Apify token instead of sharing the operator's, and a read-only view of what the autonomous pipeline has actually done. Cron/scheduling infrastructure is explicitly OUT of scope for this plan — that's a separate, bigger architecture conversation.

**Non-goal:** managing the full pre-existing `tracked_companies` list in `portals.yml` (the curated demo companies with `api:` overrides, `scan_method: websearch`, local-parser configs, etc.). Task 2 only lets a client ADD new companies and remove/toggle the ones added through this same feature — entries this UI didn't create are left alone, because some of them have config shapes (websearch queries, local parser commands) a generic form can't safely round-trip.

## Global Constraints

- All four features are USER-LAYER file writes (`data/blacklist.md`, `portals.yml`, `.env`, and a read-only view of `data/autonomy-log.tsv`) — same malformed-file guards and `atomicWriteWithBackup` used throughout this app already.
- Nothing in this plan touches `config/profile.yml`'s `automation` block or the tier switch — that surface is done (verified: 20/20 tests pass, `tsc --noEmit` clean as of this plan being written).
- `.env` writes must never echo the secret value back in any API response — `GET` returns only `{ configured: boolean }`.
- Run `cd web && npx tsc --noEmit` after every task — must exit 0.
- Run `cd web && npm run test:api` after every task that touches an API route — this is the ONLY correct way to run these tests (`node --test` directly fails on the `@/` path alias; `test:api` uses `node --import tsx`). Add each new test file to that script's file list in `package.json`.
- Commit after each task with the given message; do not push without being asked.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `web/src/app/api/blacklist/route.ts` | create | GET/PUT `data/blacklist.md`'s company list, preserving prose + preserving `since`/`scope`/`reason` for rows the UI didn't touch |
| `web/src/app/api/blacklist/route.test.ts` | create | Coverage for parse/round-trip, prose preservation, cap, malformed-file guard |
| `web/src/components/blacklist-card.tsx` | create | "Do Not Apply" card: reuses `KeywordField` (tone="exc") |
| `web/src/app/api/portals/route.ts` | modify | Add `addCompany` / `removeCompany` to `TargetingPatch`, tagging web-UI-created entries with `source: "web-ui"` |
| `web/src/app/api/portals/route.test.ts` | modify | Coverage for add/remove/vendor-detection/dedup/cap |
| `web/src/app/api/portals/snapshot/route.ts` | modify | Include `companies: {name, careersUrl, vendor}[]` (web-ui-tagged entries only) |
| `web/src/components/company-list-card.tsx` | create | "Add a company to scan" card: URL input + detected-vendor badge + list of web-ui-added companies with remove buttons |
| `web/src/app/api/secrets/apify-token/route.ts` | create | GET (configured boolean only) / PUT (set or clear) `.env`'s `APIFY_TOKEN` line |
| `web/src/app/api/secrets/apify-token/route.test.ts` | create | Coverage for set/clear/preserve-other-lines/create-if-missing |
| `web/src/components/targeting-card.tsx` | modify | Add the Apify-token field to the existing Apify sub-panel |
| `web/src/app/api/automation/log/route.ts` | create | Read-only GET of `data/autonomy-log.tsv`, most recent first, capped |
| `web/src/app/api/automation/log/route.test.ts` | create | Coverage for parsing, cap, missing-file case |
| `web/src/components/automation-activity-log.tsx` | create | Read-only table rendered below `AutomationSafetyCard` |
| `web/src/components/config-form.tsx` | modify | Render the three new cards + the log in the right places |
| `web/package.json` | modify | Add the 3 new test files to the `test:api` script |

---

### Task 1: "Do Not Apply" blacklist editor

**Files:**
- Create: `web/src/app/api/blacklist/route.ts`
- Create: `web/src/app/api/blacklist/route.test.ts`

**Ground truth this task must match** (already verified in the codebase, do not deviate):
- File: `data/blacklist.md`, a markdown table `| Company | Since | Scope | Reason |` (see `templates/blacklist.example.md` and `scan.mjs`'s `parseBlacklist`).
- `scope`'s only real value in use anywhere is the literal string `"company"` (confirmed in `modes/interview-redflag.md`: *"the literal `company` scope value stay fixed"*).
- `reason` is optional — `scan.mjs`'s own parser tolerates an empty cell (`reason: cells[4] || ''`).
- Absence of the file means "no blacklist" everywhere that reads it — this route must be able to create it from scratch.

**Design:** the file may have free-text prose above the table (the shipped template does). This route must NEVER touch that prose — it only reads/rewrites from the `| Company | Since | Scope | Reason |` header line onward. If the file doesn't exist yet, it's created with the exact template prose from `templates/blacklist.example.md` (minus the two example rows) plus whatever companies the client added.

- [ ] **Step 1: Write the failing tests**

Create `web/src/app/api/blacklist/route.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(blacklistMd?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blacklist-test-"));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  if (blacklistMd !== undefined) {
    fs.writeFileSync(path.join(dir, "data", "blacklist.md"), blacklistMd, "utf8");
  }
  return dir;
}

async function call(root: string, method: "GET" | "PUT", body?: unknown) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/blacklist", { method, body: body ? JSON.stringify(body) : undefined });
  return method === "GET" ? mod.GET(req) : mod.PUT(req);
}

test("GET returns an empty list when data/blacklist.md doesn't exist", async () => {
  const root = makeTempRoot();
  const res = await call(root, "GET");
  const json = await res.json();
  assert.deepEqual(json.companies, []);
});

test("GET parses existing rows, skipping header/separator", async () => {
  const root = makeTempRoot(
    "# Company Blacklist\n\nSome prose.\n\n| Company | Since | Scope | Reason |\n|---|---|---|---|\n| Acme Corp | 2026-01-15 | company | bad process |\n| Globex | 2026-02-01 | company | |\n",
  );
  const res = await call(root, "GET");
  const json = await res.json();
  assert.deepEqual(json.companies, ["Acme Corp", "Globex"]);
});

test("PUT adds a new company, creating the file with template prose if it didn't exist", async () => {
  const root = makeTempRoot();
  const res = await call(root, "PUT", { companies: ["Acme Corp"] });
  assert.equal(res.status, 200);
  const text = fs.readFileSync(path.join(root, "data", "blacklist.md"), "utf8");
  assert.match(text, /# Company Blacklist/);
  assert.match(text, /\|\s*Acme Corp\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*company\s*\|/);
});

test("PUT preserves prose above the table and existing row reasons untouched by this request", async () => {
  const root = makeTempRoot(
    "# Company Blacklist\n\nMy own custom notes go here, do not touch.\n\n| Company | Since | Scope | Reason |\n|---|---|---|---|\n| Acme Corp | 2026-01-15 | company | post-interview signals |\n",
  );
  const res = await call(root, "PUT", { companies: ["Acme Corp", "Globex"] });
  assert.equal(res.status, 200);
  const text = fs.readFileSync(path.join(root, "data", "blacklist.md"), "utf8");
  assert.match(text, /My own custom notes go here, do not touch\./);
  assert.match(text, /Acme Corp[^\n]*post-interview signals/); // existing row's reason/since survive
  assert.match(text, /\|\s*Globex\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*company\s*\|\s*\|/); // new row, blank reason
});

test("PUT removing a company drops its row entirely", async () => {
  const root = makeTempRoot(
    "# Company Blacklist\n\n| Company | Since | Scope | Reason |\n|---|---|---|---|\n| Acme Corp | 2026-01-15 | company | x |\n| Globex | 2026-02-01 | company | y |\n",
  );
  const res = await call(root, "PUT", { companies: ["Acme Corp"] });
  const json = await res.json();
  assert.deepEqual(json.companies, ["Acme Corp"]);
  const text = fs.readFileSync(path.join(root, "data", "blacklist.md"), "utf8");
  assert.doesNotMatch(text, /Globex/);
});

test("PUT caps the list at 24 companies", async () => {
  const root = makeTempRoot();
  const many = Array.from({ length: 30 }, (_, i) => `Company${i}`);
  const res = await call(root, "PUT", { companies: many });
  const json = await res.json();
  assert.equal(json.companies.length, 24);
});

test("PUT dedupes case-insensitively, keeping first occurrence's casing", async () => {
  const root = makeTempRoot();
  const res = await call(root, "PUT", { companies: ["Acme Corp", "acme corp", "ACME CORP"] });
  const json = await res.json();
  assert.deepEqual(json.companies, ["Acme Corp"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && node --import tsx --test src/app/api/blacklist/route.test.ts`
Expected: all 7 FAIL (route doesn't exist yet).

- [ ] **Step 3: Implement the route**

Create `web/src/app/api/blacklist/route.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merge-safe reader/writer for data/blacklist.md's company table. Everything
// above the "| Company | Since | Scope | Reason |" header line is treated as
// the user's own prose and is never touched. Rows the client didn't change
// keep their original since/scope/reason; a row added through this route gets
// scope="company" (the only literal value used anywhere in this system, per
// modes/interview-redflag.md) and an empty reason (the file's own parser
// already tolerates that — reason is documentation, not a required field).

const TABLE_HEADER_RE = /^\|\s*Company\s*\|/i;
const MAX_COMPANIES = 24;

const DEFAULT_PROSE = `# Company Blacklist

Your own do-not-apply list (user layer, opt-in). Companies here are always
skipped by the scanner and the autonomous pipeline, regardless of score or
auto-submit settings.`;

type Row = { company: string; since: string; scope: string; reason: string };

function splitProseAndTable(text: string): { prose: string; rows: Row[] } {
  const lines = text.replace(/\r/g, "").split("\n");
  const headerIdx = lines.findIndex((l) => TABLE_HEADER_RE.test(l.trim()));
  const prose = (headerIdx === -1 ? text : lines.slice(0, headerIdx).join("\n")).trimEnd();
  const rows: Row[] = [];
  if (headerIdx !== -1) {
    for (const line of lines.slice(headerIdx + 1)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|")) continue;
      const cells = trimmed.split("|").map((c) => c.trim());
      const company = cells[1] || "";
      if (!company || /^[-: ]+$/.test(company)) continue; // separator row
      rows.push({ company, since: cells[2] || "", scope: cells[3] || "company", reason: cells[4] || "" });
    }
  }
  return { prose, rows };
}

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function serialize(prose: string, rows: Row[]): string {
  const header = "| Company | Since | Scope | Reason |\n|---------|-------|-------|--------|";
  const body = rows.map((r) => `| ${r.company} | ${r.since} | ${r.scope} | ${r.reason} |`).join("\n");
  return `${prose}\n\n${header}${body ? "\n" + body : ""}\n`;
}

function blacklistPath(root: string): string {
  return path.join(root, "data", "blacklist.md");
}

export async function GET() {
  const file = blacklistPath(careerOpsRoot());
  if (!fs.existsSync(file)) return Response.json({ companies: [] });
  const { rows } = splitProseAndTable(fs.readFileSync(file, "utf8"));
  return Response.json({ companies: rows.map((r) => r.company) });
}

export async function PUT(req: Request) {
  let body: { companies?: string[] };
  try {
    body = (await req.json()) as { companies?: string[] };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (!Array.isArray(body.companies)) {
    return Response.json({ error: "companies must be an array of strings" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const file = blacklistPath(root);
  const existing = fs.existsSync(file) ? splitProseAndTable(fs.readFileSync(file, "utf8")) : { prose: DEFAULT_PROSE, rows: [] };
  const byKey = new Map(existing.rows.map((r) => [normalize(r.company), r]));

  const seen = new Set<string>();
  const nextRows: Row[] = [];
  for (const raw of body.companies) {
    const company = String(raw).trim();
    if (!company) continue;
    const key = normalize(company);
    if (seen.has(key)) continue;
    seen.add(key);
    if (nextRows.length >= MAX_COMPANIES) continue;
    const prior = byKey.get(key);
    nextRows.push(prior ?? { company, since: today(), scope: "company", reason: "" });
  }

  try {
    atomicWriteWithBackup(file, serialize(existing.prose, nextRows));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ companies: nextRows.map((r) => r.company) });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && node --import tsx --test src/app/api/blacklist/route.test.ts` — expect 7/7 pass.

- [ ] **Step 5: Add the component**

Create `web/src/components/blacklist-card.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, ShieldOff } from "lucide-react";
import { KeywordField, KEYWORD_FIELD_STYLE } from "@/components/keyword-field";

export function BlacklistCard() {
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/blacklist");
        const data = (await res.json()) as { companies: string[] };
        if (!cancelled) setCompanies(data.companies ?? []);
      } catch {
        if (!cancelled) setError("Could not load your blacklist.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (next: string[]) => {
    setCompanies(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/blacklist", { method: "PUT", body: JSON.stringify({ companies: next }) });
      if (!res.ok) throw new Error("save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setError("Could not save — try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-10 flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading your blacklist…
      </div>
    );
  }

  return (
    <div className="mt-10 border-t border-border pt-8">
      <style>{KEYWORD_FIELD_STYLE}</style>
      <div className="mb-1 flex items-center gap-2">
        <ShieldOff className="size-4 text-brand" />
        <h2 className="text-lg font-medium text-foreground">Do Not Apply</h2>
        {saving && <Loader2 className="size-3.5 animate-spin text-muted" />}
        {saved && <Check className="size-3.5 text-emerald-600" />}
      </div>
      <p className="mb-4 text-sm text-faint">
        Companies here are always skipped — by the scanner and by auto-submit — no matter how good the score is.
        Changes here take effect on the next scan or automation run.
      </p>
      <KeywordField values={companies} tone="exc" placeholder="Type a company name and press Enter…" onChange={save} />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 6: Wire into Config page and add to test:api**

In `web/src/components/config-form.tsx`: import `BlacklistCard` and render it after `<AutomationSafetyCard />`.

In `web/package.json`'s `test:api` script, append `src/app/api/blacklist/route.test.ts` to the file list.

- [ ] **Step 7: Typecheck + full API test run**

Run: `cd web && npx tsc --noEmit` — exit 0.
Run: `cd web && npm run test:api` — all tests (existing + new) pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/api/blacklist web/src/components/blacklist-card.tsx web/src/components/config-form.tsx web/package.json
git commit -m "feat(web): Do Not Apply blacklist editor on the Config page"
```

---

### Task 2: Add a company to scan by URL

**Files:**
- Modify: `web/src/app/api/portals/route.ts`
- Modify: `web/src/app/api/portals/route.test.ts`
- Modify: `web/src/app/api/portals/snapshot/route.ts`
- Create: `web/src/components/company-list-card.tsx`

**Ground truth this task must match** (verified against `providers/greenhouse.mjs`, `providers/ashby.mjs`, `providers/lever.mjs`, `providers/workday.mjs`, and `providers/_registry.mjs`):
- A `tracked_companies` entry with `careers_url` set and NO explicit `provider:` field auto-detects at scan time — each provider's own `detect()`/URL-resolver extracts the ATS slug from `careers_url` itself. No `api:` field is needed for any of the 4 supported vendors.
- Supported host patterns: Greenhouse (`job-boards(.eu)?.greenhouse.io`, `boards.greenhouse.io`), Ashby (`jobs.ashbyhq.com`), Lever (`jobs.(eu.)?lever.co`), Workday (`*.wd*.myworkdayjobs.com`).
- This route must NOT try to manage the pre-existing curated companies (Anthropic, OpenAI, PolyAI, etc. — 176 entries already in `portals.yml`). It only manages entries it creates itself, tagged `source: "web-ui"`, so it can safely list/remove exactly those without touching anything else.

- [ ] **Step 1: Write the failing tests (append to the existing test file)**

Add to `web/src/app/api/portals/route.test.ts`:

```ts
test("PUT addCompany appends a web-ui-tagged entry for a recognized Greenhouse URL", async () => {
  const root = makeTempRoot("title_filter:\n  positive: []\n");
  const res = await call(root, "PUT", { addCompany: { name: "Test Co", careersUrl: "https://job-boards.greenhouse.io/testco" } });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  const entry = doc.tracked_companies.find((c: any) => c.name === "Test Co");
  assert.ok(entry);
  assert.equal(entry.careers_url, "https://job-boards.greenhouse.io/testco");
  assert.equal(entry.source, "web-ui");
  assert.equal(entry.enabled, true);
  assert.equal(entry.provider, undefined); // left for auto-detection, not hardcoded
});

test("PUT addCompany recognizes Ashby, Lever, and Workday URLs too", async () => {
  const root = makeTempRoot("title_filter:\n  positive: []\n");
  await call(root, "PUT", { addCompany: { name: "A", careersUrl: "https://jobs.ashbyhq.com/a-co" } });
  await call(root, "PUT", { addCompany: { name: "B", careersUrl: "https://jobs.lever.co/b-co" } });
  const res = await call(root, "PUT", { addCompany: { name: "C", careersUrl: "https://c.wd5.myworkdayjobs.com/careers" } });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  const names = doc.tracked_companies.map((c: any) => c.name);
  assert.ok(names.includes("A") && names.includes("B") && names.includes("C"));
});

test("PUT addCompany rejects an unrecognized job-board URL", async () => {
  const root = makeTempRoot("title_filter:\n  positive: []\n");
  const res = await call(root, "PUT", { addCompany: { name: "Nope Co", careersUrl: "https://nopeco.com/careers" } });
  assert.equal(res.status, 400);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  assert.ok(!doc.tracked_companies?.some((c: any) => c.name === "Nope Co"));
});

test("PUT addCompany rejects a duplicate careers_url among web-ui entries", async () => {
  const root = makeTempRoot("title_filter:\n  positive: []\n");
  await call(root, "PUT", { addCompany: { name: "Test Co", careersUrl: "https://job-boards.greenhouse.io/testco" } });
  const res = await call(root, "PUT", { addCompany: { name: "Test Co Again", careersUrl: "https://job-boards.greenhouse.io/testco" } });
  assert.equal(res.status, 409);
});

test("PUT removeCompany removes only a web-ui-tagged entry, by name", async () => {
  const root = makeTempRoot("title_filter:\n  positive: []\n");
  await call(root, "PUT", { addCompany: { name: "Test Co", careersUrl: "https://job-boards.greenhouse.io/testco" } });
  const res = await call(root, "PUT", { removeCompany: "Test Co" });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  assert.ok(!doc.tracked_companies?.some((c: any) => c.name === "Test Co"));
});

test("PUT removeCompany 404s on a name that isn't a web-ui-tagged entry (leaves curated entries alone)", async () => {
  const root = makeTempRoot(
    "title_filter:\n  positive: []\ntracked_companies:\n  - name: Anthropic\n    careers_url: https://job-boards.greenhouse.io/anthropic\n    enabled: true\n",
  );
  const res = await call(root, "PUT", { removeCompany: "Anthropic" });
  assert.equal(res.status, 404);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  assert.ok(doc.tracked_companies.some((c: any) => c.name === "Anthropic")); // untouched
});

test("PUT addCompany caps web-ui-tagged companies at 30", async () => {
  const root = makeTempRoot("title_filter:\n  positive: []\n");
  for (let i = 0; i < 30; i++) {
    await call(root, "PUT", { addCompany: { name: `Co${i}`, careersUrl: `https://job-boards.greenhouse.io/co${i}` } });
  }
  const res = await call(root, "PUT", { addCompany: { name: "Co30", careersUrl: "https://job-boards.greenhouse.io/co30" } });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd web && node --import tsx --test src/app/api/portals/route.test.ts`
Expected: existing tests still pass; the 6 new ones fail.

- [ ] **Step 3: Implement — extend the route**

In `web/src/app/api/portals/route.ts`, add near the top (alongside existing helpers):

```ts
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

const MAX_WEB_UI_COMPANIES = 30;
```

Extend the `TargetingPatch` type with:

```ts
addCompany?: { name: string; careersUrl: string };
removeCompany?: string;
```

Add handling in the `PUT` function, after the existing `apify` block and before the final write:

```ts
if (patch.addCompany !== undefined) {
  const name = String(patch.addCompany.name ?? "").trim();
  const careersUrl = String(patch.addCompany.careersUrl ?? "").trim();
  if (!name || !careersUrl) {
    return Response.json({ error: "name and careersUrl are required" }, { status: 400 });
  }
  const vendor = detectVendor(careersUrl);
  if (!vendor) {
    return Response.json(
      { error: "Unrecognized job board — supported: Greenhouse, Ashby, Lever, Workday. Ask your admin to add this one manually." },
      { status: 400 },
    );
  }
  const companies = Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [];
  const webUiCompanies = companies.filter((c) => isObj(c) && c.source === "web-ui");
  if (webUiCompanies.some((c) => isObj(c) && String(c.careers_url).trim() === careersUrl)) {
    return Response.json({ error: "already tracking this company" }, { status: 409 });
  }
  if (webUiCompanies.length >= MAX_WEB_UI_COMPANIES) {
    return Response.json({ error: `too many companies added via this screen (${MAX_WEB_UI_COMPANIES} max) — remove one first` }, { status: 400 });
  }
  doc.tracked_companies = [...companies, { name, careers_url: careersUrl, enabled: true, source: "web-ui" }];
}

if (patch.removeCompany !== undefined) {
  const companies = Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [];
  const idx = companies.findIndex((c) => isObj(c) && c.source === "web-ui" && c.name === patch.removeCompany);
  if (idx === -1) {
    return Response.json({ error: "no web-ui-added company with that name" }, { status: 404 });
  }
  doc.tracked_companies = companies.filter((_, i) => i !== idx);
}
```

(Note: the exact variable names for `doc`/`isObj`/`companies` must match whatever this route already uses — read the current file before inserting; do not duplicate an existing `companies` local declared in the `apify` block above. Use the response body pattern already established by that route: `Response.json({ ok: true })` at the end.)

- [ ] **Step 4: Extend the snapshot route**

In `web/src/app/api/portals/snapshot/route.ts`, add to the returned JSON:

```ts
companies: (Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [])
  .filter((c: unknown) => isObj(c) && c.source === "web-ui")
  .map((c: any) => ({ name: c.name, careersUrl: c.careers_url, vendor: detectVendor(String(c.careers_url ?? "")) })),
```

(Duplicate the small `detectVendor`/`isObj` helpers locally in this file too, per this app's established pattern of small per-route duplication over cross-file imports for 10-line helpers.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && node --import tsx --test src/app/api/portals/route.test.ts` — all pass.

- [ ] **Step 6: Create the component**

Create `web/src/components/company-list-card.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus, Trash2, Building2 } from "lucide-react";
import { cn } from "@/lib/cn";

type TrackedCompany = { name: string; careersUrl: string; vendor: string | null };

const VENDOR_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  ashby: "Ashby",
  lever: "Lever",
  workday: "Workday",
};

export function CompanyListCard() {
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<TrackedCompany[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/portals/snapshot");
    const data = await res.json();
    setCompanies(data.companies ?? []);
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const add = async () => {
    if (!name.trim() || !url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/portals", {
        method: "PUT",
        body: JSON.stringify({ addCompany: { name: name.trim(), careersUrl: url.trim() } }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "could not add company");
      }
      setName("");
      setUrl("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not add company");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (companyName: string) => {
    await fetch("/api/portals", { method: "PUT", body: JSON.stringify({ removeCompany: companyName }) });
    await load();
  };

  if (loading) {
    return (
      <div className="mt-10 flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading companies…
      </div>
    );
  }

  return (
    <div className="mt-10 border-t border-border pt-8">
      <div className="mb-1 flex items-center gap-2">
        <Building2 className="size-4 text-brand" />
        <h2 className="text-lg font-medium text-foreground">Companies to Scan</h2>
      </div>
      <p className="mb-4 text-sm text-faint">
        Paste a company's job-board link (Greenhouse, Ashby, Lever, or Workday) to start scanning it. Other job boards
        aren't supported here yet — ask your admin to add those.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Company name"
          className="w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm sm:w-40"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://job-boards.greenhouse.io/company"
          className="w-full flex-1 rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={add}
          disabled={adding}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-60",
          )}
        >
          {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <ul className="mt-4 space-y-1.5">
        {companies.map((c) => (
          <li key={c.name} className="flex items-center justify-between rounded-md border border-border bg-surface/30 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              {c.name}
              {c.vendor && (
                <span className="rounded-full border border-border bg-surface-hover px-2 py-0.5 text-xs text-muted">
                  {VENDOR_LABELS[c.vendor] ?? c.vendor}
                </span>
              )}
            </span>
            <button type="button" onClick={() => remove(c.name)} aria-label={`Remove ${c.name}`} className="text-muted hover:text-red-600">
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {companies.length === 0 && <li className="text-xs text-faint">No companies added here yet.</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: Wire into Config page and add to test:api**

In `web/src/components/config-form.tsx`: import `CompanyListCard`, render it after `<TargetingCard />` (before `<AutomationSafetyCard />` — it's a targeting concern, not a safety-cap one).

- [ ] **Step 8: Typecheck + full API test run**

Run: `cd web && npx tsc --noEmit` — exit 0.
Run: `cd web && npm run test:api` — all pass.

- [ ] **Step 9: Commit**

```bash
git add web/src/app/api/portals web/src/components/company-list-card.tsx web/src/components/config-form.tsx
git commit -m "feat(web): add a company to scan by pasting its job-board URL"
```

---

### Task 3: Bring-your-own Apify token

**Files:**
- Create: `web/src/app/api/secrets/apify-token/route.ts`
- Create: `web/src/app/api/secrets/apify-token/route.test.ts`
- Modify: `web/src/components/targeting-card.tsx`

**Ground truth this task must match:**
- `.env` is a flat `KEY=value` file (see `.env.example`); `APIFY_TOKEN` is the exact key name already documented there and already how `scan.mjs`'s Apify provider reads its credential (via `dotenv` + `process.env`).
- `scan.mjs` calls `dotenv.config()` at its own module top level on every invocation, and every scan runs in a freshly spawned child process (confirmed in `web/src/lib/core/scan.ts` and the other routes that `spawn()` a CLI binary) — so a `.env` edit here takes effect on the NEXT scan with no server restart needed. State this in the UI copy so it isn't a mystery.
- Never return the token value in any response.

- [ ] **Step 1: Write the failing tests**

Create `web/src/app/api/secrets/apify-token/route.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(envContent?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apify-token-test-"));
  if (envContent !== undefined) {
    fs.writeFileSync(path.join(dir, ".env"), envContent, "utf8");
  }
  return dir;
}

async function call(root: string, method: "GET" | "PUT", body?: unknown) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/secrets/apify-token", { method, body: body ? JSON.stringify(body) : undefined });
  return method === "GET" ? mod.GET(req) : mod.PUT(req);
}

test("GET reports not configured when .env doesn't exist", async () => {
  const root = makeTempRoot();
  const res = await call(root, "GET");
  const json = await res.json();
  assert.equal(json.configured, false);
});

test("GET reports not configured when .env exists but has no APIFY_TOKEN line", async () => {
  const root = makeTempRoot("GEMINI_API_KEY=abc123\n");
  const res = await call(root, "GET");
  const json = await res.json();
  assert.equal(json.configured, false);
});

test("PUT sets the token, creating .env if missing, and GET never echoes the value", async () => {
  const root = makeTempRoot();
  const putRes = await call(root, "PUT", { token: "apify_api_secretvalue123" });
  assert.equal(putRes.status, 200);
  const putJson = await putRes.json();
  assert.equal(putJson.token, undefined);
  const getRes = await call(root, "GET");
  const getJson = await getRes.json();
  assert.equal(getJson.configured, true);
  assert.equal(getJson.token, undefined);
  const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
  assert.match(envText, /APIFY_TOKEN=apify_api_secretvalue123/);
});

test("PUT preserves other lines in .env when setting the token", async () => {
  const root = makeTempRoot("GEMINI_API_KEY=abc123\n# a comment\n");
  await call(root, "PUT", { token: "apify_api_xyz" });
  const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
  assert.match(envText, /GEMINI_API_KEY=abc123/);
  assert.match(envText, /# a comment/);
  assert.match(envText, /APIFY_TOKEN=apify_api_xyz/);
});

test("PUT replaces an existing token rather than duplicating the line", async () => {
  const root = makeTempRoot("APIFY_TOKEN=old_value\n");
  await call(root, "PUT", { token: "new_value" });
  const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
  const matches = envText.match(/^APIFY_TOKEN=/gm) ?? [];
  assert.equal(matches.length, 1);
  assert.match(envText, /APIFY_TOKEN=new_value/);
});

test("PUT with an empty token clears it (line removed, other lines preserved)", async () => {
  const root = makeTempRoot("GEMINI_API_KEY=abc123\nAPIFY_TOKEN=old_value\n");
  const res = await call(root, "PUT", { token: "" });
  assert.equal(res.status, 200);
  const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
  assert.doesNotMatch(envText, /APIFY_TOKEN=/);
  assert.match(envText, /GEMINI_API_KEY=abc123/);
  const getRes = await call(root, "GET");
  const getJson = await getRes.json();
  assert.equal(getJson.configured, false);
});

test("PUT rejects a token containing whitespace", async () => {
  const root = makeTempRoot();
  const res = await call(root, "PUT", { token: "has a space" });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && node --import tsx --test src/app/api/secrets/apify-token/route.test.ts` — all 7 fail (route doesn't exist).

- [ ] **Step 3: Implement the route**

Create `web/src/app/api/secrets/apify-token/route.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sets/clears APIFY_TOKEN in .env. Every scan runs in a freshly spawned child
// process that calls dotenv.config() at its own module top level (scan.mjs),
// so a change here applies on the NEXT scan — no server restart needed. This
// route NEVER returns the token value; GET only reports whether one is set.

const KEY = "APIFY_TOKEN";

function envPath(root: string): string {
  return path.join(root, ".env");
}

function readLines(root: string): string[] {
  const file = envPath(root);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n");
}

function isConfigured(lines: string[]): boolean {
  return lines.some((l) => new RegExp(`^${KEY}=.+`).test(l.trim()));
}

export async function GET() {
  const lines = readLines(careerOpsRoot());
  return Response.json({ configured: isConfigured(lines) });
}

export async function PUT(req: Request) {
  let body: { token?: string };
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const token = String(body.token ?? "").trim();
  if (token && /\s/.test(token)) {
    return Response.json({ error: "token must not contain whitespace" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const lines = readLines(root).filter((l) => !new RegExp(`^${KEY}=`).test(l.trim()));
  if (token) lines.push(`${KEY}=${token}`);
  // drop a single trailing blank line before re-joining, then restore exactly one
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const content = lines.length ? lines.join("\n") + "\n" : "";

  try {
    atomicWriteWithBackup(envPath(root), content);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, configured: isConfigured(readLines(root)) });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && node --import tsx --test src/app/api/secrets/apify-token/route.test.ts` — 7/7 pass.

- [ ] **Step 5: Add the field to the Apify sub-panel**

In `web/src/components/targeting-card.tsx`, inside the existing Indeed/Apify sub-panel (find where `apify.enabled`/`position`/`country`/`maxItems` are rendered — do not create a new card for this, it belongs next to the feature it powers): add a small section with:
- A password-style input (`type="password"`) for a new token, placeholder `"Paste your own Apify token…"`.
- On blur or a small "Save token" button, `PUT /api/secrets/apify-token` with `{ token }`, then clear the input (never keep the typed value in state after a successful save).
- A status line sourced from `GET /api/secrets/apify-token` on mount: `"Using the shared token"` when `configured` is false (falls back to the operator's own `.env`), or `"Using your own token"` when true, plus a small "Clear" link that PUTs `{ token: "" }` and refreshes the status.
- Copy: *"Your token is stored locally in this instance's `.env` file and is never shown again after saving. Takes effect on the next scan — no restart needed."*

Implement this as inline JSX inside the existing component using the same `useState`/`useEffect` fetch pattern as the rest of the card — do not extract a separate component for a 3-field sub-section.

- [ ] **Step 6: Typecheck + full API test run**

Run: `cd web && npx tsc --noEmit` — exit 0.
Run: `cd web && npm run test:api` — all pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/api/secrets web/src/components/targeting-card.tsx
git commit -m "feat(web): bring-your-own Apify token, stored in .env, never echoed back"
```

---

### Task 4: Automation activity log viewer (read-only)

**Files:**
- Create: `web/src/app/api/automation/log/route.ts`
- Create: `web/src/app/api/automation/log/route.test.ts`
- Create: `web/src/components/automation-activity-log.tsx`

**Ground truth this task must match** (confirmed in `autonomy-log.mjs`):
- File: `data/autonomy-log.tsv`, header `timestamp\treport_num\tcompany\tverdict\treason\tscore\tvendor\toutcome`.
- `verdict` ∈ `{auto_submit, draft_only, blocked}`. `reason` ∈ `{ok, tier_off, below_threshold, blacklisted, not_allowlisted, unsafe_vendor, daily_cap, run_cap}`. `outcome` ∈ `{submitted, drafted, blocked, submit_failed_captcha, submit_failed_error, submit_aborted_knockout, submit_aborted_sensitive_field}`.
- This is READ ONLY. No route in this task ever writes to the log — only `autonomy-log.mjs`'s own `appendEntry` does that, from the CLI/orchestrator side.

- [ ] **Step 1: Write the failing tests**

Create `web/src/app/api/automation/log/route.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(tsv?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autonomy-log-test-"));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  if (tsv !== undefined) {
    fs.writeFileSync(path.join(dir, "data", "autonomy-log.tsv"), tsv, "utf8");
  }
  return dir;
}

async function call(root: string) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  return mod.GET();
}

const HEADER = "timestamp\treport_num\tcompany\tverdict\treason\tscore\tvendor\toutcome";

test("GET returns an empty list when the log doesn't exist", async () => {
  const root = makeTempRoot();
  const res = await call(root);
  const json = await res.json();
  assert.deepEqual(json.entries, []);
  assert.equal(json.total, 0);
});

test("GET parses rows into objects, most recent first", async () => {
  const root = makeTempRoot(
    [
      HEADER,
      "2026-07-22T10:00:00\t003\tAcme\tdraft_only\ttier_off\t2.9\tindeed\tdrafted",
      "2026-07-23T10:00:00\t006\tGlobex\tauto_submit\tok\t4.7\tgreenhouse\tsubmitted",
    ].join("\n") + "\n",
  );
  const res = await call(root);
  const json = await res.json();
  assert.equal(json.total, 2);
  assert.equal(json.entries[0].company, "Globex"); // most recent first
  assert.equal(json.entries[0].verdict, "auto_submit");
  assert.equal(json.entries[1].company, "Acme");
});

test("GET caps returned entries at 50 but reports the true total", async () => {
  const rows = Array.from(
    { length: 60 },
    (_, i) => `2026-07-${String((i % 28) + 1).padStart(2, "0")}T10:00:00\t${i}\tCo${i}\tdraft_only\ttier_off\t3.0\tindeed\tdrafted`,
  );
  const root = makeTempRoot([HEADER, ...rows].join("\n") + "\n");
  const res = await call(root);
  const json = await res.json();
  assert.equal(json.entries.length, 50);
  assert.equal(json.total, 60);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && node --import tsx --test src/app/api/automation/log/route.test.ts` — all 3 fail.

- [ ] **Step 3: Implement the route**

Create `web/src/app/api/automation/log/route.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only view of data/autonomy-log.tsv. Nothing here ever writes to that
// file — appendEntry() in autonomy-log.mjs is the only writer, called from
// the autonomous-pipeline orchestrator, never from the web app.

const COLUMNS = ["timestamp", "reportNum", "company", "verdict", "reason", "score", "vendor", "outcome"] as const;
const MAX_ENTRIES = 50;

export async function GET() {
  const file = path.join(careerOpsRoot(), "data", "autonomy-log.tsv");
  if (!fs.existsSync(file)) return Response.json({ entries: [], total: 0 });

  const lines = fs
    .readFileSync(file, "utf8")
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const dataLines = lines.slice(1); // drop header
  const parsed = dataLines
    .map((line) => {
      const cells = line.split("\t");
      const entry: Record<string, string> = {};
      COLUMNS.forEach((col, i) => (entry[col] = cells[i] ?? ""));
      return entry;
    })
    .reverse(); // most recent first

  return Response.json({ entries: parsed.slice(0, MAX_ENTRIES), total: parsed.length });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && node --import tsx --test src/app/api/automation/log/route.test.ts` — 3/3 pass.

- [ ] **Step 5: Create the component**

Create `web/src/components/automation-activity-log.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type LogEntry = {
  timestamp: string;
  reportNum: string;
  company: string;
  verdict: string;
  reason: string;
  score: string;
  vendor: string;
  outcome: string;
};

const VERDICT_STYLE: Record<string, string> = {
  auto_submit: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  draft_only: "bg-surface-hover text-muted border-border",
  blocked: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
};

const REASON_LABELS: Record<string, string> = {
  ok: "cleared every check",
  tier_off: "auto-submit is off",
  below_threshold: "score too low",
  blacklisted: "company is on your Do Not Apply list",
  not_allowlisted: "company not on the allowlist",
  unsafe_vendor: "job board not in the allowed list",
  daily_cap: "hit today's submit limit",
  run_cap: "hit this run's submit limit",
};

export function AutomationActivityLog() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/automation/log");
        const data = await res.json();
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="mt-10 flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading activity…
      </div>
    );
  }

  return (
    <div className="mt-10 border-t border-border pt-8">
      <div className="mb-1 flex items-center gap-2">
        <History className="size-4 text-brand" />
        <h2 className="text-lg font-medium text-foreground">Automation Activity</h2>
      </div>
      <p className="mb-4 text-sm text-faint">
        {total === 0
          ? "No activity yet — this fills in once the automation has run at least once."
          : `Showing the ${Math.min(entries.length, total)} most recent of ${total} total.`}
      </p>
      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-hover text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Why</th>
                <th className="px-3 py-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.timestamp}-${i}`} className="border-t border-border">
                  <td className="px-3 py-2 text-xs text-faint">{e.timestamp.replace("T", " ")}</td>
                  <td className="px-3 py-2">{e.company}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", VERDICT_STYLE[e.verdict] ?? "")}>
                      {e.outcome}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{REASON_LABELS[e.reason] ?? e.reason}</td>
                  <td className="px-3 py-2 text-xs">{e.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Wire into Config page**

In `web/src/components/config-form.tsx`: import `AutomationActivityLog`, render it immediately after `<AutomationSafetyCard />` (before `BlacklistCard`, so the on/off switch and what-it-actually-did sit next to each other).

- [ ] **Step 7: Typecheck + full API test run, add all new test files to `test:api`**

Update `web/package.json`'s `test:api` script to include every new test file from this whole plan:

```json
"test:api": "node --import tsx --test src/app/api/portals/route.test.ts src/app/api/automation/route.test.ts src/app/api/blacklist/route.test.ts src/app/api/secrets/apify-token/route.test.ts src/app/api/automation/log/route.test.ts"
```

Run: `cd web && npx tsc --noEmit` — exit 0.
Run: `cd web && npm run test:api` — all pass.

- [ ] **Step 8: Live verification**

With the dev server running:
1. Open `/config` — confirm, top to bottom: Job Targeting → Companies to Scan → Automation Safety → Automation Activity → Do Not Apply.
2. Add a company via a real Greenhouse URL (e.g. `https://job-boards.greenhouse.io/anthropic`), confirm it appears with a "Greenhouse" badge, remove it, confirm it disappears.
3. Try an unrecognized URL (e.g. `https://example.com/jobs`) — confirm a clear error, nothing added.
4. Add a company name to the Do Not Apply list, reload the page, confirm it persisted.
5. Paste a fake Apify token, confirm the status flips to "Using your own token," clear it, confirm it flips back.
6. If `data/autonomy-log.tsv` has real rows from earlier ticks (it does, from today's runs), confirm the Activity table renders them with human-readable outcome/reason text.

- [ ] **Step 9: Commit**

```bash
git add web/src/app/api/automation/log web/src/components/automation-activity-log.tsx web/src/components/config-form.tsx web/package.json
git commit -m "feat(web): read-only Automation Activity log on the Config page"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** all four gaps named in conversation — blacklist editor, add-company-by-URL, bring-your-own Apify token, activity log viewer — map 1:1 to Tasks 1-4. Cron/scheduling explicitly excluded per the user's own sequencing ("leave the cron job for now").
- **Scope discipline:** Task 2 deliberately does NOT attempt to manage the 176 pre-existing curated `tracked_companies` entries — only web-ui-tagged ones, avoiding any risk of corrupting `scan_method: websearch` or local-parser entries a generic form can't represent.
- **Security:** Task 3's route never returns the token value in GET or PUT responses, validates against whitespace injection, and documents that `.env` writes take effect without a restart (verified against `scan.mjs`'s per-invocation `dotenv.config()` call and the fact every scan is a freshly spawned child process).
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code. Task 2's route-modification step is the one exception that says "match existing variable names" instead of a full file replacement — deliberate, because that route already has other logic (title_filter, location_filter, apify) that a full-file rewrite would risk silently reverting; inserting into the existing structure is the safer instruction for a builder model.
- **Test discipline:** every task's tests run through `node --import tsx --test` (the only working invocation in this repo, per the `test:api` script) — never bare `node --test`, which fails on `@/` path aliases.
