import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { and, eq, sql } from "drizzle-orm";
import {
  dataSyncRunsTable,
  db,
  historicalDepthChartTable,
  nflverseSourceFilesTable,
  playerGameStatsTable,
  snapCountsTable,
  teamGameStatsTable,
  qbGameStatsTable,
} from "@workspace/db";
import { logger } from "./logger";

export const nflverseBaseUrl = "https://github.com/nflverse/nflverse-data/releases/download";
const cacheDirectory = join(process.cwd(), ".cache", "nflverse");
const defaultSeasons = [2021, 2022, 2023, 2024, 2025, 2026];

type CsvRow = Record<string, string>;
type NflverseDataset = "pbp" | "player_stats" | "snap_counts" | "depth_charts";
class NflverseSourceMissingError extends Error {}

export class NflverseMissingSeasonError extends Error {
  readonly season: number;
  readonly dataset: NflverseDataset;

  constructor(dataset: NflverseDataset, season: number) {
    super(`${dataset} ${season}: source is not published yet`);
    this.name = "NflverseMissingSeasonError";
    this.dataset = dataset;
    this.season = season;
  }
}

export function shouldRefreshNflverseSource(options?: { refresh?: boolean }) {
  return options?.refresh === true;
}
type TeamGameAccumulator = {
  season: number;
  week: number;
  gameId: string;
  gameDate: string | null;
  homeScore: number | null;
  awayScore: number | null;
  teamId: string;
  opponentTeamId: string;
  isHome: boolean;
  plays: number;
  epa: number;
  success: number;
  yards: number;
  passPlays: number;
  passDropbacks: number;
  passAttempts: number;
  passSuccesses: number;
  passEpa: number;
  rushPlays: number;
  rushAttempts: number;
  rushSuccesses: number;
  rushEpa: number;
  turnovers: number;
  sacks: number;
  sacksAllowed: number;
  pressures: number;
  explosivePasses: number;
  explosiveRushes: number;
  thirdDownAttempts: number;
  thirdDownConversions: number;
  redZonePlays: number;
  redZoneTouchdowns: number;
  neutralPasses: number;
  neutralPlays: number;
  defensivePlays: number;
  defensiveEpaAllowed: number;
  defensiveStops: number;
  passEpaAllowed: number;
  rushEpaAllowed: number;
  passPlaysAllowed: number;
  rushPlaysAllowed: number;
  passSuccessesAllowed: number;
  rushSuccessesAllowed: number;
  explosivePassesAllowed: number;
  explosiveRushesAllowed: number;
  earlyDownPlays: number;
  earlyDownPasses: number;
  earlyDownSuccesses: number;
  earlyDownEpa: number;
  secondsElapsed: number;
  lastGameSecondsRemaining: number | null;
};

type QbGameAccumulator = {
  gameId: string;
  season: number;
  week: number;
  playerId: string;
  teamId: string;
  opponentTeamId: string;
  dropbacks: number;
  passAttempts: number;
  completions: number;
  passEpa: number;
  passSuccesses: number;
  interceptions: number;
  sacks: number;
  rushAttempts: number;
  rushEpa: number;
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

async function forEachCsvRow(
  filePath: string,
  handler: (row: CsvRow, rowNumber: number) => Promise<void> | void,
) {
  const input = filePath.endsWith(".gz")
    ? createReadStream(filePath).pipe(createGunzip())
    : createReadStream(filePath);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let headers: string[] = [];
  let rowNumber = 0;
  for await (const line of lines) {
    if (headers.length === 0) {
      headers = parseCsvLine(line).map((value) => value.replace(/^\uFEFF/, ""));
      continue;
    }
    if (!line) continue;
    rowNumber += 1;
    const values = parseCsvLine(line);
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    await handler(row, rowNumber);
  }
  return rowNumber;
}

function numberValue(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value: string | undefined): number | null {
  const parsed = numberValue(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function boolNumber(value: string | undefined) {
  return numberValue(value) === 1;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

export function datasetUrl(dataset: NflverseDataset, season: number) {
  if (dataset === "player_stats" && season >= 2025) {
    return `${nflverseBaseUrl}/stats_player/stats_player_week_${season}.csv.gz`;
  }
  if (dataset === "depth_charts") {
    const extension = season >= 2024 ? "csv.gz" : "csv";
    return `${nflverseBaseUrl}/depth_charts/depth_charts_${season}.${extension}`;
  }
  const filePrefix = dataset === "pbp" ? "play_by_play" : dataset;
  return `${nflverseBaseUrl}/${dataset}/${filePrefix}_${season}.csv.gz`;
}

async function fetchWithRetry(url: string, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/octet-stream", "User-Agent": "Gridline/0.2" },
        signal: AbortSignal.timeout(120_000),
      });
      if (response.status === 404) {
        throw new NflverseSourceMissingError("NFLverse source is not published yet");
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (error instanceof NflverseSourceMissingError) throw error;
      lastError = error;
      logger.warn({ error, url, attempt }, "NFLverse download attempt failed");
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("NFLverse download failed");
}

async function acquireDataset(dataset: NflverseDataset, season: number, options?: { refresh?: boolean }) {
  await mkdir(cacheDirectory, { recursive: true });
  const url = datasetUrl(dataset, season);
  const filePath = join(cacheDirectory, basename(new URL(url).pathname));
  await db
    .insert(nflverseSourceFilesTable)
    .values({ dataset, season, sourceUrl: url, localPath: filePath, status: "downloading" })
    .onConflictDoUpdate({
      target: [nflverseSourceFilesTable.dataset, nflverseSourceFilesTable.season],
      set: { sourceUrl: url, localPath: filePath, status: "downloading", startedAt: new Date(), errorMessage: null },
    });
  try {
    let fileStats = await stat(filePath).catch(() => null);
    if (!fileStats || fileStats.size === 0 || shouldRefreshNflverseSource(options)) {
      const response = await fetchWithRetry(url);
      const bytes = Buffer.from(await response.arrayBuffer());
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, bytes);
      await rename(temporaryPath, filePath);
      fileStats = await stat(filePath);
    }
    await db
      .update(nflverseSourceFilesTable)
      .set({ status: "downloaded", fileSizeBytes: fileStats.size })
      .where(and(eq(nflverseSourceFilesTable.dataset, dataset), eq(nflverseSourceFilesTable.season, season)));
    return { url, filePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(nflverseSourceFilesTable)
      .set({
        status: error instanceof NflverseMissingSeasonError ? "missing" : "failed",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(and(eq(nflverseSourceFilesTable.dataset, dataset), eq(nflverseSourceFilesTable.season, season)));
    if (error instanceof NflverseSourceMissingError) throw new NflverseMissingSeasonError(dataset, season);
    throw new Error(`${dataset} ${season}: ${message}`);
  }
}

function createAccumulator(row: CsvRow, teamId: string, opponentTeamId: string): TeamGameAccumulator {
  return {
    season: Number(row.season),
    week: Number(row.week),
    gameId: row.game_id,
    gameDate: row.game_date || null,
    homeScore: numberValue(row.total_home_score),
    awayScore: numberValue(row.total_away_score),
    teamId,
    opponentTeamId,
    isHome: row.home_team === teamId,
    plays: 0,
    epa: 0,
    success: 0,
    yards: 0,
    passPlays: 0,
    passDropbacks: 0,
    passAttempts: 0,
    passSuccesses: 0,
    passEpa: 0,
    rushPlays: 0,
    rushAttempts: 0,
    rushSuccesses: 0,
    rushEpa: 0,
    turnovers: 0,
    sacks: 0,
    sacksAllowed: 0,
    pressures: 0,
    explosivePasses: 0,
    explosiveRushes: 0,
    thirdDownAttempts: 0,
    thirdDownConversions: 0,
    redZonePlays: 0,
    redZoneTouchdowns: 0,
    neutralPasses: 0,
    neutralPlays: 0,
    defensivePlays: 0,
    defensiveEpaAllowed: 0,
    defensiveStops: 0,
    passEpaAllowed: 0,
    rushEpaAllowed: 0,
    passPlaysAllowed: 0,
    rushPlaysAllowed: 0,
    passSuccessesAllowed: 0,
    rushSuccessesAllowed: 0,
    explosivePassesAllowed: 0,
    explosiveRushesAllowed: 0,
    earlyDownPlays: 0,
    earlyDownPasses: 0,
    earlyDownSuccesses: 0,
    earlyDownEpa: 0,
    secondsElapsed: 0,
    lastGameSecondsRemaining: null,
  };
}

async function ingestPlayByPlay(season: number, filePath: string) {
  const games = new Map<string, TeamGameAccumulator>();
  const quarterbacks = new Map<string, QbGameAccumulator>();
  const rows = await forEachCsvRow(filePath, (row) => {
    const posteam = row.posteam;
    const defteam = row.defteam;
    const home = row.home_team;
    const away = row.away_team;
    if (!row.game_id || !posteam || !defteam || !home || !away) return;
    const passPlay = boolNumber(row.pass_attempt) || boolNumber(row.qb_dropback) || boolNumber(row.sack);
    const rushPlay = boolNumber(row.rush_attempt);
    if (!passPlay && !rushPlay) return;
    const offenseKey = `${row.game_id}:${posteam}`;
    const defenseKey = `${row.game_id}:${defteam}`;
    const offense = games.get(offenseKey) ?? createAccumulator(row, posteam, defteam);
    const defense = games.get(defenseKey) ?? createAccumulator(row, defteam, posteam);
    games.set(offenseKey, offense);
    games.set(defenseKey, defense);
    const epa = numberValue(row.epa) ?? 0;
    const success = numberValue(row.success) ?? (epa > 0 ? 1 : 0);
    const yards = numberValue(row.yards_gained) ?? 0;
    const totalHomeScore = numberValue(row.total_home_score);
    const totalAwayScore = numberValue(row.total_away_score);
    if (totalHomeScore !== null) {
      offense.homeScore = totalHomeScore;
      defense.homeScore = totalHomeScore;
    }
    if (totalAwayScore !== null) {
      offense.awayScore = totalAwayScore;
      defense.awayScore = totalAwayScore;
    }
    const down = integerValue(row.down);
    const earlyDown = down === 1 || down === 2;
    offense.plays += 1;
    offense.epa += epa;
    offense.success += success;
    offense.yards += yards;
    defense.defensivePlays += 1;
    defense.defensiveEpaAllowed += epa;
    defense.defensiveStops += success ? 0 : 1;
    if (earlyDown) {
      offense.earlyDownPlays += 1;
      offense.earlyDownEpa += epa;
      if (passPlay) offense.earlyDownPasses += 1;
      if (success) offense.earlyDownSuccesses += 1;
      defense.earlyDownPlays += 1;
      defense.earlyDownEpa += epa;
      if (success) defense.earlyDownSuccesses += 1;
    }
    const secondsRemaining = numberValue(row.game_seconds_remaining);
    if (secondsRemaining !== null && offense.lastGameSecondsRemaining !== null) {
      const elapsed = offense.lastGameSecondsRemaining - secondsRemaining;
      if (elapsed > 0 && elapsed <= 60) offense.secondsElapsed += elapsed;
    }
    if (secondsRemaining !== null) offense.lastGameSecondsRemaining = secondsRemaining;
    if (passPlay) {
      offense.passPlays += 1;
      if (boolNumber(row.qb_dropback) || boolNumber(row.sack)) offense.passDropbacks += 1;
      if (boolNumber(row.pass_attempt)) offense.passAttempts += 1;
      if (success) offense.passSuccesses += 1;
      offense.passEpa += epa;
      if ((numberValue(row.air_yards) ?? 0) >= 15) offense.explosivePasses += 1;
      defense.passPlaysAllowed += 1;
      defense.passEpaAllowed += epa;
      if (success) defense.passSuccessesAllowed += 1;
      if ((numberValue(row.air_yards) ?? 0) >= 15) defense.explosivePassesAllowed += 1;
    }
    if (rushPlay) {
      offense.rushPlays += 1;
      offense.rushAttempts += 1;
      if (success) offense.rushSuccesses += 1;
      offense.rushEpa += epa;
      if (yards >= 10) offense.explosiveRushes += 1;
      defense.rushPlaysAllowed += 1;
      defense.rushEpaAllowed += epa;
      if (success) defense.rushSuccessesAllowed += 1;
      if (yards >= 10) defense.explosiveRushesAllowed += 1;
    }
    if (boolNumber(row.interception) || boolNumber(row.fumble_lost)) offense.turnovers += 1;
    if (boolNumber(row.sack)) {
      defense.sacks += 1;
      offense.sacksAllowed += 1;
      defense.pressures += 1;
    } else if (boolNumber(row.qb_hit)) {
      defense.pressures += 1;
    }
    const passer = row.passer_player_id;
    if (passer && (boolNumber(row.qb_dropback) || boolNumber(row.pass_attempt) || boolNumber(row.sack))) {
      const qbKey = `${row.game_id}:${passer}`;
      const qb = quarterbacks.get(qbKey) ?? {
        gameId: row.game_id,
        season: Number(row.season),
        week: Number(row.week),
        playerId: passer,
        teamId: posteam,
        opponentTeamId: defteam,
        dropbacks: 0,
        passAttempts: 0,
        completions: 0,
        passEpa: 0,
        passSuccesses: 0,
        interceptions: 0,
        sacks: 0,
        rushAttempts: 0,
        rushEpa: 0,
      };
      if (boolNumber(row.qb_dropback) || boolNumber(row.sack)) qb.dropbacks += 1;
      if (boolNumber(row.pass_attempt)) qb.passAttempts += 1;
      if (boolNumber(row.complete_pass)) qb.completions += 1;
      qb.passEpa += epa;
      if (success) qb.passSuccesses += 1;
      if (boolNumber(row.interception)) qb.interceptions += 1;
      if (boolNumber(row.sack)) qb.sacks += 1;
      quarterbacks.set(qbKey, qb);
    }
    const rusher = row.rusher_player_id;
    if (rusher && rushPlay) {
      const qb = quarterbacks.get(`${row.game_id}:${rusher}`);
      if (qb) {
        qb.rushAttempts += 1;
        qb.rushEpa += epa;
      }
    }
    if (boolNumber(row.third_down_converted) || boolNumber(row.third_down_failed)) {
      offense.thirdDownAttempts += 1;
      if (boolNumber(row.third_down_converted)) offense.thirdDownConversions += 1;
    }
    if ((numberValue(row.yardline_100) ?? 101) <= 20) {
      offense.redZonePlays += 1;
      if (boolNumber(row.touchdown)) offense.redZoneTouchdowns += 1;
    }
    const quarter = integerValue(row.qtr) ?? 0;
    const scoreDiff = (numberValue(row.posteam_score) ?? 0) - (numberValue(row.defteam_score) ?? 0);
    if (quarter > 0 && quarter <= 3 && Math.abs(scoreDiff) <= 8) {
      offense.neutralPlays += 1;
      if (passPlay) offense.neutralPasses += 1;
    }
  });

  const values = [...games.values()].map((item) => ({
    season: item.season || season,
    week: item.week,
    gameId: item.gameId,
    gameDate: item.gameDate,
    teamScore: item.isHome ? item.homeScore : item.awayScore,
    opponentScore: item.isHome ? item.awayScore : item.homeScore,
    teamId: item.teamId,
    opponentTeamId: item.opponentTeamId,
    isHome: item.isHome,
    plays: item.plays,
    epaPerPlay: ratio(item.epa, item.plays),
    passEpa: item.passEpa,
    rushEpa: item.rushEpa,
    offensiveSuccessRate: ratio(item.success, item.plays),
    defensiveEpaAllowedPerPlay: ratio(item.defensiveEpaAllowed, item.defensivePlays),
    defensiveSuccessRate: ratio(item.defensiveStops, item.defensivePlays),
    yardsPerPlay: ratio(item.yards, item.plays),
    turnovers: item.turnovers,
    sacks: item.sacks,
    pressures: item.pressures,
    explosivePassRate: ratio(item.explosivePasses, item.passPlays),
    explosiveRushRate: ratio(item.explosiveRushes, item.rushPlays),
    thirdDownRate: ratio(item.thirdDownConversions, item.thirdDownAttempts),
    redZoneRate: ratio(item.redZoneTouchdowns, item.redZonePlays),
    neutralScriptPassRate: ratio(item.neutralPasses, item.neutralPlays),
    passDropbacks: item.passDropbacks,
    passAttempts: item.passAttempts,
    rushAttempts: item.rushAttempts,
    passEpaPerDropback: ratio(item.passEpa, item.passDropbacks),
    rushEpaPerRush: ratio(item.rushEpa, item.rushAttempts),
    passingSuccessRate: ratio(item.passSuccesses, item.passPlays),
    rushingSuccessRate: ratio(item.rushSuccesses, item.rushAttempts),
    sackRateAllowed: ratio(item.sacksAllowed, item.passDropbacks),
    earlyDownPassRate: ratio(item.earlyDownPasses, item.earlyDownPlays),
    earlyDownSuccessRate: ratio(item.earlyDownSuccesses, item.earlyDownPlays),
    earlyDownEpaPerPlay: ratio(item.earlyDownEpa, item.earlyDownPlays),
    secondsPerPlay: ratio(item.secondsElapsed, item.plays),
    passEpaAllowed: ratio(item.passEpaAllowed, item.passPlaysAllowed),
    rushEpaAllowed: ratio(item.rushEpaAllowed, item.rushPlaysAllowed),
    passSuccessRateAllowed: ratio(item.passSuccessesAllowed, item.passPlaysAllowed),
    rushSuccessRateAllowed: ratio(item.rushSuccessesAllowed, item.rushPlaysAllowed),
    defensiveSackRate: ratio(item.sacks, item.passPlaysAllowed),
    earlyDownDefensiveEpa: ratio(item.earlyDownEpa, item.earlyDownPlays),
    explosivePassRateAllowed: ratio(item.explosivePassesAllowed, item.passPlaysAllowed),
    explosiveRushRateAllowed: ratio(item.explosiveRushesAllowed, item.rushPlaysAllowed),
    sourceUpdatedAt: new Date(),
  }));
  for (let index = 0; index < values.length; index += 250) {
    const batch = values.slice(index, index + 250);
    await db.insert(teamGameStatsTable).values(batch).onConflictDoUpdate({
      target: [
        teamGameStatsTable.season,
        teamGameStatsTable.week,
        teamGameStatsTable.gameId,
        teamGameStatsTable.teamId,
      ],
      set: {
        plays: sql`excluded.plays`,
        epaPerPlay: sql`excluded.epa_per_play`,
        passEpa: sql`excluded.pass_epa`,
        rushEpa: sql`excluded.rush_epa`,
        teamScore: sql`excluded.team_score`,
        opponentScore: sql`excluded.opponent_score`,
        offensiveSuccessRate: sql`excluded.offensive_success_rate`,
        defensiveEpaAllowedPerPlay: sql`excluded.defensive_epa_allowed_per_play`,
        defensiveSuccessRate: sql`excluded.defensive_success_rate`,
        yardsPerPlay: sql`excluded.yards_per_play`,
        turnovers: sql`excluded.turnovers`,
        sacks: sql`excluded.sacks`,
        pressures: sql`excluded.pressures`,
        explosivePassRate: sql`excluded.explosive_pass_rate`,
        explosiveRushRate: sql`excluded.explosive_rush_rate`,
        thirdDownRate: sql`excluded.third_down_rate`,
        redZoneRate: sql`excluded.red_zone_rate`,
        neutralScriptPassRate: sql`excluded.neutral_script_pass_rate`,
        passDropbacks: sql`excluded.pass_dropbacks`,
        passAttempts: sql`excluded.pass_attempts`,
        rushAttempts: sql`excluded.rush_attempts`,
        passEpaPerDropback: sql`excluded.pass_epa_per_dropback`,
        rushEpaPerRush: sql`excluded.rush_epa_per_rush`,
        passingSuccessRate: sql`excluded.passing_success_rate`,
        rushingSuccessRate: sql`excluded.rushing_success_rate`,
        sackRateAllowed: sql`excluded.sack_rate_allowed`,
        earlyDownPassRate: sql`excluded.early_down_pass_rate`,
        earlyDownSuccessRate: sql`excluded.early_down_success_rate`,
        earlyDownEpaPerPlay: sql`excluded.early_down_epa_per_play`,
        secondsPerPlay: sql`excluded.seconds_per_play`,
        passEpaAllowed: sql`excluded.pass_epa_allowed`,
        rushEpaAllowed: sql`excluded.rush_epa_allowed`,
        passSuccessRateAllowed: sql`excluded.pass_success_rate_allowed`,
        rushSuccessRateAllowed: sql`excluded.rush_success_rate_allowed`,
        defensiveSackRate: sql`excluded.defensive_sack_rate`,
        earlyDownDefensiveEpa: sql`excluded.early_down_defensive_epa`,
        explosivePassRateAllowed: sql`excluded.explosive_pass_rate_allowed`,
        explosiveRushRateAllowed: sql`excluded.explosive_rush_rate_allowed`,
        sourceUpdatedAt: new Date(),
      },
    });
  }
  const qbValues = [...quarterbacks.values()].map((item) => ({
    ...item,
    participationEvidence: "play_by_play_passer_or_rusher",
    sourceUpdatedAt: new Date(),
  }));
  for (let index = 0; index < qbValues.length; index += 250) {
    await db.insert(qbGameStatsTable).values(qbValues.slice(index, index + 250)).onConflictDoUpdate({
      target: [qbGameStatsTable.gameId, qbGameStatsTable.playerId],
      set: {
        season: sql`excluded.season`,
        week: sql`excluded.week`,
        teamId: sql`excluded.team_id`,
        opponentTeamId: sql`excluded.opponent_team_id`,
        dropbacks: sql`excluded.dropbacks`,
        passAttempts: sql`excluded.pass_attempts`,
        completions: sql`excluded.completions`,
        passEpa: sql`excluded.pass_epa`,
        passSuccesses: sql`excluded.pass_successes`,
        interceptions: sql`excluded.interceptions`,
        sacks: sql`excluded.sacks`,
        rushAttempts: sql`excluded.rush_attempts`,
        rushEpa: sql`excluded.rush_epa`,
        participationEvidence: sql`excluded.participation_evidence`,
        sourceUpdatedAt: new Date(),
      },
    });
  }
  return { sourceRows: rows, records: values.length, quarterbackRecords: qbValues.length };
}

async function ingestPlayerStats(season: number, filePath: string) {
  const values: Array<typeof playerGameStatsTable.$inferInsert> = [];
  let inserted = 0;
  const flush = async () => {
    if (values.length === 0) return;
    const batch = values.splice(0);
    await db.insert(playerGameStatsTable).values(batch).onConflictDoUpdate({
      target: [
        playerGameStatsTable.playerId,
        playerGameStatsTable.season,
        playerGameStatsTable.week,
        playerGameStatsTable.seasonType,
        playerGameStatsTable.opponentTeamId,
      ],
      set: {
        playerName: sql`excluded.player_name`,
        position: sql`excluded.position`,
        teamId: sql`excluded.team_id`,
        completions: sql`excluded.completions`,
        attempts: sql`excluded.attempts`,
        passingYards: sql`excluded.passing_yards`,
        passingTds: sql`excluded.passing_tds`,
        interceptions: sql`excluded.interceptions`,
        sacks: sql`excluded.sacks`,
        carries: sql`excluded.carries`,
        rushingYards: sql`excluded.rushing_yards`,
        rushingTds: sql`excluded.rushing_tds`,
        targets: sql`excluded.targets`,
        receptions: sql`excluded.receptions`,
        receivingYards: sql`excluded.receiving_yards`,
        receivingTds: sql`excluded.receiving_tds`,
        receivingEpa: sql`excluded.receiving_epa`,
        rushingEpa: sql`excluded.rushing_epa`,
        passingEpa: sql`excluded.passing_epa`,
        sourceUpdatedAt: new Date(),
      },
    });
    inserted += batch.length;
  };
  const rows = await forEachCsvRow(filePath, async (row) => {
    const parsed = parsePlayerStatsRow(row, season);
    if (!parsed) return;
    values.push(parsed);
    if (values.length >= 500) await flush();
  });
  await flush();
  return { sourceRows: rows, records: inserted };
}

export function parsePlayerStatsRow(row: CsvRow, season: number): typeof playerGameStatsTable.$inferInsert | null {
  if (!("player_id" in row && "season" in row && "week" in row
    && "opponent_team" in row && ("team" in row || "recent_team" in row))) {
    throw new Error(`player_stats ${season}: missing required player, season, week or team columns`);
  }
  if (!row.player_id || !row.week || row.season_type === "PRE" || integerValue(row.season) !== season) return null;
  return {
    playerId: row.player_id,
    playerName: row.player_display_name || row.player_name || row.player_id,
    position: row.position || null,
    teamId: row.team || row.recent_team || null,
    opponentTeamId: row.opponent_team || null,
    season: season,
    week: integerValue(row.week) ?? 0,
    seasonType: row.season_type || "REG",
    completions: integerValue(row.completions),
    attempts: integerValue(row.attempts),
    passingYards: numberValue(row.passing_yards),
    passingTds: integerValue(row.passing_tds),
    interceptions: integerValue(row.passing_interceptions ?? row.interceptions),
    sacks: integerValue(row.sacks_suffered ?? row.sacks),
    carries: integerValue(row.carries),
    rushingYards: numberValue(row.rushing_yards),
    rushingTds: integerValue(row.rushing_tds),
    targets: integerValue(row.targets),
    receptions: integerValue(row.receptions),
    receivingYards: numberValue(row.receiving_yards),
    receivingTds: integerValue(row.receiving_tds),
    receivingEpa: numberValue(row.receiving_epa),
    rushingEpa: numberValue(row.rushing_epa),
    passingEpa: numberValue(row.passing_epa),
  };
}

async function ingestSnapCounts(season: number, filePath: string) {
  const values: Array<typeof snapCountsTable.$inferInsert> = [];
  let inserted = 0;
  const flush = async () => {
    if (values.length === 0) return;
    const batch = values.splice(0);
    await db.insert(snapCountsTable).values(batch).onConflictDoUpdate({
      target: [snapCountsTable.gameId, snapCountsTable.playerId],
      set: {
        playerName: sql`excluded.player_name`,
        position: sql`excluded.position`,
        teamId: sql`excluded.team_id`,
        opponentTeamId: sql`excluded.opponent_team_id`,
        offenseSnaps: sql`excluded.offense_snaps`,
        offensePct: sql`excluded.offense_pct`,
        defenseSnaps: sql`excluded.defense_snaps`,
        defensePct: sql`excluded.defense_pct`,
        specialTeamsSnaps: sql`excluded.special_teams_snaps`,
        specialTeamsPct: sql`excluded.special_teams_pct`,
        sourceUpdatedAt: new Date(),
      },
    });
    inserted += batch.length;
  };
  const rows = await forEachCsvRow(filePath, async (row) => {
    if (!row.game_id || !row.player || !row.team) return;
    values.push({
      gameId: row.game_id,
      season: integerValue(row.season) ?? season,
      week: integerValue(row.week) ?? 0,
      playerId: row.pfr_player_id || `${row.team}:${row.player}`,
      playerName: row.player,
      position: row.position || null,
      teamId: row.team,
      opponentTeamId: row.opponent || null,
      offenseSnaps: integerValue(row.offense_snaps),
      offensePct: numberValue(row.offense_pct),
      defenseSnaps: integerValue(row.defense_snaps),
      defensePct: numberValue(row.defense_pct),
      specialTeamsSnaps: integerValue(row.st_snaps),
      specialTeamsPct: numberValue(row.st_pct),
    });
    if (values.length >= 500) await flush();
  });
  await flush();
  return { sourceRows: rows, records: inserted };
}

async function ingestHistoricalDepthCharts(season: number, filePath: string) {
  const values: Array<typeof historicalDepthChartTable.$inferInsert> = [];
  let inserted = 0;
  const flush = async () => {
    if (values.length === 0) return;
    const batch = [...new Map(values.splice(0).map((item) => [item.sourceKey, item])).values()];
    await db.insert(historicalDepthChartTable).values(batch).onConflictDoUpdate({
      target: historicalDepthChartTable.sourceKey,
      set: {
        playerName: sql`excluded.player_name`,
        depthPosition: sql`excluded.depth_position`,
        role: sql`excluded.role`,
        sourceSnapshotAt: sql`excluded.source_snapshot_at`,
        sourceUpdatedAt: new Date(),
      },
    });
    inserted += batch.length;
  };
  const rows = await forEachCsvRow(filePath, async (row) => {
    const modernSnapshot = Boolean(row.dt && row.team);
    const teamId = modernSnapshot ? row.team : row.club_code;
    const week = modernSnapshot ? 0 : integerValue(row.week);
    if (!teamId || week === null || row.game_type === "PRE") return;
    const depthPosition = integerValue(modernSnapshot ? row.pos_rank : row.depth_team);
    const playerName = modernSnapshot
      ? row.player_name
      : row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ");
    if (!playerName) return;
    const playerId = row.gsis_id || row.espn_id || row.elias_id || `${teamId}:${playerName.toLowerCase().replace(/\s+/g, "-")}`;
    const position = modernSnapshot ? row.pos_abb || row.pos_name : row.position || row.depth_position;
    const sourceSnapshotAt = modernSnapshot && row.dt ? new Date(row.dt) : null;
    const sourceKey = modernSnapshot
      ? `${season}:${row.dt}:${teamId}:${playerId}:${position}`
      : `${season}:${week}:${teamId}:${playerId}:${position}`;
    values.push({
      sourceKey,
      season: integerValue(row.season) ?? season,
      week,
      teamId,
      playerId,
      playerName,
      position: position || null,
      depthPosition,
      role: depthPosition === 1 ? "starter" : "backup",
      sourceSnapshotAt,
    });
    if (values.length >= 500) await flush();
  });
  await flush();
  return { sourceRows: rows, records: inserted };
}

export async function syncNflverseHistory(
  seasons = defaultSeasons,
  options?: { jobKey?: string; scheduledFor?: Date; refresh?: boolean; completedWindow?: string; datasets?: NflverseDataset[] },
) {
  const [run] = await db
    .insert(dataSyncRunsTable)
    .values({
      provider: "nflverse",
      status: "running",
      jobKey: options?.jobKey ?? null,
      scheduledFor: options?.scheduledFor ?? null,
    })
    .returning({ id: dataSyncRunsTable.id });
  const failures: string[] = [];
  const missingDatasets: string[] = [];
  let recordsProcessed = 0;
  try {
    for (const season of seasons) {
      for (const dataset of options?.datasets ?? (["pbp", "player_stats", "snap_counts", "depth_charts"] as const)) {
        try {
          const source = await acquireDataset(dataset, season, { refresh: options?.refresh });
          const result =
            dataset === "pbp"
              ? await ingestPlayByPlay(season, source.filePath)
              : dataset === "player_stats"
                ? await ingestPlayerStats(season, source.filePath)
                : dataset === "snap_counts"
                  ? await ingestSnapCounts(season, source.filePath)
                  : await ingestHistoricalDepthCharts(season, source.filePath);
          if (result.records === 0) {
            throw new Error(`${dataset} ${season}: source contains no usable rows for the requested season`);
          }
          recordsProcessed += result.records;
          await db
            .update(nflverseSourceFilesTable)
            .set({ status: "success", rowsProcessed: result.sourceRows, completedAt: new Date(), errorMessage: null })
            .where(and(eq(nflverseSourceFilesTable.dataset, dataset), eq(nflverseSourceFilesTable.season, season)));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(message);
          if (error instanceof NflverseMissingSeasonError) missingDatasets.push(`${dataset}:${season}`);
          await db
            .update(nflverseSourceFilesTable)
            .set({ status: "failed", errorMessage: message, completedAt: new Date() })
            .where(and(eq(nflverseSourceFilesTable.dataset, dataset), eq(nflverseSourceFilesTable.season, season)));
          logger.error({ error, dataset, season }, "NFLverse dataset ingestion failed");
        }
      }
    }
    const handledMissingSeason = failures.length > 0 && failures.length === missingDatasets.length;
    const status = failures.length === 0
      ? "success"
      : handledMissingSeason
        ? "skipped"
        : recordsProcessed > 0
          ? "partial"
          : "failed";
    await db
      .update(dataSyncRunsTable)
      .set({
        status,
        completedAt: new Date(),
        recordsProcessed,
        errorMessage: failures.length && !handledMissingSeason ? failures.join("; ").slice(0, 8_000) : null,
        skipReason: handledMissingSeason ? "NFLverse has not published the requested season yet." : null,
        metadata: {
          refresh: Boolean(options?.refresh),
          completedWindow: options?.completedWindow ?? null,
          handledMissingSeason,
          missingDatasets,
        },
      })
      .where(eq(dataSyncRunsTable.id, run.id));
    return { status, recordsProcessed, failures, handledMissingSeason, missingDatasets, completedWindow: options?.completedWindow ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(dataSyncRunsTable)
      .set({ status: "failed", completedAt: new Date(), recordsProcessed, errorMessage: message, metadata: { refresh: Boolean(options?.refresh), completedWindow: options?.completedWindow ?? null } })
      .where(eq(dataSyncRunsTable.id, run.id));
    throw error;
  }
}

export async function refreshNflversePlayByPlay(seasons = defaultSeasons) {
  let recordsProcessed = 0;
  const failures: string[] = [];
  for (const season of seasons) {
    try {
      const source = await acquireDataset("pbp", season);
      const result = await ingestPlayByPlay(season, source.filePath);
      recordsProcessed += result.records;
      await db.update(nflverseSourceFilesTable)
        .set({ status: "success", rowsProcessed: result.sourceRows, completedAt: new Date(), errorMessage: null })
        .where(and(eq(nflverseSourceFilesTable.dataset, "pbp"), eq(nflverseSourceFilesTable.season, season)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      logger.error({ error, season }, "NFLverse play-by-play refresh failed");
    }
  }
  return { seasons, recordsProcessed, failures, status: failures.length ? "partial" : "success" };
}

export async function getNflverseHealth() {
  const [[summary], [playerSummary], [snapSummary], [depthSummary]] = await Promise.all([
    db
      .select({
        seasons: sql<number>`count(distinct ${teamGameStatsTable.season})::int`,
        games: sql<number>`count(distinct ${teamGameStatsTable.gameId})::int`,
        teamGames: sql<number>`count(*)::int`,
        lastUpdated: sql<Date | null>`max(${teamGameStatsTable.sourceUpdatedAt})`,
      })
      .from(teamGameStatsTable),
    db.select({ records: sql<number>`count(*)::int` }).from(playerGameStatsTable),
    db.select({ records: sql<number>`count(*)::int` }).from(snapCountsTable),
    db.select({ records: sql<number>`count(*)::int` }).from(historicalDepthChartTable),
  ]);
  const failures = await db
    .select({ dataset: nflverseSourceFilesTable.dataset, season: nflverseSourceFilesTable.season, error: nflverseSourceFilesTable.errorMessage })
    .from(nflverseSourceFilesTable)
    .where(eq(nflverseSourceFilesTable.status, "failed"));
  const loaded = (summary?.teamGames ?? 0) > 0;
  return {
    status: loaded ? (failures.length ? "stale" as const : "current" as const) : "stale" as const,
    detail: loaded
      ? `${summary.seasons} seasons, ${summary.games} games, ${summary.teamGames} team-game rows loaded.`
      : "Historical sync has not completed.",
    lastUpdated: summary?.lastUpdated ? new Date(summary.lastUpdated).toISOString() : null,
    requestsToday: 0,
    requestsThisMonth: 0,
    remainingQuota: "Public dataset",
    metadata: {
      seasonsLoaded: summary?.seasons ?? 0,
      gamesLoaded: summary?.games ?? 0,
      teamGameRows: summary?.teamGames ?? 0,
      playerGameRows: playerSummary?.records ?? 0,
      snapCountRows: snapSummary?.records ?? 0,
      historicalDepthRows: depthSummary?.records ?? 0,
      failures: failures.map((item) => `${item.dataset} ${item.season}: ${item.error ?? "failed"}`),
    },
  };
}