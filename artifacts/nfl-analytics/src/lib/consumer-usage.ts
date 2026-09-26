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

export type UsageFilters = {
  team: string;
  position: "" | "QB" | "RB" | "WR" | "TE";
  window: "last3" | "last5" | "last8" | "season";
  game: string;
  sort: UsageSortColumn;
  direction: "asc" | "desc";
};

export const defaultUsageFilters: UsageFilters = {
  team: "", position: "", window: "last5", game: "", sort: "primaryVolume", direction: "desc",
};

const teams = new Set("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WSH".split(" "));
const positions = new Set(["QB", "RB", "WR", "TE"]);
const windows = new Set(["last3", "last5", "last8", "season"]);
const sorts = new Set<UsageSortColumn>(["name", "primaryVolume", "primaryYards", "totalTd", "snapShare", "trend"]);

// A URL game is only usable once the schedule has confirmed it. null means validation is pending.
export function parseUsageSearch(search: string, validGames: ReadonlySet<string> | null): UsageFilters {
  const params = new URLSearchParams(search);
  const team = params.get("team") ?? "";
  const position = params.get("position") ?? "";
  const window = params.get("window") ?? "";
  const sort = params.get("sort") ?? "";
  const direction = params.get("direction") ?? "";
  const game = params.get("game") ?? "";
  return {
    team: teams.has(team) ? team : "",
    position: positions.has(position) ? position as UsageFilters["position"] : "",
    window: windows.has(window) ? window as UsageFilters["window"] : "last5",
    game: validGames?.has(game) ? game : "",
    sort: sorts.has(sort as UsageSortColumn) ? sort as UsageSortColumn : "primaryVolume",
    direction: direction === "asc" ? "asc" : "desc",
  };
}

export function serializeUsageSearch(filters: UsageFilters): string {
  const params = new URLSearchParams();
  if (filters.team) params.set("team", filters.team);
  if (filters.position) params.set("position", filters.position);
  if (filters.window !== "last5") params.set("window", filters.window);
  if (filters.game) params.set("game", filters.game);
  if (filters.sort !== "primaryVolume") params.set("sort", filters.sort);
  if (filters.direction !== "desc") params.set("direction", filters.direction);
  return params.toString();
}

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