import type { ConsumerMarketComparison } from '@workspace/api-client-react';

export function formatComparisonValue(comparison: ConsumerMarketComparison, value: number | null) {
  if (value === null) return '—';
  if (comparison.market === 'moneyline') return `${(value * 100).toFixed(1)}%`;
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

export function formatDifference(comparison: ConsumerMarketComparison) {
  if (comparison.difference === null) return '—';
  const suffix = comparison.differenceUnit === 'probability_points' ? ' pp' : ' pts';
  return `${comparison.difference > 0 ? '+' : ''}${comparison.difference.toFixed(1)}${suffix}`;
}

export function ConsumerMarketComparisonCell({ comparison, className = '', eligible = false }: { comparison: ConsumerMarketComparison, className?: string, eligible?: boolean }) {
  const usable = eligible && comparison.state === 'available';
  return (
    <div className={`market-comparison-cell ${className}`.trim()} data-testid={`market-comparison-${comparison.market}`}>
      <div className="tc-quote-label">
        <span>{comparison.label}</span>
        <span className={`market-state market-state-${comparison.state}`}>
          {usable ? 'Ready' : comparison.state === 'absent' ? 'No market' : comparison.state === 'stale' ? 'Stale' : 'Not eligible'}
        </span>
      </div>
      {usable && <dl className="comparison-values">
        <div><dt>Gridline</dt><dd>{formatComparisonValue(comparison, comparison.modelValue)}</dd></div>
        <div><dt>Market</dt><dd>{formatComparisonValue(comparison, comparison.marketValue)}</dd></div>
        <div><dt>Model difference</dt><dd>{formatDifference(comparison)}</dd></div>
      </dl>}
      {usable && comparison.selectedQuote && (
        <p className="selected-book">
          {comparison.selectedQuote.sportsbook} · {comparison.selectedQuote.price > 0 ? '+' : ''}
          {comparison.selectedQuote.price}
        </p>
      )}
      {usable && <p className="consumer-note">{comparison.freshnessLabel}</p>}
    </div>
  );
}
