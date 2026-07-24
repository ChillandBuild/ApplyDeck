import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(envContent?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "serper-key-route-test-"));
  if (envContent !== undefined) {
    fs.writeFileSync(path.join(dir, ".env"), envContent, "utf8");
  }
  return dir;
}

async function callGet(root: string) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  return mod.GET();
}

async function callPut(root: string, body: unknown) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/secrets/serper-key", { method: "PUT", body: JSON.stringify(body) });
  return mod.PUT(req);
}

test("GET returns configured: false when .env does not exist", async () => {
  const root = makeTempRoot();
  const res = await callGet(root);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.configured, false);
});

test("GET returns configured: true when SERPER_API_KEY is present in .env", async () => {
  const root = makeTempRoot("SERPER_API_KEY=test_key_123\n");
  const res = await callGet(root);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.configured, true);
});

test("PUT sets SERPER_API_KEY in .env", async () => {
  const root = makeTempRoot();
  const res = await callPut(root, { key: "serper_test_456" });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.configured, true);
  const content = fs.readFileSync(path.join(root, ".env"), "utf8");
  assert.match(content, /SERPER_API_KEY=serper_test_456/);
});

test("PUT clears SERPER_API_KEY in .env when empty string passed", async () => {
  const root = makeTempRoot("SERPER_API_KEY=test_key_123\nOTHER_VAR=1\n");
  const res = await callPut(root, { key: "" });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.configured, false);
  const content = fs.readFileSync(path.join(root, ".env"), "utf8");
  assert.doesNotMatch(content, /SERPER_API_KEY=/);
  assert.match(content, /OTHER_VAR=1/);
});
