import type { ConsumerMatchupAssessment, ConsumerMatchupBoard, ConsumerMatchupMetric } from '@workspace/api-client-react';

export function formatMatchupMetric(metric: ConsumerMatchupMetric, side: 'home' | 'away') {
  const value = side === 'home' ? metric.homeValue : metric.awayValue;
  if (value === null) return 'Unavailable';
  if (metric.unit === 'rate') return `${(value * 100).toFixed(1)}%`;
  if (metric.unit === 'seconds') return `${value.toFixed(1)} sec`;
  return value.toFixed(0);
}

export function matchupEdgeSide(assessment: ConsumerMatchupAssessment) {
  return assessment.edge === 'home' || assessment.edge === 'away' ? assessment.edge : null;
}

export function supportedMatchupSummary(board: ConsumerMatchupBoard) {
  return board.summary.filter((item) => {
    const assessment = board.assessments.find((candidate) => candidate.category === item.category);
    return (item.edge === 'home' || item.edge === 'away')
      && assessment?.edge === item.edge
      && assessment.confidence !== 'unavailable'
      && assessment.metrics.some((metric) => metric.homeValue !== null && metric.awayValue !== null
        && Number.isFinite(metric.homeValue) && Number.isFinite(metric.awayValue));
  }).slice(0, 3);
}