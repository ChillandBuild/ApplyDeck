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
