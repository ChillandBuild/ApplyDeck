import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";

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

export async function GET() {
  const file = path.join(careerOpsRoot(), "portals.yml");
  if (!fs.existsSync(file)) {
    return Response.json({ positive: [], negative: [], alwaysAllow: [], block: [], apify: null, companies: [] });
  }
  let doc: Record<string, unknown>;
  try {
    const parsed = yaml.load(fs.readFileSync(file, "utf8"));
    doc = isObj(parsed) ? parsed : {};
  } catch {
    return Response.json({ positive: [], negative: [], alwaysAllow: [], block: [], apify: null, companies: [], malformed: true });
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
    companies: companies
      .filter((c: unknown) => isObj(c) && c.source === "web-ui")
      .map((c: any) => ({ name: c.name, careersUrl: c.careers_url, vendor: detectVendor(String(c.careers_url ?? "")) })),
  });
}
