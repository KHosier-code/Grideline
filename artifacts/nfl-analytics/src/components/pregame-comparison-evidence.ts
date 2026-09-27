import type { ConsumerMatchupAssessment, ConsumerMatchupBoard, ConsumerMatchupMetric } from '@workspace/api-client-react';

export const comparisonSpecs = [
  { category: 'passing', label: 'Passing', metricLabel: 'Blended pass EPA / dropback' },
  { category: 'rushing', label: 'Rushing', metricLabel: 'Blended rush EPA / carry' },
  { category: 'red_zone', label: 'Offensive red zone', metricLabel: 'Offensive red-zone rate' },
  { category: 'pace_tendency', label: 'Pace', metricLabel: 'Seconds per play' },
] as const;

export function supportedComparisonMetric(metric: ConsumerMatchupMetric | undefined, assessment: ConsumerMatchupAssessment | undefined) {
  return Boolean(metric
    && typeof metric.homeValue === 'number' && Number.isFinite(metric.homeValue)
    && typeof metric.awayValue === 'number' && Number.isFinite(metric.awayValue)
    && assessment && assessment.edge !== 'insufficient' && assessment.confidence !== 'unavailable');
}

export function hasSupportedComparison(board: ConsumerMatchupBoard) {
  return board.status !== 'unavailable' && comparisonSpecs.some(spec => {
    const assessment = board.assessments.find(item => item.category === spec.category);
    return supportedComparisonMetric(assessment?.metrics.find(item => item.label === spec.metricLabel), assessment);
  });
}