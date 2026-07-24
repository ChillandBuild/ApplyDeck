import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isApifyPluginEnabled, isApifyTokenConfigured } from "./apify-discover";

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apify-discover-test-"));
}

test("isApifyPluginEnabled is false when config/plugins.yml doesn't exist", () => {
  const root = makeTempRoot();
  assert.equal(isApifyPluginEnabled(root), false);
});

test("isApifyPluginEnabled is false when apify isn't enabled", () => {
  const root = makeTempRoot();
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config", "plugins.yml"), "plugins:\n  apify:\n    enabled: false\n");
  assert.equal(isApifyPluginEnabled(root), false);
});

test("isApifyPluginEnabled is true when apify is enabled", () => {
  const root = makeTempRoot();
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config", "plugins.yml"), "plugins:\n  apify:\n    enabled: true\n");
  assert.equal(isApifyPluginEnabled(root), true);
});

test("isApifyPluginEnabled is false on malformed YAML, never throws", () => {
  const root = makeTempRoot();
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config", "plugins.yml"), "not: [valid: {{{");
  assert.equal(isApifyPluginEnabled(root), false);
});

test("isApifyTokenConfigured is false when .env doesn't exist", () => {
  const root = makeTempRoot();
  assert.equal(isApifyTokenConfigured(root), false);
});

test("isApifyTokenConfigured is true when APIFY_TOKEN is set", () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, ".env"), "OTHER=1\nAPIFY_TOKEN=apify_api_abc123\n");
  assert.equal(isApifyTokenConfigured(root), true);
});

test("isApifyTokenConfigured is false when the line is present but empty", () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, ".env"), "APIFY_TOKEN=\n");
  assert.equal(isApifyTokenConfigured(root), false);
});
