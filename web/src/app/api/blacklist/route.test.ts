import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeTempRoot(blacklistMd?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blacklist-test-"));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  if (blacklistMd !== undefined) {
    fs.writeFileSync(path.join(dir, "data", "blacklist.md"), blacklistMd, "utf8");
  }
  return dir;
}

async function call(root: string, method: "GET" | "PUT", body?: unknown) {
  process.env.CAREER_OPS_ROOT = root;
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/blacklist", { method, body: body ? JSON.stringify(body) : undefined });
  return method === "GET" ? mod.GET(req) : mod.PUT(req);
}

test("GET returns an empty list when data/blacklist.md doesn't exist", async () => {
  const root = makeTempRoot();
  const res = await call(root, "GET");
  const json = await res.json();
  assert.deepEqual(json.companies, []);
});

test("GET parses existing rows, skipping header/separator", async () => {
  const root = makeTempRoot(
    "# Company Blacklist\n\nSome prose.\n\n| Company | Since | Scope | Reason |\n|---|---|---|---|\n| Acme Corp | 2026-01-15 | company | bad process |\n| Globex | 2026-02-01 | company | |\n",
  );
  const res = await call(root, "GET");
  const json = await res.json();
  assert.deepEqual(json.companies, ["Acme Corp", "Globex"]);
});

test("PUT adds a new company, creating the file with template prose if it didn't exist", async () => {
  const root = makeTempRoot();
  const res = await call(root, "PUT", { companies: ["Acme Corp"] });
  assert.equal(res.status, 200);
  const text = fs.readFileSync(path.join(root, "data", "blacklist.md"), "utf8");
  assert.match(text, /# Company Blacklist/);
  assert.match(text, /\|\s*Acme Corp\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*company\s*\|/);
});

test("PUT preserves prose above the table and existing row reasons untouched by this request", async () => {
  const root = makeTempRoot(
    "# Company Blacklist\n\nMy own custom notes go here, do not touch.\n\n| Company | Since | Scope | Reason |\n|---|---|---|---|\n| Acme Corp | 2026-01-15 | company | post-interview signals |\n",
  );
  const res = await call(root, "PUT", { companies: ["Acme Corp", "Globex"] });
  assert.equal(res.status, 200);
  const text = fs.readFileSync(path.join(root, "data", "blacklist.md"), "utf8");
  assert.match(text, /My own custom notes go here, do not touch\./);
  assert.match(text, /Acme Corp[^\n]*post-interview signals/); // existing row's reason/since survive
  assert.match(text, /\|\s*Globex\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*company\s*\|\s*\|/); // new row, blank reason
});

test("PUT removing a company drops its row entirely", async () => {
  const root = makeTempRoot(
    "# Company Blacklist\n\n| Company | Since | Scope | Reason |\n|---|---|---|---|\n| Acme Corp | 2026-01-15 | company | x |\n| Globex | 2026-02-01 | company | y |\n",
  );
  const res = await call(root, "PUT", { companies: ["Acme Corp"] });
  const json = await res.json();
  assert.deepEqual(json.companies, ["Acme Corp"]);
  const text = fs.readFileSync(path.join(root, "data", "blacklist.md"), "utf8");
  assert.doesNotMatch(text, /Globex/);
});

test("PUT caps the list at 24 companies", async () => {
  const root = makeTempRoot();
  const many = Array.from({ length: 30 }, (_, i) => `Company${i}`);
  const res = await call(root, "PUT", { companies: many });
  const json = await res.json();
  assert.equal(json.companies.length, 24);
});

test("PUT dedupes case-insensitively, keeping first occurrence's casing", async () => {
  const root = makeTempRoot();
  const res = await call(root, "PUT", { companies: ["Acme Corp", "acme corp", "ACME CORP"] });
  const json = await res.json();
  assert.deepEqual(json.companies, ["Acme Corp"]);
});
