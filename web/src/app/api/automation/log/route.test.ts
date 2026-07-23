import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(tsv?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autonomy-log-test-"));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  if (tsv !== undefined) {
    fs.writeFileSync(path.join(dir, "data", "autonomy-log.tsv"), tsv, "utf8");
  }
  return dir;
}

async function call(root: string) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  return mod.GET();
}

const HEADER = "timestamp\treport_num\tcompany\tverdict\treason\tscore\tvendor\toutcome";

test("GET returns an empty list when the log doesn't exist", async () => {
  const root = makeTempRoot();
  const res = await call(root);
  const json = await res.json();
  assert.deepEqual(json.entries, []);
  assert.equal(json.total, 0);
});

test("GET parses rows into objects, most recent first", async () => {
  const root = makeTempRoot(
    [
      HEADER,
      "2026-07-22T10:00:00\t003\tAcme\tdraft_only\ttier_off\t2.9\tindeed\tdrafted",
      "2026-07-23T10:00:00\t006\tGlobex\tauto_submit\tok\t4.7\tgreenhouse\tsubmitted",
    ].join("\n") + "\n",
  );
  const res = await call(root);
  const json = await res.json();
  assert.equal(json.total, 2);
  assert.equal(json.entries[0].company, "Globex"); // most recent first
  assert.equal(json.entries[0].verdict, "auto_submit");
  assert.equal(json.entries[1].company, "Acme");
});

test("GET caps returned entries at 50 but reports the true total", async () => {
  const rows = Array.from(
    { length: 60 },
    (_, i) => `2026-07-${String((i % 28) + 1).padStart(2, "0")}T10:00:00\t${i}\tCo${i}\tdraft_only\ttier_off\t3.0\tindeed\tdrafted`,
  );
  const root = makeTempRoot([HEADER, ...rows].join("\n") + "\n");
  const res = await call(root);
  const json = await res.json();
  assert.equal(json.entries.length, 50);
  assert.equal(json.total, 60);
});
