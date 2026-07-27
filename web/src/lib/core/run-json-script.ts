import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

/**
 * Run a core root script with `--json` and parse its stdout — the same
 * scripts the CLI uses, so results never drift from what `node {name}.mjs`
 * would print. Returns null on any failure (script missing, non-zero exit,
 * unparseable output) so callers can render a graceful empty state instead
 * of crashing the page.
 */
export async function runJsonScript<T = unknown>(nameNoExt: string, timeoutMs = 15_000): Promise<T | null> {
  const script = rootScript(nameNoExt);
  if (!fs.existsSync(script)) return null;

  const stdout = await new Promise<string>((resolve) => {
    execFile("node", [script, "--json"], { cwd: careerOpsRoot(), timeout: timeoutMs }, (_err, out) => resolve(out || ""));
  });

  try {
    const start = stdout.indexOf("{");
    if (start === -1) return null;
    return JSON.parse(stdout.slice(start)) as T;
  } catch {
    return null;
  }
}
