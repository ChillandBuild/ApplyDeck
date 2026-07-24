import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { isSerperKeyConfigured } from "@/app/api/secrets/serper-key/route";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const root = careerOpsRoot();

  if (!isSerperKeyConfigured(root)) {
    return Response.json(
      { error: "SERPER_API_KEY is not configured — enter your key on the Scout page." },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* stream closed */
        }
      };

      const child = spawn(process.execPath, [rootScript("web-search-run")], { cwd: root });

      let buf = "";
      child.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        const parts = buf.split(/\r?\n/);
        buf = parts.pop() ?? "";
        for (const line of parts) {
          if (!line.trim()) continue;
          try {
            send(JSON.parse(line));
          } catch {
            /* skip invalid JSON */
          }
        }
      });

      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
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
