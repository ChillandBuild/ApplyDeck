import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { readPortalsDoc } from "@/lib/core/portals";
import { isApifyPluginEnabled, isApifyTokenConfigured } from "@/lib/core/apify-discover";
import type { ApifyScanEvent } from "@/lib/explore";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function POST(req: NextRequest) {
  let body: { sources?: unknown } = {};
  try {
    body = (await req.json()) as { sources?: unknown };
  } catch {
    /* empty body → no sources, caught below */
  }
  const requested = Array.isArray(body.sources) ? body.sources.filter((s): s is string => typeof s === "string") : [];
  if (requested.length === 0) {
    return Response.json({ error: "no sources selected" }, { status: 400 });
  }

  const root = careerOpsRoot();

  if (!isApifyPluginEnabled(root)) {
    return Response.json({ error: "The Apify plugin isn't enabled — turn it on in Config → Search Sources." }, { status: 400 });
  }
  if (!isApifyTokenConfigured(root)) {
    return Response.json({ error: "No Apify token configured — add one in Config → Search Sources." }, { status: 400 });
  }

  const { doc } = readPortalsDoc(root);
  const companies = Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [];
  const entries = companies.filter(
    (c): c is Record<string, unknown> =>
      isObj(c) && c.provider === "apify" && typeof c.name === "string" && requested.includes(c.name),
  );
  if (entries.length === 0) {
    return Response.json({ error: "none of the requested sources are configured" }, { status: 400 });
  }

  const entriesFile = path.join(os.tmpdir(), `career-ops-apify-${randomUUID()}.json`);
  fs.writeFileSync(
    entriesFile,
    JSON.stringify(
      entries.map((e) => ({
        name: e.name,
        actor: e.actor,
        input: e.input ?? {},
        field_map: e.field_map,
        timeout_ms: e.timeout_ms,
      })),
    ),
    "utf8",
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: ApifyScanEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* stream already closed client-side */
        }
      };

      const child = spawn(process.execPath, [rootScript("explore-apify"), "--entries", entriesFile], { cwd: root });

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
            /* skip an unparsable line rather than crashing the stream */
          }
        }
      });

      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          fs.unlinkSync(entriesFile);
        } catch {
          /* best-effort cleanup */
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
