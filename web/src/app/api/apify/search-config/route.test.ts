import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(portalsContent?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "search-config-route-test-"));
  if (portalsContent !== undefined) {
    fs.writeFileSync(path.join(dir, "portals.yml"), portalsContent, "utf8");
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
  const req = new Request("http://x/api/apify/search-config", { method: "PUT", body: JSON.stringify(body) });
  return mod.PUT(req);
}

test("GET returns current apify_search config from portals.yml", async () => {
  const root = makeTempRoot();
  const res = await callGet(root);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.enabled, true);
  assert.deepEqual(data.platforms, ["indeed"]);
});

test("PUT updates apify_search config in portals.yml", async () => {
  const root = makeTempRoot();
  const res = await callPut(root, {
    enabled: true,
    keywords: ["Data Scientist"],
    platforms: ["indeed", "glassdoor"],
    location: "Remote",
    max: 30,
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.deepEqual(data.config.keywords, ["Data Scientist"]);
  assert.deepEqual(data.config.platforms, ["indeed", "glassdoor"]);
});
