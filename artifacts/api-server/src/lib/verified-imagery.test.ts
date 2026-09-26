import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { approvedPlayerHeadshotUrl, approvedReviewUrl, createImageRefreshGate, IMAGE_PARSER_VERSION, parseImageCsv, PLAYER_HEADSHOT_RIGHTS, reconcilePlayerImages, reconcileTeamImages, playerHeadshot, safeImageUrl, staleVerifiedImages, validPersistedImageRows } from "./verified-imagery";

test("a cold or timed-out image source never blocks consumer responses and retries are bounded", async () => {
  let finish!: () => void;
  let now = 1000;
  let calls = 0;
  const refresh = createImageRefreshGate(() => {
    calls++;
    return new Promise<void>(resolve => { finish = resolve; });
  }, () => now);
  const started = Date.now();
  refresh(true);
  assert.equal(staleVerifiedImages(null, [team("a", "A", "A")]), null);
  assert.ok(Date.now() - started < 100, "no remote image work belongs in the read path");
  await Promise.resolve();
  assert.equal(calls, 1);
  refresh(true);
  assert.equal(calls, 1, "parallel requests share one refresh");
  finish();
  await new Promise(resolve => setImmediate(resolve));
  refresh(true);
  assert.equal(calls, 1, "a completed but failed or stale refresh cannot stampede requests");
  now += 5 * 60_000;
  refresh(true);
  await Promise.resolve();
  assert.equal(calls, 2);
  finish();
});

const url = (id: string) => `https://images.example.org/${id}.png`;
const team = (teamId: string, abbreviation: string, name: string) => ({ teamId, abbreviation, name });
const source = (team_abbr: string, team_name: string, team_logo_espn: string) => ({ team_abbr, team_name, team_logo_espn });
const player = (gsis_id: string, espn_id: string, headshot_url: string, extras = {}) =>
  ({ gsis_id, espn_id, headshot_url, pfr_id: "", pff_id: "", esb_id: "", smart_id: "", ...extras });

test("CSV parser validates headers, escaped quotes, and completeness", () => {
  assert.deepEqual(parseImageCsv('team_abbr,team_name,team_logo_espn\r\nLA,"Los Angeles ""Rams""",https://x.example/a.png\r\n',
    ["team_abbr", "team_name", "team_logo_espn"])[0], source("LA", 'Los Angeles "Rams"', "https://x.example/a.png"));
  assert.throws(() => parseImageCsv("gsis_id,headshot_url\n\"unterminated", ["gsis_id", "headshot_url"]), /Truncated/);
  assert.throws(() => parseImageCsv("gsis_id\nA", ["gsis_id", "espn_id"]), /missing headers/);
});

test("team aliases work in either direction without replacing schedule IDs", () => {
  const schedule = [team("schedule-la", "LAR", "Los Angeles Rams")];
  const images = reconcileTeamImages(schedule, [
    source("LA", "Los Angeles Rams", url("rams")),
    source("SD", "San Diego Chargers", url("chargers")),
    source("WAS", "Washington Commanders", url("washington")),
    source("OAK", "Oakland Raiders", url("vegas")),
  ]);
  assert.deepEqual([...images.logos.keys()], schedule.map(row => row.teamId));
  assert.equal(images.logos.get("schedule-la"), url("rams"));
  assert.equal(reconcileTeamImages([team("espn-la", "LA", "Los Angeles Rams")],
    [source("LAR", "Los Angeles Rams", url("rams"))]).logos.get("espn-la"), url("rams"));
});

test("team conflicts, missing URLs and unknown clubs never assign a logo", () => {
  const teams = [team("a", "LA", "Los Angeles Rams"), team("b", "LAC", "Los Angeles Chargers")];
  const result = reconcileTeamImages(teams, [
    source("LA", "Los Angeles Chargers", url("wrong")), source("UNK", "Unknown", url("unknown")),
  ]);
  assert.equal(result.logos.size, 0);
  assert.equal(result.ambiguous.length, 1);
  assert.ok(result.unmatched.some(row => row.id.startsWith("UNK")));
  assert.equal(reconcileTeamImages([teams[0]], [source("LA", "Los Angeles Rams", url("a")), source("LAR", "Los Angeles Rams", url("b"))]).logos.size, 0);
  assert.equal(safeImageUrl("javascript:alert(1)"), null);
  assert.equal(safeImageUrl("http://images.example.org/a"), null);
});

test("GSIS, ESPN and PFR resolve exactly; non-fantasy positions remain eligible", () => {
  const reconciled = reconcilePlayerImages([
    player("00-1", "100", url("lineman")),
    player("", "200", url("kicker")),
    player("00-3", "", ""),
  ], [
    { gsisId: "00-1", espnId: "100", pfrId: "Line01", pffId: null, esbId: null, smartId: null },
    { gsisId: "00-2", espnId: "200", pfrId: null, pffId: null, esbId: null, smartId: null },
  ]);

  assert.equal(reconciled.photos.get("00-1"), url("lineman"));
  assert.equal(reconciled.photos.get("00-2"), url("kicker"));
  for (const id of ["00-1", "100", "Line01", "200", "00-2"])
    assert.equal(playerHeadshot(id, reconciled), null, `unlicensed image must not be served for ${id}`);
  assert.equal(playerHeadshot("00-3", reconciled), null);
  assert.ok(reconciled.missingUrl.some(issue => issue.id === "00-3"));
});

test("NFL-hosted and unknown headshots fail closed despite verified identity", () => {
  const nflUrl = "https://static.www.nfl.com/image/upload/league/some-image";
  const mapped = reconcilePlayerImages([player("00-1", "100", nflUrl)], [
    { gsisId: "00-1", espnId: "100", pfrId: null, pffId: null, esbId: null, smartId: null },
  ]);

  const identity = (gsisId: string, espnId: string) =>
    ({ gsisId, espnId, pfrId: null, pffId: null, esbId: null, smartId: null });
  assert.deepEqual(PLAYER_HEADSHOT_RIGHTS.approvedHosts, []);
  assert.equal(mapped.photos.get("00-1"), nflUrl);
  assert.deepEqual(mapped.unapprovedHosts, [{ host: "static.www.nfl.com", rows: 1 }]);
  assert.equal(playerHeadshot("00-1", mapped), null);
  assert.equal(playerHeadshot("100", mapped), null);
  assert.equal(approvedPlayerHeadshotUrl(url("other")), null);
  assert.equal(approvedPlayerHeadshotUrl("https://static.www.nfl.com.evil.test/photo"), null);
  assert.equal(approvedPlayerHeadshotUrl("http://static.www.nfl.com/photo"), null);
  assert.equal(approvedPlayerHeadshotUrl("https://user@static.www.nfl.com/photo"), null);
});

test("pixel review is player and source specific; rejection and host rights fail closed", () => {
  const sourceHash = "a".repeat(64);
  const imageHash = "b".repeat(64);
  const imageUrl = "https://static.www.nfl.com/player.jpg";
  const approvals = new Map([["00-1", { sourceHash, imageUrl, imageHash, decision: "approved" }]]);
  assert.equal(approvedReviewUrl("00-1", imageUrl, sourceHash, approvals), null, "a review cannot override missing rights");
  // Simulate an explicitly licensed host without changing the production no-rights setting.
  (PLAYER_HEADSHOT_RIGHTS.approvedHosts as string[]).push("static.www.nfl.com");
  PLAYER_HEADSHOT_RIGHTS.status = "approved";
  try {
    assert.equal(approvedReviewUrl("00-1", imageUrl, sourceHash, approvals), "/api/verified-imagery/player/00-1");
    const reconciled = reconcilePlayerImages([player("00-1", "100", imageUrl)],
      [{ gsisId: "00-1", espnId: "100", pfrId: null, pffId: null, esbId: null, smartId: null }]);
    assert.equal(playerHeadshot("100", reconciled, sourceHash, approvals), "/api/verified-imagery/player/100",
      "typed consumer IDs must use their own identity in the returned URL");
  } finally { (PLAYER_HEADSHOT_RIGHTS.approvedHosts as string[]).pop(); PLAYER_HEADSHOT_RIGHTS.status = "not_approved"; }
  assert.equal(approvedReviewUrl("00-2", imageUrl, sourceHash, approvals), null);
  assert.equal(approvedReviewUrl("00-1", imageUrl, "c".repeat(64), approvals), null);
  assert.equal(approvedReviewUrl("00-1", "https://static.www.nfl.com/other.jpg", sourceHash, approvals), null);
  approvals.set("00-1", { sourceHash, imageUrl, imageHash, decision: "rejected" });
  assert.equal(approvedReviewUrl("00-1", imageUrl, sourceHash, approvals), null);
});

test("colliding crosswalk IDs and conflicting weekly headshots fail closed", () => {
  const crosswalk = (gsisId: string) => ({
    gsisId, espnId: "100", pfrId: null, pffId: null, esbId: null, smartId: null,
  });
  const rows = [crosswalk("00-1"), crosswalk("00-2")];
  const collision = reconcilePlayerImages([player("", "100", url("someone"))], rows);
  assert.equal(playerHeadshot("100", collision), null);
  assert.equal(collision.photos.size, 0);
  assert.ok(collision.ambiguous.some(issue => issue.id === "espnId:100"));
  const conflicting = reconcilePlayerImages([player("00-1", "100", url("first")), player("00-1", "100", url("second"))], [rows[0]!]);
  assert.equal(playerHeadshot("00-1", conflicting), null);
  assert.equal(conflicting.photos.size, 0);
  assert.ok(conflicting.duplicateRosterIds.some(issue => issue.id === "00-1"));
  const contradictory = reconcilePlayerImages([player("00-3", "100", url("wrong"))], [rows[0]!]);
  assert.equal(playerHeadshot("00-3", contradictory), null);
  assert.equal(contradictory.photos.size, 0);
  assert.equal(reconcilePlayerImages([player("00-1", "100", url("wrong"))], rows).photos.size, 0);
});

test("missing source stays unavailable; failed refresh only reuses prior verified rows", () => {
  const schedule = [team("schedule-la", "LAR", "Los Angeles Rams")];
  assert.equal(staleVerifiedImages(null, schedule), null);
  const roster = reconcilePlayerImages([player("00-1", "100", url("photo"))], []);
  const previous = {
    sources: { teams: null, roster: null, players: null },
    teams: reconcileTeamImages([], []),
    players: roster,
    teamRows: [source("LA", "Los Angeles Rams", url("rams"))],
    crosswalkError: null,
    sourceErrors: [],
    approvals: new Map(),
  };
  assert.equal(staleVerifiedImages(previous, schedule)?.teams.logos.get("schedule-la"), url("rams"));
  assert.equal(staleVerifiedImages(previous, [team("other", "UNKNOWN", "Other")])?.teams.logos.size, 0);
});

test("persisted evidence requires matching source, version, fields and intact rows", () => {
  const rows = [source("LA", "Los Angeles Rams", url("rams"))];
  const receipt = {
    canonicalRowsHash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    sourceContentHash: "a".repeat(64), rowCount: 1,
    sourceUrl: "https://example.org/teams.csv", parserVersion: IMAGE_PARSER_VERSION,
    sourceHeaders: ["team_abbr", "team_name", "team_logo_espn"],
  };
  const valid = (payload: unknown, meta = receipt) =>
    validPersistedImageRows(payload, meta, receipt.sourceUrl, receipt.sourceHeaders);
  assert.equal(valid(rows), true);
  assert.equal(valid([{ ...rows[0], team_logo_espn: url("other") }]), false);
  assert.equal(valid([], { ...receipt, rowCount: 0 }), false);
  assert.equal(valid(rows, { ...receipt, sourceUrl: "https://example.org/other.csv" }), false);
  assert.equal(valid(rows, { ...receipt, parserVersion: "verified-imagery-v1" }), false);
  assert.equal(valid(rows, { ...receipt, sourceHeaders: ["team_abbr"] }), false);
  assert.equal(valid(rows, { ...receipt, sourceContentHash: "unknown" }), false);
  assert.equal(valid([{ ...rows[0], team_logo_espn: null }]), false);
});
