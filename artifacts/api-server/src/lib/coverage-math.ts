export function coveragePercent(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator * 100 : 0;
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