import test from "node:test";
import assert from "node:assert/strict";
import { commitsByStamp, datedReceipts, listReceipts, parseReceiptPath, stampTime } from "./receipts-restore";

const commit = (sha: string, message: string, date: string) => ({ sha, commit: { message, committer: { date } } });

test("receipt paths give the season, week, run time and kind", () => {
  assert.deepEqual(parseReceiptPath("2026/week-05/2026-10-11T12-18-05Z-games.json"),
    { path: "2026/week-05/2026-10-11T12-18-05Z-games.json", season: 2026, week: 5, stamp: "2026-10-11T12-18-05Z", kind: "games" });
  assert.equal(parseReceiptPath("README.md"), null);
  assert.equal(parseReceiptPath("2026/week-00/2026-10-11T12-18-05Z-games.json"), null);
  assert.equal(parseReceiptPath("2026/week-05/2026-10-11T12-18-05Z-props.json"), null);
  assert.equal(stampTime("2026-10-11T12-18-05Z").toISOString(), "2026-10-11T12:18:05.000Z");
});

test("each run is dated by the commit that first published it", () => {
  const byStamp = commitsByStamp([
    commit("b", "Receipts 2026-10-11T12-18-05Z", "2026-10-11T12:18:07Z"),
    commit("a", "Receipts 2026-10-11T12-18-05Z", "2026-10-11T12:18:06Z"),
    commit("c", "Fix README", "2026-10-12T00:00:00Z"),
  ]);
  assert.equal(byStamp.size, 1);
  assert.equal(byStamp.get("2026-10-11T12-18-05Z")?.sha, "a");
});

test("files without a matching, plausible commit are left out", () => {
  const byStamp = commitsByStamp([
    commit("a", "Receipts 2026-10-04T20-34-33Z", "2026-10-04T20:34:34Z"),
    // Committed before the run it claims: not how the workflow writes receipts.
    commit("b", "Receipts 2026-10-05T23-14-40Z", "2026-10-05T23:00:00Z"),
  ]);
  const { files, skipped } = datedReceipts([
    "README.md",
    "2026/week-04/2026-10-04T20-34-33Z-touchdowns.json",
    "2026/week-04/2026-10-04T20-34-33Z-games.json",
    "2026/week-05/2026-10-05T23-14-40Z-games.json",
    "2026/week-05/2026-10-06T14-09-02Z-games.json",
  ], byStamp);
  assert.deepEqual(files.map((file) => [file.path, file.sha, file.committedAt.toISOString()]), [
    ["2026/week-04/2026-10-04T20-34-33Z-games.json", "a", "2026-10-04T20:34:34.000Z"],
    ["2026/week-04/2026-10-04T20-34-33Z-touchdowns.json", "a", "2026-10-04T20:34:34.000Z"],
  ]);
  assert.deepEqual(skipped.map((item) => item.reason), ["commit time does not match the run", "no matching commit"]);
});

test("listing reads the branch tree and every page of commits", async () => {
  const commits = Array.from({ length: 100 }, (_, index) => commit(`x${index}`, "Other", "2026-10-01T00:00:00Z"));
  const calls: string[] = [];
  const fake = (async (url: string) => {
    calls.push(url);
    if (url.includes("/git/trees/")) return Response.json({ tree: [{ path: "2026/week-04/2026-10-02T22-07-28Z-games.json", type: "blob" }, { path: "2026", type: "tree" }] });
    if (url.endsWith("&page=1")) return Response.json(commits);
    return Response.json([commit("first", "Receipts 2026-10-02T22-07-28Z", "2026-10-02T22:07:29Z")]);
  }) as typeof fetch;
  const { files } = await listReceipts(fake);
  assert.equal(calls.length, 3);
  assert.deepEqual(files.map((file) => file.sha), ["first"]);
});
