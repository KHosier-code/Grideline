import assert from "node:assert/strict";
import test from "node:test";
import type { GameProjectionRow } from "@workspace/db";
import {
  favoriteRecord, lineValueGames, lineValueSummary, lockedAt, openerWatch, openerWatchSummary, projectionsBeforeKickoff, watchAlerts,
  winnerRecord, lockTime, spreadLocks, spreadLockSummary, earlyWindowOpens, earlyLinePicks, earlyLineSummary, earlyStopTime, type EarlyPick, type SpreadQuote,
} from "./game-projections";

const qb = { name: "QB", value: 0, listed: true, newStarter: false };
const game = (gameId: string, margin: number, kickoff: string): GameProjectionRow => ({
  gameId, nflverseGameId: gameId, homeTeam: "HOM", awayTeam: "AWY", kickoff, projectedMargin: margin, projectedTotal: 44,
  homeWinProbability: margin > 0 ? 0.6 : 0.4, homeQb: qb, awayQb: qb,
  factors: { qbEdge: 0, teamEdge: 0, passEdge: 0, rushEdge: 0, restDiff: 0, neutralSite: false },
});

test("a run after kickoff never replaces the pregame projection", () => {
  const byGame = projectionsBeforeKickoff([
    { generatedAt: new Date("2026-09-29T12:00:00Z"), games: [game("thu", 3, "2026-10-02T00:15:00Z")] },
    { generatedAt: new Date("2026-10-03T12:00:00Z"), games: [game("thu", -7, "2026-10-02T00:15:00Z")] },
  ]);
  assert.equal(byGame.get("thu")?.projectedMargin, 3);
});

test("later pregame runs replace earlier ones (a QB change during the week)", () => {
  const byGame = projectionsBeforeKickoff([
    { generatedAt: new Date("2026-09-29T12:00:00Z"), games: [game("sun", 5, "2026-10-04T17:00:00Z")] },
    { generatedAt: new Date("2026-10-03T12:00:00Z"), games: [game("sun", -1, "2026-10-04T17:00:00Z")] },
  ]);
  assert.equal(byGame.get("sun")?.projectedMargin, -1);
});

test("winner record counts wins, losses and ties by week", () => {
  const byGame = projectionsBeforeKickoff([{ generatedAt: new Date("2026-09-01T00:00:00Z"), games: [
    game("a", 3, "2026-09-10T00:00:00Z"), game("b", -2, "2026-09-10T00:00:00Z"), game("c", 1, "2026-09-17T00:00:00Z"),
  ] }]);
  const finals = new Map([["a", { home: 24, away: 17, week: 1 }], ["b", { home: 24, away: 17, week: 1 }], ["c", { home: 20, away: 20, week: 2 }]]);
  const record = winnerRecord(byGame.values(), finals);
  assert.deepEqual(record.total, { wins: 1, losses: 1, pushes: 1 });
  assert.deepEqual(record.weeks.get(1), { wins: 1, losses: 1, pushes: 0 });
});

const quote = (sportsbook: string, at: string, homeLine: number): SpreadQuote => ({ sportsbook, capturedAt: new Date(at), homeLine });

test("line value: the line moving toward Gridline counts as closing line value", () => {
  // Gridline has home by 6; the opener is home -3, so Gridline leans home.
  const runs = [{ generatedAt: new Date("2026-09-29T14:00:00Z"), games: [game("g1", 6, "2026-10-04T17:00:00Z")] }];
  const quotes = new Map([["g1", [
    quote("DraftKings", "2026-09-29T14:07:00Z", -3),
    quote("DraftKings", "2026-10-04T16:22:00Z", -4.5),
    quote("DraftKings", "2026-10-04T18:00:00Z", -7), // after kickoff: ignored
    quote("FanDuel", "2026-09-29T14:07:00Z", -2.5),
  ]]]);
  const finals = new Map([["g1", { home: 24, away: 20, week: 4 }]]);
  const [row] = lineValueGames(runs, quotes, finals);
  assert.equal(row.sportsbook, "DraftKings");
  assert.equal(row.lean, "home");
  assert.equal(row.movedToward, 1.5);
  assert.equal(row.atsOpen, "win"); // won by 4, covered -3
  assert.equal(row.atsClose, "loss"); // didn't cover -4.5
  const summary = lineValueSummary([row]);
  assert.equal(summary.movedToward, 1);
  assert.equal(summary.averageMove, 1.5);
});

test("line value: away leans, small edges and single captures", () => {
  const runs = [{ generatedAt: new Date("2026-09-29T14:00:00Z"), games: [
    game("away", -2, "2026-10-04T17:00:00Z"), game("flat", 3.2, "2026-10-04T17:00:00Z"), game("one", 3, "2026-10-04T17:00:00Z"),
  ] }];
  const quotes = new Map([
    // Gridline away by 2, opener home -1: lean away. Line moves to home +1: toward away by 2.
    ["away", [quote("FanDuel", "2026-09-30T00:00:00Z", -1), quote("FanDuel", "2026-10-04T16:00:00Z", 1)]],
    ["flat", [quote("DraftKings", "2026-09-30T00:00:00Z", -3), quote("DraftKings", "2026-10-04T16:00:00Z", -3.5)]],
    ["one", [quote("DraftKings", "2026-09-30T00:00:00Z", -3)]],
  ]);
  const rows = lineValueGames(runs, quotes, new Map());
  assert.equal(rows.length, 2);
  const away = rows.find((row) => row.gameId === "away")!;
  assert.equal(away.lean, "away");
  assert.equal(away.movedToward, 2);
  assert.equal(rows.find((row) => row.gameId === "flat")!.lean, null);
  assert.equal(lineValueSummary(rows).leans, 1);
});

test("line value uses the projection published by the opener, not a later one", () => {
  const runs = [
    { generatedAt: new Date("2026-09-29T12:00:00Z"), games: [game("g", 7, "2026-10-04T17:00:00Z")] },
    { generatedAt: new Date("2026-10-02T12:00:00Z"), games: [game("g", -7, "2026-10-04T17:00:00Z")] },
  ];
  const quotes = new Map([["g", [quote("DraftKings", "2026-09-29T14:00:00Z", -3), quote("DraftKings", "2026-10-04T16:00:00Z", -3)]]]);
  assert.equal(lineValueGames(runs, quotes, new Map())[0].gridlineMargin, 7);
});

test("favorite record grades the line's favorite", () => {
  const entry = (gameId: string, marketMargin: number | null) => ({ ...game(gameId, 1, "2026-09-10T17:00:00Z"), marketMargin, generatedAt: new Date("2026-09-09T00:00:00Z"), lockedAt: new Date("2026-09-09T00:00:00Z") });
  const finals = new Map([["a", { home: 20, away: 10, week: 1 }], ["b", { home: 20, away: 10, week: 1 }], ["c", { home: 7, away: 7, week: 1 }]]);
  const record = favoriteRecord([entry("a", 3), entry("b", -3), entry("c", 1), entry("d", 2)], finals);
  assert.deepEqual(record, { wins: 1, losses: 1, pushes: 1 });
});

test("a run received after kickoff doesn't count, whatever time it says it was made", () => {
  const backdated = { generatedAt: new Date("2026-10-04T12:00:00Z"), receivedAt: new Date("2026-10-04T18:00:00Z"), games: [game("sun", -9, "2026-10-04T17:00:00Z")] };
  assert.equal(lockedAt(backdated).toISOString(), "2026-10-04T18:00:00.000Z");
  const byGame = projectionsBeforeKickoff([
    { generatedAt: new Date("2026-09-29T14:00:00Z"), receivedAt: new Date("2026-09-29T14:00:05Z"), games: [game("sun", 2, "2026-10-04T17:00:00Z")] },
    backdated,
  ]);
  assert.equal(byGame.get("sun")?.projectedMargin, 2);
  assert.equal(byGame.get("sun")?.lockedAt.toISOString(), "2026-09-29T14:00:05.000Z");
});

test("watch list: 4+ points off the opener, graded at the opener, when we published, and the close", () => {
  // Opener home -1 Sunday night; Gridline (home by 6) published Tuesday when the line was -2.5; it closed -4.
  const runs = [
    { generatedAt: new Date("2026-09-29T14:00:00Z"), games: [game("w", 6, "2026-10-04T17:00:00Z"), game("n", 2, "2026-10-04T17:00:00Z")] },
    { generatedAt: new Date("2026-10-03T14:00:00Z"), games: [game("w", -10, "2026-10-04T17:00:00Z")] }, // later runs don't change the flag
  ];
  const quotes = new Map([
    ["w", [quote("DraftKings", "2026-09-28T03:07:00Z", -1), quote("DraftKings", "2026-09-29T10:00:00Z", -2.5), quote("DraftKings", "2026-10-04T16:22:00Z", -4)]],
    ["n", [quote("DraftKings", "2026-09-28T03:07:00Z", -1)]],
  ]);
  const finals = new Map([["w", { home: 23, away: 20, week: 4 }]]);
  const watch = openerWatch(runs, quotes, finals, new Date("2026-10-05T00:00:00Z"));
  assert.equal(watch.length, 1); // "n" is only 1 point off
  const [row] = watch;
  assert.equal(row.gap, 5);
  assert.equal(row.side, "home");
  assert.equal(row.publishedLine, -2.5);
  assert.equal(row.movedToward, 3);
  assert.deepEqual([row.atsOpen, row.atsPublished, row.atsClose], ["win", "win", "loss"]);
  const summary = openerWatchSummary(watch);
  assert.equal(summary.flagged, 1);
  assert.deepEqual(summary.atsClose, { wins: 0, losses: 1, pushes: 0 });
  assert.equal(summary.movedToward, 1);
});

test("watch alerts: new flags and moves of a point or more since a time", () => {
  const runs = [{ generatedAt: new Date("2026-09-29T14:00:00Z"), games: [game("w", -6, "2026-10-04T17:00:00Z")] }];
  const quotes = new Map([["w", [
    quote("DraftKings", "2026-09-28T03:07:00Z", -1), quote("DraftKings", "2026-10-01T14:07:00Z", 1),
  ]]]);
  const watch = openerWatch(runs, quotes, new Map(), new Date("2026-10-01T15:00:00Z"))
    .map((item) => ({ ...item, homeTeam: "KC", awayTeam: "BUF" }));
  const recent = watchAlerts(watch, quotes, new Date("2026-10-01T12:00:00Z"));
  assert.deepEqual(recent.map((alert) => alert.kind), ["moved-toward"]);
  assert.match(recent[0].message, /from KC -1 to BUF -1/);
  const all = watchAlerts(watch, quotes, new Date("2026-09-28T00:00:00Z"));
  assert.deepEqual(all.map((alert) => alert.kind), ["moved-toward", "flagged"]);
  assert.match(all[1].message, /Gridline has BUF -6, the opener is KC -1 at DraftKings/);
});

test("lock times: Saturday noon ET for Sunday and Monday games, six hours ahead otherwise", () => {
  // Sunday 1:00 PM ET -> Saturday 16:00 UTC.
  assert.equal(lockTime(new Date("2026-10-11T17:00:00Z")).toISOString(), "2026-10-10T16:00:00.000Z");
  // Monday 8:15 PM ET is Tuesday 00:15 UTC -> still Saturday.
  assert.equal(lockTime(new Date("2026-10-13T00:15:00Z")).toISOString(), "2026-10-10T16:00:00.000Z");
  // Sunday 9:30 AM ET London game -> Saturday.
  assert.equal(lockTime(new Date("2026-10-11T13:30:00Z")).toISOString(), "2026-10-10T16:00:00.000Z");
  // Thursday 8:15 PM ET -> six hours before.
  assert.equal(lockTime(new Date("2026-10-09T00:15:00Z")).toISOString(), "2026-10-08T18:15:00.000Z");
});

const sunday = "2026-10-11T17:00:00Z";
const quotes = (rows: Array<[string, string, number]>): SpreadQuote[] =>
  rows.map(([sportsbook, at, homeLine]) => ({ sportsbook, capturedAt: new Date(at), homeLine }));

test("locked pick: the away dog at the best number, graded there, with closing line value", () => {
  // Home favored by 7 at DK, 6.5 at FD; we say home by 5.5 -> away +7 at DK, a 1.5-point lean.
  const runs = [{ generatedAt: new Date("2026-10-10T15:20:00Z"), games: [game("g", 5.5, sunday)] }];
  const q = new Map([["g", quotes([
    ["DraftKings", "2026-10-10T14:07:00Z", -7], ["FanDuel", "2026-10-10T14:07:00Z", -6.5],
    ["DraftKings", "2026-10-11T16:22:00Z", -6],
  ])]]);
  const before = spreadLocks(runs, q, new Map(), new Date("2026-10-10T12:00:00Z"));
  assert.equal(before.length, 0, "no projection before the lock yet");
  const [lock] = spreadLocks(runs, q, new Map([["g", { home: 24, away: 20, week: 6 }]]), new Date("2026-10-12T12:00:00Z"));
  assert.equal(lock.locked, true);
  assert.equal(lock.side, "away");
  assert.equal(lock.line, 7);
  assert.equal(lock.sportsbook, "DraftKings");
  assert.equal(lock.tier, "lean");
  assert.equal(lock.closeLine, 6);
  assert.equal(lock.clv, 1);
  assert.equal(lock.result, "win"); // lost by 4, covered +7
  const summary = spreadLockSummary([lock]);
  assert.deepEqual(summary.leans, { wins: 1, losses: 0, pushes: 0 });
  assert.equal(summary.beatClose, 1);
});

test("locked pick ignores runs and lines after the lock; small gaps are no pick", () => {
  const runs = [
    { generatedAt: new Date("2026-10-10T15:20:00Z"), games: [game("g", 10, sunday)] },
    { generatedAt: new Date("2026-10-11T15:45:00Z"), games: [game("g", 3, sunday)] },
  ];
  const q = new Map([["g", quotes([["DraftKings", "2026-10-10T14:07:00Z", -3], ["DraftKings", "2026-10-11T12:07:00Z", -9]])]]);
  const [lock] = spreadLocks(runs, q, new Map(), new Date("2026-10-11T16:00:00Z"));
  assert.equal(lock.tier, "play"); // home by 10 vs -3: a 7-point play on home -3
  assert.equal(lock.line, -3);
  assert.equal(lock.gridlineMargin, 10);
  const [small] = spreadLocks([{ generatedAt: new Date("2026-10-10T15:20:00Z"), games: [game("g", 3.5, sunday)] }], q,
    new Map(), new Date("2026-10-11T16:00:00Z"));
  assert.equal(small.tier, null);
  assert.equal(small.side, null);
});

test("before the lock the pick is the current lean, not graded", () => {
  const runs = [{ generatedAt: new Date("2026-10-08T15:20:00Z"), games: [game("g", -6, sunday)] }];
  const q = new Map([["g", quotes([["FanDuel", "2026-10-08T14:07:00Z", 1]])]]);
  const [lock] = spreadLocks(runs, q, new Map(), new Date("2026-10-09T12:00:00Z"));
  assert.equal(lock.locked, false);
  assert.equal(lock.side, "away");
  assert.equal(lock.line, -1);
  assert.equal(lock.tier, "play");
  assert.equal(lock.result, null);
});

test("spread picks are paused: games from week 6 on get no lock", () => {
  const later = "2026-10-18T17:00:00Z";
  const runs = [{ generatedAt: new Date("2026-10-17T15:20:00Z"), games: [game("g6", 10, later)] }];
  const q = new Map([["g6", quotes([["DraftKings", "2026-10-17T14:07:00Z", -3]])]]);
  assert.equal(spreadLocks(runs, q, new Map(), new Date("2026-10-18T12:00:00Z")).length, 0);
  assert.equal(spreadLockSummary([]).pausedFrom, "2026-10-13T12:00:00.000Z");
});

test("early window opens Monday 12:00 UTC of the game's week", () => {
  // Week 7: Thursday Oct 22, Sunday Oct 25, Monday night Oct 26 (Oct 27 00:15 UTC).
  for (const kickoff of ["2026-10-23T00:15:00Z", "2026-10-25T17:00:00Z", "2026-10-27T00:15:00Z"]) {
    assert.equal(earlyWindowOpens(new Date(kickoff)).toISOString(), "2026-10-19T12:00:00.000Z", kickoff);
  }
});

const wk7 = "2026-10-25T17:00:00Z";
test("early pick: first post after Monday 8 AM, 4+ off the nearest line, graded there", () => {
  const runs = [
    { generatedAt: new Date("2026-10-18T23:20:00Z"), games: [game("e", -3, wk7)] }, // Sunday night: before the window
    { generatedAt: new Date("2026-10-19T12:45:00Z"), games: [game("e", 4, wk7)] },  // Monday morning: the pick
    { generatedAt: new Date("2026-10-20T14:20:00Z"), games: [game("e", 9, wk7)] },  // later runs don't change it
  ];
  // Home +1.5 at DK Monday 12:07 -> we say home by 4: a 5.5-point gap on home +1.5.
  const q = new Map([["e", quotes([
    ["DraftKings", "2026-10-19T03:07:00Z", 3], ["DraftKings", "2026-10-19T12:07:00Z", 1.5], ["FanDuel", "2026-10-19T12:07:00Z", 1],
    ["DraftKings", "2026-10-25T16:22:00Z", -1],
  ])]]);
  const before = earlyLinePicks(runs, q, new Map(), new Date("2026-10-21T12:00:00Z"));
  assert.equal(before.length, 1);
  assert.equal(before[0].side, "home");
  assert.equal(before[0].line, 1.5);
  assert.equal(before[0].sportsbook, "DraftKings");
  assert.equal(before[0].gap, 5.5);
  assert.equal(before[0].result, null);
  const [after] = earlyLinePicks(runs, q, new Map([["e", { home: 20, away: 21, week: 7 }]]), new Date("2026-10-26T12:00:00Z"));
  assert.equal(after.result, "win"); // lost by 1 with +1.5
  assert.equal(after.clv, 2.5);      // took +1.5, closed -1
  assert.equal(after.stillPick, false);
  assert.deepEqual(earlyLineSummary([after]).record, { wins: 1, losses: 0, pushes: 0 });
});

test("early pick needs a fresh line and a 4-point gap; nothing before week 7", () => {
  const runs = [{ generatedAt: new Date("2026-10-19T12:45:00Z"), games: [game("e", 8, wk7)] }];
  const stale = new Map([["e", quotes([["DraftKings", "2026-10-19T03:07:00Z", -1]])]]); // 9.6 h old
  assert.equal(earlyLinePicks(runs, stale, new Map(), new Date("2026-10-20T00:00:00Z")).length, 0);
  const small = new Map([["e", quotes([["DraftKings", "2026-10-19T12:07:00Z", -5]])]]); // gap 3
  assert.equal(earlyLinePicks(runs, small, new Map(), new Date("2026-10-20T00:00:00Z")).length, 0);
  const early = [{ generatedAt: new Date("2026-10-12T12:45:00Z"), games: [game("w6", 8, "2026-10-18T17:00:00Z")] }];
  const q6 = new Map([["w6", quotes([["DraftKings", "2026-10-12T12:07:00Z", 1]])]]);
  assert.equal(earlyLinePicks(early, q6, new Map(), new Date("2026-10-13T00:00:00Z")).length, 0);
});

test("stop rule: under 50% after the first 30 graded picks stops new ones", () => {
  const pick = (i: number, result: "win" | "loss"): EarlyPick => ({
    gameId: `p${i}`, homeTeam: "H", awayTeam: "A", kickoff: new Date(Date.UTC(2026, 9, 25 + i)).toISOString(),
    postedAt: new Date(Date.UTC(2026, 9, 20 + i)), side: "home", line: 3, sportsbook: "DraftKings", quotedAt: new Date(),
    gridlineMargin: 8, gap: 5, currentLine: 3, stillPick: false, started: true, clv: 0, result,
  });
  const losing = Array.from({ length: 30 }, (_, i) => pick(i, i < 14 ? "win" : "loss"));
  assert.ok(earlyStopTime(losing));
  assert.equal(earlyLineSummary(losing).stopped, true);
  const winning = Array.from({ length: 30 }, (_, i) => pick(i, i < 16 ? "win" : "loss"));
  assert.equal(earlyStopTime(winning), null);
  // A later slump doesn't trip it: the rule is judged once, at pick 30.
  const later = [...winning, ...Array.from({ length: 20 }, (_, i) => pick(30 + i, "loss"))];
  assert.equal(earlyLineSummary(later).stopped, false);
});
