import { and, gte, inArray } from "drizzle-orm";
import { db, gamesTable, playersTable } from "@workspace/db";
import { readDevelopmentUpcomingPlayerReadiness } from "./player-forecast-readiness";
import {
  PLAYER_TD_MODEL_VERSION, scoreUpcomingPlayerTdCandidate,
  type PlayerTdCandidate, type PlayerTdEvaluationInput, type PlayerTdEvaluationReport,
} from "./player-td-model";

type Candidate = { playerId: string; playerName: string; gameId: string };
type GateInput = {
  asOf: Date | null;
  upcomingGames: number;
  candidates: Candidate[];
  blockers: string[];
  modelVersion: string | null;
};

type QualifiedCandidate = {
  candidate: PlayerTdCandidate;
  rosterTeamVerifiedAt: Date | null;
  availabilityVerifiedAt: Date | null;
  starterVerifiedAt: Date | null;
  confirmedAvailable: boolean;
  confirmedStarter: boolean;
};

/**
 * This is the positive branch of the TD-only contract. The caller must supply
 * archived source-release evidence and an explicitly approved evaluation;
 * neither a successful download nor a completed-game date is such evidence.
 * Invalid individual rows are withheld rather than falling back to a yardage
 * simulation or silently weakening the slate-wide source gate.
 */
export function buildQualifiedPlayerTdForecasts(input: {
  asOf: Date;
  upcomingGames: number;
  history: PlayerTdEvaluationInput;
  frozenReport: PlayerTdEvaluationReport;
  candidates: QualifiedCandidate[];
  sourceReleaseArchiveVerified: boolean;
  modelEvaluationApproved: boolean;
  sharedBlockers: string[];
}) {
  const blockers = [...input.sharedBlockers];
  if (!input.sourceReleaseArchiveVerified) blockers.push("Historical and current NFLverse source releases have not been independently archived before each cutoff.");
  if (!input.modelEvaluationApproved) blockers.push("This scoring-TD model's calibration and ablation verdict has not been approved for live use.");
  if (!input.upcomingGames) blockers.push("No verified future regular-season matchup is available.");
  if (blockers.length) return buildPlayerTdForecastReadiness({
    asOf: input.asOf, upcomingGames: input.upcomingGames, modelVersion: input.frozenReport.version,
    candidates: input.candidates.map(({ candidate }) => ({
      playerId: candidate.playerId, playerName: candidate.playerName, gameId: candidate.gameId,
    })),
    blockers,
  });
  const fresh = (value: Date | null, kickoff: Date) => value instanceof Date
    && Number.isFinite(value.getTime()) && value <= input.asOf && value < kickoff
    && input.asOf.getTime() - value.getTime() <= 48 * 60 * 60 * 1000;
  const forecasts: Array<{
    playerId: string; playerName: string; position: string; teamId: string; opponentTeamId: string;
    gameId: string; season: number; week: number; kickoffTime: string; probability: number;
    modelVersion: string; cutoffAt: string; priorAppearances: number;
    recentTargets: number | null; recentCarries: number | null; redZoneOpportunities: number | null;
    opponentWrRole: string | null; opponentDefensiveContext: number | null; limitations: string[];
  }> = [];
  const withheld: Array<Candidate & { reason: string }> = [];
  for (const row of input.candidates) {
    const candidate = row.candidate;
    let reason: string | null = null;
    if (candidate.kickoff <= input.asOf || candidate.week < 1 || candidate.week > 18
      || candidate.kickoffTimeSource !== "scheduledKickoff") {
      reason = "Future regular-season kickoff is not verified";
    } else if (!fresh(row.rosterTeamVerifiedAt, candidate.kickoff)) {
      reason = "Player/team assignment is not verified by a recent complete roster observation";
    } else if (!row.confirmedAvailable || !fresh(row.availabilityVerifiedAt, candidate.kickoff)) {
      reason = "Availability is missing, stale, or indicates the player is out";
    } else if (!row.confirmedStarter || !fresh(row.starterVerifiedAt, candidate.kickoff)) {
      reason = "Starter/depth participation is not recently confirmed";
    }
    if (!reason) {
      try {
        const scored = scoreUpcomingPlayerTdCandidate({
          history: input.history, candidate, frozenReport: input.frozenReport,
        });
        const features = scored.featureValues;
        if (!Number.isFinite(scored.probability) || scored.probability < 0 || scored.probability > 1) {
          throw new Error("Fitted model returned an invalid probability");
        }
        forecasts.push({
          playerId: candidate.playerId, playerName: candidate.playerName, position: candidate.position,
          teamId: candidate.team, opponentTeamId: candidate.opponent, gameId: candidate.gameId,
          season: candidate.season, week: candidate.week, kickoffTime: candidate.kickoff.toISOString(),
          probability: scored.probability, modelVersion: scored.version, cutoffAt: input.asOf.toISOString(),
          priorAppearances: input.history.players.filter((history) => history.playerId === candidate.playerId
            && history.kickoff < candidate.kickoff).length,
          recentTargets: features.targetsMean3 ?? null,
          recentCarries: features.carriesMean3 ?? null,
          // The trained features expose prior shares, not a directly
          // auditable raw opportunity count. Do not relabel shares as counts.
          redZoneOpportunities: null,
          opponentWrRole: candidate.position === "WR" && features.wr1Role !== null
            ? features.wr1Role === 1 ? "Prior-targets WR1 role; team-defense proxy" : "Other WR role; team-defense proxy"
            : null,
          opponentDefensiveContext: features.defenseEpa ?? null,
          limitations: ["Team-level opponent context is not a named WR–CB assignment.",
            "Rushing/receiving TD scoring only; QB passing TDs excluded.",
            ...(features.rzCoverage === null
              ? ["Prior zone-20 PBP opportunity is unavailable."]
              : ["A raw zone-20 opportunity count is not supplied by this fitted feature contract."])],
        });
      } catch (error) {
        reason = error instanceof Error ? error.message : "Fitted scoring or evidence contract failed";
      }
    }
    if (reason) withheld.push({
      playerId: candidate.playerId, playerName: candidate.playerName, gameId: candidate.gameId, reason,
    });
  }
  if (!forecasts.length) return {
    status: "unavailable" as const, message: "No eligible players passed every scoring-TD forecast gate.",
    asOf: input.asOf.toISOString(), modelVersion: input.frozenReport.version,
    upcomingGames: input.upcomingGames, blockers: ["No verified eligible player has a valid scoring-TD probability."],
    forecasts, withheld,
  };
  forecasts.sort((a, b) => a.gameId.localeCompare(b.gameId)
    || b.probability - a.probability || a.playerId.localeCompare(b.playerId));
  return {
    status: "forecasts" as const,
    message: "Pregame model probability of at least one rushing or receiving TD. Not sportsbook odds or betting advice.",
    asOf: input.asOf.toISOString(), modelVersion: input.frozenReport.version,
    upcomingGames: input.upcomingGames, blockers: [], forecasts, withheld,
  };
}

/**
 * No probability may be inferred from a historical yardage simulation.
 * Current imports have no immutable per-week source publication timeline and
 * a complete roster capture still does not prove injury status or starter
 * participation. All gates must be resolved before the consumer TD contract
 * can return a fitted probability.
 */
export function buildPlayerTdForecastReadiness(input: GateInput) {
  return {
    status: "unavailable" as const,
    message: input.upcomingGames
      ? "Weekly rushing-or-receiving touchdown model probabilities are withheld. Readiness checks have not established safe pregame inputs and participation."
      : "No qualified weekly rushing-or-receiving touchdown forecast is available.",
    asOf: input.asOf?.toISOString() ?? null,
    modelVersion: input.modelVersion,
    upcomingGames: input.upcomingGames,
    blockers: input.blockers,
    forecasts: [] as never[],
    withheld: input.candidates.map((candidate) => ({
      ...candidate,
      reason: input.blockers[0] ?? "Pregame evidence is not qualified",
    })),
  };
}

export async function readDevelopmentPlayerTdForecastReadiness(asOf = new Date()) {
  const audit = await readDevelopmentUpcomingPlayerReadiness(asOf);
  const games = await db.select({
    gameId: gamesTable.gameId, season: gamesTable.season, week: gamesTable.week,
    homeTeamId: gamesTable.homeTeamId, awayTeamId: gamesTable.awayTeamId,
    kickoff: gamesTable.kickoffTime, status: gamesTable.gameStatus,
  }).from(gamesTable).where(gte(gamesTable.season, asOf.getUTCFullYear() - 1));
  const next = games.filter((game) => game.kickoff && game.kickoff > asOf
    && game.week >= 1 && game.week <= 18 && !/final|complete|live|postponed|cancel/i.test(game.status))
    .sort((a, b) => a.kickoff!.getTime() - b.kickoff!.getTime())[0];
  const slate = next ? games.filter((game) => game.season === next.season && game.week === next.week
    && game.kickoff && game.kickoff > asOf
    && !/final|complete|live|postponed|cancel/i.test(game.status)) : [];
  const teamIds = [...new Set(slate.flatMap((game) => [game.homeTeamId, game.awayTeamId]))];
  const players = teamIds.length
    ? await db.select({
      playerId: playersTable.playerId, playerName: playersTable.name, teamId: playersTable.teamId,
    }).from(playersTable).where(and(
      inArray(playersTable.teamId, teamIds),
      inArray(playersTable.position, ["QB", "RB", "WR", "TE"]),
    ))
    : [];
  const candidates = players.flatMap((player) => {
    const game = slate.find((item) => item.homeTeamId === player.teamId || item.awayTeamId === player.teamId);
    return game ? [{ playerId: player.playerId, playerName: player.playerName, gameId: game.gameId }] : [];
  });
  return buildPlayerTdForecastReadiness({
    asOf, upcomingGames: slate.length, candidates,
    modelVersion: PLAYER_TD_MODEL_VERSION,
    blockers: [
      ...audit.blockers,
      "This TD endpoint has not approved per-player roster/team, injury availability, starter/depth and participation evidence for the upcoming slate.",
      "Injury-only observations cannot verify omitted players as healthy.",
      "Historical NFLverse weekly publication timestamps and pregame expected-TD releases were not preserved; source freshness cannot be attested.",
      "The red-zone and team-defense research must pass an independent calibration/coverage review before live activation.",
    ],
  });
}