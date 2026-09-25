import type { ConsumerGameDetail } from '@workspace/api-client-react';
import { ConsumerMarketComparisonCell } from './ConsumerMarketComparison';
import { formatQuote } from '../pages/consumer/consumer-ui';
import { eligibleMarketComparisons } from '../lib/consumer-presentation';

export function ConsumerMarketEvidence({ game, beforeKickoff }: { game: ConsumerGameDetail; beforeKickoff: boolean }) {
  const usable = eligibleMarketComparisons(game, beforeKickoff);
  return <section className="premium-comparison-section" data-section="market-comparison" data-testid="premium-comparison" aria-labelledby="market-comparison-heading">
    <div className="consumer-section-heading"><div>
      <p className="consumer-eyebrow">{beforeKickoff ? 'Current market context' : 'Historical market context'}</p>
      <h2 id="market-comparison-heading">Gridline vs. market</h2>
    </div><span className={`market-state market-state-${usable.length ? 'available' : 'absent'}`}>{usable.length ? `${usable.length} eligible` : 'No eligible comparison'}</span></div>
    <p className="consumer-note">{beforeKickoff
      ? usable.length ? 'Only fresh, complete, eligible markets are compared. Market context does not change the saved projection.' : game.recommendation.reason ?? 'No complete, fresh market evidence is eligible for comparison.'
      : 'These are historical observations, not current comparisons or verified closing lines. No comparison is eligible after kickoff.'}</p>
    {usable.length > 0 && <div className="premium-market-quotes" aria-label="Eligible current quotes">{usable.map((comparison) =>
      <div className="premium-market-quote" key={comparison.market}><small>{comparison.label}</small><span>{formatQuote(comparison.selectedQuote, comparison.market)}</span></div>)}</div>}
    {usable.length > 0 && <div className="premium-comparison-grid">{usable.map((comparison) =>
      <ConsumerMarketComparisonCell key={comparison.market} comparison={comparison} eligible />)}</div>}
    {game.marketBoard.comparisons.some((comparison) => !usable.includes(comparison)) && <details className="market-unusable">
      <summary>View unavailable, stale, or ineligible markets</summary>
      <div className="premium-comparison-grid">{game.marketBoard.comparisons.filter((comparison) => !usable.includes(comparison)).map((comparison) =>
        <ConsumerMarketComparisonCell key={comparison.market} comparison={comparison} />)}</div>
    </details>}
  </section>;
}