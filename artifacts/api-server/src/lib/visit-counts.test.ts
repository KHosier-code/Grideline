import test from "node:test";
import assert from "node:assert/strict";
import { addVisit, visitDay, visitPage } from "./visit-counts";

test("pages are grouped, and unknown paths can't add new keys", () => {
  assert.equal(visitPage("/"), "home");
  assert.equal(visitPage("/td/josh-allen?utm_source=x"), "td-player");
  assert.equal(visitPage("/games/401873052"), "game");
  assert.equal(visitPage("/pools/bowls/"), "bowls");
  assert.equal(visitPage("/cbb/ratings"), "cbb-ratings");
  assert.equal(visitPage("/admin/secret"), "other");
  assert.equal(visitPage("/../../etc/passwd"), "other");
});

test("views, visitors, returning visitors, sources and events add up", () => {
  let counts = addVisit({}, { page: "/", first: true, source: "google" });
  counts = addVisit(counts, { page: "/touchdowns" });
  counts = addVisit(counts, { page: "/pools/bowls", first: true, returning: true });
  counts = addVisit(counts, { page: "/pools/bowls", event: "bowl_sheet_built", detail: "confidence-25-mixed" });
  counts = addVisit(counts, { page: "/pools/bowls", event: "bowl_sheet_built", detail: "Bad Detail!" });
  assert.deepEqual(counts, {
    views: { home: 1, touchdowns: 1, bowls: 1 },
    visitors: 2, returning: 1,
    sources: { google: 1, direct: 1 },
    events: { bowl_sheet_built: 2 },
    details: { "bowl_sheet_built:confidence-25-mixed": 1 },
  });
});

test("days are Eastern calendar days", () => {
  assert.equal(visitDay(new Date("2026-12-07T04:30:00Z")), "2026-12-06");
  assert.equal(visitDay(new Date("2026-12-07T05:30:00Z")), "2026-12-07");
});
