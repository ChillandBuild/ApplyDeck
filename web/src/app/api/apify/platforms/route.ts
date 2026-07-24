import { NextRequest } from "next/server";
import { spawnSync } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const root = careerOpsRoot();
  const res = spawnSync(process.execPath, [rootScript("explore-apify"), "--platforms"], { cwd: root, encoding: "utf8" });

  if (res.error || res.status !== 0) {
    return Response.json({ error: res.error?.message || res.stderr || "Failed to fetch platforms" }, { status: 500 });
  }

  try {
    const platforms = JSON.parse(res.stdout.trim());
    return Response.json({ platforms });
  } catch (err) {
    return Response.json({ error: "Invalid platforms JSON output" }, { status: 500 });
  }
}
