import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Checks (or unchecks) `- [ ]` rows in data/pipeline.md by URL — the same
// `[x]` the CLI itself writes once a pending URL is processed. This is what
// the web inbox's Skip/Delete calls so a dismissed posting actually leaves
// "N in inbox" instead of only hiding client-side. Matched by the row's own
// first `|`-column (the URL), same parser shape as readInbox().
const CHECKBOX_RE = /^(\s*-\s*\[)([ xX])(\]\s*)(.+)$/;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const urls = Array.isArray(body?.urls) ? body.urls.filter((u: unknown): u is string => typeof u === "string" && u.length > 0) : [];
  const done = body?.done !== false;
  if (!urls.length) return Response.json({ error: "urls required" }, { status: 400 });

  const file = path.join(careerOpsRoot(), "data/pipeline.md");
  let md: string;
  try {
    md = fs.readFileSync(file, "utf8");
  } catch {
    return Response.json({ error: "data/pipeline.md not found" }, { status: 404 });
  }

  const urlSet = new Set(urls);
  let changed = 0;
  const next = md.split("\n").map((line) => {
    const m = line.match(CHECKBOX_RE);
    if (!m) return line;
    const [, pre, , post, rest] = m;
    const url = rest.split("|")[0]?.trim();
    if (!url || !urlSet.has(url)) return line;
    changed++;
    return `${pre}${done ? "x" : " "}${post}${rest}`;
  });

  if (changed) atomicWriteWithBackup(file, next.join("\n"));
  return Response.json({ changed });
}
