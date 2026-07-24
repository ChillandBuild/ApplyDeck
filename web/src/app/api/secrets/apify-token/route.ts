import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { isApifyTokenConfigured } from "@/lib/core/apify-discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sets/clears APIFY_TOKEN in .env. Every scan runs in a freshly spawned child
// process that calls dotenv.config() at its own module top level (scan.mjs),
// so a change here applies on the NEXT scan — no server restart needed. This
// route NEVER returns the token value; GET only reports whether one is set.

const KEY = "APIFY_TOKEN";

function envPath(root: string): string {
  return path.join(root, ".env");
}

function readLines(root: string): string[] {
  const file = envPath(root);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n");
}

function isConfigured(lines: string[]): boolean {
  return lines.some((l) => new RegExp(`^${KEY}=.+`).test(l.trim()));
}

export async function GET() {
  return Response.json({ configured: isApifyTokenConfigured(careerOpsRoot()) });
}

export async function PUT(req: Request) {
  let body: { token?: string };
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const token = String(body.token ?? "").trim();
  if (token && /\s/.test(token)) {
    return Response.json({ error: "token must not contain whitespace" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const lines = readLines(root).filter((l) => !new RegExp(`^${KEY}=`).test(l.trim()));
  if (token) lines.push(`${KEY}=${token}`);
  // drop a single trailing blank line before re-joining, then restore exactly one
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const content = lines.length ? lines.join("\n") + "\n" : "";

  try {
    atomicWriteWithBackup(envPath(root), content);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, configured: isConfigured(readLines(root)) });
}
