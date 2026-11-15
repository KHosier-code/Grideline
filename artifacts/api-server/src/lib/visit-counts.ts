/**
 * First-party visit counts: one small row per day (weekly_reports, kind
 * "visits"), with page views by page, daily visitors, returning visitors,
 * where new visits came from, and product events such as a bowl sheet being
 * built. Nothing that identifies a person is stored: no IPs, no cookies, no
 * user ids. The browser decides "first visit today" and "came back within a
 * week" from its own local storage and only sends yes or no.
 */

export const VISIT_PAGES: Array<[string, RegExp]> = [
  ["home", /^\/$/],
  ["nfl", /^\/nfl$/],
  ["touchdowns", /^\/(touchdowns|props)$/],
  ["td-player", /^\/td\/[a-z0-9-]+$/],
  ["games", /^\/games$/],
  ["game", /^\/games\/[A-Za-z0-9-]+$/],
  ["performance", /^\/performance$/],
  ["receipts", /^\/receipts$/],
  ["methodology", /^\/methodology$/],
  ["pickem", /^\/pickem$/],
  ["power-ratings", /^\/power-ratings$/],
  ["qb-rankings", /^\/qb-rankings$/],
  ["matchups", /^\/matchups$/],
  ["research", /^\/(red-zone|usage|teams|defense-vs-position)$/],
  ["my-picks", /^\/my-picks$/],
  ["share", /^\/share$/],
  ["cbb", /^\/cbb$/],
  ["cbb-ratings", /^\/cbb\/ratings$/],
  ["cbb-record", /^\/cbb\/record$/],
  ["cbb-how", /^\/cbb\/how-it-works$/],
  ["bowls", /^\/pools\/bowls$/],
  ["pools", /^\/pools(\/.*)?$/],
];

export const VISIT_SOURCES = ["google", "bing", "duckduckgo", "x", "facebook", "reddit", "instagram", "email", "other", "direct"] as const;
export type VisitSource = typeof VISIT_SOURCES[number];

export const VISIT_EVENTS = ["bowl_sheet_built", "bowl_sheet_copied", "newsletter_signup"] as const;
export type VisitEvent = typeof VISIT_EVENTS[number];

export type Visit = {
  page: string;
  /** First page this browser opened today. */
  first?: boolean;
  /** First page today, and this browser also visited in the previous 7 days. */
  returning?: boolean;
  source?: VisitSource;
  event?: VisitEvent;
  /** A short label for the event, e.g. "confidence-25-mixed". */
  detail?: string;
};

export type VisitCounts = {
  views?: Record<string, number>;
  visitors?: number;
  returning?: number;
  sources?: Record<string, number>;
  events?: Record<string, number>;
  details?: Record<string, number>;
};

/** "/td/josh-allen?x=1" -> "td-player"; anything unlisted counts as "other". */
export function visitPage(path: string) {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return VISIT_PAGES.find(([, pattern]) => pattern.test(clean))?.[0] ?? "other";
}

const MAX_DETAILS = 300;
const add = (map: Record<string, number> | undefined, key: string) => ({ ...(map ?? {}), [key]: (map?.[key] ?? 0) + 1 });

/** The day's counts with one more visit or event added. */
export function addVisit(counts: VisitCounts, visit: Visit): VisitCounts {
  const next: VisitCounts = { ...counts };
  if (visit.event) {
    next.events = add(counts.events, visit.event);
    if (visit.detail && /^[a-z0-9-]{1,40}$/.test(visit.detail)) {
      const key = `${visit.event}:${visit.detail}`;
      if (counts.details?.[key] !== undefined || Object.keys(counts.details ?? {}).length < MAX_DETAILS) {
        next.details = add(counts.details, key);
      }
    }
    return next;
  }
  next.views = add(counts.views, visitPage(visit.page));
  if (visit.first) {
    next.visitors = (counts.visitors ?? 0) + 1;
    if (visit.returning) next.returning = (counts.returning ?? 0) + 1;
    next.sources = add(counts.sources, visit.source ?? "direct");
  }
  return next;
}

/** Eastern-time calendar day, which is how the counts are grouped. */
export function visitDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
