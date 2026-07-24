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
