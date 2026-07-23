import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(envContent?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apify-token-test-"));
  if (envContent !== undefined) {
    fs.writeFileSync(path.join(dir, ".env"), envContent, "utf8");
  }
  return dir;
}

async function call(root: string, method: "GET" | "PUT", body?: unknown) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/secrets/apify-token", { method, body: body ? JSON.stringify(body) : undefined });
  return method === "GET" ? mod.GET(req) : mod.PUT(req);
}

test("GET reports not configured when .env doesn't exist", async () => {
  const root = makeTempRoot();
  const res = await call(root, "GET");
  const json = await res.json();
  assert.equal(json.configured, false);
});

test("GET reports not configured when .env exists but has no APIFY_TOKEN line", async () => {
  const root = makeTempRoot("GEMINI_API_KEY=abc123\n");
  const res = await call(root, "GET");
  const json = await res.json();
  assert.equal(json.configured, false);
});

test("PUT sets the token, creating .env if missing, and GET never echoes the value", async () => {
  const root = makeTempRoot();
  const putRes = await call(root, "PUT", { token: "apify_api_secretvalue123" });
  assert.equal(putRes.status, 200);
  const putJson = await putRes.json();
  assert.equal(putJson.token, undefined);
  const getRes = await call(root, "GET");
  const getJson = await getRes.json();
  assert.equal(getJson.configured, true);
  assert.equal(getJson.token, undefined);
  const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
  assert.match(envText, /APIFY_TOKEN=apify_api_secretvalue123/);
});

test("PUT preserves other lines in .env when setting the token", async () => {
  const root = makeTempRoot("GEMINI_API_KEY=abc123\n# a comment\n");
  await call(root, "PUT", { token: "apify_api_xyz" });
  const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
  assert.match(envText, /GEMINI_API_KEY=abc123/);
  assert.match(envText, /# a comment/);
  assert.match(envText, /APIFY_TOKEN=apify_api_xyz/);
});

test("PUT replaces an existing token rather than duplicating the line", async () => {
  const root = makeTempRoot("APIFY_TOKEN=old_value\n");
  await call(root, "PUT", { token: "new_value" });
  const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
  const matches = envText.match(/^APIFY_TOKEN=/gm) ?? [];
  assert.equal(matches.length, 1);
  assert.match(envText, /APIFY_TOKEN=new_value/);
});

test("PUT with an empty token clears it (line removed, other lines preserved)", async () => {
  const root = makeTempRoot("GEMINI_API_KEY=abc123\nAPIFY_TOKEN=old_value\n");
  const res = await call(root, "PUT", { token: "" });
  assert.equal(res.status, 200);
  const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
  assert.doesNotMatch(envText, /APIFY_TOKEN=/);
  assert.match(envText, /GEMINI_API_KEY=abc123/);
  const getRes = await call(root, "GET");
  const getJson = await getRes.json();
  assert.equal(getJson.configured, false);
});

test("PUT rejects a token containing whitespace", async () => {
  const root = makeTempRoot();
  const res = await call(root, "PUT", { token: "has a space" });
  assert.equal(res.status, 400);
});
