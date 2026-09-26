type UsageGame = {
  week: number;
  metrics: Record<string, { value: number | null }>;
};

type SortMetric = {
  playerName: string;
  trend: "up" | "down" | "flat" | "unavailable";
  position?: string | null;
  aggregate: Record<string, { value: number | null }>;
};

export type UsageSortColumn = "name" | "primaryVolume" | "primaryYards" | "snapShare" | "attempts" | "completions" | "passingYards" | "passingTds" | "targets" | "receptions" | "receivingYards" | "carries" | "rushingYards" | "totalTd" | "trend";

export function primaryUsage(player: { position?: string | null }) {
  if (player.position === "QB") return { volume: "attempts", volumeLabel: "Att", yards: "passingYards" };
  if (player.position === "RB") return { volume: "carries", volumeLabel: "Carries", yards: "rushingYards" };
  return { volume: "targets", volumeLabel: "Targets", yards: "receivingYards" };
}

export function usageChartData(games: UsageGame[]) {
  return games.map((game) => ({
    name: `W${game.week}`,
    carries: game.metrics.carries?.value ?? undefined,
    targets: game.metrics.targets?.value ?? undefined,
    passingYards: game.metrics.passingYards?.value ?? undefined,
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
    if (column === "primaryVolume") return player.aggregate[primaryUsage(player).volume]?.value ?? null;
    if (column === "primaryYards") return player.aggregate[primaryUsage(player).yards]?.value ?? null;
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