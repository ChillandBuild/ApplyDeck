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
