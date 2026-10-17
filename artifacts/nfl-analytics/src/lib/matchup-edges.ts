/** Shapes written by research/td-model/matchup_report.py, and the matchup edges built from them. */
export type MetricFormat = 'pct' | 'num1' | 'num2' | 'sec';
/** "high" = more is better for that unit, "low" = less is better, null = style rather than quality. */
export type Direction = 'high' | 'low' | null;
export type MatchupMetric = {
  key: string; label: string; group: string; format: MetricFormat;
  offense: Direction; defense: Direction; help: string;
};
export type MetricCell = { value: number | null; rank: number | null };
export type UnitProfile = { games?: number } & Record<string, MetricCell | number | undefined>;
export type MatchupWindow = 'season' | 'last4';
export type MatchupTeam = { team: string } & Record<MatchupWindow, { offense: UnitProfile; defense: UnitProfile }>;
export type MatchupReport = {
  season: number; throughWeek: number; generatedAt: string;
  sources: { playByPlay: number; ftnCharting: number | null; pfrAdvanced: number | null; nextGenStats: number | null };
  metrics: MatchupMetric[];
  league: Record<MatchupWindow, { offense: Record<string, number | null>; defense: Record<string, number | null> }>;
  teams: MatchupTeam[];
};

const ALIASES: Record<string, string> = { LAR: 'LA', WSH: 'WAS', JAC: 'JAX', LVR: 'LV' };

export function findTeam(report: MatchupReport, abbreviation: string) {
  const code = ALIASES[abbreviation] ?? abbreviation;
  return report.teams.find(team => team.team === code);
}

export function cell(profile: UnitProfile | undefined, key: string): MetricCell | null {
  const value = profile?.[key];
  return value && typeof value === 'object' ? value : null;
}

export function formatMetric(value: number | null | undefined, format: MetricFormat) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (format === 'pct') return `${(value * 100).toFixed(1)}%`;
  if (format === 'sec') return `${value.toFixed(2)}s`;
  return value.toFixed(format === 'num1' ? 1 : 2);
}

export function ordinal(rank: number) {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return `${rank}th`;
  return `${rank}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[rank % 10] ?? 'th'}`;
}

/** Ranks at or better than this are a strength; at or worse than WEAK, a weakness. */
export const STRONG = 10;
export const WEAK = 23;

export type MatchupEdge = {
  offense: string; defense: string; favors: 'offense' | 'defense';
  topic: string; text: string; strength: number;
};

/** Offense metric against the defense metric it runs into. Both ranks are 1 = best for that unit. */
const PAIRS: Array<{ offense: string; defense: string; topic: string; offenseSide: string; defenseSide: string; measure: string; defenseMeasure?: string }> = [
  { offense: 'epa_pass', defense: 'epa_pass', topic: 'Passing game', offenseSide: 'passing game', defenseSide: 'pass defense', measure: 'EPA per dropback' },
  { offense: 'epa_rush', defense: 'epa_rush', topic: 'Run game', offenseSide: 'run game', defenseSide: 'run defense', measure: 'EPA per rush' },
  { offense: 'explosive_pass', defense: 'explosive_pass', topic: 'Big plays in the air', offenseSide: 'passing game', defenseSide: 'pass defense', measure: 'pass plays of 20+ yards' },
  { offense: 'explosive_rush', defense: 'explosive_rush', topic: 'Long runs', offenseSide: 'run game', defenseSide: 'run defense', measure: 'runs of 10+ yards' },
  { offense: 'pressure_rate', defense: 'pressure_rate', topic: 'Protection vs pass rush', offenseSide: 'pass protection', defenseSide: 'pass rush', measure: 'pressure rate allowed', defenseMeasure: 'pressure rate' },
  { offense: 'yac', defense: 'yac', topic: 'Yards after catch', offenseSide: 'receiving corps', defenseSide: 'tackling', measure: 'yards after the catch' },
];

/** "Texans" -> "Texans'", "49ers" -> "49ers'", "Jets" -> "Jets'", "Commanders" -> "Commanders'". */
export function possessive(name: string) {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

type Lookup = (abbreviation: string) => string;

function pairEdge(
  report: MatchupReport, metricKey: string, offenseTeam: MatchupTeam, defenseTeam: MatchupTeam,
  pair: typeof PAIRS[number], name: Lookup, win: MatchupWindow,
): MatchupEdge | null {
  const metric = report.metrics.find(item => item.key === metricKey);
  const off = cell(offenseTeam[win].offense, pair.offense);
  const def = cell(defenseTeam[win].defense, pair.defense);
  if (!metric || !off?.rank || !def?.rank) return null;
  const offName = possessive(name(offenseTeam.team));
  const defName = possessive(name(defenseTeam.team));
  const offValue = formatMetric(off.value, metric.format);
  const defValue = formatMetric(def.value, metric.format);
  if (off.rank <= STRONG && def.rank >= WEAK) {
    return { offense: offenseTeam.team, defense: defenseTeam.team, favors: 'offense', topic: pair.topic, strength: def.rank - off.rank,
      text: `${offName} ${pair.offenseSide} ranks ${ordinal(off.rank)} in ${pair.measure} (${offValue}); ${defName} ${pair.defenseSide} ranks ${ordinal(def.rank)} (${defValue}).` };
  }
  if (def.rank <= STRONG && off.rank >= WEAK) {
    return { offense: offenseTeam.team, defense: defenseTeam.team, favors: 'defense', topic: pair.topic, strength: off.rank - def.rank,
      text: `${defName} ${pair.defenseSide} ranks ${ordinal(def.rank)} in ${pair.defenseMeasure ?? `${pair.measure} allowed`} (${defValue}); ${offName} ${pair.offenseSide} ranks ${ordinal(off.rank)} (${offValue}).` };
  }
  return null;
}

/** Blitz-heavy defenses against offenses that do (or don't) handle the blitz. */
function blitzEdge(report: MatchupReport, offenseTeam: MatchupTeam, defenseTeam: MatchupTeam, name: Lookup, win: MatchupWindow): MatchupEdge | null {
  const blitz = cell(defenseTeam[win].defense, 'blitz_rate');
  const vsBlitz = cell(offenseTeam[win].offense, 'epa_vs_blitz');
  if (!blitz?.rank || !vsBlitz?.rank || blitz.rank > 8 || !report.metrics.some(item => item.key === 'epa_vs_blitz')) return null;
  const rate = formatMetric(blitz.value, 'pct');
  const epa = formatMetric(vsBlitz.value, 'num2');
  const base = { offense: offenseTeam.team, defense: defenseTeam.team, topic: 'Blitz' };
  if (vsBlitz.rank <= STRONG) {
    return { ...base, favors: 'offense', strength: 9 - blitz.rank + (STRONG - vsBlitz.rank),
      text: `${possessive(name(defenseTeam.team))} defense blitzes on ${rate} of dropbacks (${ordinal(blitz.rank)} most); ${possessive(name(offenseTeam.team))} offense ranks ${ordinal(vsBlitz.rank)} in EPA against the blitz (${epa}).` };
  }
  if (vsBlitz.rank >= WEAK) {
    return { ...base, favors: 'defense', strength: 9 - blitz.rank + (vsBlitz.rank - WEAK),
      text: `${possessive(name(defenseTeam.team))} defense blitzes on ${rate} of dropbacks (${ordinal(blitz.rank)} most); ${possessive(name(offenseTeam.team))} offense ranks ${ordinal(vsBlitz.rank)} in EPA against the blitz (${epa}).` };
  }
  return null;
}

/** Every edge for one offense against one defense, strongest first. */
export function unitEdges(report: MatchupReport, offense: string, defense: string, name: Lookup, win: MatchupWindow = 'season') {
  const offenseTeam = findTeam(report, offense);
  const defenseTeam = findTeam(report, defense);
  if (!offenseTeam || !defenseTeam) return [];
  const edges = PAIRS.map(pair => pairEdge(report, pair.offense, offenseTeam, defenseTeam, pair, name, win));
  edges.push(blitzEdge(report, offenseTeam, defenseTeam, name, win));
  return edges.filter((edge): edge is MatchupEdge => edge !== null).sort((a, b) => b.strength - a.strength);
}

/** Pass or run funnel: a defense much better against one than the other, so offenses lean the other way. */
export function funnel(report: MatchupReport, defense: string, name: Lookup, win: MatchupWindow = 'season') {
  const team = findTeam(report, defense);
  const pass = cell(team?.[win].defense, 'epa_pass');
  const rush = cell(team?.[win].defense, 'epa_rush');
  if (!team || !pass?.rank || !rush?.rank) return null;
  if (rush.rank <= STRONG && pass.rank >= 20) {
    return { kind: 'pass' as const, text: `${possessive(name(team.team))} defense is a pass funnel: ${ordinal(rush.rank)} against the run but ${ordinal(pass.rank)} against the pass, so offenses tend to throw on it.` };
  }
  if (pass.rank <= STRONG && rush.rank >= 20) {
    return { kind: 'run' as const, text: `${possessive(name(team.team))} defense is a run funnel: ${ordinal(pass.rank)} against the pass but ${ordinal(rush.rank)} against the run, so offenses tend to run on it.` };
  }
  return null;
}
