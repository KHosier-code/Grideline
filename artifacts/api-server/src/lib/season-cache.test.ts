import test from "node:test";
import assert from "node:assert/strict";
import { seasonCache } from "./season-cache";

test("reloads only when the fingerprint changes or the copy is too old", async () => {
  let now = 0;
  let fingerprint = "a";
  let loads = 0;
  const get = seasonCache(async (season) => `${season}:${++loads}`, async () => fingerprint, 1000, () => now);
  assert.equal(await get(2026), "2026:1");
  assert.equal(await get(2026), "2026:1");
  fingerprint = "b"; // a new run or price arrived
  assert.equal(await get(2026), "2026:2");
  now = 999;
  assert.equal(await get(2026), "2026:2");
  now = 1000; // time-dependent data (kickoff locks) refreshes on its own
  assert.equal(await get(2026), "2026:3");
  assert.equal(await get(2025), "2025:4"); // each season is kept separately
});

test("visitors arriving together share one load, and failures aren't kept", async () => {
  let loads = 0;
  let fail = true;
  const get = seasonCache(async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (fail) throw new Error("database busy");
    return loads;
  }, async () => "same");
  const results = await Promise.allSettled([get(2026), get(2026), get(2026)]);
  assert.equal(loads, 1);
  assert.ok(results.every((result) => result.status === "rejected"));
  fail = false;
  assert.equal(await get(2026), 2);
  assert.equal(await get(2026), 2);
});
