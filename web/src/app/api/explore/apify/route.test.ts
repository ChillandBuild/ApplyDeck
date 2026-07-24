import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(opts: { portalsYaml?: string; pluginsYaml?: string; env?: string } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "explore-apify-route-test-"));
  if (opts.portalsYaml !== undefined) fs.writeFileSync(path.join(dir, "portals.yml"), opts.portalsYaml, "utf8");
  if (opts.pluginsYaml !== undefined) {
    fs.mkdirSync(path.join(dir, "config"), { recursive: true });
    fs.writeFileSync(path.join(dir, "config", "plugins.yml"), opts.pluginsYaml, "utf8");
  }
  if (opts.env !== undefined) fs.writeFileSync(path.join(dir, ".env"), opts.env, "utf8");
  return dir;
}

const ENABLED_PLUGINS = "plugins:\n  apify:\n    enabled: true\n";
const WITH_TOKEN = "APIFY_TOKEN=apify_api_test\n";
const PORTALS_WITH_ENTRY = `
tracked_companies:
  - name: "LinkedIn — India (via Apify)"
    provider: apify
    actor: bebity/linkedin-jobs-scraper
    input: { keywords: "Data Scientist" }
    field_map: { title: title, url: url }
`;

async function callPost(root: string, body: unknown) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/explore/apify", { method: "POST", body: JSON.stringify(body) });
  return mod.POST(req);
}

test("POST 400s when no sources are given", async () => {
  const root = makeTempRoot({ portalsYaml: PORTALS_WITH_ENTRY, pluginsYaml: ENABLED_PLUGINS, env: WITH_TOKEN });
  const res = await callPost(root, { sources: [] });
  assert.equal(res.status, 400);
});

test("POST 400s when the apify plugin isn't enabled", async () => {
  const root = makeTempRoot({ portalsYaml: PORTALS_WITH_ENTRY, pluginsYaml: "plugins:\n  apify:\n    enabled: false\n", env: WITH_TOKEN });
  const res = await callPost(root, { sources: ["LinkedIn — India (via Apify)"] });
  assert.equal(res.status, 400);
  const d = await res.json();
  assert.match(d.error, /apify|plugin/i);
});

test("POST 400s when config/plugins.yml doesn't exist at all", async () => {
  const root = makeTempRoot({ portalsYaml: PORTALS_WITH_ENTRY, env: WITH_TOKEN });
  const res = await callPost(root, { sources: ["LinkedIn — India (via Apify)"] });
  assert.equal(res.status, 400);
});

test("POST 400s when no APIFY_TOKEN is configured", async () => {
  const root = makeTempRoot({ portalsYaml: PORTALS_WITH_ENTRY, pluginsYaml: ENABLED_PLUGINS });
  const res = await callPost(root, { sources: ["LinkedIn — India (via Apify)"] });
  assert.equal(res.status, 400);
  const d = await res.json();
  assert.match(d.error, /token/i);
});

test("POST 400s when none of the requested source names match a provider:apify entry", async () => {
  const root = makeTempRoot({ portalsYaml: PORTALS_WITH_ENTRY, pluginsYaml: ENABLED_PLUGINS, env: WITH_TOKEN });
  const res = await callPost(root, { sources: ["Nonexistent Source"] });
  assert.equal(res.status, 400);
});

test("POST passes all gates and returns a streaming NDJSON response", async () => {
  const root = makeTempRoot({ portalsYaml: PORTALS_WITH_ENTRY, pluginsYaml: ENABLED_PLUGINS, env: WITH_TOKEN });
  const res = await callPost(root, { sources: ["LinkedIn — India (via Apify)"] });
  // Gates all pass, so the route spawns explore-apify.mjs with a fake token —
  // the spawned process will itself fail against the real Apify API (no
  // network mocking here), but the ROUTE's job (gate checks + starting the
  // stream) is what this test verifies, matching this repo's existing
  // precedent of not unit-testing the spawn/network behavior of streaming
  // discovery routes (/api/explore, /api/explore/ai have no route.test.ts
  // for the same reason). explore-apify.mjs's own logic is covered by
  // tests/explore-apify.test.mjs (Task 4) with a fully injected runActorFn.
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/x-ndjson; charset=utf-8");
  // Drain the stream so the spawned child (which will exit quickly on a
  // fake token) doesn't linger past the test.
  const reader = res.body!.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
});
