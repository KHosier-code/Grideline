/**
 * College basketball spread record, from every stored daily run.
 *
 * A pick counts once, at the first run that showed it before tip-off and at
 * the line shown then; later runs can't move it, add it or take it back.
 * Results come from the finals each run carries for the last few days.
 */
export type CbbPick = { id: string; tip: string; side: "home" | "away"; team: string; line: number; edge: number; home: string; away: string };
export type CbbResult = { id: string; homePoints: number; awayPoints: number };
export type CbbRun = { generatedAt: Date; picks: CbbPick[] | null; results: CbbResult[] | null };

export type CbbGradedPick = CbbPick & { postedAt: string; outcome: "win" | "loss" | "push" | "pending"; homePoints: number | null; awayPoints: number | null };

/** Win pays 100/110 at -110; a loss costs 1. */
const WIN_UNITS = 100 / 110;
export const EDGE_BUCKETS = [[2, 4], [4, 6], [6, Infinity]] as const;

export function gradeCbbPick(pick: CbbPick, result: CbbResult | undefined): CbbGradedPick["outcome"] {
  if (!result) return "pending";
  const margin = pick.side === "home" ? result.homePoints - result.awayPoints : result.awayPoints - result.homePoints;
  const cover = margin + pick.line;
  return cover > 0 ? "win" : cover < 0 ? "loss" : "push";
}

export function cbbRecord(runs: CbbRun[]) {
  const ordered = [...runs].sort((a, b) => a.generatedAt.getTime() - b.generatedAt.getTime());
  const locked = new Map<string, CbbPick & { postedAt: string }>();
  const results = new Map<string, CbbResult>();
  for (const run of ordered) {
    for (const pick of run.picks ?? []) {
      if (locked.has(pick.id) || !(run.generatedAt.getTime() < Date.parse(pick.tip))) continue;
      locked.set(pick.id, { ...pick, postedAt: run.generatedAt.toISOString() });
    }
    for (const result of run.results ?? []) results.set(result.id, result);
  }
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
  };
}
