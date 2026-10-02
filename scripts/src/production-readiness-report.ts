// This report is deliberately read-only. It only uses SELECTs and must never
// be used as a substitute for a scheduler tick or an end-to-end game test.
// The deployed API separately runs a metadata-free database smoke query before
// starting its API and worker processes.
import { db, pool } from "@workspace/db";
import {
  dataSyncRunsTable,
  gameProjectionRunsTable,
  gamesTable,
  nflverseSourceFilesTable,
  oddsApiRequestsTable,
  oddsEventAuditsTable,
  pregameTeamFeaturesTable,
  schedulerJobsTable,
  sportsbookOddsTable,
  teamsTable,
} from "@workspace/db";
import { asc, desc } from "drizzle-orm";

const now = new Date();
const formatArgument = process.argv.find((argument) => argument.startsWith("--format="));
const formatIndex = process.argv.indexOf("--format");
const format = formatArgument?.split("=")[1]
  ?? (formatIndex >= 0 ? process.argv[formatIndex + 1] : undefined)
  ?? (process.argv.includes("--markdown") ? "markdown" : "json");
const awayArgument = process.argv.find((argument) => argument.startsWith("--away="))?.split("=")[1]?.toUpperCase();
const homeArgument = process.argv.find((argument) => argument.startsWith("--home="))?.split("=")[1]?.toUpperCase();

const terminalStatuses = ["final", "completed", "postponed", "canceled"];
type ReadinessStatus = "pass" | "warning" | "pending";
type SyncRow = typeof dataSyncRunsTable.$inferSelect;
type SchedulerRow = typeof schedulerJobsTable.$inferSelect;
type OddsRequestRow = typeof oddsApiRequestsTable.$inferSelect;
type OddsRequestEvidence = Pick<OddsRequestRow,
  "id" | "requestedAt" | "status" | "httpStatus" | "recordsProcessed" |
  "creditsUsed" | "creditsRemaining" | "errorMessage">;

type GameRow = {
  gameId: string;
  season: number;
  week: number;
  kickoffTime: Date | null;
  gameStatus: string;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  homeTeamId?: string;
  awayTeamId?: string;
};
type FeatureRow = {
  gameId: string;
  featureVersion: string;
  kickoffTime: Date;
  generatedAt: Date;
  lowSample: boolean;
};
type ProjectionRunRow = {
  season: number;
  week: number;
  generatedAt: Date;
  modelVersion: string;
  games: Array<{ gameId: string }>;
};
type NflverseFileRow = {
  dataset: string;
  season: number;
  status: string;
  rowsProcessed: number;
  startedAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
};
type OddsQuoteRow = {
  gameId: string;
  sportsbook: string;
  market: string;
  selection: string;
  point: number | null;
  price: number;
  capturedAt: Date;
};
type OddsAuditRow = {
  requestId: number;
  auditedAt: Date;
  observationsReceived: number;
  observationsSaved: number;
  duplicateObservations: number;
  rejectedObservations: number;
  outcome: string;
  reason: string;
};
type Evidence = Record<string, unknown>;
type ProductionStep = {
  number: number;
  name: string;
  status: ReadinessStatus;
  evidence: Evidence;
  note?: string;
};
type ReadinessReport = {
  generatedAt: string;
  databaseTarget: string;
  readOnly: boolean;
  verdict: string;
  productionCycleSteps: ProductionStep[];
  summary: {
    pass: number;
    warning: number;
    pending: number;
    note: string;
  };
  blockers: Array<{ check: string; status: ReadinessStatus; reason: string }>;
  safetyConfirmations: Record<string, boolean>;
};

function isTerminal(status: string | null | undefined) {
  const value = String(status ?? "").toLowerCase();
  return terminalStatuses.some((part) => value.includes(part));
}

function normalizedGameState(game: Pick<GameRow, "gameStatus" | "kickoffTime">) {
  const status = (game.gameStatus ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (status.includes("postpon")) return "postponed";
  if (status.includes("cancel")) return "cancelled";
  if (status.includes("final") || status.includes("completed") || status === "closed") return "final";
  if (status.includes("progress") || status.includes("halftime") || status.includes("quarter")) return "live";
  if (status.includes("scheduled") || status.includes("pre game") || status === "status unknown") {
    return game.kickoffTime ? "pregame" : "scheduled";
  }
  return game.kickoffTime && game.kickoffTime <= now ? "live" : game.kickoffTime ? "pregame" : "scheduled";
}

function buildRecords(
  teams: Array<{ teamId: string; abbreviation: string; teamName: string }>,
  games: GameRow[],
) {
  const records = new Map(teams.map((team) => [team.teamId, { ...team, wins: 0, losses: 0, ties: 0, games: 0 }]));
  for (const game of games) {
    if (game.week < 1 || game.week > 18 || normalizedGameState(game) !== "final"
      || game.finalHomeScore === null || game.finalAwayScore === null
      || !Number.isInteger(game.finalHomeScore) || !Number.isInteger(game.finalAwayScore)) continue;
    const home = records.get(game.homeTeamId ?? "");
    const away = records.get(game.awayTeamId ?? "");
    if (!home || !away) continue;
    home.games += 1; away.games += 1;
    if (game.finalHomeScore === game.finalAwayScore) { home.ties += 1; away.ties += 1; }
    else if (game.finalHomeScore > game.finalAwayScore) { home.wins += 1; away.losses += 1; }
    else { away.wins += 1; home.losses += 1; }
  }
  return [...records.values()].sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
}

function verifyRecords(
  records: Array<{ abbreviation: string; wins: number; losses: number; ties: number; games: number }>,
  targetWeek: number | null,
  completedPriorGames: number,
) {
  const discrepancies = records
    .filter((record) => record.games !== record.wins + record.losses + record.ties)
    .map((record) => `${record.abbreviation}: record game total does not match W-L-T`);
  if (records.length !== 32) discrepancies.push(`Expected 32 teams, found ${records.length}`);
  // Tonight's Week 2 gate has an authoritative, schedule-independent
  // expectation: Week 1 contains 16 completed games and every team enters 1-0,
  // 0-1, or 0-0-1. Do not let a structurally valid all-zero league pass.
  if (targetWeek === 2) {
    if (completedPriorGames !== 16) {
      discrepancies.push(`Expected 16 authoritative Week 1 games, found ${completedPriorGames}`);
    }
    for (const record of records) {
      if (record.games !== 1) discrepancies.push(`${record.abbreviation}: expected 1 completed game entering Week 2, found ${record.games}`);
    }
  }
  return {
    expectedTeamCount: 32,
    actualTeamCount: records.length,
    targetWeek,
    completedPriorGames,
    complete: discrepancies.length === 0,
    discrepancies,
  };
}

function isUpcoming(game: Pick<GameRow, "kickoffTime" | "gameStatus">) {
  return Boolean(game.kickoffTime && game.kickoffTime > now && !isTerminal(game.gameStatus));
}

function iso(value: Date | null | undefined) {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

function ageHours(value: Date | null | undefined) {
  return value instanceof Date ? Math.max(0, (now.getTime() - value.getTime()) / 3_600_000) : null;
}

function statusForFreshness(
  latestSuccess: SyncRow | undefined,
  latestRun: SyncRow | undefined,
  nextRunAt: Date | null | undefined,
  maxAgeHours: number,
  noDataIsPending = false,
) : ReadinessStatus {
  if (!latestSuccess) return noDataIsPending ? "pending" : "warning";
  if (latestRun && latestRun.status !== "success" &&
    (!latestSuccess.completedAt || !latestRun.startedAt || latestRun.startedAt >= latestSuccess.completedAt)) {
    return "warning";
  }
  if ((ageHours(latestSuccess.completedAt) ?? Infinity) > maxAgeHours) return "warning";
  if (!nextRunAt) return "warning";
  return "pass";
}

function syncEvidence(
  provider: string,
  runs: SyncRow[],
  jobs: SchedulerRow[],
  maxAgeHours: number,
  pendingWithoutData = false,
) : Evidence & { status: ReadinessStatus } {
  const providerRuns = runs.filter((run) => run.provider === provider);
  const successes = providerRuns.filter((run) => run.status === "success" && run.completedAt);
  const latestSuccess = successes[0];
  const latestRun = providerRuns[0];
  const providerJobs = jobs.filter((job) => job.provider === provider);
  const nextRunAt = providerJobs
    .filter((job) => job.enabled && job.nextRunAt)
    .sort((left, right) => (left.nextRunAt?.getTime() ?? Infinity) - (right.nextRunAt?.getTime() ?? Infinity))[0]?.nextRunAt ?? null;
  const latestFailure = providerRuns.find((run) => run.status !== "success" && run.status !== "skipped");
  const latestRunIsProblem = Boolean(latestRun && latestRun.status !== "success" && latestRun.status !== "skipped");
  const stale = !latestSuccess ||
    (ageHours(latestSuccess.completedAt) ?? Infinity) > maxAgeHours ||
    Boolean(latestFailure && (!latestSuccess.completedAt || latestFailure.startedAt >= latestSuccess.completedAt)) ||
    Boolean(latestRunIsProblem && latestRun && (!latestSuccess?.completedAt || latestRun.startedAt >= latestSuccess.completedAt));
  const freshnessCleared = !stale && Boolean(nextRunAt);
  return {
    status: statusForFreshness(latestSuccess, latestRun, nextRunAt, maxAgeHours, pendingWithoutData),
    provider,
    lastSuccessfulSync: latestSuccess ? {
      completedAt: iso(latestSuccess.completedAt),
      startedAt: iso(latestSuccess.startedAt),
      jobKey: latestSuccess.jobKey,
    } : null,
    recordsAdded: null,
    recordsProcessed: latestSuccess?.recordsProcessed ?? null,
    duplicatesSkipped: null,
    failures: providerRuns.filter((run) => run.status !== "success" && run.status !== "skipped").length,
    latestFailure: latestFailure ? {
      startedAt: iso(latestFailure.startedAt),
      completedAt: iso(latestFailure.completedAt),
      error: latestFailure.errorMessage,
    } : null,
    error: latestRun?.errorMessage ?? null,
    latestRun: latestRun ? {
      status: latestRun.status,
      startedAt: iso(latestRun.startedAt),
      completedAt: iso(latestRun.completedAt),
      recordsProcessed: latestRun.recordsProcessed,
      error: latestRun.errorMessage,
      skipReason: latestRun.skipReason,
    } : null,
    nextScheduledSync: iso(nextRunAt),
    schedulerRows: providerJobs.length,
    freshnessHours: ageHours(latestSuccess?.completedAt),
    freshnessExpectationHours: maxAgeHours,
    stale,
    freshnessCleared,
    staleStatus: stale ? "stale" : "cleared",
    note: !latestSuccess
      ? "No successful synchronization is persisted; this report does not claim freshness."
      : undefined,
  };
}

function oddsEvidence(
  requests: OddsRequestEvidence[],
  quotes: OddsQuoteRow[],
  audits: OddsAuditRow[],
  jobs: SchedulerRow[],
  maxAgeHours: number,
  pendingWithoutData: boolean,
): Evidence & { status: ReadinessStatus } {
  const latestRequest = requests[0];
  const latestSuccess = requests.find((request) => request.status === "success");
  const latestFailure = requests.find((request) => request.status === "failed");
  const latestQuote = quotes[0];
  const latestAudit = audits[0];
  const providerJobs = jobs.filter((job) => job.provider === "odds-api");
  const nextRunAt = providerJobs
    .filter((job) => job.enabled && job.nextRunAt)
    .sort((left, right) => (left.nextRunAt?.getTime() ?? Infinity) - (right.nextRunAt?.getTime() ?? Infinity))[0]?.nextRunAt ?? null;
  const latestFailureIsNewer = Boolean(latestFailure && (!latestSuccess ||
    latestFailure.requestedAt >= latestSuccess.requestedAt));
  const stale = !latestQuote ||
    (ageHours(latestQuote.capturedAt) ?? Infinity) > maxAgeHours ||
    latestFailureIsNewer;
  const freshnessCleared = !stale && Boolean(nextRunAt);
  const auditTotals = audits.reduce((totals, audit) => ({
    observationsReceived: totals.observationsReceived + audit.observationsReceived,
    observationsSaved: totals.observationsSaved + audit.observationsSaved,
    duplicateObservations: totals.duplicateObservations + audit.duplicateObservations,
    rejectedObservations: totals.rejectedObservations + audit.rejectedObservations,
  }), {
    observationsReceived: 0,
    observationsSaved: 0,
    duplicateObservations: 0,
    rejectedObservations: 0,
  });
  return {
    status: !latestSuccess
      ? pendingWithoutData ? "pending" : "warning"
      : stale || !nextRunAt ? "warning" : "pass",
    provider: "odds-api",
    latestRequestStatus: latestRequest?.status ?? null,
    latestRequestTime: iso(latestRequest?.requestedAt),
    recordsProcessed: latestRequest?.recordsProcessed ?? null,
    creditsUsed: latestRequest?.creditsUsed ?? null,
    creditsRemaining: latestRequest?.creditsRemaining ?? null,
    latestRequest: latestRequest ? {
      id: latestRequest.id,
      status: latestRequest.status,
      requestedAt: iso(latestRequest.requestedAt),
      httpStatus: latestRequest.httpStatus,
      recordsProcessed: latestRequest.recordsProcessed,
      creditsUsed: latestRequest.creditsUsed,
      creditsRemaining: latestRequest.creditsRemaining,
      error: latestRequest.errorMessage,
    } : null,
    lastSuccessfulRequest: latestSuccess ? {
      id: latestSuccess.id,
      requestedAt: iso(latestSuccess.requestedAt),
      recordsProcessed: latestSuccess.recordsProcessed,
      creditsUsed: latestSuccess.creditsUsed,
      creditsRemaining: latestSuccess.creditsRemaining,
    } : null,
    latestQuoteTime: iso(latestQuote?.capturedAt),
    observationsSaved: latestAudit?.observationsSaved ?? null,
    duplicateObservations: latestAudit?.duplicateObservations ?? null,
    rejectedObservations: latestAudit?.rejectedObservations ?? null,
    latestAudit: latestAudit ? {
      requestId: latestAudit.requestId,
      auditedAt: iso(latestAudit.auditedAt),
      observationsReceived: latestAudit.observationsReceived,
      observationsSaved: latestAudit.observationsSaved,
      duplicateObservations: latestAudit.duplicateObservations,
      rejectedObservations: latestAudit.rejectedObservations,
      outcome: latestAudit.outcome,
      reason: latestAudit.reason,
    } : null,
    auditTotals,
    failures: requests.filter((request) => request.status === "failed").length,
    latestFailure: latestFailure ? {
      id: latestFailure.id,
      requestedAt: iso(latestFailure.requestedAt),
      httpStatus: latestFailure.httpStatus,
      error: latestFailure.errorMessage,
      creditsRemaining: latestFailure.creditsRemaining,
    } : null,
    nextScheduledSync: iso(nextRunAt),
    schedulerRows: providerJobs.length,
    stale,
    freshnessCleared,
    staleStatus: stale ? "stale" : "cleared",
    note: !latestSuccess
      ? "No successful Odds API request is persisted; this report does not claim odds freshness."
      : undefined,
  };
}

function step(number: number, name: string, status: ReadinessStatus, evidence: Evidence, note?: string): ProductionStep {
  return { number, name, status, evidence, ...(note ? { note } : {}) };
}

function quoteAge(capturedAt: Date | null | undefined) {
  return capturedAt instanceof Date
    ? { minutes: Math.max(0, (now.getTime() - capturedAt.getTime()) / 60_000), capturedAt: capturedAt.toISOString() }
    : null;
}

function targetGame(
  games: GameRow[],
  teams: Array<{ teamId: string; abbreviation: string; teamName: string }>,
) {
  const byId = new Map(teams.map((team) => [team.teamId, team]));
  const hasExplicitSelector = Boolean(homeArgument || awayArgument);
  const candidates = games
    .filter((game) => game.kickoffTime && (hasExplicitSelector || isUpcoming(game)))
    .sort((left, right) => hasExplicitSelector
      ? Math.abs(left.kickoffTime!.getTime() - now.getTime()) - Math.abs(right.kickoffTime!.getTime() - now.getTime())
      : left.kickoffTime!.getTime() - right.kickoffTime!.getTime());
  return candidates.find((game) => {
    const home = byId.get(game.homeTeamId ?? "");
    const away = byId.get(game.awayTeamId ?? "");
    return (!homeArgument || home?.abbreviation.toUpperCase() === homeArgument)
      && (!awayArgument || away?.abbreviation.toUpperCase() === awayArgument);
  }) ?? null;
}

function targetMarketEvidence(gameId: string, kickoff: Date | null, rows: OddsQuoteRow[]) {
  const kickoffTime = kickoff ? kickoff.getTime() : Infinity;
  const canonicalCutoff = kickoff ? kickoffTime - 30 * 60_000 : Infinity;
  const supported = rows
    .filter((row) => row.gameId === gameId && ["DraftKings", "FanDuel"].includes(row.sportsbook)
      && ["spread", "total", "moneyline"].includes(row.market)
      && Number.isFinite(row.price)
      && (row.market === "moneyline" || (row.point !== null && Number.isFinite(row.point))))
    .sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime());
  const latest = (book: string, market: string, before = Infinity) => {
    const eligible = supported.filter((row) => row.sportsbook === book && row.market === market && row.capturedAt.getTime() <= before);
    return eligible.at(-1) ?? null;
  };
  const finalPreKickoff = (book: string, market: string) => {
    const eligible = supported.filter((row) => row.sportsbook === book && row.market === market && row.capturedAt.getTime() < kickoffTime);
    return eligible.at(-1) ?? null;
  };
  const markets = ["spread", "total", "moneyline"];
  return {
    current: Object.fromEntries(markets.flatMap((market) =>
      ["DraftKings", "FanDuel"].map((book) => [`${book}:${market}`, latest(book, market)]))),
    canonicalAtCutoff: Object.fromEntries(markets.flatMap((market) =>
      ["DraftKings", "FanDuel"].map((book) => [`${book}:${market}`, latest(book, market, canonicalCutoff)]))),
    finalPreKickoff: Object.fromEntries(markets.flatMap((market) =>
      ["DraftKings", "FanDuel"].map((book) => [`${book}:${market}`, finalPreKickoff(book, market)]))),
  };
}

function markdown(report: ReadinessReport) {
  const lines = [
    "# Gridline production-readiness report",
    "",
    `Generated: \`${report.generatedAt}\`  `,
    `Database target: \`${report.databaseTarget}\`  `,
    `Read-only: **${report.readOnly ? "yes" : "no"}**`,
    "",
    `## Verdict: ${report.verdict}`,
    "",
    "| # | Production-cycle check | Status | Evidence |",
    "|---:|---|---|---|",
  ];
  for (const item of report.productionCycleSteps) {
    const evidence = Object.entries(item.evidence)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
      .join("; ");
    lines.push(`| ${item.number} | ${item.name} | **${String(item.status).toUpperCase()}** | ${evidence || item.note || "No evidence persisted"} |`);
  }
  lines.push("", "## Blockers", "");
  for (const blocker of report.blockers) lines.push(`- **${blocker.status.toUpperCase()}** ${blocker.check}: ${blocker.reason}`);
  lines.push("", "## Safety confirmations", "");
  for (const [key, value] of Object.entries(report.safetyConfirmations)) lines.push(`- ${key}: **${value ? "yes" : "no"}**`);
  lines.push("", "## Read-only report notes", "", "- `pending` means the real game-cycle event has not happened or no evidence exists; it is not a pass.", "- `warning` means evidence is stale, incomplete, failed, or not safe to call healthy.", "- No feed, projection, or database mutation is performed by this command.", "");
  return `${lines.join("\n")}\n`;
}

async function buildReport() {
  // Keep these as plain reads. In particular, do not import scheduler or
  // sync functions: those functions intentionally write to the DB.
  const [
    games,
    syncRuns,
    schedulerJobs,
    features,
    projectionRuns,
    nflverseFiles,
    oddsRequests,
    oddsQuotes,
    oddsAudits,
    teams,
  ] = await Promise.all([
    db.select({
      gameId: gamesTable.gameId,
      season: gamesTable.season,
      week: gamesTable.week,
      kickoffTime: gamesTable.kickoffTime,
      gameStatus: gamesTable.gameStatus,
      finalHomeScore: gamesTable.finalHomeScore,
      finalAwayScore: gamesTable.finalAwayScore,
      homeTeamId: gamesTable.homeTeamId,
      awayTeamId: gamesTable.awayTeamId,
    }).from(gamesTable).orderBy(asc(gamesTable.kickoffTime)),
    db.select().from(dataSyncRunsTable).orderBy(desc(dataSyncRunsTable.startedAt)),
    db.select().from(schedulerJobsTable).orderBy(asc(schedulerJobsTable.nextRunAt)),
    db.select({
      gameId: pregameTeamFeaturesTable.gameId,
      featureVersion: pregameTeamFeaturesTable.featureVersion,
      kickoffTime: pregameTeamFeaturesTable.kickoffTime,
      generatedAt: pregameTeamFeaturesTable.generatedAt,
      lowSample: pregameTeamFeaturesTable.lowSample,
    }).from(pregameTeamFeaturesTable).orderBy(desc(pregameTeamFeaturesTable.generatedAt)),
    db.select({
      season: gameProjectionRunsTable.season,
      week: gameProjectionRunsTable.week,
      generatedAt: gameProjectionRunsTable.generatedAt,
      modelVersion: gameProjectionRunsTable.modelVersion,
      games: gameProjectionRunsTable.games,
    }).from(gameProjectionRunsTable).orderBy(desc(gameProjectionRunsTable.generatedAt)),
    db.select({
      dataset: nflverseSourceFilesTable.dataset,
      season: nflverseSourceFilesTable.season,
      status: nflverseSourceFilesTable.status,
      rowsProcessed: nflverseSourceFilesTable.rowsProcessed,
      startedAt: nflverseSourceFilesTable.startedAt,
      completedAt: nflverseSourceFilesTable.completedAt,
      errorMessage: nflverseSourceFilesTable.errorMessage,
    }).from(nflverseSourceFilesTable).orderBy(desc(nflverseSourceFilesTable.completedAt)),
    db.select({
      id: oddsApiRequestsTable.id,
      requestedAt: oddsApiRequestsTable.requestedAt,
      status: oddsApiRequestsTable.status,
      httpStatus: oddsApiRequestsTable.httpStatus,
      recordsProcessed: oddsApiRequestsTable.recordsProcessed,
      creditsUsed: oddsApiRequestsTable.creditsUsed,
      creditsRemaining: oddsApiRequestsTable.creditsRemaining,
      errorMessage: oddsApiRequestsTable.errorMessage,
    }).from(oddsApiRequestsTable).orderBy(desc(oddsApiRequestsTable.requestedAt), desc(oddsApiRequestsTable.id)),
    db.select({
      gameId: sportsbookOddsTable.gameId,
      capturedAt: sportsbookOddsTable.capturedAt,
      sportsbook: sportsbookOddsTable.sportsbook,
      market: sportsbookOddsTable.market,
      selection: sportsbookOddsTable.selection,
      point: sportsbookOddsTable.point,
      price: sportsbookOddsTable.price,
    }).from(sportsbookOddsTable).orderBy(desc(sportsbookOddsTable.capturedAt), desc(sportsbookOddsTable.id)),
    db.select({
      requestId: oddsEventAuditsTable.requestId,
      auditedAt: oddsEventAuditsTable.auditedAt,
      observationsReceived: oddsEventAuditsTable.observationsReceived,
      observationsSaved: oddsEventAuditsTable.observationsSaved,
      duplicateObservations: oddsEventAuditsTable.duplicateObservations,
      rejectedObservations: oddsEventAuditsTable.rejectedObservations,
      outcome: oddsEventAuditsTable.outcome,
      reason: oddsEventAuditsTable.reason,
    }).from(oddsEventAuditsTable).orderBy(desc(oddsEventAuditsTable.auditedAt), desc(oddsEventAuditsTable.id)),
    db.select({
      teamId: teamsTable.teamId,
      abbreviation: teamsTable.abbreviation,
      teamName: teamsTable.teamName,
    }).from(teamsTable),
  ]);

  const upcoming = games.filter(isUpcoming);
  const selectedGame = targetGame(games, teams);
  const selectedState = selectedGame ? normalizedGameState(selectedGame) : null;
  const enteringGames = selectedGame
    ? games.filter((game) => game.season === selectedGame.season && game.week < selectedGame.week)
    : [];
  const records = buildRecords(teams, enteringGames);
  const completedPriorGames = enteringGames.filter((game) =>
    game.week >= 1 && game.week <= 18
    && normalizedGameState(game) === "final"
    && Number.isInteger(game.finalHomeScore)
    && Number.isInteger(game.finalAwayScore)).length;
  const recordVerification = verifyRecords(records, selectedGame?.week ?? null, completedPriorGames);
  const selectedMarkets = selectedGame
    ? targetMarketEvidence(selectedGame.gameId, selectedGame.kickoffTime, oddsQuotes)
    : null;
  const completed = games.filter((game) => game.kickoffTime && game.kickoffTime <= now && isTerminal(game.gameStatus));
  const schedule = syncEvidence("espn-schedule", syncRuns, schedulerJobs, 36);
  const injuries = syncEvidence("espn-injuries", syncRuns, schedulerJobs, 96);
  const nflverse = syncEvidence("nflverse", syncRuns, schedulerJobs, 240, completed.length === 0);
  const odds = oddsEvidence(oddsRequests, oddsQuotes, oddsAudits, schedulerJobs, 6, upcoming.length === 0);
  const adaptiveJob = schedulerJobs.find((job) => job.jobKey === "odds-adaptive");
  const expectedRequestCost = 3;
  const latestQuota = oddsRequests.find((request) => request.creditsRemaining !== null);
  const quotaAffordable = latestQuota?.creditsRemaining === null || latestQuota?.creditsRemaining === undefined
    ? null
    : latestQuota.creditsRemaining >= expectedRequestCost;

  const upcomingFeatureCounts = upcoming.map((game) => ({
    gameId: game.gameId,
    rows: features.filter((row) => row.gameId === game.gameId).length,
    latestGeneratedAt: iso(features.find((row) => row.gameId === game.gameId)?.generatedAt),
  }));
  const featureReady = upcomingFeatureCounts.filter((item) => item.rows >= 2);
  const featureStatus = upcoming.length === 0 ? "pending"
    : featureReady.length === upcoming.length ? "pass"
      : featureReady.length ? "warning" : "pending";

  // The QB-adjusted game model (research/game-model) posts one run per
  // upload; a game counts as projected when a run saved before its kickoff
  // includes it.
  const upcomingProjections = upcoming.map((game) => {
    const run = (projectionRuns as ProjectionRunRow[]).find((item) =>
      item.generatedAt < (game.kickoffTime ?? now)
      && item.games.some((projection) => projection.gameId === game.gameId));
    return {
      gameId: game.gameId,
      latestProjectionAt: iso(run?.generatedAt),
      modelVersion: run?.modelVersion ?? null,
    };
  });
  const projectedUpcoming = upcomingProjections.filter((item) => item.latestProjectionAt);
  const projectionStatus = upcoming.length === 0 ? "pending"
    : projectedUpcoming.length === upcoming.length ? "pass"
      : projectedUpcoming.length ? "warning" : "pending";

  const scoredCompleted = completed.filter((game) => game.finalHomeScore !== null && game.finalAwayScore !== null);
  const resultStatus = completed.length === 0 ? "pending"
    : scoredCompleted.length < completed.length ? "warning" : "pass";

  const selectedFinalEvidence = selectedGame
    ? Object.values(selectedMarkets?.finalPreKickoff ?? {}).filter(Boolean).length
    : 0;
  const selectedCurrentQuotes = Object.values(selectedMarkets?.current ?? {}).filter(
    (quote): quote is OddsQuoteRow => Boolean(quote),
  );
  const selectedMarketCount = selectedCurrentQuotes.length;
  const requiredMarketStreams = ["spread", "total", "moneyline"].flatMap((market) =>
    ["DraftKings", "FanDuel"].map((book) => `${book}:${market}`));
  const missingMarketStreams = requiredMarketStreams.filter((key) => !selectedMarkets?.current[key]);
  const allCurrentMarketsFresh = selectedMarketCount === requiredMarketStreams.length
    && selectedCurrentQuotes.every((quote) => now.getTime() - quote.capturedAt.getTime() <= 15 * 60_000);

  const productionCycleSteps = [
    step(1, "Target matchup and normalized game state", selectedGame ? "pass" : "pending", {
      selector: awayArgument || homeArgument ? { away: awayArgument ?? null, home: homeArgument ?? null } : "nearest upcoming",
      gameId: selectedGame?.gameId ?? null,
      kickoff: iso(selectedGame?.kickoffTime),
      state: selectedState,
      matchup: selectedGame ? { awayTeamId: selectedGame.awayTeamId, homeTeamId: selectedGame.homeTeamId } : null,
      upcomingGames: upcoming.length,
    }, selectedGame ? undefined : "No matchup matched the requested selector."),
    step(2, "Authoritative entering team records", recordVerification.complete ? "pass" : "warning", {
      season: selectedGame?.season ?? null,
      weeksIncluded: selectedGame ? `1-${selectedGame.week - 1}` : null,
      records: records.map(({ teamId, abbreviation, teamName, wins, losses, ties, games }) =>
        ({ teamId, abbreviation, teamName, wins, losses, ties, games })),
      verification: recordVerification,
      rule: "Final regular-season weeks 1-18 only; preseason, postseason, non-final, and score-shaped rows excluded.",
    }),
    step(3, "Upcoming NFL game exists", upcoming.length ? "pass" : "pending", {
      upcomingGames: upcoming.length,
      nextGame: upcoming[0] ? {
        gameId: upcoming[0].gameId,
        kickoffTime: iso(upcoming[0].kickoffTime),
        season: upcoming[0].season,
        week: upcoming[0].week,
      } : null,
    }, upcoming.length ? undefined : "No future unfinished game is persisted; a live cycle cannot be exercised."),
    step(4, "Latest ESPN schedule sync", schedule.status, schedule),
    step(5, "Latest ESPN injury sync", injuries.status, injuries),
    step(6, "Latest NFLverse sync", nflverse.status, {
      ...nflverse,
      latestSourceFile: nflverseFiles[0] ? {
        dataset: nflverseFiles[0].dataset,
        season: nflverseFiles[0].season,
        status: nflverseFiles[0].status,
        rowsProcessed: nflverseFiles[0].rowsProcessed,
        completedAt: iso(nflverseFiles[0].completedAt),
        error: nflverseFiles[0].errorMessage,
      } : null,
    }, completed.length === 0 ? "No completed game window exists; NFLverse refresh is correctly not claimed as complete." : undefined),
    step(7, "Adaptive sportsbook worker and quota safety", odds.status === "pass" && Boolean(adaptiveJob) && quotaAffordable === true ? "pass" : "warning", {
      ...odds,
      job: adaptiveJob ? {
        jobKey: adaptiveJob.jobKey, enabled: adaptiveJob.enabled, nextRunAt: iso(adaptiveJob.nextRunAt),
        lockOwner: adaptiveJob.lockOwner, lockUntil: iso(adaptiveJob.lockUntil), cadence: adaptiveJob.cadence,
        lastStatus: adaptiveJob.lastStatus, lastError: adaptiveJob.lastError,
      } : null,
      expectedRequestCost,
      quotaAffordable,
      skipStatuses: oddsRequests.filter((request) => request.status === "skipped").slice(0, 5).map((request) => request.errorMessage),
    }),
    step(8, "Target matchup market truth", selectedGame
      ? (allCurrentMarketsFresh ? "pass" : "warning")
      : "pending", {
      kickoff: iso(selectedGame?.kickoffTime),
      current: selectedMarkets?.current ?? null,
      canonicalAtCutoff: selectedMarkets?.canonicalAtCutoff ?? null,
      finalPreKickoff: selectedMarkets?.finalPreKickoff ?? null,
      freshnessBoundaryMinutes: 15,
      requiredMarketStreams,
      availableMarketStreams: selectedMarketCount,
      missingMarketStreams,
      quoteAges: Object.fromEntries(Object.entries(selectedMarkets?.current ?? {}).map(([key, quote]) => [key, quoteAge(quote?.capturedAt)])),
    }),
    step(9, "Pregame features exist for upcoming games", featureStatus, {
      upcomingGames: upcoming.length,
      gamesWithTwoTeamRows: featureReady.length,
      featureRows: upcomingFeatureCounts,
    }),
    step(10, "QB-model projections for upcoming games", projectionStatus, {
      upcomingGames: upcoming.length,
      gamesWithPreKickoffProjection: projectedUpcoming.length,
      latestRun: projectionRuns[0] ? {
        season: projectionRuns[0].season,
        week: projectionRuns[0].week,
        generatedAt: iso(projectionRuns[0].generatedAt),
        modelVersion: projectionRuns[0].modelVersion,
      } : null,
      games: upcomingProjections,
    }, projectionStatus === "pending" && upcoming.length
      ? "No QB-model projection run saved before kickoff covers the upcoming games."
      : undefined),
    step(11, "Final pre-kickoff market evidence", selectedGame && selectedState === "final"
      ? selectedFinalEvidence === requiredMarketStreams.length ? "pass" : "warning"
      : "pending", {
      gameId: selectedGame?.gameId ?? null,
      state: selectedState,
      finalPreKickoffObservations: selectedFinalEvidence,
      authoritativeFinalRequired: true,
    }),
    step(12, "Final results ingested", resultStatus, {
      completedGames: completed.length,
      completedGamesWithFinalScores: scoredCompleted.length,
    }),
  ];

  const hasWarnings = productionCycleSteps.some((item) => item.status === "warning");
  const hasPending = productionCycleSteps.some((item) => item.status === "pending");
  const blockers = productionCycleSteps
    .filter((item) => item.status !== "pass")
    .map((item) => ({
      check: item.name,
      status: item.status,
      reason: item.note ?? `Evidence is ${item.status}; inspect the attached evidence before release.`,
    }));
  return {
    generatedAt: now.toISOString(),
    databaseTarget: "development (DATABASE_URL; read-only SELECT queries)",
    readOnly: true,
    verdict: hasWarnings || hasPending ? "NOT READY" : "READY FOR PRIVATE PRODUCTION",
    productionCycleSteps,
    summary: {
      pass: productionCycleSteps.filter((item) => item.status === "pass").length,
      warning: productionCycleSteps.filter((item) => item.status === "warning").length,
      pending: productionCycleSteps.filter((item) => item.status === "pending").length,
      note: "FULLY UNATTENDED READY requires a separate production deployment, secret, authorization, worker, quota, backup, and real-time game verification.",
    },
    blockers,
    safetyConfirmations: {
      readOnlyQueriesOnly: true,
      noFeedOrProjectionMutation: true,
      authoritativeRegularSeasonRecordsOnly: true,
      marketEvidenceStrictlyBeforeKickoffForFinal: true,
    },
  };
}

try {
  const report = await buildReport();
  process.stdout.write(format === "markdown" ? markdown(report) : `${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Production-readiness report failed (no writes were attempted): ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}