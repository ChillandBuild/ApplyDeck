import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { isApifyPluginEnabled, isApifyTokenConfigured } from "@/lib/core/apify-discover";
import type { ApifyScanEvent } from "@/lib/explore";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface ComposerBody {
  keywords?: unknown;
  platforms?: unknown;
  location?: unknown;
  country?: unknown;
  max?: unknown;
  sources?: unknown; // legacy fallback
}

export async function POST(req: NextRequest) {
  let body: ComposerBody = {};
  try {
    body = (await req.json()) as ComposerBody;
  } catch {
    /* empty body */
  }

  const root = careerOpsRoot();

  if (!isApifyPluginEnabled(root)) {
    return Response.json({ error: "The Apify plugin isn't enabled — turn it on in Config → Search Sources." }, { status: 400 });
  }
  if (!isApifyTokenConfigured(root)) {
    return Response.json({ error: "No Apify token configured — add one in Config → Search Sources." }, { status: 400 });
  }

  const keywords = Array.isArray(body.keywords)
    ? body.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    : [];
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : [];

  const location = typeof body.location === "string" ? body.location.trim() : "";
  const country = typeof body.country === "string" ? body.country.trim() : "US";
  const max = typeof body.max === "number" && body.max > 0 ? body.max : 20;

  if (keywords.length === 0 || platforms.length === 0) {
    return Response.json({ error: "At least one keyword and one platform must be selected." }, { status: 400 });
  }

  // Fan out keywords × platforms
  const jobs: Array<{ platform: string; query: string; location: string; country: string; max: number }> = [];
  for (const query of keywords) {
    for (const platform of platforms) {
      jobs.push({ platform, query, location, country, max });
    }
  }

  const jobsFile = path.join(os.tmpdir(), `career-ops-apify-jobs-${randomUUID()}.json`);
  fs.writeFileSync(jobsFile, JSON.stringify(jobs), "utf8");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: ApifyScanEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* stream closed */
        }
      };

      const child = spawn(process.execPath, [rootScript("explore-apify"), "--jobs", jobsFile], { cwd: root });

      let buf = "";
      child.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        const parts = buf.split(/\r?\n/);
        buf = parts.pop() ?? "";
        for (const line of parts) {
          if (!line.trim()) continue;
          try {
            send(JSON.parse(line) as ApifyScanEvent);
          } catch {
            /* skip unparsable line */
          }
        }
      });

      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          fs.unlinkSync(jobsFile);
        } catch {
          /* best effort cleanup */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      child.on("error", (err) => {
        send({ kind: "error", message: err.message });
        finish();
      });
      child.on("close", finish);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
