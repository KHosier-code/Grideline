// This report is deliberately read-only. It only uses SELECTs and must never
// be used as a substitute for a scheduler tick or an end-to-end game test.
import { db, pool } from "@workspace/db";
import {
  dataSyncRunsTable,
  gamesTable,
  modelPromotionHistoryTable,
  modelTrainingRunsTable,
  nflverseSourceFilesTable,
  oddsApiRequestsTable,
  oddsEventAuditsTable,
  predictionGradesTable,
  predictionSnapshotsTable,
  pregameTeamFeaturesTable,
  schedulerJobsTable,
  sportsbookOddsTable,
  weeklyLearningReportsTable,
} from "@workspace/db";
import { asc, desc } from "drizzle-orm";

const now = new Date();
const formatArgument = process.argv.find((argument) => argument.startsWith("--format="));
const formatIndex = process.argv.indexOf("--format");
const format = formatArgument?.split("=")[1]
  ?? (formatIndex >= 0 ? process.argv[formatIndex + 1] : undefined)
  ?? (process.argv.includes("--markdown") ? "markdown" : "json");

const terminalStatuses = ["final", "completed", "postponed", "canceled"];
const families = ["spread", "moneyline", "totals"];
type ReadinessStatus = "pass" | "warning" | "pending";
type SyncRow = typeof dataSyncRunsTable.$inferSelect;
type SchedulerRow = typeof schedulerJobsTable.$inferSelect;
type PromotionRow = typeof modelPromotionHistoryTable.$inferSelect;
type TrainingRunRow = typeof modelTrainingRunsTable.$inferSelect;
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
};
type FeatureRow = {
  gameId: string;
  featureVersion: string;
  kickoffTime: Date;
  generatedAt: Date;
  lowSample: boolean;
};
type SnapshotRow = {
  id: number;
  gameId: string;
  predictionTimestamp: Date;
  snapshotLabel: string;
  kickoffTime: Date | null;
  featureVersion: string;
  spreadModelVersion: string | null;
  moneylineModelVersion: string | null;
  totalsModelVersion: string | null;
  officialFinalPrediction: boolean;
  frozenAt: Date | null;
  lowSample: boolean;
};
type GradeRow = {
  id: number;
  predictionId: number;
  gradedAt: Date;
  clv: Record<string, unknown>;
};
type WeeklyReportRow = {
  season: number;
  week: number;
  generatedAt: Date;
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
type OddsQuoteRow = { capturedAt: Date };
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
};

function isTerminal(status: string | null | undefined) {
  const value = String(status ?? "").toLowerCase();
  return terminalStatuses.some((part) => value.includes(part));
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

function currentByFamily<T extends { family: string }>(rows: T[]) {
  const result = new Map<string, T>();
  for (const row of rows) if (!result.has(row.family)) result.set(row.family, row);
  return [...result.values()];
}

function latestRunByStatus<T extends { status: string }>(rows: T[], status: string) {
  return rows.find((run) => run.status === status) ?? null;
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
  lines.push("", "## Read-only report notes", "", "- `pending` means the real game-cycle event has not happened or no evidence exists; it is not a pass.", "- `warning` means evidence is stale, incomplete, failed, or not safe to call healthy.", "- No feed, prediction, promotion, freeze, grade, or database mutation is performed by this command.", "");
  return `${lines.join("\n")}\n`;
}

async function buildReport() {
  // Keep these as plain reads. In particular, do not import scheduler or
  // prediction functions: those functions intentionally write to the DB.
  const [
    games,
    syncRuns,
    schedulerJobs,
    features,
    promotions,
    trainingRuns,
    snapshots,
    grades,
    weeklyReports,
    nflverseFiles,
    oddsRequests,
    oddsQuotes,
    oddsAudits,
  ] = await Promise.all([
    db.select({
      gameId: gamesTable.gameId,
      season: gamesTable.season,
      week: gamesTable.week,
      kickoffTime: gamesTable.kickoffTime,
      gameStatus: gamesTable.gameStatus,
      finalHomeScore: gamesTable.finalHomeScore,
      finalAwayScore: gamesTable.finalAwayScore,
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
    db.select().from(modelPromotionHistoryTable).orderBy(desc(modelPromotionHistoryTable.promotedAt), desc(modelPromotionHistoryTable.id)),
    db.select().from(modelTrainingRunsTable).orderBy(desc(modelTrainingRunsTable.trainedAt), desc(modelTrainingRunsTable.id)),
    db.select({
      id: predictionSnapshotsTable.id,
      gameId: predictionSnapshotsTable.gameId,
      predictionTimestamp: predictionSnapshotsTable.predictionTimestamp,
      snapshotLabel: predictionSnapshotsTable.snapshotLabel,
      kickoffTime: predictionSnapshotsTable.kickoffTime,
      featureVersion: predictionSnapshotsTable.featureVersion,
      spreadModelVersion: predictionSnapshotsTable.spreadModelVersion,
      moneylineModelVersion: predictionSnapshotsTable.moneylineModelVersion,
      totalsModelVersion: predictionSnapshotsTable.totalsModelVersion,
      officialFinalPrediction: predictionSnapshotsTable.officialFinalPrediction,
      frozenAt: predictionSnapshotsTable.frozenAt,
      lowSample: predictionSnapshotsTable.lowSample,
    }).from(predictionSnapshotsTable).orderBy(desc(predictionSnapshotsTable.predictionTimestamp)),
    db.select({
      id: predictionGradesTable.id,
      predictionId: predictionGradesTable.predictionId,
      gradedAt: predictionGradesTable.gradedAt,
      clv: predictionGradesTable.clv,
    }).from(predictionGradesTable).orderBy(desc(predictionGradesTable.gradedAt)),
    db.select({
      season: weeklyLearningReportsTable.season,
      week: weeklyLearningReportsTable.week,
      generatedAt: weeklyLearningReportsTable.generatedAt,
    }).from(weeklyLearningReportsTable).orderBy(desc(weeklyLearningReportsTable.generatedAt)),
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
      capturedAt: sportsbookOddsTable.capturedAt,
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
  ]);

  const upcoming = games.filter(isUpcoming);
  const completed = games.filter((game) => game.kickoffTime && game.kickoffTime <= now && isTerminal(game.gameStatus));
  const schedule = syncEvidence("espn-schedule", syncRuns, schedulerJobs, 36);
  const injuries = syncEvidence("espn-injuries", syncRuns, schedulerJobs, 96);
  const nflverse = syncEvidence("nflverse", syncRuns, schedulerJobs, 240, completed.length === 0);
  const odds = oddsEvidence(oddsRequests, oddsQuotes, oddsAudits, schedulerJobs, 6, upcoming.length === 0);

  const upcomingFeatureCounts = upcoming.map((game) => ({
    gameId: game.gameId,
    rows: features.filter((row) => row.gameId === game.gameId).length,
    latestGeneratedAt: iso(features.find((row) => row.gameId === game.gameId)?.generatedAt),
  }));
  const featureReady = upcomingFeatureCounts.filter((item) => item.rows >= 2);
  const featureStatus = upcoming.length === 0 ? "pending"
    : featureReady.length === upcoming.length ? "pass"
      : featureReady.length ? "warning" : "pending";

  const currentPromotions = currentByFamily(promotions.filter((promotion) => promotion.role === "production"));
  const phase6Promotions = currentPromotions.filter((promotion) => String(promotion.modelVersion).startsWith("phase6-refit-"));
  const phase6PromotionEvidence = phase6Promotions.filter((promotion) =>
    trainingRuns.some((run) => run.modelVersion === promotion.modelVersion && run.status === "refit_candidate"));
  const phase6Families = new Set(phase6PromotionEvidence.map((promotion) => promotion.family));
  const phase6Status = families.every((family) => phase6Families.has(family)) ? "pass"
    : currentPromotions.length ? "warning" : "pending";

  const upcomingSnapshotCounts = upcoming.map((game) => ({
    gameId: game.gameId,
    snapshots: snapshots.filter((snapshot) => snapshot.gameId === game.gameId && snapshot.predictionTimestamp < (game.kickoffTime ?? now)).length,
    latestSnapshotAt: iso(snapshots.find((snapshot) => snapshot.gameId === game.gameId)?.predictionTimestamp),
  }));
  const snapshotReady = upcomingSnapshotCounts.filter((item) => item.snapshots > 0);
  const snapshotStatus = upcoming.length === 0 ? "pending"
    : snapshotReady.length === upcoming.length ? "pass"
      : snapshotReady.length ? "warning" : "pending";

  const pastKickoffSnapshots = snapshots.filter((snapshot) => snapshot.kickoffTime && snapshot.kickoffTime <= now);
  const freezeDue = pastKickoffSnapshots.filter((snapshot) => !snapshot.officialFinalPrediction);
  const freezeCompleted = pastKickoffSnapshots.filter((snapshot) => snapshot.officialFinalPrediction);
  const freezeStatus = freezeDue.length ? "warning" : pastKickoffSnapshots.length ? "pass" : "pending";

  // This is a database invariant check, not an attempted mutation. A row
  // written after kickoff is evidence of a safety failure; an empty database
  // cannot prove the runtime guard has been exercised.
  const postKickoffWrites = snapshots.filter((snapshot) =>
    snapshot.kickoffTime && snapshot.predictionTimestamp >= snapshot.kickoffTime);
  const safetyStatus = postKickoffWrites.length
    ? "warning"
    : pastKickoffSnapshots.length
      ? "pass"
      : "pending";

  const scoredCompleted = completed.filter((game) => game.finalHomeScore !== null && game.finalAwayScore !== null);
  const completedIds = new Set(scoredCompleted.map((game) => game.gameId));
  const completedSnapshots = snapshots.filter((snapshot) => completedIds.has(snapshot.gameId) && snapshot.officialFinalPrediction);
  const gradedIds = new Set(grades.map((grade) => grade.predictionId));
  const ungradedCompleted = completedSnapshots.filter((snapshot) => !gradedIds.has(snapshot.id));
  const resultGradeStatus = completed.length === 0 ? "pending"
    : scoredCompleted.length < completed.length ||
      completedSnapshots.length < scoredCompleted.length ||
      ungradedCompleted.length ||
      grades.length === 0 ? "warning"
      : scoredCompleted.length ? "pass" : "pending";

  const clvEligible = grades.filter((grade) => grade.clv && typeof grade.clv === "object" && grade.clv.status === "measured");
  const clvStatus = grades.length === 0 ? "pending" : clvEligible.length ? "pass" : "warning";

  const latestCompleted = completed.sort((left, right) => (right.kickoffTime?.getTime() ?? 0) - (left.kickoffTime?.getTime() ?? 0))[0];
  const matchingReport = latestCompleted && weeklyReports.find((report) =>
    report.season === latestCompleted.season && report.week === latestCompleted.week);
  const performanceStatus = completed.length === 0 ? "pending"
    : matchingReport && grades.length ? "pass" : "warning";

  const latestChallenger = latestRunByStatus(trainingRuns, "challenger");
  const latestRefit = latestRunByStatus(trainingRuns, "refit_candidate");
  const challengerStatus = latestChallenger || latestRefit ? "pass" : "pending";

  const productionCycleSteps = [
    step(1, "Upcoming NFL game exists", upcoming.length ? "pass" : "pending", {
      upcomingGames: upcoming.length,
      nextGame: upcoming[0] ? {
        gameId: upcoming[0].gameId,
        kickoffTime: iso(upcoming[0].kickoffTime),
        season: upcoming[0].season,
        week: upcoming[0].week,
      } : null,
    }, upcoming.length ? undefined : "No future unfinished game is persisted; a live cycle cannot be exercised."),
    step(2, "Latest ESPN schedule sync", schedule.status, schedule),
    step(3, "Latest ESPN injury sync", injuries.status, injuries),
    step(4, "Latest NFLverse sync", nflverse.status, {
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
    step(5, "Latest sportsbook odds sync", odds.status, odds),
    step(6, "Pregame features exist for upcoming games", featureStatus, {
      upcomingGames: upcoming.length,
      gamesWithTwoTeamRows: featureReady.length,
      featureRows: upcomingFeatureCounts,
    }),
    step(7, "Active Phase 6 production promotions", phase6Status, {
      requiredFamilies: families,
      activeProductionPromotions: currentPromotions.map((promotion) => ({
        family: promotion.family,
        modelVersion: promotion.modelVersion,
        featureVersion: promotion.featureVersion,
        promotedAt: iso(promotion.promotedAt),
        promotedBy: promotion.promotedBy,
      })),
    }, phase6Status !== "pass" ? "All three families must have explicit phase6-refit production promotions; no automatic promotion is inferred." : undefined),
    step(8, "Current prediction snapshots", snapshotStatus, {
      upcomingGames: upcoming.length,
      gamesWithPreKickoffSnapshots: snapshotReady.length,
      games: upcomingSnapshotCounts,
    }),
    step(9, "Official freezes due/completed", freezeStatus, {
      pastKickoffSnapshots: pastKickoffSnapshots.length,
      freezesDue: freezeDue.length,
      freezesCompleted: freezeCompleted.length,
      dueGameIds: [...new Set(freezeDue.map((snapshot) => snapshot.gameId))],
      completedGameIds: [...new Set(freezeCompleted.map((snapshot) => snapshot.gameId))],
    }, freezeDue.length ? "Past-kickoff snapshots remain unfrozen; this read-only report intentionally does not freeze them." : undefined),
    step(10, "Post-kickoff prediction mutation safety", safetyStatus, {
      postKickoffSnapshotWrites: postKickoffWrites.length,
      checkedSnapshots: snapshots.length,
      postKickoffGameIds: [...new Set(postKickoffWrites.map((snapshot) => snapshot.gameId))],
    }, !pastKickoffSnapshots.length
      ? "No snapshot has reached kickoff to exercise the post-kickoff guard; pending is more honest than pass."
      : undefined),
    step(11, "Final results ingested and prediction grades", resultGradeStatus, {
      completedGames: completed.length,
      completedGamesWithFinalScores: scoredCompleted.length,
      officialSnapshotsForCompletedGames: completedSnapshots.length,
      ungradedOfficialSnapshots: ungradedCompleted.length,
      grades: grades.length,
      latestGradeAt: iso(grades[0]?.gradedAt),
    }),
    step(12, "CLV eligibility", clvStatus, {
      grades: grades.length,
      measuredClvGrades: clvEligible.length,
      eligiblePredictionIds: clvEligible.slice(0, 20).map((grade) => grade.predictionId),
    }, grades.length === 0 ? "CLV waits for a completed, graded prediction with a legitimate pre-prediction market line." : undefined),
    step(13, "Reports and performance readiness", performanceStatus, {
      completedGames: completed.length,
      latestCompletedGame: latestCompleted ? { season: latestCompleted.season, week: latestCompleted.week, gameId: latestCompleted.gameId } : null,
      latestWeeklyReport: weeklyReports[0] ? {
        season: weeklyReports[0].season,
        week: weeklyReports[0].week,
        generatedAt: iso(weeklyReports[0].generatedAt),
      } : null,
      grades: grades.length,
    }),
    step(14, "Latest challenger/refit runs", challengerStatus, {
      latestChallenger: latestChallenger ? {
        modelVersion: latestChallenger.modelVersion,
        family: latestChallenger.family,
        status: latestChallenger.status,
        trainedAt: iso(latestChallenger.trainedAt),
        sampleSize: latestChallenger.sampleSize,
      } : null,
      latestPhase6Refit: latestRefit ? {
        modelVersion: latestRefit.modelVersion,
        family: latestRefit.family,
        status: latestRefit.status,
        trainedAt: iso(latestRefit.trainedAt),
        sampleSize: latestRefit.sampleSize,
      } : null,
    }, challengerStatus === "pending" ? "No challenger or Phase 6 refit run is persisted; retraining cannot be claimed." : undefined),
  ];

  const hasWarnings = productionCycleSteps.some((item) => item.status === "warning");
  const hasPending = productionCycleSteps.some((item) => item.status === "pending");
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