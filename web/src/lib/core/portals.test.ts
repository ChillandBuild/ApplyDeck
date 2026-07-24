import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPortalsDoc } from "./portals";

function makeTempRoot(content?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portals-doc-test-"));
  if (content !== undefined) fs.writeFileSync(path.join(dir, "portals.yml"), content, "utf8");
  return dir;
}

test("readPortalsDoc returns exists:false and an empty doc when portals.yml is absent", () => {
  const root = makeTempRoot();
  const r = readPortalsDoc(root);
  assert.deepEqual(r, { doc: {}, exists: false, malformed: false });
});

test("readPortalsDoc parses a valid document", () => {
  const root = makeTempRoot("title_filter:\n  positive:\n    - Intern\n");
  const r = readPortalsDoc(root);
  assert.equal(r.exists, true);
  assert.equal(r.malformed, false);
  assert.deepEqual((r.doc.title_filter as { positive: string[] }).positive, ["Intern"]);
});

test("readPortalsDoc reports malformed:true on invalid YAML, without throwing", () => {
  const root = makeTempRoot("not: [valid, yaml: {{{");
  const r = readPortalsDoc(root);
  assert.equal(r.exists, true);
  assert.equal(r.malformed, true);
  assert.deepEqual(r.doc, {});
});

test("readPortalsDoc treats a non-object document (e.g. a bare list) as an empty doc, not malformed", () => {
  const root = makeTempRoot("- just\n- a\n- list\n");
  const r = readPortalsDoc(root);
  assert.equal(r.exists, true);
  assert.equal(r.malformed, false);
  assert.deepEqual(r.doc, {});
});
