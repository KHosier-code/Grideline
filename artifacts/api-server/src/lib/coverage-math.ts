export function coveragePercent(numerator: number, denominator: number) {
  return denominator > 0
    ? Math.max(0, Math.min(100, numerator / denominator * 100))
    : 0;
}

export function isWeatherEligible(indoorOutdoor: string | null | undefined, roofStatus: string | null | undefined) {
  const kind = indoorOutdoor?.toLowerCase();
  return kind === "outdoor" || roofStatus?.toLowerCase() === "retractable";
}

export function passesReadinessThreshold(observed: number | null, threshold: number) {
  return observed !== null && observed >= threshold;
}

export function latestCoverageAnchor<T extends { season: number; week: number; kickoffTime: Date | null }>(
  games: T[],
  now: Date,
) {
  const withKickoff = games.filter((game) => game.kickoffTime);
  return withKickoff
    .filter((game) => game.kickoffTime!.getTime() >= now.getTime())
    .sort((a, b) => a.kickoffTime!.getTime() - b.kickoffTime!.getTime())[0]
    ?? withKickoff.sort((a, b) => b.kickoffTime!.getTime() - a.kickoffTime!.getTime())[0]
    ?? null;
}