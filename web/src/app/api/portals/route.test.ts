import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

// The route reads careerOpsRoot() from @/lib/career-ops, which resolves from
// CAREER_OPS_ROOT. Point it at a throwaway temp dir per test so we never touch
// the real repo's portals.yml.
function makeTempRoot(portalsYaml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portals-put-test-"));
  fs.writeFileSync(path.join(dir, "portals.yml"), portalsYaml, "utf8");
  return dir;
}

const BASE_YAML = `
title_filter:
  positive:
    - "Intern"
  negative:
    - "Senior"
location_filter:
  always_allow:
    - "India"
  block:
    - "Poland"
search_queries:
  - name: "LinkedIn — India DS/ML/GenAI"
    query: 'site:linkedin.com/jobs "Data Scientist" India'
    enabled: true
  - name: "Naukri — India DS/ML/GenAI"
    query: 'site:naukri.com "Data Scientist" India'
    enabled: false
tracked_companies:
  - name: "Indeed India — DS/ML Intern (via Apify)"
    provider: apify
    actor: misceres/indeed-scraper
    input: { position: "Data Science Intern", country: "IN", location: "Tamil Nadu", maxItems: 25 }
    field_map:
      title: [positionName, title]
      url: url
      company: [company, companyName]
      location: [location, formattedLocation]
  - name: "Palantir"
    careers_url: "https://jobs.lever.co/palantir"
    enabled: true
`;

async function callPut(root: string, body: unknown) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/portals", { method: "PUT", body: JSON.stringify(body) });
  return mod.PUT(req);
}

test("replaces title_filter positive/negative and location_filter lists", async () => {
  const root = makeTempRoot(BASE_YAML);
  const res = await callPut(root, {
    positive: ["Intern", "Machine Learning"],
    negative: ["Senior", "Staff"],
    alwaysAllow: ["India", "Coimbatore"],
    block: ["Poland"],
  });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  assert.deepEqual(doc.title_filter.positive, ["Intern", "Machine Learning"]);
  assert.deepEqual(doc.title_filter.negative, ["Senior", "Staff"]);
  assert.deepEqual(doc.location_filter.always_allow, ["India", "Coimbatore"]);
  assert.equal(doc.tracked_companies.length, 2);
});

test("updates the matched apify entry's input fields and enabled flag", async () => {
  const root = makeTempRoot(BASE_YAML);
  const res = await callPut(root, {
    apify: { enabled: false, position: "ML Intern", country: "IN", area: "Coimbatore", maxItems: 999 },
  });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  const entry = doc.tracked_companies.find((c: any) => c.provider === "apify");
  assert.equal(entry.enabled, false);
  assert.equal(entry.input.position, "ML Intern");
  assert.equal(entry.input.location, "Coimbatore");
  assert.equal(entry.input.maxItems, 50);
  const other = doc.tracked_companies.find((c: any) => c.name === "Palantir");
  assert.equal(other.careers_url, "https://jobs.lever.co/palantir");
});

test("caps positive/negative/location lists at 24 entries", async () => {
  const root = makeTempRoot(BASE_YAML);
  const many = Array.from({ length: 30 }, (_, i) => `Keyword${i}`);
  const res = await callPut(root, { positive: many });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  assert.equal(doc.title_filter.positive.length, 24);
});

test("returns 400 when apify body sent but no apify entry exists", async () => {
  const root = makeTempRoot(`
title_filter:
  positive: ["Intern"]
tracked_companies:
  - name: "Palantir"
    careers_url: "https://jobs.lever.co/palantir"
`);
  const res = await callPut(root, { apify: { enabled: true, maxItems: 25 } });
  assert.equal(res.status, 400);
});

test("refuses to write when portals.yml is malformed (409, no data loss)", async () => {
  const root = makeTempRoot("not: [valid, yaml: {{{");
  const before = fs.readFileSync(path.join(root, "portals.yml"), "utf8");
  const res = await callPut(root, { positive: ["Intern"] });
  assert.equal(res.status, 409);
  const after = fs.readFileSync(path.join(root, "portals.yml"), "utf8");
  assert.equal(after, before);
});

test("PUT addCompany appends a web-ui-tagged entry for a recognized Greenhouse URL", async () => {
  const root = makeTempRoot("title_filter:\n  positive: []\n");
  const res = await callPut(root, { addCompany: { name: "Test Co", careersUrl: "https://job-boards.greenhouse.io/testco" } });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  const entry = doc.tracked_companies.find((c: any) => c.name === "Test Co");
  assert.ok(entry);
  assert.equal(entry.careers_url, "https://job-boards.greenhouse.io/testco");
  assert.equal(entry.source, "web-ui");
  assert.equal(entry.enabled, true);
  assert.equal(entry.provider, undefined); // left for auto-detection, not hardcoded
});

test("PUT addCompany recognizes Ashby, Lever, and Workday URLs too", async () => {
  const root = makeTempRoot("title_filter:\n  positive: []\n");
  await callPut(root, { addCompany: { name: "A", careersUrl: "https://jobs.ashbyhq.com/a-co" } });
  await callPut(root, { addCompany: { name: "B", careersUrl: "https://jobs.lever.co/b-co" } });
  const res = await callPut(root, { addCompany: { name: "C", careersUrl: "https://c.wd5.myworkdayjobs.com/careers" } });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  const names = doc.tracked_companies.map((c: any) => c.name);
  assert.ok(names.includes("A") && names.includes("B") && names.includes("C"));
});

test("PUT addCompany rejects an unrecognized job-board URL", async () => {
  const root = makeTempRoot("title_filter:\n  positive: []\n");
  const res = await callPut(root, { addCompany: { name: "Nope Co", careersUrl: "https://nopeco.com/careers" } });
  assert.equal(res.status, 400);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  assert.ok(!doc.tracked_companies?.some((c: any) => c.name === "Nope Co"));
});

test("PUT addCompany rejects a duplicate careers_url among web-ui entries", async () => {
  const root = makeTempRoot("title_filter:\n  positive: []\n");
  await callPut(root, { addCompany: { name: "Test Co", careersUrl: "https://job-boards.greenhouse.io/testco" } });
  const res = await callPut(root, { addCompany: { name: "Test Co Again", careersUrl: "https://job-boards.greenhouse.io/testco" } });
  assert.equal(res.status, 409);
});

test("PUT removeCompany removes only a web-ui-tagged entry, by name", async () => {
  const root = makeTempRoot("title_filter:\n  positive: []\n");
  await callPut(root, { addCompany: { name: "Test Co", careersUrl: "https://job-boards.greenhouse.io/testco" } });
  const res = await callPut(root, { removeCompany: "Test Co" });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  assert.ok(!doc.tracked_companies?.some((c: any) => c.name === "Test Co"));
});

test("PUT removeCompany 404s on a name that isn't a web-ui-tagged entry (leaves curated entries alone)", async () => {
  const root = makeTempRoot(
    "title_filter:\n  positive: []\ntracked_companies:\n  - name: Anthropic\n    careers_url: https://job-boards.greenhouse.io/anthropic\n    enabled: true\n",
  );
  const res = await callPut(root, { removeCompany: "Anthropic" });
  assert.equal(res.status, 404);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  assert.ok(doc.tracked_companies.some((c: any) => c.name === "Anthropic")); // untouched
});

test("PUT addCompany caps web-ui-tagged companies at 30", async () => {
  const root = makeTempRoot("title_filter:\n  positive: []\n");
  for (let i = 0; i < 30; i++) {
    await callPut(root, { addCompany: { name: `Co${i}`, careersUrl: `https://job-boards.greenhouse.io/co${i}` } });
  }
  const res = await callPut(root, { addCompany: { name: "Co30", careersUrl: "https://job-boards.greenhouse.io/co30" } });
  assert.equal(res.status, 400);
});

test("PUT toggleSearchSource flips enabled on the matched search_queries entry, by name", async () => {
  const root = makeTempRoot(BASE_YAML);
  const res = await callPut(root, { toggleSearchSource: { name: "LinkedIn — India DS/ML/GenAI", enabled: false } });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  const linkedin = doc.search_queries.find((q: any) => q.name === "LinkedIn — India DS/ML/GenAI");
  assert.equal(linkedin.enabled, false);
  const naukri = doc.search_queries.find((q: any) => q.name === "Naukri — India DS/ML/GenAI");
  assert.equal(naukri.enabled, false); // untouched, was already false
  assert.equal(linkedin.query, 'site:linkedin.com/jobs "Data Scientist" India'); // query text untouched
});

test("PUT toggleSearchSource can re-enable a disabled entry", async () => {
  const root = makeTempRoot(BASE_YAML);
  const res = await callPut(root, { toggleSearchSource: { name: "Naukri — India DS/ML/GenAI", enabled: true } });
  assert.equal(res.status, 200);
  const doc = yaml.load(fs.readFileSync(path.join(root, "portals.yml"), "utf8")) as any;
  const naukri = doc.search_queries.find((q: any) => q.name === "Naukri — India DS/ML/GenAI");
  assert.equal(naukri.enabled, true);
});

test("PUT toggleSearchSource 404s on a name that doesn't exist in search_queries", async () => {
  const root = makeTempRoot(BASE_YAML);
  const res = await callPut(root, { toggleSearchSource: { name: "Nonexistent Source", enabled: true } });
  assert.equal(res.status, 404);
});

test("PUT toggleSearchSource 400s when name is blank", async () => {
  const root = makeTempRoot(BASE_YAML);
  const res = await callPut(root, { toggleSearchSource: { name: "  ", enabled: true } });
  assert.equal(res.status, 400);
});

