import type { GameAlertEvent, GameAlertEvidence } from "@workspace/db";

export function sameGameAlertEvidence(left: GameAlertEvidence, right: GameAlertEvidence): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalize(entry)]));
    }
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

/** Changes are cumulative against the last material alert, not against every poll. */
export function detectGameAlerts(previous: GameAlertEvidence, current: GameAlertEvidence, detectedAt: string): GameAlertEvent[] {
  const events: GameAlertEvent[] = [];
  const add = (category: GameAlertEvent["category"], detail: string) => events.push({ category, detail, detectedAt });
  if (previous.projection && current.projection &&
    (Math.abs(current.projection.margin - previous.projection.margin) >= 2
      || Math.abs(current.projection.total - previous.projection.total) >= 2
      || Math.abs(current.projection.homeWinProbability - previous.projection.homeWinProbability) >= 0.05)) {
    add("projection", "The saved game projection changed materially (2+ points or 5+ percentage points in win probability).");
  }
  if (previous.personnel && current.personnel &&
    Object.keys(previous.personnel).some((key) => current.personnel![key] !== undefined && current.personnel![key] !== previous.personnel![key])) {
    add("personnel", "Expected starter or reported player availability changed. Review the current personnel evidence.");
  }
  if (previous.market && current.market &&
    Object.entries(previous.market).some(([key, quote]) => {
      const next = current.market![key];
      return next && ((quote.point !== null && next.point !== null && Math.abs(next.point - quote.point) >= 1)
        || Math.abs(next.price - quote.price) >= 20);
    })) {
    add("market", "A tracked sportsbook line moved by 1+ point or 20+ price units. Review the current market context.");
  }
  return events;
}

export function advanceGameAlertEvidence(previous: GameAlertEvidence, current: GameAlertEvidence, events: GameAlertEvent[]): GameAlertEvidence {
  const categories = new Set(events.map((event) => event.category));
  return {
    projection: categories.has("projection") || !previous.projection ? current.projection : previous.projection,
    personnel: categories.has("personnel") ? current.personnel : current.personnel ? { ...current.personnel, ...previous.personnel } : previous.personnel,
    market: categories.has("market") ? current.market : current.market ? { ...current.market, ...previous.market } : previous.market,
  };
}