import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(portalsYaml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portals-snapshot-test-"));
  fs.writeFileSync(path.join(dir, "portals.yml"), portalsYaml, "utf8");
  return dir;
}

async function callGet(root: string) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  return mod.GET();
}

test("GET surfaces search_queries entries as searchSources with name/query/enabled", async () => {
  const root = makeTempRoot(`
title_filter:
  positive: ["Intern"]
search_queries:
  - name: "LinkedIn — India DS/ML/GenAI"
    query: 'site:linkedin.com/jobs "Data Scientist" India'
    enabled: true
  - name: "Naukri — India DS/ML/GenAI"
    query: 'site:naukri.com "Data Scientist" India'
    enabled: false
`);
  const res = await callGet(root);
  const data = await res.json();
  assert.equal(data.searchSources.length, 2);
  const linkedin = data.searchSources.find((s: any) => s.name === "LinkedIn — India DS/ML/GenAI");
  assert.equal(linkedin.enabled, true);
  assert.equal(linkedin.query, 'site:linkedin.com/jobs "Data Scientist" India');
  const naukri = data.searchSources.find((s: any) => s.name === "Naukri — India DS/ML/GenAI");
  assert.equal(naukri.enabled, false);
});

test("GET defaults searchSources enabled to true when the field is absent", async () => {
  const root = makeTempRoot(`
search_queries:
  - name: "Glassdoor — India DS/ML/GenAI"
    query: 'site:glassdoor.com "Data Scientist" India'
`);
  const res = await callGet(root);
  const data = await res.json();
  assert.equal(data.searchSources[0].enabled, true);
});

test("GET returns an empty searchSources list when portals.yml has no search_queries", async () => {
  const root = makeTempRoot(`title_filter:\n  positive: ["Intern"]\n`);
  const res = await callGet(root);
  const data = await res.json();
  assert.deepEqual(data.searchSources, []);
});

test("GET returns empty snapshot (with empty searchSources) when portals.yml is absent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portals-snapshot-missing-"));
  const res = await callGet(dir);
  const data = await res.json();
  assert.deepEqual(data.searchSources, []);
  assert.deepEqual(data.companies, []);
});
