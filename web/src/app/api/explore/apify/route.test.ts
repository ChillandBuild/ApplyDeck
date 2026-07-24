import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(opts: { pluginsYaml?: string; env?: string } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "explore-apify-route-test-"));
  if (opts.pluginsYaml !== undefined) {
    fs.mkdirSync(path.join(dir, "config"), { recursive: true });
    fs.writeFileSync(path.join(dir, "config", "plugins.yml"), opts.pluginsYaml, "utf8");
  }
  if (opts.env !== undefined) fs.writeFileSync(path.join(dir, ".env"), opts.env, "utf8");
  return dir;
}

const ENABLED_PLUGINS = "plugins:\n  apify:\n    enabled: true\n";
const WITH_TOKEN = "APIFY_TOKEN=apify_api_test\n";

async function callPost(root: string, body: unknown) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/explore/apify", { method: "POST", body: JSON.stringify(body) });
  return mod.POST(req);
}

test("POST 400s when no keywords or platforms are given", async () => {
  const root = makeTempRoot({ pluginsYaml: ENABLED_PLUGINS, env: WITH_TOKEN });
  const res = await callPost(root, { keywords: [], platforms: ["indeed"] });
  assert.equal(res.status, 400);

  const res2 = await callPost(root, { keywords: ["Engineer"], platforms: [] });
  assert.equal(res2.status, 400);
});

test("POST 400s when the apify plugin isn't enabled", async () => {
  const root = makeTempRoot({ pluginsYaml: "plugins:\n  apify:\n    enabled: false\n", env: WITH_TOKEN });
  const res = await callPost(root, { keywords: ["Engineer"], platforms: ["indeed"] });
  assert.equal(res.status, 400);
  const d = await res.json();
  assert.match(d.error, /apify|plugin/i);
});

test("POST 400s when config/plugins.yml doesn't exist at all", async () => {
  const root = makeTempRoot({ env: WITH_TOKEN });
  const res = await callPost(root, { keywords: ["Engineer"], platforms: ["indeed"] });
  assert.equal(res.status, 400);
});

test("POST 400s when no APIFY_TOKEN is configured", async () => {
  const root = makeTempRoot({ pluginsYaml: ENABLED_PLUGINS });
  const res = await callPost(root, { keywords: ["Engineer"], platforms: ["indeed"] });
  assert.equal(res.status, 400);
  const d = await res.json();
  assert.match(d.error, /token/i);
});

test("POST passes all gates and returns a streaming NDJSON response", async () => {
  const root = makeTempRoot({ pluginsYaml: ENABLED_PLUGINS, env: WITH_TOKEN });
  const res = await callPost(root, { keywords: ["Data Scientist"], platforms: ["indeed"], location: "Remote", max: 10 });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/x-ndjson; charset=utf-8");
  const reader = res.body!.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
});
