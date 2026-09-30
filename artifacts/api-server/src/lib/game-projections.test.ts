import assert from "node:assert/strict";
import test from "node:test";
import type { GameProjectionRow } from "@workspace/db";
import { projectionsBeforeKickoff, winnerRecord } from "./game-projections";

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
