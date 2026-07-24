import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(envContent?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scout-run-route-test-"));
  if (envContent !== undefined) {
    fs.writeFileSync(path.join(dir, ".env"), envContent, "utf8");
  }
  return dir;
}

async function callPost(root: string) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/scout/web-search/run", { method: "POST" });
  return mod.POST(req);
}

test("POST 400s when SERPER_API_KEY is not configured", async () => {
  const root = makeTempRoot();
  const res = await callPost(root);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /SERPER_API_KEY/i);
});

test("POST passes gate and returns streaming NDJSON when SERPER_API_KEY is configured", async () => {
  const root = makeTempRoot("SERPER_API_KEY=test_key_123\n");
  const res = await callPost(root);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/x-ndjson; charset=utf-8");
  const reader = res.body!.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
});
