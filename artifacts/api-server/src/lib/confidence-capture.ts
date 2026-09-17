import { CONFIDENCE_VERSION } from "./confidence-framework";
import { consumerGames } from "../routes/consumer";

export type ConfidenceCaptureWindow = {
  season?: number;
  week?: number;
  gameId?: string;
  asOf?: Date;
};

export async function captureConfidenceResults(window: ConfidenceCaptureWindow = {}) {
  const games = await consumerGames(window, true);
  const validSnapshotsEvaluated = games.filter((game) => game.prediction !== null).length;
  return {
    status: validSnapshotsEvaluated > 0 ? "success" as const : "skipped" as const,
    gamesEvaluated: games.length,
    validSnapshotsEvaluated,
    marketResultsCalculated: games.reduce((sum, game) => sum + game.confidence.markets.length, 0),
    marketResultsPersisted: games.persistedConfidenceResults,
    version: CONFIDENCE_VERSION,
  };
}