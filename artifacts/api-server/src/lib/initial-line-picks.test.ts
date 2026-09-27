import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, gt, inArray } from "drizzle-orm";
import { captureInitialLineOutcome, completeInitialQuotes, nextInitialSlate, publicFirstLines, rankInitialPicks, readInitialWeeklyPickArchive, verifySavedPick, type InitialQuote } from "./initial-line-picks";
import { inferInitialLineGame } from "./live-predictions";
import { db, gamesTable, initialLinePicksTable, initialWeeklyPicksTable, oddsApiRequestsTable, pregameTeamFeaturesTable, sportsbookOddsTable, teamsTable } from "@workspace/db";

const home = "HME", away = "AWY";
const quote = (sportsbook: string, market: string, selection: string, point: number | null, price: number): InitialQuote =>
  ({ sportsbook, market, selection, point, price, sourceTimestamp: null });
const full = [
  quote("DraftKings", "moneyline", home, null, -135),
  quote("DraftKings", "moneyline", away, null, 115),
  quote("DraftKings", "spread", home, -2.5, -110),
  quote("DraftKings", "spread", away, 2.5, -110),
];

test("first observed lines require both quoted sides of two markets at one book", () => {
  assert.equal(completeInitialQuotes(full.slice(0, 3), home, away), null);
  assert.equal(completeInitialQuotes([...full.slice(0, 2), ...full.slice(2).map((row) => ({ ...row, sportsbook: "FanDuel" }))], home, away), null);
  assert.equal(completeInitialQuotes([...full, full[0]!], home, away), null);
  assert.equal(completeInitialQuotes([...full.slice(0, 3), { ...full[3]!, point: -2.5 }], home, away), null);
  assert.deepEqual(completeInitialQuotes(full, home, away)?.quotes, full);
  assert.equal(completeInitialQuotes([...full, ...full.map((row) => ({ ...row, sportsbook: "FanDuel" }))], home, away)?.sportsbook, "DraftKings");
});

test("weekly winner ranks by locked probability, kickoff and game identity", () => {
  const kickoffTime = new Date("2027-09-09T17:00:00Z");
  assert.equal(rankInitialPicks([
    { gameId: "z", winnerProbability: .7, kickoffTime },
    { gameId: "b", winnerProbability: .8, kickoffTime },
    { gameId: "a", winnerProbability: .8, kickoffTime },
  ])?.gameId, "a");
  assert.equal(rankInitialPicks([]), null);
});

test("next initial-line slate follows kickoff across week and season transitions", () => {
  const now = new Date("2026-12-31T00:00:00Z");
  const schedule = [
    { season: 2027, week: 1, kickoffTime: new Date("2027-09-09T17:00:00Z"), gameStatus: "scheduled" },
    { season: 2026, week: 18, kickoffTime: new Date("2027-01-03T21:00:00Z"), gameStatus: "scheduled" },
    { season: 2026, week: 18, kickoffTime: new Date("2027-01-03T18:00:00Z"), gameStatus: "scheduled" },
    { season: 2026, week: 17, kickoffTime: new Date("2026-12-30T18:00:00Z"), gameStatus: "final" },
  ];
  assert.equal(nextInitialSlate(schedule, now).length, 2);
  assert.equal(nextInitialSlate(schedule, new Date("2027-01-04T00:00:00Z"))[0]?.season, 2027);
  assert.deepEqual(nextInitialSlate(schedule, new Date("2028-01-01T00:00:00Z")), []);
});

test("development first-pull outcomes are terminal across retries and concurrent captures", async (t) => {
  const suffix = randomUUID();
  const gameId = `initial-line-test-${suffix}`;
  const homeId = `initial-home-${suffix}`, awayId = `initial-away-${suffix}`;
  const requestedAt = new Date("2026-09-26T14:00:00Z");
  const observedAt = new Date("2026-09-26T14:00:02Z");
  const kickoffTime = new Date("2026-09-27T17:00:00Z");
  await db.insert(teamsTable).values([
    { teamId: homeId, abbreviation: home, teamName: "Test Home" },
    { teamId: awayId, abbreviation: away, teamName: "Test Away" },
  ]);
  await db.insert(gamesTable).values({
    gameId, season: 2026, week: 1, gameDate: kickoffTime, kickoffTime,
    homeTeamId: homeId, awayTeamId: awayId, gameStatus: "STATUS_SCHEDULED",
  });
  const [request] = await db.insert(oddsApiRequestsTable).values({ requestedAt, status: "success" })
    .returning({ id: oddsApiRequestsTable.id });
  t.after(async () => {
    // Evidence is append-only. Its fixture game is removed so the retained
    // test-namespace outcome cannot affect a later consumer slate.
    await db.delete(gamesTable).where(eq(gamesTable.gameId, gameId));
    await db.delete(teamsTable).where(inArray(teamsTable.teamId, [homeId, awayId]));
  });
  const first = { gameId, requestId: request!.id, requestedAt, observedAt, quotes: [] };
  assert.deepEqual(await Promise.all([
    captureInitialLineOutcome(first), captureInitialLineOutcome(first),
  ]), [true, false]);
  const [saved] = await db.select().from(initialLinePicksTable).where(eq(initialLinePicksTable.gameId, gameId));
  assert.equal(saved?.status, "no_line");
  assert.equal(saved?.cutoffAt.toISOString(), observedAt.toISOString());
  assert.equal(saved?.winnerTeamId, null);
  // A later complete market cannot be presented as the initial observation.
  assert.equal(await captureInitialLineOutcome({ ...first, observedAt: new Date("2026-09-26T15:00:00Z"), quotes: full }), false);
  const [stillSaved] = await db.select().from(initialLinePicksTable).where(eq(initialLinePicksTable.gameId, gameId));
  assert.equal(stillSaved?.requestId, request!.id);
  assert.equal(stillSaved?.status, "no_line");
});

test("development full first-line pick binds original models, quotes and inputs without a paid request", async (t) => {
  const requestedAt = new Date();
  const observedAt = new Date(requestedAt.getTime() + 1_000);
  const candidates = await db.select().from(gamesTable)
    .where(gt(gamesTable.kickoffTime, new Date(observedAt.getTime() + 60_000)));
  let source: typeof candidates[number] | undefined;
  for (const game of candidates.slice(0, 40)) {
    if ((await inferInitialLineGame(game.gameId, requestedAt, observedAt)).status === "locked") {
      source = game;
      break;
    }
  }
  assert.ok(source, "development must have at least one cutoff-safe upcoming game to exercise the full lock");
  const suffix = randomUUID();
  const gameId = `initial-line-full-test-${suffix}`;
  const missingId = `${gameId}-missing`;
  const featureRows = await db.select().from(pregameTeamFeaturesTable)
    .where(eq(pregameTeamFeaturesTable.gameId, source.gameId));
  const teams = await db.select().from(teamsTable)
    .where(inArray(teamsTable.teamId, [source.homeTeamId, source.awayTeamId]));
  const homeCode = teams.find((row) => row.teamId === source.homeTeamId)!.abbreviation;
  const awayCode = teams.find((row) => row.teamId === source.awayTeamId)!.abbreviation;
  const quotes = [
    quote("DraftKings", "moneyline", homeCode, null, -135),
    quote("DraftKings", "moneyline", awayCode, null, 115),
    quote("DraftKings", "spread", homeCode, -2.5, -110),
    quote("DraftKings", "spread", awayCode, 2.5, -110),
  ];
  await db.insert(gamesTable).values([{ ...source, gameId }, { ...source, gameId: missingId }]);
  await db.insert(pregameTeamFeaturesTable).values(featureRows.map((row) => ({ ...row, gameId })));
  const [request] = await db.insert(oddsApiRequestsTable).values({ requestedAt, status: "success" })
    .returning({ id: oddsApiRequestsTable.id });
  await db.insert(sportsbookOddsTable).values([gameId, missingId].flatMap((id) => quotes.map((row) => ({
    gameId: id, sportsbook: row.sportsbook, market: row.market, selection: row.selection,
    point: row.point, price: row.price, capturedAt: observedAt, sourceTimestamp: null,
  }))));
  t.after(async () => {
    await db.delete(sportsbookOddsTable).where(inArray(sportsbookOddsTable.gameId, [gameId, missingId]));
    await db.delete(pregameTeamFeaturesTable).where(inArray(pregameTeamFeaturesTable.gameId, [gameId, missingId]));
    await db.delete(gamesTable).where(inArray(gamesTable.gameId, [gameId, missingId]));
  });
  assert.equal(await captureInitialLineOutcome({ gameId, requestId: request!.id, requestedAt, observedAt, quotes }), true);
  const [saved] = await db.select().from(initialLinePicksTable).where(eq(initialLinePicksTable.gameId, gameId));
  assert.equal(saved?.status, "locked");
  assert.equal(saved?.quotes?.length, 4);
  assert.deepEqual(publicFirstLines(saved!), {
    sportsbook: "DraftKings",
    quotes: quotes.map(({ market, selection, point, price }) => ({ market, selection, point, price })),
  });
  assert.equal(Object.keys(saved?.models ?? {}).length, 3);
  assert.ok(saved?.inputVector?.length);
  assert.equal(await verifySavedPick(saved!), true);
  assert.equal(await verifySavedPick({ ...saved!, prediction: { ...saved!.prediction!, homeWinProbability: 0.99 } }), false);
  assert.equal(await verifySavedPick({ ...saved!, models: { ...saved!.models!, moneyline: { ...saved!.models!.moneyline!, checksum: "wrong" } } }), false);
  assert.equal(await captureInitialLineOutcome({ gameId, requestId: request!.id, requestedAt, observedAt, quotes }), false);
  assert.equal(await captureInitialLineOutcome({ gameId, requestId: request!.id,
    requestedAt, observedAt: new Date(observedAt.getTime() + 10_000),
    quotes: quotes.map((item) => ({ ...item, price: 150 })) }), false);
  const [unchangedPick] = await db.select().from(initialLinePicksTable).where(eq(initialLinePicksTable.gameId, gameId));
  assert.deepEqual(publicFirstLines(unchangedPick!), publicFirstLines(saved!));
  assert.equal(await captureInitialLineOutcome({ gameId: missingId, requestId: request!.id, requestedAt, observedAt, quotes }), true);
  const [missing] = await db.select().from(initialLinePicksTable).where(eq(initialLinePicksTable.gameId, missingId));
  assert.equal(missing?.status, "missing_input");
  await db.insert(pregameTeamFeaturesTable).values(featureRows.map((row) => ({ ...row, gameId: missingId })));
  assert.equal(await captureInitialLineOutcome({ gameId: missingId, requestId: request!.id, requestedAt, observedAt, quotes }), false);
  const [unchanged] = await db.select().from(initialLinePicksTable).where(eq(initialLinePicksTable.gameId, missingId));
  assert.equal(unchanged?.status, "missing_input");
});

test("historical archive returns only a verified saved winner, never a substitute for missing or invalid evidence", async (t) => {
  assert.equal(process.env.NODE_ENV, "development", "database fixtures must only run in development");
  const requestedAt = new Date();
  const observedAt = new Date(requestedAt.getTime() + 1_000);
  const candidates = await db.select().from(gamesTable)
    .where(gt(gamesTable.kickoffTime, new Date(observedAt.getTime() + 60_000)));
  let source: typeof candidates[number] | undefined;
  for (const game of candidates.slice(0, 40)) {
    if ((await inferInitialLineGame(game.gameId, requestedAt, observedAt)).status === "locked") {
      source = game;
      break;
    }
  }
  assert.ok(source, "development needs a cutoff-safe upcoming game with promoted models");
  const kickoffTime = source.kickoffTime!;
  const season = 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  const suffix = randomUUID();
  const gameIds = [1, 2, 3, 4].map((week) => `initial-archive-test-${suffix}-${week}`);
  const featureRows = await db.select().from(pregameTeamFeaturesTable)
    .where(eq(pregameTeamFeaturesTable.gameId, source.gameId));
  const teams = await db.select().from(teamsTable)
    .where(inArray(teamsTable.teamId, [source.homeTeamId, source.awayTeamId]));
  const homeCode = teams.find((row) => row.teamId === source.homeTeamId)!.abbreviation;
  const awayCode = teams.find((row) => row.teamId === source.awayTeamId)!.abbreviation;
  const quotes = [
    quote("DraftKings", "moneyline", homeCode, null, -135),
    quote("DraftKings", "moneyline", awayCode, null, 115),
    quote("DraftKings", "spread", homeCode, -2.5, -110),
    quote("DraftKings", "spread", awayCode, 2.5, -110),
  ];
  // Immutable first-line evidence cannot be deleted. Once fixture games
  // are removed, this unique synthetic season cannot form an archive slate.
  t.after(async () => {
    await db.delete(sportsbookOddsTable).where(inArray(sportsbookOddsTable.gameId, gameIds));
    await db.delete(pregameTeamFeaturesTable).where(inArray(pregameTeamFeaturesTable.gameId, gameIds));
    await db.delete(gamesTable).where(inArray(gamesTable.gameId, gameIds));
  });
  await db.insert(gamesTable).values(gameIds.map((gameId, index) =>
    ({ ...source, gameId, season, week: index + 1 })));
  await db.insert(pregameTeamFeaturesTable).values(gameIds.flatMap((gameId, index) =>
    featureRows.map((row) => ({ ...row, gameId, season, week: index + 1 }))));
  const [request] = await db.insert(oddsApiRequestsTable).values({ requestedAt, status: "success" })
    .returning({ id: oddsApiRequestsTable.id });
  await db.insert(sportsbookOddsTable).values(quotes.map((row) => ({
    gameId: gameIds[0]!, sportsbook: row.sportsbook, market: row.market,
    selection: row.selection, point: row.point, price: row.price,
    capturedAt: observedAt, sourceTimestamp: null,
  })));
  assert.equal(await captureInitialLineOutcome({
    gameId: gameIds[0]!, requestId: request!.id, requestedAt, observedAt, quotes,
  }), true);
  const [saved] = await db.select().from(initialLinePicksTable)
    .where(eq(initialLinePicksTable.gameId, gameIds[0]!));
  assert.equal(saved?.status, "locked");
  assert.equal(await verifySavedPick(saved!), true);
  // Week 2 points to a verified pick from the wrong week; week 3 has no
  // selection; week 4 has a complete-looking row with a false model checksum.
  await db.insert(initialWeeklyPicksTable).values([
    { season, week: 1, gameId: gameIds[0]! },
    { season, week: 2, gameId: gameIds[0]! },
  ]);
  const badId = gameIds[3]!;
  await db.insert(initialLinePicksTable).values({
    ...saved!, gameId: badId, season, week: 4,
    models: {
      ...saved!.models!,
      moneyline: { ...saved!.models!.moneyline!, checksum: "incorrect-checksum" },
    },
    inputSourceEvidence: {
      ...saved!.inputSourceEvidence,
      rows: (saved!.inputSourceEvidence!.rows as Array<Record<string, unknown>>)
        .map((row) => ({ ...row, gameId: badId })),
    },
  });
  await db.insert(initialWeeklyPicksTable).values({ season, week: 4, gameId: badId });

  const archive = await readInitialWeeklyPickArchive(season, new Date(kickoffTime.getTime() + 1_000));
  assert.equal(archive.season, season);
  assert.equal(archive.weeks.length, 4);
  const byWeek = new Map(archive.weeks.map((week) => [week.week, week]));
  assert.deepEqual(byWeek.get(1)?.pick, {
    gameId: gameIds[0], teamName: teams.find((team) => team.teamId === saved!.winnerTeamId)!.teamName,
    season, week: 1, probability: saved!.winnerProbability,
    observedAt: observedAt.toISOString(),
  });
  assert.equal(byWeek.get(1)?.reason, null);
  for (const week of [2, 4]) {
    assert.equal(byWeek.get(week)?.pick, null);
    assert.equal(byWeek.get(week)?.reason, "Saved official weekly pick evidence could not be verified.");
  }
  assert.equal(byWeek.get(3)?.pick, null);
  assert.equal(byWeek.get(3)?.reason, "No persisted official weekly selection is available for this week.");
});
