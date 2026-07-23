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
