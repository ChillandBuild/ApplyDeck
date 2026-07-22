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

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const DEFAULTS = { tier: "draft" as const, scheduleHours: 6 };

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
