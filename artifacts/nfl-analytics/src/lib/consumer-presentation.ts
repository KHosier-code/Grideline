import type { ConsumerProjectedMatchup, ConsumerMatchupAssessment, DefensePositionMetric } from '@workspace/api-client-react';

export function supportedAssessments(assessments: ConsumerMatchupAssessment[]) {
  return assessments.filter((assessment) => assessment.edge !== 'insufficient');
}

export function partitionMetricCoverage(keys: string[], metrics: Record<string, DefensePositionMetric>) {
  return {
    covered: keys.filter(key => (metrics[key]?.coveredGames ?? 0) > 0),
    missing: keys.filter(key => (metrics[key]?.coveredGames ?? 0) === 0),
  };
}

export function preKickoffMovementLabel(beforeKickoff: boolean): string | null {
  return beforeKickoff ? null : 'Last recorded pre-kickoff';
}

export const PREMIUM_GAME_DETAIL_SECTION_ORDER = [
  'game-header',
  'gridline-projection',
  'market-comparison',
  'matchup-insights',
  'matchup-board',
  'personnel',
  'player-usage',
  'player-matchups',
  'line-movement',
  'projection-explanation',
] as const;

export type SupportedPlayerMatchup = ConsumerProjectedMatchup & {
  basis: 'verified' | 'inferred';
  confidence: 'high' | 'medium' | 'low';
};

export function isMatchupSupported(
  matchup: ConsumerProjectedMatchup & { basis?: string; confidence?: string },
): matchup is SupportedPlayerMatchup {
  return (matchup.basis === 'verified' || matchup.basis === 'inferred')
    && (matchup.confidence === 'high' || matchup.confidence === 'medium' || matchup.confidence === 'low');
}

export function formatUsageMetric(key: string, value: number | null): string | null {
  if (value === null || value === undefined) return null;
  switch (key) {
    case 'snapShare':
    case 'targetShare':
    case 'explosiveRate':
      return `${(value * 100).toFixed(1)}%`;
    case 'yardsPerTarget':
    case 'yardsPerCarry':
      return value.toFixed(1);
    default:
      return value.toString();
  }
}

export function usagePeriodLabel(season: number, week: number): string {
  return `${season} season · up to 5 completed team games before Week ${week}`;
}

export const USAGE_METRIC_LABELS: Record<string, string> = {
  snapShare: 'Snap share',
  attempts: 'Pass att',
  completions: 'Completions',
  passingYards: 'Pass yards',
  passingTds: 'Pass TD',
  targets: 'Targets',
  targetShare: 'Target share',
  receptions: 'Receptions',
  receivingYards: 'Rec yards',
  receivingTds: 'Rec TD',
  carries: 'Carries',
  rushingYards: 'Rush yards',
  totalTd: 'Total TD',
  yardsPerTarget: 'Yds/target',
  yardsPerCarry: 'Yds/carry',
  redZoneTouches: 'RZ touches',
  redZoneTargets: 'RZ targets',
  explosiveRate: 'Explosive rate',
};
