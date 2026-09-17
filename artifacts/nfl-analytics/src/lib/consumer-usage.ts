type UsageGame = {
  week: number;
  metrics: Record<string, { value: number | null }>;
};

type SortMetric = {
  playerName: string;
  trend: "up" | "down" | "flat" | "unavailable";
  aggregate: Record<string, { value: number | null }>;
};

export type UsageSortColumn = "name" | "snapShare" | "targets" | "receptions" | "receivingYards" | "carries" | "rushingYards" | "totalTd" | "trend";

export function usageChartData(games: UsageGame[]) {
  return games.map((game) => ({
    name: `W${game.week}`,
    carries: game.metrics.carries?.value ?? undefined,
    targets: game.metrics.targets?.value ?? undefined,
  }));
}

export function trendLabel(trend: "up" | "down" | "flat" | "unavailable") {
  if (trend === "up") return "Trending Up";
  if (trend === "down") return "Trending Down";
  if (trend === "flat") return "Flat";
  return "Trend unavailable";
}

export function sortUsagePlayers<T extends SortMetric>(players: T[], column: UsageSortColumn, direction: "asc" | "desc") {
  const trendRank = { unavailable: 0, down: 1, flat: 2, up: 3 };
  const value = (player: T): string | number | null => {
    if (column === "name") return player.playerName.toLocaleLowerCase();
    if (column === "trend") return trendRank[player.trend];
    return player.aggregate[column]?.value ?? null;
  };
  return [...players].sort((left, right) => {
    const a = value(left);
    const b = value(right);
    if (a === null && b !== null) return 1;
    if (b === null && a !== null) return -1;
    if (a === null || b === null || a === b) return left.playerName.localeCompare(right.playerName);
    const comparison = a < b ? -1 : 1;
    return direction === "asc" ? comparison : -comparison;
  });
}