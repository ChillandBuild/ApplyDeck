import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "SERPER_API_KEY";

function envPath(root: string): string {
  return path.join(root, ".env");
}

function readLines(root: string): string[] {
  const file = envPath(root);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n");
}

export function isSerperKeyConfigured(root: string): boolean {
  return readLines(root).some((l) => new RegExp(`^${KEY}=.+`).test(l.trim()));
}

export async function GET() {
  return Response.json({ configured: isSerperKeyConfigured(careerOpsRoot()) });
}

export async function PUT(req: Request) {
  let body: { key?: string; token?: string };
  try {
    body = (await req.json()) as { key?: string; token?: string };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const key = String(body.key ?? body.token ?? "").trim();
  if (key && /\s/.test(key)) {
    return Response.json({ error: "key must not contain whitespace" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const lines = readLines(root).filter((l) => !new RegExp(`^${KEY}=`).test(l.trim()));
  if (key) lines.push(`${KEY}=${key}`);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const content = lines.length ? lines.join("\n") + "\n" : "";

  try {
    atomicWriteWithBackup(envPath(root), content);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, configured: isSerperKeyConfigured(root) });
}
