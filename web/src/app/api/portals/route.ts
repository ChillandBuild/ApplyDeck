import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merge-safe writer for portals.yml's title_filter (a USER-LAYER file). Replaces
// ONLY title_filter.positive (the role keywords the free scanner matches), seeding
// from templates/portals.example.yml on first create, and PRESERVING tracked_companies
// + every other block. Atomic write, confirm-gated (setProfile/setPortals). This is
// what loads the very first home scan once the user confirms their target roles.

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

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function POST(req: Request) {
  let body: { roles?: string[]; location?: string[] };
  try {
    body = (await req.json()) as { roles?: string[]; location?: string[] };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const roles = (Array.isArray(body.roles) ? body.roles : []).map((r) => String(r).trim()).filter(Boolean).slice(0, 24);
  if (roles.length === 0) return Response.json({ error: "no roles" }, { status: 400 });

  const root = careerOpsRoot();
  const file = path.join(root, "portals.yml");
  let doc: Record<string, unknown> = {};
  try {
    doc = (yaml.load(fs.readFileSync(file, "utf8")) as Record<string, unknown>) || {};
  } catch {
    try {
      doc = (yaml.load(fs.readFileSync(path.join(root, "templates", "portals.example.yml"), "utf8")) as Record<string, unknown>) || {};
    } catch {
      doc = {};
    }
  }

  const tf = isObj(doc.title_filter) ? { ...doc.title_filter } : {};
  tf.positive = roles; // replace ONLY the positive keywords; keep negative/etc.
  doc.title_filter = tf;
  if (Array.isArray(body.location) && body.location.length) {
    const lf = isObj(doc.location_filter) ? { ...doc.location_filter } : {};
    lf.allow = body.location.map((l) => String(l).trim()).filter(Boolean);
    doc.location_filter = lf;
  }

  try {
    atomicWriteWithBackup(file, yaml.dump(doc, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, roles: roles.length });
}

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
  addCompany?: { name: string; careersUrl: string };
  removeCompany?: string;
  toggleSearchSource?: { name: string; enabled: boolean };
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

  if (patch.toggleSearchSource !== undefined) {
    const name = String(patch.toggleSearchSource.name ?? "").trim();
    if (!name) return Response.json({ error: "name is required" }, { status: 400 });
    const queries = Array.isArray(doc.search_queries) ? doc.search_queries : [];
    const idx = queries.findIndex((q) => isObj(q) && q.name === name);
    if (idx === -1) {
      return Response.json({ error: "no search source with that name" }, { status: 404 });
    }
    const nextQueries = [...queries];
    nextQueries[idx] = { ...(queries[idx] as Record<string, unknown>), enabled: !!patch.toggleSearchSource.enabled };
    doc.search_queries = nextQueries;
  }

  if (patch.removeCompany !== undefined) {
    const companies = Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [];
    const idx = companies.findIndex((c) => isObj(c) && c.source === "web-ui" && c.name === patch.removeCompany);
    if (idx === -1) {
      return Response.json({ error: "no web-ui-added company with that name" }, { status: 404 });
    }
    doc.tracked_companies = companies.filter((_, i) => i !== idx);
  }

  try {
    atomicWriteWithBackup(file, yaml.dump(doc, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
