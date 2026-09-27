import type { ConsumerGameDetail } from '@workspace/api-client-react';
import { ShieldCheck, CheckCircle2 } from 'lucide-react';
import { ConsumerMessage, metric } from '../pages/consumer/consumer-ui';

export function ConsumerProjectionEvidence({ game }: { game: ConsumerGameDetail }) {
  const prediction = game.prediction;
  return <section className="premium-projection-section" data-section="gridline-projection" data-testid="premium-projection" aria-labelledby="projection-heading">
    <div className="consumer-section-heading">
      <div><p className="consumer-eyebrow">Saved pregame outlook</p><h2 id="projection-heading">Gridline projection</h2></div>
      {prediction && <span className="premium-confidence-badge"><ShieldCheck className="h-4 w-4" /> Input data: {game.dataConfidence.label}</span>}
    </div>
    {game.finalScore && <div className="premium-final-result" data-testid="final-result">
      <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
      <span><small>Verified final score · {game.matchup.away.abbreviation} – {game.matchup.home.abbreviation}</small>{game.finalScore.away} – {game.finalScore.home}</span>
    </div>}
    {prediction ? <>
      <p className="consumer-note">
        {prediction.officialFinalPrediction
          ? 'Verified official pregame prediction, frozen before kickoff.'
          : 'Saved model projection, not a verified official pregame prediction.'}
        {prediction.predictionTimestamp && <> Saved <time dateTime={prediction.predictionTimestamp}>{new Date(prediction.predictionTimestamp).toLocaleString()}</time>.</>}
      </p>
      <div className="premium-projection-grid">
        <div className="ppg-score"><small>Projected score · {game.matchup.away.abbreviation} – {game.matchup.home.abbreviation}</small>
          <div className="ppg-score-value">{metric(prediction.projectedAwayScore)} – {metric(prediction.projectedHomeScore)}</div></div>
        <div className="ppg-metrics">
          <div><small>Home margin · {game.matchup.home.abbreviation}</small><span>{metric(prediction.projectedMargin)}</span></div>
          <div><small>Projected total</small><span>{metric(prediction.projectedTotal)}</span></div>
          <div><small>{game.matchup.away.abbreviation} win probability</small><span>{metric(prediction.awayWinProbability, true)}</span></div>
          <div><small>{game.matchup.home.abbreviation} win probability</small><span>{metric(prediction.homeWinProbability, true)}</span></div>
        </div>
      </div>
      <p className="consumer-note">The projected scores are calculated from the spread model’s home margin and the totals model’s total. These win probabilities come separately from the moneyline model, not from the evidence-quality scores; they need not imply the same favorite as the projected score.</p>
    </> : <ConsumerMessage title="No eligible saved projection" detail={game.availability.prediction ?? 'No eligible saved prediction is available.'} />}
  </section>;
}