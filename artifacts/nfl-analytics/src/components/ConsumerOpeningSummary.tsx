import type { ConsumerGame } from '@workspace/api-client-react';
import './ConsumerOpeningSummary.css';

const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? 'Unavailable' : value.toFixed(1);
const price = (value: number) => `${value > 0 ? '+' : ''}${value}`;

export function ConsumerOpeningSummary({ game, showProjection = true }: { game: ConsumerGame; showProjection?: boolean }) {
  const prediction = game.prediction;
  const probability = prediction?.homeWinProbability;
  const winner = probability == null || !Number.isFinite(probability) || probability === 0.5 ? null
    : probability > 0.5 ? game.matchup.home : game.matchup.away;
  const winnerChance = probability == null || !Number.isFinite(probability) || !winner ? null
    : Math.max(probability, 1 - probability) * 100;
  const markets = game.initialMarkets;
  const quote = (market: 'moneyline' | 'total' | 'spread') => {
    const line = markets?.[market];
    if (!line) return 'Unavailable — no verified first-request line for this market';
    if (market === 'moneyline') return `${line.selection} ${price(line.price)}`;
    if (market === 'spread') return `${line.selection} ${line.point! > 0 ? '+' : ''}${line.point} (${price(line.price)})`;
    return `${line.selection} ${number(line.point)} (${price(line.price)})`;
  };
  return <div className="consumer-opening-summary">
    {showProjection && <section aria-label="Saved model projection" data-testid="game-projection-summary">
      <h3>Projected model</h3>
      {prediction ? <dl className="consumer-opening-grid">
        <div><dt>Model</dt><dd>{prediction.modelLabel}{prediction.officialFinalPrediction ? ' · official pregame' : ' · saved outlook'}</dd></div>
        <div><dt>Projected score</dt><dd>{game.matchup.away.abbreviation} {number(prediction.projectedAwayScore)} – {game.matchup.home.abbreviation} {number(prediction.projectedHomeScore)}</dd></div>
        <div><dt>Margin of victory</dt><dd>{prediction.projectedMargin == null ? 'Unavailable' : `${number(Math.abs(prediction.projectedMargin))} points${prediction.projectedMargin === 0 ? ' · even' : winner ? ` · ${winner.abbreviation}` : ''}`}</dd></div>
        <div><dt>Projected total</dt><dd>{number(prediction.projectedTotal)}</dd></div>
        <div><dt>Projected winner</dt><dd>{winner ? `${winner.name} · ${winnerChance!.toFixed(1)}% win probability` : 'Unavailable'}</dd></div>
      </dl> : <p>{game.availability.prediction ?? 'No eligible saved projection is available.'}</p>}
    </section>}
    <section aria-label="First-request market comparison" data-testid="game-initial-markets">
      <h3>Initial market lines</h3>
      <p>Best customer-facing line by market from the first verified request. Later updates are not substituted.</p>
      <dl className="consumer-opening-grid">
        <div><dt>Projected winner moneyline</dt><dd>{quote('moneyline')}</dd></div>
        <div><dt>Over/under</dt><dd>{quote('total')}</dd></div>
        <div><dt>Favored team spread</dt><dd>{quote('spread')}</dd></div>
      </dl>
    </section>
  </div>;
}