# Automation Safety Config UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose the autonomous-pipeline's safety caps — `score_threshold`, `daily_submit_cap`, `per_run_cap`, `company_allowlist`, `safe_vendors` — as editable form fields on the web Config page, so a non-technical client can tune how cautious auto-submit is without touching YAML.

**Architecture:** Extend the existing `web/src/app/api/automation/route.ts` (currently only handles `scheduleHours`) to also read/write these five fields, using the same malformed-YAML guard already proven in that route. Add a new `AutomationSafetyCard` component — separate from `TargetingCard`, not merged into it, because this is safety config, not job-targeting config, and non-tech users benefit from that being a visually distinct section. `tier` (draft/autonomous) is READ but never WRITTEN by this route — that boundary from the original implementation is preserved and reinforced, not loosened.

**Tech Stack:** Next.js 16 App Router, TypeScript, `js-yaml`, existing `atomicWriteWithBackup`, existing `KeywordField` chip component (reused for `company_allowlist`).

## Global Constraints

- **`tier` stays read-only through this entire feature.** The GET response includes it (so the UI can show current state), but no PUT body field can ever set it — no checkbox, no toggle, nothing. This is a repeat of the existing route's own design comment; do not add a way around it "for convenience."
- **`safe_vendors` is a closed set**, not free text: `greenhouse | ashby | lever | workday`. These are the only vendors `modes/autonomous-pipeline.md` knows how to detect and the only ones with documented ATS quirks in `modes/apply.md`. Render as checkboxes, not a `KeywordField` — a typo'd vendor string must be structurally impossible, not just discouraged.
- **`score_threshold`** clamps to `[1, 5]` server-side, one decimal place.
- **`daily_submit_cap`** and **`per_run_cap`** clamp to `[0, 20]` server-side — 0 is valid (functionally pauses auto-submit without touching `tier`); 20 is a sanity ceiling, not a real expected value.
- **`company_allowlist`** reuses the existing capped-at-24 pattern from `web/src/app/api/portals/route.ts`'s `capList` helper — duplicate that 4-line function locally rather than importing across route files (Next.js route files don't share state; a tiny local copy is simpler than a shared util for 4 lines, per YAGNI).
- Empty `company_allowlist` continues to mean "unrestricted" per `autonomy-gate.mjs`'s existing semantics (see `docs/superpowers/specs/2026-07-22-autonomous-pipeline-design.md`) — the UI must say this explicitly, not leave a non-tech user guessing what an empty list means for a safety control.
- Run `cd web && npx tsc --noEmit` after every task — must exit 0.
- Commit after each task with the given message; do not push without being asked.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `web/src/app/api/automation/route.ts` | modify | Extend GET/PUT to cover the 5 safety fields; `tier` becomes read-only passthrough |
| `web/src/app/api/automation/route.test.ts` | modify | Add coverage for the new fields, the closed-vendor-set rule, and the “tier is never written” guarantee |
| `web/src/components/automation-safety-card.tsx` | create | New Config-page card: score threshold, caps, vendor checkboxes, allowlist chips, read-only tier badge |
| `web/src/components/config-form.tsx` | modify | Render `<AutomationSafetyCard />` alongside `<TargetingCard />` |

---

### Task 1: Extend `/api/automation` for the safety fields

**Files:**
- Modify: `web/src/app/api/automation/route.ts`
- Modify: `web/src/app/api/automation/route.test.ts`

**Interfaces:**
- Consumes: nothing new (same `careerOpsRoot`, `atomicWriteWithBackup`, `js-yaml` already imported).
- Produces (used by Task 2's `AutomationSafetyCard`):
  - `GET /api/automation` now returns:
    ```ts
    {
      tier: "draft" | "autonomous",   // READ-ONLY — see note below
      scheduleHours: number,
      scoreThreshold: number,
      dailySubmitCap: number,
      perRunCap: number,
      companyAllowlist: string[],
      safeVendors: ("greenhouse" | "ashby" | "lever" | "workday")[],
    }
    ```
  - `PUT /api/automation` body may include any subset of: `scheduleHours`, `scoreThreshold`, `dailySubmitCap`, `perRunCap`, `companyAllowlist`, `safeVendors`. **`tier` in the body is silently ignored** — not an error, just never read, so a stray field from a future client can't accidentally flip it.
  - Response: `{ ok: true, ...the-fields-that-were-set }`, same envelope shape as before.

- [ ] **Step 1: Write the failing tests (append to the existing test file)**

Add to `web/src/app/api/automation/route.test.ts` (keep all 4 existing tests, add these):

```ts
test("GET returns safety-field defaults when automation block is absent", async () => {
  const root = makeTempRoot("candidate:\n  full_name: Test\n");
  const res = await call(root, "GET");
  const json = await res.json();
  assert.equal(json.scoreThreshold, 4.5);
  assert.equal(json.dailySubmitCap, 3);
  assert.equal(json.perRunCap, 2);
  assert.deepEqual(json.companyAllowlist, []);
  assert.deepEqual(json.safeVendors, ["greenhouse", "ashby"]);
});

test("PUT writes all five safety fields and preserves tier/scheduleHours", async () => {
  const root = makeTempRoot(`
automation:
  tier: autonomous
  score_threshold: 4.5
  daily_submit_cap: 3
  per_run_cap: 2
  company_allowlist: []
  safe_vendors: [greenhouse, ashby]
  schedule_hours: 6
`);
  const res = await call(root, "PUT", {
    scoreThreshold: 4.2,
    dailySubmitCap: 5,
    perRunCap: 3,
    companyAllowlist: ["Perplexity", "Faculty"],
    safeVendors: ["greenhouse", "lever"],
  });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8"));
  assert.equal(doc.automation.score_threshold, 4.2);
  assert.equal(doc.automation.daily_submit_cap, 5);
  assert.equal(doc.automation.per_run_cap, 3);
  assert.deepEqual(doc.automation.company_allowlist, ["Perplexity", "Faculty"]);
  assert.deepEqual(doc.automation.safe_vendors, ["greenhouse", "lever"]);
  assert.equal(doc.automation.tier, "autonomous"); // untouched by this PUT
  assert.equal(doc.automation.schedule_hours, 6); // untouched — wasn't in the body
});

test("PUT ignores a tier field in the body — cannot flip tier through this route", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { tier: "autonomous", scoreThreshold: 4.0 });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8"));
  assert.equal(doc.automation.tier, "draft"); // still draft — the body's tier field was ignored
  assert.equal(doc.automation.score_threshold, 4.0); // the OTHER field in the same request did apply
});

test("PUT clamps score_threshold to [1, 5]", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { scoreThreshold: 9.9 });
  const json = await res.json();
  assert.equal(json.scoreThreshold, 5);
  const res2 = await call(root, "PUT", { scoreThreshold: 0 });
  const json2 = await res2.json();
  assert.equal(json2.scoreThreshold, 1);
});

test("PUT clamps daily_submit_cap and per_run_cap to [0, 20]", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { dailySubmitCap: 999, perRunCap: -5 });
  const json = await res.json();
  assert.equal(json.dailySubmitCap, 20);
  assert.equal(json.perRunCap, 0);
});

test("PUT rejects unknown vendor strings, keeping only the closed set", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { safeVendors: ["greenhouse", "totallyMadeUp", "lever"] });
  const json = await res.json();
  assert.deepEqual(json.safeVendors, ["greenhouse", "lever"]);
});

test("PUT caps company_allowlist at 24 entries", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const many = Array.from({ length: 30 }, (_, i) => `Company${i}`);
  const res = await call(root, "PUT", { companyAllowlist: many });
  const json = await res.json();
  assert.equal(json.companyAllowlist.length, 24);
});

test("PUT still refuses malformed profile.yml (409, no data loss) with safety fields in the body", async () => {
  const root = makeTempRoot("not: [valid, yaml: {{{");
  const before = fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8");
  const res = await call(root, "PUT", { scoreThreshold: 4.0, dailySubmitCap: 5 });
  assert.equal(res.status, 409);
  const after = fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8");
  assert.equal(after, before);
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd web && node --test src/app/api/automation/route.test.ts`
Expected: the 4 pre-existing tests still pass; the 8 new ones FAIL (fields don't exist yet on the route).

- [ ] **Step 3: Rewrite the route implementation**

Replace the full contents of `web/src/app/api/automation/route.ts`:

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
// to parse. This route deliberately never WRITES `tier` — switching to
// "autonomous" needs the full context in modes/autonomous-pipeline.md, not a
// dropdown in a form. A `tier` key in a PUT body is silently ignored, not
// rejected, so a future client sending the full GET shape back unmodified
// can't accidentally flip it either.

const SAFE_VENDOR_SET = ["greenhouse", "ashby", "lever", "workday"] as const;
type SafeVendor = (typeof SAFE_VENDOR_SET)[number];

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const DEFAULTS = {
  tier: "draft" as const,
  scheduleHours: 6,
  scoreThreshold: 4.5,
  dailySubmitCap: 3,
  perRunCap: 2,
  companyAllowlist: [] as string[],
  safeVendors: ["greenhouse", "ashby"] as SafeVendor[],
};

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

function capList(v: unknown, max = 24): string[] {
  return (Array.isArray(v) ? v : []).map((r) => String(r).trim()).filter(Boolean).slice(0, max);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function readAutomation(a: Record<string, unknown>) {
  const tier = a.tier === "autonomous" ? "autonomous" : "draft";
  const scheduleN = Number(a.schedule_hours);
  const scheduleHours = Number.isFinite(scheduleN) && scheduleN > 0 ? clamp(Math.round(scheduleN), 1, 168) : DEFAULTS.scheduleHours;
  const thresholdN = Number(a.score_threshold);
  const scoreThreshold = Number.isFinite(thresholdN) ? clamp(Math.round(thresholdN * 10) / 10, 1, 5) : DEFAULTS.scoreThreshold;
  const dailyN = Number(a.daily_submit_cap);
  const dailySubmitCap = Number.isFinite(dailyN) ? clamp(Math.round(dailyN), 0, 20) : DEFAULTS.dailySubmitCap;
  const runN = Number(a.per_run_cap);
  const perRunCap = Number.isFinite(runN) ? clamp(Math.round(runN), 0, 20) : DEFAULTS.perRunCap;
  const companyAllowlist = capList(a.company_allowlist);
  const safeVendorsRaw = Array.isArray(a.safe_vendors) ? a.safe_vendors : DEFAULTS.safeVendors;
  const safeVendors = safeVendorsRaw.filter((v): v is SafeVendor => SAFE_VENDOR_SET.includes(v as SafeVendor));
  return {
    tier,
    scheduleHours,
    scoreThreshold,
    dailySubmitCap,
    perRunCap,
    companyAllowlist,
    safeVendors: safeVendors.length > 0 ? safeVendors : DEFAULTS.safeVendors,
  };
}

export async function GET() {
  const { doc, malformed } = readProfile(careerOpsRoot());
  if (malformed || !doc) return Response.json(DEFAULTS);
  const a = isObj(doc.automation) ? doc.automation : {};
  return Response.json(readAutomation(a));
}

type SafetyPatch = {
  scheduleHours?: number;
  scoreThreshold?: number;
  dailySubmitCap?: number;
  perRunCap?: number;
  companyAllowlist?: string[];
  safeVendors?: string[];
  // tier?: never read, intentionally not in this type
};

export async function PUT(req: Request) {
  let body: SafetyPatch;
  try {
    body = (await req.json()) as SafetyPatch;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const { doc, malformed } = readProfile(root);
  if (malformed || doc === null) {
    return Response.json({ error: "config/profile.yml exists but is not valid YAML — refusing to overwrite it." }, { status: 409 });
  }

  const automation = isObj(doc.automation) ? { ...doc.automation } : {};
  const out: Record<string, unknown> = {};

  if (body.scheduleHours !== undefined) {
    const n = Number(body.scheduleHours);
    if (!Number.isFinite(n)) return Response.json({ error: "scheduleHours must be a number" }, { status: 400 });
    automation.schedule_hours = clamp(Math.round(n), 1, 168);
    out.scheduleHours = automation.schedule_hours;
  }
  if (body.scoreThreshold !== undefined) {
    const n = Number(body.scoreThreshold);
    if (!Number.isFinite(n)) return Response.json({ error: "scoreThreshold must be a number" }, { status: 400 });
    automation.score_threshold = clamp(Math.round(n * 10) / 10, 1, 5);
    out.scoreThreshold = automation.score_threshold;
  }
  if (body.dailySubmitCap !== undefined) {
    const n = Number(body.dailySubmitCap);
    if (!Number.isFinite(n)) return Response.json({ error: "dailySubmitCap must be a number" }, { status: 400 });
    automation.daily_submit_cap = clamp(Math.round(n), 0, 20);
    out.dailySubmitCap = automation.daily_submit_cap;
  }
  if (body.perRunCap !== undefined) {
    const n = Number(body.perRunCap);
    if (!Number.isFinite(n)) return Response.json({ error: "perRunCap must be a number" }, { status: 400 });
    automation.per_run_cap = clamp(Math.round(n), 0, 20);
    out.perRunCap = automation.per_run_cap;
  }
  if (body.companyAllowlist !== undefined) {
    automation.company_allowlist = capList(body.companyAllowlist);
    out.companyAllowlist = automation.company_allowlist;
  }
  if (body.safeVendors !== undefined) {
    const filtered = (Array.isArray(body.safeVendors) ? body.safeVendors : []).filter((v): v is SafeVendor =>
      SAFE_VENDOR_SET.includes(v as SafeVendor),
    );
    automation.safe_vendors = filtered;
    out.safeVendors = filtered;
  }
  // NOTE: `body.tier` is never read, never written. This is intentional — see
  // the module comment. Do not add an `if (body.tier !== undefined)` branch.

  const merged = { ...doc, automation };
  const file = path.join(root, "config", "profile.yml");
  try {
    atomicWriteWithBackup(file, yaml.dump(merged, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, ...out });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && node --test src/app/api/automation/route.test.ts`
Expected: all 12 tests pass (4 original + 8 new).

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit` — Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/automation/route.ts web/src/app/api/automation/route.test.ts
git commit -m "feat(web): expose automation safety caps via /api/automation, tier stays read-only"
```

---

### Task 2: `AutomationSafetyCard` component + wire into Config page

**Files:**
- Create: `web/src/components/automation-safety-card.tsx`
- Modify: `web/src/components/config-form.tsx`

**Interfaces:**
- Consumes: `GET`/`PUT /api/automation` from Task 1; `KeywordField` from `@/components/keyword-field` (for `companyAllowlist`); `cn` from `@/lib/cn`.
- Produces: `<AutomationSafetyCard />`, rendered as its own section on the Config page, below `<TargetingCard />`.

- [ ] **Step 1: Create the component**

Create `web/src/components/automation-safety-card.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { KeywordField, KEYWORD_FIELD_STYLE } from "@/components/keyword-field";

const VENDOR_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  ashby: "Ashby",
  lever: "Lever",
  workday: "Workday",
};
const VENDOR_KEYS = Object.keys(VENDOR_LABELS);

type AutomationSnapshot = {
  tier: "draft" | "autonomous";
  scoreThreshold: number;
  dailySubmitCap: number;
  perRunCap: number;
  companyAllowlist: string[];
  safeVendors: string[];
};

export function AutomationSafetyCard() {
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<"draft" | "autonomous">("draft");
  const [scoreThreshold, setScoreThreshold] = useState(4.5);
  const [dailySubmitCap, setDailySubmitCap] = useState(3);
  const [perRunCap, setPerRunCap] = useState(2);
  const [companyAllowlist, setCompanyAllowlist] = useState<string[]>([]);
  const [safeVendors, setSafeVendors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/automation");
        const data = (await res.json()) as AutomationSnapshot;
        if (cancelled) return;
        setTier(data.tier);
        setScoreThreshold(data.scoreThreshold);
        setDailySubmitCap(data.dailySubmitCap);
        setPerRunCap(data.perRunCap);
        setCompanyAllowlist(data.companyAllowlist ?? []);
        setSafeVendors(data.safeVendors ?? []);
      } catch {
        if (!cancelled) setError("Could not load automation settings — check the server is running.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleVendor = (v: string) => {
    setSafeVendors((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/automation", {
        method: "PUT",
        body: JSON.stringify({
          scoreThreshold,
          dailySubmitCap,
          perRunCap,
          companyAllowlist,
          safeVendors,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "save failed");
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
        <Loader2 className="size-4 animate-spin" /> Loading automation settings…
      </div>
    );
  }

  return (
    <div className="mt-10 border-t border-border pt-8">
      <style>{KEYWORD_FIELD_STYLE}</style>
      <div className="mb-1 flex items-center gap-2">
        <ShieldAlert className="size-4 text-brand" />
        <h2 className="text-lg font-medium text-foreground">Automation Safety</h2>
      </div>
      <p className="mb-1 text-sm text-faint">
        How cautious auto-submit is. These limits only matter when auto-submit is actually on.
      </p>
      <div
        className={cn(
          "mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
          tier === "autonomous"
            ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            : "border-border bg-surface-hover text-muted",
        )}
      >
        <span className={cn("size-1.5 rounded-full", tier === "autonomous" ? "bg-red-500" : "bg-muted")} />
        Auto-submit is currently {tier === "autonomous" ? "ON" : "OFF"}
      </div>
      {tier !== "autonomous" && (
        <p className="mb-6 -mt-4 text-xs text-faint">
          These limits are saved but have no effect while auto-submit is off. Turning auto-submit on itself isn't done
          from this page — ask your ApplyDeck admin.
        </p>
      )}

      <div className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-3">
          <label className="text-xs text-muted">
            Minimum score to auto-submit
            <input
              type="number"
              min={1}
              max={5}
              step={0.1}
              value={scoreThreshold}
              onChange={(e) => setScoreThreshold(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-muted">
            Max auto-submits per day
            <input
              type="number"
              min={0}
              max={20}
              value={dailySubmitCap}
              onChange={(e) => setDailySubmitCap(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-muted">
            Max auto-submits per run
            <input
              type="number"
              min={0}
              max={20}
              value={perRunCap}
              onChange={(e) => setPerRunCap(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-border bg-surface/40 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Only submit on these job-board platforms
          </label>
          <div className="flex flex-wrap gap-2">
            {VENDOR_KEYS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => toggleVendor(v)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  safeVendors.includes(v)
                    ? "border-brand/50 bg-brand-soft text-brand"
                    : "border-border bg-surface/50 text-muted hover:bg-surface-hover",
                )}
              >
                {VENDOR_LABELS[v]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-faint">Job boards not on this list always fall back to draft, never auto-submit.</p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Only auto-submit to these companies
          </label>
          <KeywordField
            values={companyAllowlist}
            tone="inc"
            placeholder="Leave empty to allow any company…"
            onChange={setCompanyAllowlist}
          />
          <p className="mt-1.5 text-xs text-faint">
            {companyAllowlist.length === 0
              ? "Empty = any company that clears the other checks is eligible."
              : `Only the ${companyAllowlist.length} compan${companyAllowlist.length === 1 ? "y" : "ies"} listed above are eligible.`}
          </p>
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
        {saving ? "Saving…" : saved ? "Saved" : "Save automation settings"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the Config page**

In `web/src/components/config-form.tsx`:
1. Add the import: `import { AutomationSafetyCard } from "@/components/automation-safety-card";`
2. Immediately after the existing `<TargetingCard />` line (added by the prior Targeting plan), add `<AutomationSafetyCard />` as its next sibling, still inside the same wrapper `<div>`.

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit` — Expected: exit 0.

- [ ] **Step 4: Live verification**

With the dev server running on port 3001:
```bash
curl -s http://localhost:3001/api/automation
```
Expected: JSON including `tier`, `scoreThreshold`, `dailySubmitCap`, `perRunCap`, `companyAllowlist`, `safeVendors` — reflecting whatever is actually in `config/profile.yml` right now (if `tier` is currently `"autonomous"` from prior testing, it should show `"autonomous"` here too — READ, not overwritten).

```bash
curl -s -X PUT http://localhost:3001/api/automation -d '{"dailySubmitCap":7}'
curl -s http://localhost:3001/api/automation
```
Expected: `dailySubmitCap` is now `7`; **`tier` is unchanged** from before this PUT — confirm this explicitly, it's the one invariant that must never regress.

Then restore the original value: `curl -s -X PUT http://localhost:3001/api/automation -d '{"dailySubmitCap":3}'`.

Open `http://localhost:3001/config` in a browser: confirm the "Automation Safety" section renders below Job Targeting, shows the correct ON/OFF tier badge, and editing a cap + clicking Save persists after a page reload.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/automation-safety-card.tsx web/src/components/config-form.tsx
git commit -m "feat(web): Automation Safety card on the Config page (caps, allowlist, vendors)"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** all 5 requested fields (score_threshold, daily_submit_cap, per_run_cap, company_allowlist, safe_vendors) → Task 1 (route) + Task 2 (UI); `tier` explicitly excluded per the original design rationale, with 2 dedicated tests proving it can't be set through this surface even when included in the request body; closed vendor enum enforced server-side, not just in the UI; empty-allowlist semantics explained in the UI copy, not left implicit.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code.
- **Type consistency:** `AutomationSnapshot` in the component matches the GET route's response shape field-for-field (`tier`, `scoreThreshold`, `dailySubmitCap`, `perRunCap`, `companyAllowlist`, `safeVendors`); the PUT body shape in the component's `save()` matches `SafetyPatch` in the route; camelCase (client/API) vs snake_case (YAML) boundary is kept at the route layer only, consistent with the existing Targeting UI's convention.
