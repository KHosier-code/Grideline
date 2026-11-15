/**
 * College basketball spread record, from every stored daily run.
 *
 * Only the daily card counts: for each game day (Eastern), the first run at
 * or after CARD_OPENS_UTC_HOUR picks its CARD_SIZE biggest disagreements with
 * the line between CARD_MIN_EDGE and CARD_MAX_EDGE points, among games that
 * haven't tipped. Those lock at the line shown then; later runs can't move,
 * add or remove them. Other games we disagree on are leans, never graded.
 * (6+ point gaps were mostly stale or mistaken lines in testing.) Results
 * come from the finals each run carries for the last few days.
 */
export type CbbPick = { id: string; tip: string; side: "home" | "away"; team: string; line: number; edge: number; home: string; away: string };
export type CbbResult = { id: string; homePoints: number; awayPoints: number };
export type CbbRun = { generatedAt: Date; picks: CbbPick[] | null; results: CbbResult[] | null };

export type CbbGradedPick = CbbPick & { postedAt: string; outcome: "win" | "loss" | "push" | "pending"; homePoints: number | null; awayPoints: number | null };

/** Win pays 100/110 at -110; a loss costs 1. */
const WIN_UNITS = 100 / 110;
export const EDGE_BUCKETS = [[2, 4], [4, 6]] as const;
export const CARD_SIZE = 5;
export const CARD_MIN_EDGE = 2;
export const CARD_MAX_EDGE = 6;
/** 11:00 UTC: 7 AM Eastern in daylight time, 6 AM in standard time. */
export const CARD_OPENS_UTC_HOUR = 11;

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** "2026-11-02" for a game that tips that evening, Eastern. */
export const gameDay = (tip: string) => ET_DATE.format(new Date(tip));

export function gradeCbbPick(pick: CbbPick, result: CbbResult | undefined): CbbGradedPick["outcome"] {
  if (!result) return "pending";
  const margin = pick.side === "home" ? result.homePoints - result.awayPoints : result.awayPoints - result.homePoints;
  const cover = margin + pick.line;
  return cover > 0 ? "win" : cover < 0 ? "loss" : "push";
}

/** Each game day's card, locked from the first run after the card opens. */
export function dailyCards(runs: CbbRun[]) {
  const ordered = [...runs].sort((a, b) => a.generatedAt.getTime() - b.generatedAt.getTime());
  const locked = new Map<string, CbbPick & { postedAt: string }>();
  const done = new Set<string>();
  for (const run of ordered) {
    const at = run.generatedAt.getTime();
    const byDay = new Map<string, CbbPick[]>();
    for (const pick of run.picks ?? []) {
      const day = gameDay(pick.tip);
      if (done.has(day) || !(at < Date.parse(pick.tip)) || at < Date.parse(`${day}T${String(CARD_OPENS_UTC_HOUR).padStart(2, "0")}:00:00Z`)) continue;
      byDay.set(day, [...(byDay.get(day) ?? []), pick]);
    }
    for (const [day, picks] of byDay) {
      done.add(day);
      picks.filter((pick) => pick.edge >= CARD_MIN_EDGE && pick.edge < CARD_MAX_EDGE)
        .sort((a, b) => b.edge - a.edge).slice(0, CARD_SIZE)
        .forEach((pick) => locked.set(pick.id, { ...pick, postedAt: run.generatedAt.toISOString() }));
    }
  }
  return locked;
}

export function cbbRecord(runs: CbbRun[]) {
  const locked = dailyCards(runs);
  const results = new Map<string, CbbResult>();
  const byTime = [...runs].sort((a, b) => a.generatedAt.getTime() - b.generatedAt.getTime());
  for (const run of byTime) for (const result of run.results ?? []) results.set(result.id, result);
  const picks: CbbGradedPick[] = [...locked.values()].map((pick) => {
    const result = results.get(pick.id);
    return { ...pick, outcome: gradeCbbPick(pick, result), homePoints: result?.homePoints ?? null, awayPoints: result?.awayPoints ?? null };
  }).sort((a, b) => Date.parse(b.tip) - Date.parse(a.tip));
  const tally = (list: CbbGradedPick[]) => {
    const wins = list.filter((pick) => pick.outcome === "win").length;
    const losses = list.filter((pick) => pick.outcome === "loss").length;
    const pushes = list.filter((pick) => pick.outcome === "push").length;
    return { wins, losses, pushes, units: Math.round((wins * WIN_UNITS - losses) * 100) / 100 };
  };
  return {
    ...tally(picks),
    pending: picks.filter((pick) => pick.outcome === "pending").length,
    byEdge: EDGE_BUCKETS.map(([min, max]) => ({ min, max: Number.isFinite(max) ? max : null, ...tally(picks.filter((pick) => pick.edge >= min && pick.edge < max)) })),
    recent: picks.filter((pick) => pick.outcome !== "pending").slice(0, 40),
    /** The card's picks still waiting on a result, at the line they locked at, so the board can mark them. */
    official: picks.filter((pick) => pick.outcome === "pending"),
  };
}
