# Automation Safety Config UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose the autonomous-pipeline's safety caps — `tier`, `score_threshold`, `daily_submit_cap`, `per_run_cap`, `company_allowlist`, `safe_vendors` — as editable form fields on the web Config page, so a non-technical client can turn auto-submit on/off and tune how cautious it is, per their own instance, without an operator touching YAML for them.

**Architecture:** Extend the existing `web/src/app/api/automation/route.ts` (currently only handles `scheduleHours`) to also read/write these six fields, using the same malformed-YAML guard already proven in that route. Add a new `AutomationSafetyCard` component — separate from `TargetingCard`, not merged into it, because this is safety config, not job-targeting config, and non-tech users benefit from that being a visually distinct section. `tier` (draft/autonomous) is now a client-controlled switch: validated server-side against a closed two-value enum (`"draft" | "autonomous"`, anything else rejected with 400), and gated client-side behind an explicit confirm step before it can be turned on — this is the one field on the card with real consequences, so it gets a deliberate second click, not silent auto-save.

**Tech Stack:** Next.js 16 App Router, TypeScript, `js-yaml`, existing `atomicWriteWithBackup`, existing `KeywordField` chip component (reused for `company_allowlist`).

## Global Constraints

- **`tier` is settable, but through a closed enum only.** `PUT` accepts `tier: "draft" | "autonomous"` — any other value (typo, arbitrary string, boolean, number) is a 400, not a silent coercion. There is no partial/soft state between the two.
- **Turning `tier` on is a two-step client action, not a side effect of the general Save button.** The UI must get an explicit confirmation (a native `confirm()` is sufficient — no need for a custom modal) before it includes `tier: "autonomous"` in a PUT, with copy that says plainly what turning it on means: the system can submit applications without a human reviewing them first, within the limits configured below. Turning it back OFF does not require confirmation — making the system more conservative never needs a safety gate.
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
| `web/src/app/api/automation/route.ts` | modify | Extend GET/PUT to cover the 5 caps plus `tier` itself, `tier` validated against a closed enum |
| `web/src/app/api/automation/route.test.ts` | modify | Add coverage for the new fields, the closed-vendor-set rule, and the tier enum guard (valid values apply, invalid values 400 the whole request) |
| `web/src/components/automation-safety-card.tsx` | create | New Config-page card: tier on/off switch (confirm-gated), score threshold, caps, vendor checkboxes, allowlist chips |
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
      tier: "draft" | "autonomous",
      scheduleHours: number,
      scoreThreshold: number,
      dailySubmitCap: number,
      perRunCap: number,
      companyAllowlist: string[],
      safeVendors: ("greenhouse" | "ashby" | "lever" | "workday")[],
    }
    ```
  - `PUT /api/automation` body may include any subset of: `tier`, `scheduleHours`, `scoreThreshold`, `dailySubmitCap`, `perRunCap`, `companyAllowlist`, `safeVendors`. **`tier`, if present, must be exactly `"draft"` or `"autonomous"`** — any other value is a 400 and the write does not happen at all (not even the other fields in the same request), since a rejected `tier` means the request's intent was ambiguous.
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

test("PUT sets tier to autonomous when given a valid value", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { tier: "autonomous" });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.tier, "autonomous");
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8"));
  assert.equal(doc.automation.tier, "autonomous");
});

test("PUT sets tier back to draft when given a valid value", async () => {
  const root = makeTempRoot("automation:\n  tier: autonomous\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { tier: "draft" });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8"));
  assert.equal(doc.automation.tier, "draft");
});

test("PUT rejects an invalid tier value — 400, no write, unrelated fields also not applied", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  score_threshold: 4.5\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { tier: "yolo", scoreThreshold: 2.0 });
  assert.equal(res.status, 400);
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8"));
  assert.equal(doc.automation.tier, "draft"); // unchanged
  assert.equal(doc.automation.score_threshold, 4.5); // unchanged — the whole request was rejected
});

test("PUT omitting tier leaves the existing tier untouched", async () => {
  const root = makeTempRoot("automation:\n  tier: autonomous\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { scoreThreshold: 4.0 });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8"));
  assert.equal(doc.automation.tier, "autonomous"); // untouched — wasn't in the body
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
Expected: the 4 pre-existing tests still pass; the 11 new ones FAIL (fields don't exist yet on the route).

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
// to parse. `tier` (draft/autonomous) is writable here — each client controls
// their own instance's auto-submit switch — but only through the closed
// "draft" | "autonomous" enum; any other value is a 400 and the ENTIRE request
// is rejected, not just the tier field, since an invalid tier means intent was
// ambiguous. The confirm-before-enabling UX lives client-side in
// AutomationSafetyCard; this route only enforces the enum.

const TIER_SET = new Set(["draft", "autonomous"]);

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
  tier?: string;
  scheduleHours?: number;
  scoreThreshold?: number;
  dailySubmitCap?: number;
  perRunCap?: number;
  companyAllowlist?: string[];
  safeVendors?: string[];
};

export async function PUT(req: Request) {
  let body: SafetyPatch;
  try {
    body = (await req.json()) as SafetyPatch;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  if (body.tier !== undefined && !TIER_SET.has(body.tier)) {
    return Response.json({ error: 'tier must be "draft" or "autonomous"' }, { status: 400 });
  }

  const root = careerOpsRoot();
  const { doc, malformed } = readProfile(root);
  if (malformed || doc === null) {
    return Response.json({ error: "config/profile.yml exists but is not valid YAML — refusing to overwrite it." }, { status: 409 });
  }

  const automation = isObj(doc.automation) ? { ...doc.automation } : {};
  const out: Record<string, unknown> = {};

  if (body.tier !== undefined) {
    automation.tier = body.tier;
    out.tier = body.tier;
  }
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
Expected: all 15 tests pass (4 original + 11 new).

- [ ] **Step 5: Typecheck**

Run: `cd web && npx tsc --noEmit` — Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/automation/route.ts web/src/app/api/automation/route.test.ts
git commit -m "feat(web): expose automation safety caps + tier switch via /api/automation"
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
  const [tierSaving, setTierSaving] = useState(false);
  const [tierError, setTierError] = useState<string | null>(null);

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

  const requestTierChange = async (next: "draft" | "autonomous") => {
    if (next === tier || tierSaving) return;
    if (next === "autonomous") {
      const ok = window.confirm(
        "Turn auto-submit ON?\n\nApplyDeck will be able to submit applications on your behalf, automatically, without you reviewing them first — within the limits set below (minimum score, daily cap, allowed companies/platforms).\n\nYou can turn this off again at any time.",
      );
      if (!ok) return;
    }
    setTierSaving(true);
    setTierError(null);
    try {
      const res = await fetch("/api/automation", {
        method: "PUT",
        body: JSON.stringify({ tier: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "could not change auto-submit");
      }
      setTier(next);
    } catch (e) {
      setTierError(e instanceof Error ? e.message : "could not change auto-submit");
    } finally {
      setTierSaving(false);
    }
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
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={tier === "autonomous"}
          disabled={tierSaving}
          onClick={() => requestTierChange(tier === "autonomous" ? "draft" : "autonomous")}
          className={cn(
            "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
            tier === "autonomous" ? "bg-red-500" : "bg-border",
          )}
        >
          <span
            className={cn(
              "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
              tier === "autonomous" ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
            tier === "autonomous"
              ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              : "border-border bg-surface-hover text-muted",
          )}
        >
          <span className={cn("size-1.5 rounded-full", tier === "autonomous" ? "bg-red-500" : "bg-muted")} />
          Auto-submit is {tierSaving ? "updating…" : tier === "autonomous" ? "ON" : "OFF"}
        </div>
      </div>
      <p className="mb-6 text-xs text-faint">
        When OFF, ApplyDeck prepares applications for you to review and send yourself. When ON, it submits on its own —
        but only for jobs that clear every limit below.
      </p>
      {tierError && <p className="mb-6 -mt-4 text-xs text-red-600">{tierError}</p>}

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
Expected: JSON including `tier`, `scoreThreshold`, `dailySubmitCap`, `perRunCap`, `companyAllowlist`, `safeVendors` — reflecting whatever is actually in `config/profile.yml` right now.

```bash
curl -s -X PUT http://localhost:3001/api/automation -d '{"dailySubmitCap":7}'
curl -s http://localhost:3001/api/automation
```
Expected: `dailySubmitCap` is now `7`; `tier` is unchanged from before this PUT, since it wasn't in the body.

```bash
curl -s -X PUT http://localhost:3001/api/automation -d '{"tier":"nonsense"}'
```
Expected: `400`, and a follow-up `GET` shows `tier` unchanged — confirm the enum guard actually rejects bad input rather than coercing it.

Then restore `dailySubmitCap`: `curl -s -X PUT http://localhost:3001/api/automation -d '{"dailySubmitCap":3}'`.

Open `http://localhost:3001/config` in a browser: confirm the "Automation Safety" section renders below Job Targeting, the switch reflects the real current tier, clicking it to turn ON triggers the browser confirm dialog with the stated copy, canceling that dialog leaves the switch unchanged, confirming it flips the switch and persists immediately (reload the page — it should still show ON), and editing a cap + clicking "Save automation settings" persists after a reload without touching the switch.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/automation-safety-card.tsx web/src/components/config-form.tsx
git commit -m "feat(web): Automation Safety card on the Config page (caps, allowlist, vendors)"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** all 6 fields (tier, score_threshold, daily_submit_cap, per_run_cap, company_allowlist, safe_vendors) → Task 1 (route) + Task 2 (UI); `tier` is client-settable but constrained to a closed two-value enum server-side (invalid values 400 the whole request) and gated behind an explicit browser-confirm step client-side before it can be turned ON (never gated turning it OFF); closed vendor enum enforced server-side, not just in the UI; empty-allowlist semantics explained in the UI copy, not left implicit.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code.
- **Type consistency:** `AutomationSnapshot` in the component matches the GET route's response shape field-for-field (`tier`, `scoreThreshold`, `dailySubmitCap`, `perRunCap`, `companyAllowlist`, `safeVendors`); the PUT body shape in the component's `save()` matches `SafetyPatch` in the route; camelCase (client/API) vs snake_case (YAML) boundary is kept at the route layer only, consistent with the existing Targeting UI's convention.
