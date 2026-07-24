import { NextRequest } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { getApifySearchConfig, updateApifySearchConfig, type ApifySearchConfig } from "@/lib/core/portals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PLATFORMS = ["indeed", "linkedin", "glassdoor", "naukri"];

export async function GET() {
  const root = careerOpsRoot();
  return Response.json(getApifySearchConfig(root));
}

export async function PUT(req: NextRequest) {
  let body: Partial<ApifySearchConfig> = {};
  try {
    body = (await req.json()) as Partial<ApifySearchConfig>;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const update: Partial<ApifySearchConfig> = {};

  if (typeof body.enabled === "boolean") {
    update.enabled = body.enabled;
  }
  if (Array.isArray(body.keywords)) {
    update.keywords = body.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
  }
  if (Array.isArray(body.platforms)) {
    const valid = body.platforms.filter((p): p is string => typeof p === "string" && VALID_PLATFORMS.includes(p));
    if (valid.length === 0) {
      return Response.json({ error: "At least one valid platform must be selected" }, { status: 400 });
    }
    update.platforms = valid;
  }
  if (typeof body.location === "string") {
    update.location = body.location.trim();
  }
  if (typeof body.country === "string") {
    update.country = body.country.trim();
  }
  if (typeof body.max === "number") {
    update.max = Math.max(1, Math.min(100, body.max));
  }

  const root = careerOpsRoot();
  try {
    updateApifySearchConfig(root, update);
    return Response.json({ ok: true, config: getApifySearchConfig(root) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "save failed" }, { status: 500 });
  }
}
