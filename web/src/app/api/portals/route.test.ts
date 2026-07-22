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
