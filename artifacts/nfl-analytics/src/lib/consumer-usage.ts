type UsageGame = {
  week: number;
  metrics: Record<string, { value: number | null }>;
};

type SortMetric = {
  playerId?: string;
  teamId?: string | null;
  playerName: string;
  trend: "up" | "down" | "flat" | "unavailable";
  position?: string | null;
  aggregate: Record<string, { value: number | null; available?: boolean }>;
  sourceCoverage?: { includedGames: number; requestedGames: number };
};

export type UsageSortColumn = "relevance" | "name" | "primaryVolume" | "primaryYards" | "snapShare" | "attempts" | "completions" | "passingYards" | "passingTds" | "targets" | "receptions" | "receivingYards" | "carries" | "rushingYards" | "totalTd" | "trend";

export type UsageFilters = {
  team: string;
  position: "" | "QB" | "RB" | "WR" | "TE";
  window: "last3" | "last5" | "last8" | "season";
  game: string;
  search: string;
  includeZero: boolean;
  sort: UsageSortColumn;
  direction: "asc" | "desc";
};

export const defaultUsageFilters: UsageFilters = {
  team: "", position: "", window: "last5", game: "", search: "", includeZero: false, sort: "relevance", direction: "desc",
};

const teams = new Set("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WSH".split(" "));
const positions = new Set(["QB", "RB", "WR", "TE"]);
const windows = new Set(["last3", "last5", "last8", "season"]);
const sorts = new Set<UsageSortColumn>(["relevance", "name", "primaryVolume", "primaryYards", "totalTd", "snapShare", "trend"]);
export const MAX_USAGE_SEARCH_LENGTH = 80;
export const boundedUsageSearch = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_USAGE_SEARCH_LENGTH);

// A URL game is only usable once the schedule has confirmed it. null means validation is pending.
export function parseUsageSearch(query: string, validGames: ReadonlySet<string> | null): UsageFilters {
  const params = new URLSearchParams(query);
  const team = params.get("team") ?? "";
  const position = params.get("position") ?? "";
  const window = params.get("window") ?? "";
  const sort = params.get("sort") ?? "";
  const direction = params.get("direction") ?? "";
  const game = params.get("game") ?? "";
  const search = boundedUsageSearch(params.get("search") ?? "");
  const validatedSort = sorts.has(sort as UsageSortColumn) ? sort as UsageSortColumn : "relevance";
  return {
    team: teams.has(team) ? team : "",
    position: positions.has(position) ? position as UsageFilters["position"] : "",
    window: windows.has(window) ? window as UsageFilters["window"] : "last5",
    game: validGames?.has(game) ? game : "",
    search,
    includeZero: params.get("includeZero") === "1",
    sort: validatedSort,
    direction: validatedSort !== "relevance" && direction === "asc" ? "asc" : "desc",
  };
}

export function serializeUsageSearch(filters: UsageFilters): string {
  const params = new URLSearchParams();
  if (filters.team) params.set("team", filters.team);
  if (filters.position) params.set("position", filters.position);
  if (filters.window !== "last5") params.set("window", filters.window);
  if (filters.game) params.set("game", filters.game);
  if (filters.search) params.set("search", boundedUsageSearch(filters.search));
  if (filters.includeZero) params.set("includeZero", "1");
  if (filters.sort !== "relevance") params.set("sort", filters.sort);
  if (filters.sort !== "relevance" && filters.direction !== "desc") params.set("direction", filters.direction);
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

export function formatUsageMetric(value: number | null | undefined, unit: "count" | "percent" | "average" = "count") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (unit === "percent") return `${(value * 100).toFixed(1)}%`;
  if (unit === "average") return value.toFixed(1);
  return Math.round(value).toLocaleString("en-US");
}

const observed = (metric?: { value: number | null; available?: boolean }) =>
  metric?.available !== false && typeof metric?.value === "number" && Number.isFinite(metric.value) ? metric.value : null;

export function discoverUsagePlayers<T extends SortMetric & { games: unknown[] }>(
  players: T[], search: string, includeZero: boolean,
) {
  const name = search.trim().toLocaleLowerCase();
  return players.filter(player => player.games.length > 0
    && (!name || player.playerName.toLocaleLowerCase().includes(name))
    && (includeZero || observed(player.aggregate[primaryUsage(player).volume]) !== 0));
}

export function sortUsagePlayers<T extends SortMetric>(players: T[], column: UsageSortColumn, direction: "asc" | "desc") {
  const trendRank = { unavailable: 0, down: 1, flat: 2, up: 3 };
  const identity = (a: T, b: T) => a.playerName.localeCompare(b.playerName)
    || (a.teamId ?? "").localeCompare(b.teamId ?? "")
    || (a.playerId ?? "").localeCompare(b.playerId ?? "");
  // A full-window QB, RB, WR or TE can rank highly without comparing raw attempts to targets.
  const relevance = (player: T) => {
    const volume = observed(player.aggregate[primaryUsage(player).volume]);
    if (volume === null) return null;
    const included = player.sourceCoverage?.includedGames ?? 1;
    const requested = player.sourceCoverage?.requestedGames ?? included;
    if (included <= 0 || requested <= 0) return null;
    const typical = player.position === "QB" ? 30 : player.position === "RB" ? 15 : 8;
    return Math.min(included / requested, 1)
      * (0.4 + 0.6 * Math.log1p(volume / included) / Math.log1p(typical));
  };
  const value = (player: T): string | number | null => {
    if (column === "relevance") return relevance(player);
    if (column === "name") return player.playerName.toLocaleLowerCase();
    if (column === "trend") return trendRank[player.trend];
    if (column === "primaryVolume") return observed(player.aggregate[primaryUsage(player).volume]);
    if (column === "primaryYards") return observed(player.aggregate[primaryUsage(player).yards]);
    return observed(player.aggregate[column]);
  };
  return [...players].sort((left, right) => {
    const a = value(left);
    const b = value(right);
    if (a === null && b !== null) return 1;
    if (b === null && a !== null) return -1;
    if (a === null || b === null || a === b) return identity(left, right);
    const comparison = a < b ? -1 : 1;
    return direction === "asc" ? comparison : -comparison;
  });
}