import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

function makeTempRoot(profileYaml?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "automation-test-"));
  fs.mkdirSync(path.join(dir, "config"), { recursive: true });
  if (profileYaml !== undefined) {
    fs.writeFileSync(path.join(dir, "config", "profile.yml"), profileYaml, "utf8");
  }
  return dir;
}

async function call(root: string, method: "GET" | "PUT", body?: unknown) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/automation", { method, body: body ? JSON.stringify(body) : undefined });
  return method === "GET" ? mod.GET(req) : mod.PUT(req);
}

test("GET returns defaults when profile.yml has no automation block", async () => {
  const root = makeTempRoot("candidate:\n  full_name: Test\n");
  const res = await call(root, "GET");
  const json = await res.json();
  assert.equal(json.tier, "draft");
  assert.equal(json.scheduleHours, 6);
});

test("PUT writes schedule_hours and preserves the rest of the automation block", async () => {
  const root = makeTempRoot(`
automation:
  tier: draft
  score_threshold: 4.5
  daily_submit_cap: 3
  schedule_hours: 6
`);
  const res = await call(root, "PUT", { scheduleHours: 12 });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8")) as any;
  assert.equal(doc.automation.schedule_hours, 12);
  assert.equal(doc.automation.tier, "draft");
  assert.equal(doc.automation.score_threshold, 4.5);
});

test("PUT clamps out-of-range values", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { scheduleHours: 999 });
  const json = await res.json();
  assert.equal(json.scheduleHours, 168);
});

test("PUT refuses to write when profile.yml is malformed", async () => {
  const root = makeTempRoot("not: [valid, yaml: {{{");
  const res = await call(root, "PUT", { scheduleHours: 12 });
  assert.equal(res.status, 409);
});
