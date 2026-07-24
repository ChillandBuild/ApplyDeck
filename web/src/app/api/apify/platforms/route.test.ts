import { test } from "node:test";
import assert from "node:assert/strict";

async function callGet() {
  const mod = await import(`./route.ts?t=${Date.now()}`);
  const req = new Request("http://x/api/apify/platforms", { method: "GET" });
  return mod.GET(req);
}

test("GET /api/apify/platforms returns list of platform metadata", async () => {
  const res = await callGet();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.platforms));
  assert.equal(data.platforms.length, 4);
  const ids = data.platforms.map((p: { id: string }) => p.id);
  assert.ok(ids.includes("indeed"));
  assert.ok(ids.includes("linkedin"));
});
