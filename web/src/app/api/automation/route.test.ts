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

test("GET returns safety-field defaults when automation block is absent", async () => {
  const root = makeTempRoot("candidate:\n  full_name: Test\n");
  const res = await call(root, "GET");
  const json = await res.json();
  assert.equal(json.scoreThreshold, 4.5);
  assert.equal(json.dailySubmitCap, 3);
  assert.equal(json.perRunCap, 2);
  assert.deepEqual(json.companyAllowlist, []);
  assert.deepEqual(json.safeVendors, ["greenhouse", "ashby"]);
});

test("PUT writes all five safety fields and preserves tier/scheduleHours", async () => {
  const root = makeTempRoot(`
automation:
  tier: autonomous
  score_threshold: 4.5
  daily_submit_cap: 3
  per_run_cap: 2
  company_allowlist: []
  safe_vendors: [greenhouse, ashby]
  schedule_hours: 6
`);
  const res = await call(root, "PUT", {
    scoreThreshold: 4.2,
    dailySubmitCap: 5,
    perRunCap: 3,
    companyAllowlist: ["Perplexity", "Faculty"],
    safeVendors: ["greenhouse", "lever"],
  });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8")) as any;
  assert.equal(doc.automation.score_threshold, 4.2);
  assert.equal(doc.automation.daily_submit_cap, 5);
  assert.equal(doc.automation.per_run_cap, 3);
  assert.deepEqual(doc.automation.company_allowlist, ["Perplexity", "Faculty"]);
  assert.deepEqual(doc.automation.safe_vendors, ["greenhouse", "lever"]);
  assert.equal(doc.automation.tier, "autonomous"); // untouched by this PUT
  assert.equal(doc.automation.schedule_hours, 6); // untouched — wasn't in the body
});

test("PUT sets tier to autonomous when given a valid value", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { tier: "autonomous" });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.tier, "autonomous");
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8")) as any;
  assert.equal(doc.automation.tier, "autonomous");
});

test("PUT sets tier back to draft when given a valid value", async () => {
  const root = makeTempRoot("automation:\n  tier: autonomous\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { tier: "draft" });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8")) as any;
  assert.equal(doc.automation.tier, "draft");
});

test("PUT rejects an invalid tier value — 400, no write, unrelated fields also not applied", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  score_threshold: 4.5\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { tier: "yolo", scoreThreshold: 2.0 });
  assert.equal(res.status, 400);
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8")) as any;
  assert.equal(doc.automation.tier, "draft"); // unchanged
  assert.equal(doc.automation.score_threshold, 4.5); // unchanged — the whole request was rejected
});

test("PUT omitting tier leaves the existing tier untouched", async () => {
  const root = makeTempRoot("automation:\n  tier: autonomous\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { scoreThreshold: 4.0 });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8")) as any;
  assert.equal(doc.automation.tier, "autonomous"); // untouched — wasn't in the body
});

test("PUT clamps score_threshold to [1, 5]", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { scoreThreshold: 9.9 });
  const json = await res.json();
  assert.equal(json.scoreThreshold, 5);
  const res2 = await call(root, "PUT", { scoreThreshold: 0 });
  const json2 = await res2.json();
  assert.equal(json2.scoreThreshold, 1);
});

test("PUT clamps daily_submit_cap and per_run_cap to [0, 20]", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { dailySubmitCap: 999, perRunCap: -5 });
  const json = await res.json();
  assert.equal(json.dailySubmitCap, 20);
  assert.equal(json.perRunCap, 0);
});

test("PUT rejects unknown vendor strings, keeping only the closed set", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const res = await call(root, "PUT", { safeVendors: ["greenhouse", "totallyMadeUp", "lever"] });
  const json = await res.json();
  assert.deepEqual(json.safeVendors, ["greenhouse", "lever"]);
});

test("PUT caps company_allowlist at 24 entries", async () => {
  const root = makeTempRoot("automation:\n  tier: draft\n  schedule_hours: 6\n");
  const many = Array.from({ length: 30 }, (_, i) => `Company${i}`);
  const res = await call(root, "PUT", { companyAllowlist: many });
  const json = await res.json();
  assert.equal(json.companyAllowlist.length, 24);
});

test("PUT still refuses malformed profile.yml (409, no data loss) with safety fields in the body", async () => {
  const root = makeTempRoot("not: [valid, yaml: {{{");
  const before = fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8");
  const res = await call(root, "PUT", { scoreThreshold: 4.0, dailySubmitCap: 5 });
  assert.equal(res.status, 409);
  const after = fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8");
  assert.equal(after, before);
});

