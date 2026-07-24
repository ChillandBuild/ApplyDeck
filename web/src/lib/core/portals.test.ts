import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { getApifySearchConfig, updateApifySearchConfig } from "./portals";

function makeTempRoot(portalsContent?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portals-test-"));
  if (portalsContent !== undefined) {
    fs.writeFileSync(path.join(dir, "portals.yml"), portalsContent, "utf8");
  }
  return dir;
}

test("getApifySearchConfig returns sensible defaults when apify_search block is missing", () => {
  const root = makeTempRoot();
  const cfg = getApifySearchConfig(root);
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.keywords, []);
  assert.deepEqual(cfg.platforms, ["indeed"]);
  assert.equal(cfg.location, "");
  assert.equal(cfg.country, "US");
  assert.equal(cfg.max, 20);
});

test("updateApifySearchConfig updates apify_search block while preserving top-level keys", () => {
  const initialYaml = `
tracked_companies:
  - name: "Acme Corp"
search_queries:
  - query: "site:greenhouse.io Acme"
`;
  const root = makeTempRoot(initialYaml);
  updateApifySearchConfig(root, {
    enabled: true,
    keywords: ["Backend Engineer"],
    platforms: ["indeed", "glassdoor"],
    location: "Remote",
    country: "US",
    max: 25,
  });

  const cfg = getApifySearchConfig(root);
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.keywords, ["Backend Engineer"]);
  assert.deepEqual(cfg.platforms, ["indeed", "glassdoor"]);
  assert.equal(cfg.location, "Remote");
  assert.equal(cfg.max, 25);

  const fileContent = fs.readFileSync(path.join(root, "portals.yml"), "utf8");
  const doc = yaml.load(fileContent) as Record<string, unknown>;
  assert.ok(Array.isArray(doc.tracked_companies));
  assert.ok(Array.isArray(doc.search_queries));
});
