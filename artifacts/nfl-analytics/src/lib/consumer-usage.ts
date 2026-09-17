type UsageGame = {
  week: number;
  metrics: Record<string, { value: number | null }>;
};

export function usageChartData(games: UsageGame[]) {
  return games.map((game) => ({
    name: `W${game.week}`,
    carries: game.metrics.carries?.value ?? undefined,
    targets: game.metrics.targets?.value ?? undefined,
  }));
}

export function trendLabel(trend: "up" | "down" | "flat" | "unavailable") {
  if (trend === "up") return "▲ Trending Up";
  if (trend === "down") return "▼ Trending Down";
  if (trend === "flat") return "— Flat";
  return "— Trend unavailable";
}