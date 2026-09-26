import type { ConsumerSourceHealth } from "./consumer-source-health";
import type { NflGameState } from "./game-state";
import { consumerMarketFreshnessMinutes } from "./consumer-market-freshness";

type Market = "spread" | "total" | "moneyline";
type Quote = {
  sportsbook: string;
  market: string;
  selection: string;
  point: number | null;
  price: number;
  capturedAt: Date;
};
type Comparison = { market: Market; state: "available" | "stale" | "absent"; modelValue: number | null };

function sourceBlocker(health: ConsumerSourceHealth, name: "schedule" | "odds") {
  const source = health.sources[name];
  const label = name === "odds" ? "Sportsbook odds" : "Schedule";
  return `${label} ${source.status} (last successful sync ${source.lastSuccessAt ?? "not recorded"}; last verified observation ${source.sourceTimestamp ?? "not recorded"}; latest attempt ${source.lastAttemptStatus ?? "none"} at ${source.lastAttemptAt ?? "not recorded"})`;
}

function gameEvidence(input: { verifiedAt: Date | null; rows: Quote[]; audit?: {
  auditedAt: Date; outcome: string; observationsReceived: number; rejectedObservations: number;
} | null; lastCompleteAt?: Date | null }) {
  const lastQuote = input.rows.reduce<Date | null>((latest, row) =>
    !latest || row.capturedAt > latest ? row.capturedAt : latest, null);
  const observation = [
    `last complete game observation ${input.lastCompleteAt?.toISOString() ?? input.verifiedAt?.toISOString() ?? "not recorded"}`,
    input.audit && !input.verifiedAt
      ? `latest game audit ${input.audit.auditedAt.toISOString()} (${input.audit.outcome}, ${input.audit.observationsReceived} observations, ${input.audit.rejectedObservations} rejected); latest audit is not complete`
      : null,
  ].filter(Boolean).join("; ");
  return `${observation}; last saved quote ${lastQuote?.toISOString() ?? "not recorded"}`;
}

function validPrice(price: number) {
  return Number.isInteger(price) && (price <= -100 || price >= 100);
}

function completeMarket(
  rows: Quote[],
  market: Market,
  homeNames: string[],
  awayNames: string[],
  now: Date,
  kickoffTime: Date,
  verifiedAt: Date | null,
) {
  const freshnessMinutes = consumerMarketFreshnessMinutes(kickoffTime, now, market);
  if (!verifiedAt || verifiedAt > now
    || now.getTime() - verifiedAt.getTime() > freshnessMinutes * 60_000) return false;
  return ["DraftKings", "FanDuel"].every((sportsbook) => {
    const forBook = rows.filter((quote) => quote.market === market && quote.sportsbook === sportsbook
      && quote.capturedAt.getTime() <= now.getTime())
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
    const namesMatch = (selection: string, names: string[]) =>
      names.some((name) => name.length > 2 && (selection.trim().toLowerCase() === name.toLowerCase()
        || selection.trim().toLowerCase().startsWith(`${name.toLowerCase()} `)));
    const isPrimary = (selection: string) => market === "total"
      ? /\bover\b/i.test(selection)
      : namesMatch(selection, homeNames);
    const primary = forBook.find((row) => isPrimary(row.selection));
    const secondary = forBook.find((row) => market === "total"
      ? /\bunder\b/i.test(row.selection)
      : namesMatch(row.selection, awayNames));
    if (!primary || !secondary) return false;
    if ([primary, secondary].some((quote) =>
      !validPrice(quote.price)
      || (market !== "moneyline" && (quote.point === null || !Number.isFinite(quote.point))))) return false;
    if (market === "total" && primary.point !== secondary.point) return false;
    if (market === "spread" && Math.abs((primary.point ?? 0) + (secondary.point ?? 0)) > 0.01) return false;
    return true;
  });
}

export function consumerRecommendation(input: {
  gameState: NflGameState;
  kickoffTime: Date | null;
  now: Date;
  sourceHealth: ConsumerSourceHealth;
  homeAbbreviation: string;
  homeName?: string;
  awayAbbreviation: string;
  awayName?: string;
  rows: Quote[];
  comparisons: Comparison[];
  verifiedAt: Date | null;
  audit?: { auditedAt: Date; outcome: string; observationsReceived: number; rejectedObservations: number } | null;
  lastCompleteAt?: Date | null;
}) {
  const empty = { spread: false, total: false, moneyline: false };
  if (!["scheduled", "pregame"].includes(input.gameState)
    || !input.kickoffTime || input.kickoffTime.getTime() <= input.now.getTime()) {
    return { status: "historical" as const, reason: "Current recommendations close at kickoff or when a game is no longer scheduled.", markets: empty };
  }
  const schedule = input.sourceHealth.sources.schedule.status;
  const odds = input.sourceHealth.sources.odds.status;
  const blockedSources = (["schedule", "odds"] as const).filter((name) =>
    input.sourceHealth.sources[name].status !== "healthy");
  const evidence = gameEvidence(input);
  if (schedule === "stale" || odds === "stale") {
    return { status: "stale" as const, reason: `${blockedSources.map((name) => sourceBlocker(input.sourceHealth, name)).join("; ")}. Game: ${evidence}. Current recommendations are unavailable.`, markets: empty };
  }
  if (schedule === "unavailable" || odds === "unavailable") {
    return { status: "unavailable" as const, reason: `${blockedSources.map((name) => sourceBlocker(input.sourceHealth, name)).join("; ")}. Game: ${evidence}. Current recommendations are unavailable.`, markets: empty };
  }
  if (schedule !== "healthy" || odds !== "healthy") {
    return { status: "partial" as const, reason: `${blockedSources.map((name) => sourceBlocker(input.sourceHealth, name)).join("; ")}. Game: ${evidence}. Current recommendations are unavailable.`, markets: empty };
  }
  const markets = Object.fromEntries((["spread", "total", "moneyline"] as const).map((market) => {
    const comparison = input.comparisons.find((value) => value.market === market);
    return [market, comparison?.state === "available" && comparison.modelValue !== null
      && completeMarket(input.rows, market, [input.homeAbbreviation, input.homeName ?? ""],
        [input.awayAbbreviation, input.awayName ?? ""], input.now, input.kickoffTime!, input.verifiedAt)];
  })) as typeof empty;
  const available = Object.values(markets).filter(Boolean).length;
  return {
    status: available === 3 ? "healthy" as const : available ? "partial" as const : "unavailable" as const,
    reason: available === 3 ? null : `One or more markets lack a fresh, complete DraftKings and FanDuel price pair (${evidence}). Only eligible markets may be considered.`,
    markets,
  };
}