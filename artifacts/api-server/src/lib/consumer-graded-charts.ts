export type GradedChartRow = {
  prediction: {
    gameId: string;
    predictionTimestamp: Date;
    kickoffTime: Date | null;
    officialFinalPrediction: boolean;
  };
  grade: {
    homeWinCorrect: boolean | null;
    marginError: number | null;
    totalError: number | null;
  } | null;
  game: {
    gameId: string;
    season: number;
    week: number;
    kickoffTime: Date | null;
    gameStatus: string;
    finalHomeScore: number | null;
    finalAwayScore: number | null;
  } | null;
};

export type GradedChartMetrics = {
  graded: number;
  winnerGraded: number;
  winnerCorrect: number;
  winnerAccuracy: number | null;
  marginGraded: number;
  marginMae: number | null;
  totalGraded: number;
  totalMae: number | null;
};

function isFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isUsableGradedChartRow(row: GradedChartRow) {
  const { prediction, grade, game } = row;
  if (!prediction.officialFinalPrediction || !grade || !game ||
      prediction.gameId !== game.gameId || !prediction.kickoffTime || !game.kickoffTime ||
      prediction.kickoffTime.getTime() !== game.kickoffTime.getTime() ||
      prediction.predictionTimestamp.getTime() >= game.kickoffTime.getTime() ||
      !Number.isInteger(game.season) || !Number.isInteger(game.week) ||
      game.finalHomeScore === null || game.finalAwayScore === null) return false;
  const status = game.gameStatus.toLowerCase();
  return status.includes("final") || status.includes("completed");
}

function metrics(rows: GradedChartRow[]): GradedChartMetrics {
  const winnerRows = rows.filter((row) => row.grade!.homeWinCorrect !== null);
  const marginErrors = rows.map((row) => row.grade!.marginError).filter(isFiniteNumber);
  const totalErrors = rows.map((row) => row.grade!.totalError).filter(isFiniteNumber);
  const winnerCorrect = winnerRows.filter((row) => row.grade!.homeWinCorrect === true).length;
  return {
    graded: rows.length,
    winnerGraded: winnerRows.length,
    winnerCorrect,
    winnerAccuracy: winnerRows.length ? winnerCorrect / winnerRows.length : null,
    marginGraded: marginErrors.length,
    marginMae: marginErrors.length
      ? marginErrors.reduce((sum, error) => sum + Math.abs(error), 0) / marginErrors.length
      : null,
    totalGraded: totalErrors.length,
    totalMae: totalErrors.length
      ? totalErrors.reduce((sum, error) => sum + Math.abs(error), 0) / totalErrors.length
      : null,
  };
}

export function aggregateGradedCharts(rows: GradedChartRow[], truncated = false) {
  const usable = rows.filter(isUsableGradedChartRow).sort((left, right) =>
    left.game!.season - right.game!.season ||
    left.game!.kickoffTime!.getTime() - right.game!.kickoffTime!.getTime() ||
    left.game!.week - right.game!.week ||
    left.game!.gameId.localeCompare(right.game!.gameId),
  );
  const seasons = new Map<number, GradedChartRow[]>();
  for (const row of usable) {
    const season = row.game!.season;
    seasons.set(season, [...(seasons.get(season) ?? []), row]);
  }

  const bySeason = [...seasons.entries()]
    .sort(([left], [right]) => left - right)
    .map(([season, seasonRows]) => ({ season, ...metrics(seasonRows) }));

  const cumulative: Array<{
    season: number;
    week: number;
    gameId: string;
    kickoffTime: string;
  } & GradedChartMetrics> = [];
  const running = {
    graded: 0,
    winnerGraded: 0,
    winnerCorrect: 0,
    marginGraded: 0,
    marginAbsoluteError: 0,
    totalGraded: 0,
    totalAbsoluteError: 0,
  };
  for (const row of usable) {
    running.graded += 1;
    if (row.grade!.homeWinCorrect !== null) {
      running.winnerGraded += 1;
      if (row.grade!.homeWinCorrect) running.winnerCorrect += 1;
    }
    if (isFiniteNumber(row.grade!.marginError)) {
      running.marginGraded += 1;
      running.marginAbsoluteError += Math.abs(row.grade!.marginError);
    }
    if (isFiniteNumber(row.grade!.totalError)) {
      running.totalGraded += 1;
      running.totalAbsoluteError += Math.abs(row.grade!.totalError);
    }
    cumulative.push({
      season: row.game!.season,
      week: row.game!.week,
      gameId: row.game!.gameId,
      kickoffTime: row.game!.kickoffTime!.toISOString(),
      graded: running.graded,
      winnerGraded: running.winnerGraded,
      winnerCorrect: running.winnerCorrect,
      winnerAccuracy: running.winnerGraded ? running.winnerCorrect / running.winnerGraded : null,
      marginGraded: running.marginGraded,
      marginMae: running.marginGraded ? running.marginAbsoluteError / running.marginGraded : null,
      totalGraded: running.totalGraded,
      totalMae: running.totalGraded ? running.totalAbsoluteError / running.totalGraded : null,
    });
  }

  return {
    status: usable.length ? "measured" : "not_configured",
    source: "official_graded_predictions",
    note: "Chronological scores use eligible official prediction snapshots recorded strictly before kickoff and joined to final games by prediction ID. Market data is not ROI or betting-return performance.",
    season: null as number | null,
    bySeason,
    cumulative,
    openingClosingAvailable: false as const,
    openingClosingReason: "Opening and closing market-price coverage is not evaluated by this endpoint.",
    truncated,
  };
}