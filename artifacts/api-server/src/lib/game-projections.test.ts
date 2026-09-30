import assert from "node:assert/strict";
import test from "node:test";
import type { GameProjectionRow } from "@workspace/db";
import { favoriteRecord, lineValueGames, lineValueSummary, projectionsBeforeKickoff, winnerRecord, type SpreadQuote } from "./game-projections";

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
  const entry = (gameId: string, marketMargin: number | null) => ({ ...game(gameId, 1, "2026-09-10T17:00:00Z"), marketMargin, generatedAt: new Date("2026-09-09T00:00:00Z") });
  const finals = new Map([["a", { home: 20, away: 10, week: 1 }], ["b", { home: 20, away: 10, week: 1 }], ["c", { home: 7, away: 7, week: 1 }]]);
  const record = favoriteRecord([entry("a", 3), entry("b", -3), entry("c", 1), entry("d", 2)], finals);
  assert.deepEqual(record, { wins: 1, losses: 1, pushes: 1 });
});
