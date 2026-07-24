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

test("GET surfaces provider:apify tracked_companies entries as apifySources, regardless of enabled", async () => {
  const root = makeTempRoot(`
tracked_companies:
  - name: "Indeed India — DS/ML Intern (via Apify)"
    provider: apify
    actor: misceres/indeed-scraper
    input: { position: "Data Science Intern" }
    enabled: true
  - name: "LinkedIn — India (via Apify)"
    provider: apify
    actor: bebity/linkedin-jobs-scraper
    enabled: false
  - name: "Palantir"
    careers_url: "https://jobs.lever.co/palantir"
`);
  const res = await callGet(root);
  const data = await res.json();
  assert.equal(data.apifySources.length, 2);
  const indeed = data.apifySources.find((s: any) => s.name === "Indeed India — DS/ML Intern (via Apify)");
  assert.equal(indeed.actor, "misceres/indeed-scraper");
  assert.equal(indeed.enabled, true);
  const linkedin = data.apifySources.find((s: any) => s.name === "LinkedIn — India (via Apify)");
  assert.equal(linkedin.enabled, false); // still present — enabled only gates cron, not the picker
});

test("GET returns an empty apifySources list when no provider:apify entries exist", async () => {
  const root = makeTempRoot(`tracked_companies:\n  - name: Anthropic\n    careers_url: https://job-boards.greenhouse.io/anthropic\n`);
  const res = await callGet(root);
  const data = await res.json();
  assert.deepEqual(data.apifySources, []);
});
