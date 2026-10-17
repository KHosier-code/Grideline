import assert from "node:assert/strict";
import test from "node:test";
import type { TouchdownPickRow } from "@workspace/db";
import {
  boardForWeek, bookComparison, bookFairProbability, decimalOdds, expectedValue, fairAmericanOdds, isValueCandidate, mergePropReports, statusAt, topTenRecord, valueFive, valueRecord,
} from "./touchdown-board";

const factors = {
  targetsPerGame: null, carriesPerGame: null, targetShare: null, carryShare: null, redZoneTouchesPerGame: null,
  redZoneShare: null, goalLineShare: null, teamImpliedPoints: null, opponentTdsAllowedRatio: null, recentTdRate: null,
};
const pick = (playerId: string, probability: number, kickoff: string): TouchdownPickRow => ({
  playerId, name: playerId, position: "RB", team: "AAA", opponent: "BBB", isHome: true, kickoff, probability,
  injuryStatus: null, factors,
});
const THU = "2026-10-02T00:15:00Z";
const SUN = "2026-10-04T17:00:00Z";

test("Thursday players keep the ranking published before Thursday", () => {
  const runs = [
    { generatedAt: new Date("2026-09-29T12:00:00Z"), picks: [pick("thu", 0.4, THU), pick("sun", 0.3, SUN)] },
    // Saturday run: Thursday game already played, so only Sunday players.
    { generatedAt: new Date("2026-10-03T12:00:00Z"), picks: [pick("sun", 0.35, SUN)] },
  ];
  const board = boardForWeek(runs, new Date("2026-10-03T13:00:00Z"));
  assert.deepEqual(board.map((entry) => [entry.playerId, entry.probability]), [["thu", 0.4], ["sun", 0.35]]);
});

test("a run made after kickoff never replaces the pre-game number", () => {
  const runs = [
    { generatedAt: new Date("2026-09-29T12:00:00Z"), picks: [pick("thu", 0.4, THU)] },
    { generatedAt: new Date("2026-10-02T12:00:00Z"), picks: [pick("thu", 0.9, THU)] },
  ];
  assert.equal(boardForWeek(runs, new Date("2026-10-03T00:00:00Z"))[0].probability, 0.4);
});

test("a player dropped from the latest run before their game is removed", () => {
  const runs = [
    { generatedAt: new Date("2026-09-29T12:00:00Z"), picks: [pick("out", 0.5, SUN), pick("sun", 0.3, SUN)] },
    { generatedAt: new Date("2026-10-03T12:00:00Z"), picks: [pick("sun", 0.3, SUN)] },
  ];
  assert.deepEqual(boardForWeek(runs, new Date("2026-10-03T13:00:00Z")).map((entry) => entry.playerId), ["sun"]);
});

test("fair odds", () => {
  assert.equal(fairAmericanOdds(0.5), -100);
  assert.equal(fairAmericanOdds(0.25), 300);
  assert.equal(fairAmericanOdds(0.6), -150);
});

test("top-10 record only counts fully graded weeks", () => {
  const board = Array.from({ length: 12 }, (_, index) => ({ ...pick(`p${index}`, 0.5 - index / 100, SUN), generatedAt: new Date(), lockedAt: new Date() }));
  const results = new Map(board.map((entry, index) => [entry.playerId, index % 2 === 0]));
  const record = topTenRecord([{ week: 4, board, results }]);
  assert.deepEqual([record.weeksGraded, record.topTenPicks, record.topTenHits], [1, 10, 5]);
  assert.ok(Math.abs(record.expectedHits - 4.55) < 0.06, `${record.expectedHits}`);
  assert.deepEqual(record.priced, { picks: 0, hits: 0, units: 0 });
  // The top 5 inside it: p0, p2, p4 scored.
  assert.deepEqual([record.topFive.picks, record.topFive.hits], [5, 3]);
  assert.ok(Math.abs(record.topFive.expectedHits - 2.4) < 0.06, `${record.topFive.expectedHits}`);
  assert.equal(record.weeks[0].topFiveHits, 3);
  const partial = new Map([...results].slice(0, 5));
  assert.equal(topTenRecord([{ board, results: partial }]).weeksGraded, 0);
});

test("top-10 profit uses each pick's book price and skips unpriced picks", () => {
  const board = Array.from({ length: 10 }, (_, index) => ({ ...pick(`p${index}`, 0.4, SUN), generatedAt: new Date(), lockedAt: new Date() }));
  const results = new Map(board.map((entry, index) => [entry.playerId, index < 4]));
  // Hits at -150 pay 0.667 each; misses lose 1; p9 has no price.
  const record = topTenRecord([{ week: 5, board, results, price: (entry) => entry.playerId === "p9" ? null : -150 }]);
  assert.deepEqual(record.priced, { picks: 9, hits: 4, units: -2.33 });
  // Top 5: p0-p3 hit at -150 (+0.667 each), p4 missed.
  assert.deepEqual(record.topFive.priced, { picks: 5, hits: 4, units: 1.67 });
  assert.equal(record.weeks[0].pricedPicks, 9);
});

test("value candidates need plus money and a 5-cent edge", () => {
  assert.equal(decimalOdds(150), 2.5);
  assert.equal(decimalOdds(-200), 1.5);
  assert.ok(Math.abs(expectedValue(0.6, -120) - 0.1) < 1e-9);
  assert.equal(isValueCandidate(0.36, 200), true);   // +8 cents per $1
  assert.equal(isValueCandidate(0.35, 190), false);  // under the 5-cent floor
  assert.equal(isValueCandidate(0.6, -120), false);  // favorites belong to the Top 5, not Value 5
  assert.equal(isValueCandidate(0.6, 140), false);   // shorter than +150
  assert.equal(isValueCandidate(0.35, null), false); // no price captured
});

test("Value 5 locks each pick at its kickoff, so a Thursday loss can't drop off later", () => {
  const early = new Date("2026-10-01T12:00:00Z");
  const runs = [{ generatedAt: early, picks: [pick("thu", 0.3, THU), ...["s1", "s2", "s3", "s4", "s5"].map((id) => pick(id, 0.3, SUN))] }];
  // Thursday's capture priced only the Thursday game; Saturday's priced Sunday at longer odds.
  const saturday = new Date("2026-10-03T14:00:00Z");
  const priceAt = (entry: { playerId: string }, before: Date) =>
    entry.playerId === "thu" ? 260 : before > saturday ? 400 : null;
  const sundayMorning = new Date("2026-10-04T12:00:00Z");
  const picks = valueFive(runs, sundayMorning, priceAt);
  // Sunday's five now beat Thursday's edge, yet the Thursday pick stays at the price it was chosen at.
  assert.deepEqual([...picks.keys()].sort(), ["s1", "s2", "s3", "s4", "s5", "thu"]);
  assert.equal(picks.get("thu")!.price, 260);
  assert.equal(picks.get("thu")!.selectedAt.toISOString(), THU.replace("Z", ".000Z"));
  // Before Saturday's capture only the Thursday game had a price.
  assert.deepEqual([...valueFive(runs, new Date("2026-10-01T13:00:00Z"), priceAt).keys()], ["thu"]);
});

test("Value 5 ignores runs posted after a game started", () => {
  const late = { generatedAt: new Date("2026-10-04T18:00:00Z"), picks: [pick("s1", 0.5, SUN)] };
  const early = { generatedAt: new Date("2026-10-04T12:00:00Z"), picks: [pick("s1", 0.2, SUN)] };
  // At kickoff s1 was 20% at +300 (EV -0.2), so it was never a value pick, whatever the later run says.
  const picks = valueFive([early, late], new Date("2026-10-05T00:00:00Z"), () => 300);
  assert.equal(picks.size, 0);
});

test("value record grades each pick at the price it was chosen at", () => {
  const chosen = (id: string, price: number) => [id, { entry: { ...pick(id, 0.3, SUN), generatedAt: new Date(), lockedAt: new Date() },
    price, expectedValue: 0.1, selectedAt: new Date(SUN) }] as const;
  const picks = new Map([chosen("a", 250), chosen("b", 300), chosen("c", 400)]);
  const results = new Map([["a", true], ["b", false]]);
  // a wins at +250 (+2.5), b loses (-1), c has no result yet.
  assert.deepEqual(valueRecord([{ week: 4, picks, results }]), { picks: 2, hits: 1, units: 1.5, weeks: [{ week: 4, picks: 2, hits: 1, units: 1.5 }] });
});

test("book chance takes the cut out and averages the books", () => {
  // +150 implies 40%; with a 20% cut the fair chance is 33.3%.
  assert.ok(Math.abs(bookFairProbability([150])! - 0.4 / 1.2) < 1e-9);
  assert.ok(Math.abs(bookFairProbability([150, 100])! - 0.45 / 1.2) < 1e-9);
  assert.equal(bookFairProbability([]), null);
});

test("book comparison scores both sets of chances on the same players", () => {
  const rows = [
    { week: 4, probability: 0.6, bookProbability: 0.5, scored: true },
    { week: 4, probability: 0.2, bookProbability: 0.3, scored: false },
    { week: 5, probability: 0.5, bookProbability: 0.5, scored: false },
  ];
  const result = bookComparison(rows);
  assert.equal(result.players, 3);
  assert.equal(result.weeks, 2);
  assert.equal(result.modelBrier, Math.round(((0.16 + 0.04 + 0.25) / 3) * 10000) / 10000);
  assert.equal(result.bookBrier, Math.round(((0.25 + 0.09 + 0.25) / 3) * 10000) / 10000);
  assert.ok(result.modelLogLoss! < result.bookLogLoss!);
  assert.equal(bookComparison([]).modelBrier, null);
});

test("a touchdown run received after kickoff doesn't change that game's board", () => {
  const before = { generatedAt: new Date("2026-10-04T14:00:00Z"), picks: [pick("p", 0.3, SUN)] };
  const late = { generatedAt: new Date("2026-10-04T15:00:00Z"), receivedAt: new Date("2026-10-04T18:00:00Z"), picks: [pick("p", 0.9, SUN)] };
  const [entry] = boardForWeek([before, late], new Date("2026-10-05T00:00:00Z"));
  assert.equal(entry.probability, 0.3);
});

test("a week's price captures merge, newest per game, and can be read as of a time", () => {
  const event = (eventId: string, price: number) => ({ eventId, teams: ["AAA", "BBB"], commence: SUN, players: { x: [{ book: "draftkings", price }] } });
  const thursday = { capturedAt: "2026-10-01T14:00:00Z", creditsRemaining: 300, events: [event("thu", 150)] };
  const friday = { capturedAt: "2026-10-02T14:00:00Z", creditsRemaining: 290, events: [event("sun", 180)] };
  const saturday = { capturedAt: "2026-10-03T14:00:00Z", creditsRemaining: 280, events: [event("sun", 200)] };
  const merged = mergePropReports([thursday, saturday, friday])!;
  // Saturday's capture has no Thursday game; Thursday's prices must survive it.
  assert.deepEqual(merged.events.map((item) => [item.eventId, item.players.x[0].price]).sort(), [["sun", 200], ["thu", 150]]);
  assert.equal(merged.capturedAt, saturday.capturedAt);
  const asOfFriday = mergePropReports([thursday, saturday, friday], new Date("2026-10-03T00:00:00Z"))!;
  assert.deepEqual(asOfFriday.events.map((item) => [item.eventId, item.players.x[0].price]).sort(), [["sun", 180], ["thu", 150]]);
  assert.equal(mergePropReports([saturday], new Date("2026-10-01T00:00:00Z")), null);
});

test("injury status counts for 6 days after it was seen, as of the time asked", () => {
  const rows = [
    { gameStatus: "Questionable", snapshotTimestamp: new Date("2026-10-15T15:00:00Z") },
    { gameStatus: "Out", snapshotTimestamp: new Date("2026-10-16T19:00:00Z") },
  ];
  assert.equal(statusAt(rows, new Date("2026-10-16T12:00:00Z")), "Questionable");
  assert.equal(statusAt(rows, new Date("2026-10-18T17:00:00Z")), "Out");
  // Never cleared in the feed: a week later it no longer counts.
  assert.equal(statusAt(rows, new Date("2026-10-25T17:00:00Z")), null);
  assert.equal(statusAt(rows, new Date("2026-10-14T00:00:00Z")), null);
});

test("players ruled out before kickoff leave the board; a later injury never rewrites a played game", () => {
  const runs = [{ generatedAt: new Date("2026-10-03T12:00:00Z"), picks: [pick("love", 0.3, SUN), pick("ok", 0.25, SUN), pick("q", 0.2, SUN)] }];
  const injuryAt = (playerId: string, at: Date) => {
    if (playerId === "love") return "Out";                                   // ruled out Friday
    if (playerId === "ok") return at > new Date(SUN) ? "Out" : null;         // hurt in the game
    if (playerId === "q") return "Questionable";
    return null;
  };
  const before = boardForWeek(runs, new Date("2026-10-04T12:00:00Z"), injuryAt);
  assert.deepEqual(before.map((entry) => entry.playerId), ["ok", "q"]);
  assert.equal(before[1].injuryStatus, "Questionable");
  const after = boardForWeek(runs, new Date("2026-10-06T12:00:00Z"), injuryAt);
  assert.deepEqual(after.map((entry) => entry.playerId), ["ok", "q"]);
});
