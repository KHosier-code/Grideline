import { getGetConsumerGameQueryKey, useGetConsumerGame } from '@workspace/api-client-react';
import { ChevronLeft, CloudRain, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { useLocation, useParams, Link } from 'wouter';
import { ConsumerLoading, ConsumerMessage, formatKickoff, formatQuote, metric, useConsumerNow } from './consumer-ui';
import { ConsumerDepthChart } from '../../components/ConsumerDepthChart';
import { ConsumerKeyPlayers } from '../../components/ConsumerKeyPlayers';
import { LineMovementExperience } from '../../components/LineMovementExperience';
import { ConsumerMatchupBoard } from '../../components/ConsumerMatchupBoard';
import { ConsumerMarketComparisonCell } from '../../components/ConsumerMarketComparison';
import { ConsumerPlayerMatchups } from '../../components/ConsumerPlayerMatchups';
import { MarketConfidenceSummary } from '../../components/MarketConfidence';
import { ConsumerSourceHealth } from '../../components/ConsumerSourceHealth';

export default function ConsumerGameDetail() {
  const { gameId = '' } = useParams();
  const [location] = useLocation();
  const detailSearch = location.includes('?') ? location.slice(location.indexOf('?')) : '';
  const backHref = detailSearch ? `/games${detailSearch}` : '/games';
   const query = useGetConsumerGame(gameId, { query: { queryKey: getGetConsumerGameQueryKey(gameId), enabled: Boolean(gameId), staleTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: true } });
  const now = useConsumerNow();
  if (query.isLoading) return <ConsumerLoading label="Loading matchup details…" />;
  if (query.isError || !query.data) return <ConsumerMessage error title="This matchup is unavailable" detail="We couldn’t load this game right now. Return to Games and try again shortly." />;
  const game = query.data;
  const prediction = game.prediction;
  const beforeKickoff = Boolean(game.kickoffTime && new Date(game.kickoffTime).getTime() > now
    && (game.gameState === 'pregame' || game.gameState === 'scheduled'));
  const weather = game.weather as { summary?: unknown; temperature?: unknown; sustainedWind?: unknown; precipitationProbability?: unknown } | null;
  const weatherParts = weather ? [
    typeof weather.summary === 'string' ? weather.summary : null,
    typeof weather.temperature === 'number' ? `${weather.temperature.toFixed(0)}°F` : null,
    typeof weather.sustainedWind === 'number' ? `${weather.sustainedWind.toFixed(0)} mph wind` : null,
    typeof weather.precipitationProbability === 'number' ? `${weather.precipitationProbability.toFixed(0)}% precipitation` : null,
  ].filter(Boolean) : [];

  return <div className="consumer-page consumer-detail">
    <Link href={backHref} className="consumer-back"><ChevronLeft className="h-4 w-4" /> Back to games</Link>
    <ConsumerSourceHealth health={game.sourceHealth} />

    <section className="premium-hero" data-section="game-header" data-testid="premium-hero" aria-label="Game summary">
      <div className="premium-hero-context">
        <div className="premium-hero-kickoff">
          {formatKickoff(game.kickoffTime)}
            <span className={`market-state market-state-${game.gameState}`}> · {game.gameState}</span>
          {game.venue ? <span className="premium-venue"> · {game.venue}</span> : null}
        </div>
        <div className="premium-weather" data-testid="game-weather">
          <CloudRain className="h-4 w-4" aria-hidden="true" />
          <span>{weatherParts.length > 0 ? weatherParts.join(' · ') : game.analysis.availability.weather ?? 'Weather unavailable'}</span>
        </div>
      </div>

      <div className="premium-teams">
        <div className="premium-team premium-away">
          <span className="premium-team-abbr">{game.matchup.away.abbreviation}</span>
          <span className="premium-team-name">{game.matchup.away.name}</span>
        </div>
        <div className="premium-vs">VS</div>
        <div className="premium-team premium-home">
          <span className="premium-team-abbr">{game.matchup.home.abbreviation}</span>
          <span className="premium-team-name">{game.matchup.home.name}</span>
        </div>
      </div>

      <div className="premium-current-market">
         <span className="premium-eyebrow">{beforeKickoff ? 'Current market' : 'Pregame market history'}</span>
        <div className="premium-market-quotes">
          <div className="premium-market-quote">
            <small>Spread</small>
             <span>{beforeKickoff && game.recommendation.markets.spread ? formatQuote(game.marketBoard.comparisons.find(c => c.market === 'spread')?.selectedQuote ?? null, 'spread') : 'Unavailable'}</span>
          </div>
          <div className="premium-market-quote">
            <small>Moneyline</small>
             <span>{beforeKickoff && game.recommendation.markets.moneyline ? formatQuote(game.marketBoard.comparisons.find(c => c.market === 'moneyline')?.selectedQuote ?? null, 'moneyline') : 'Unavailable'}</span>
          </div>
          <div className="premium-market-quote">
            <small>Total</small>
             <span>{beforeKickoff && game.recommendation.markets.total ? formatQuote(game.marketBoard.comparisons.find(c => c.market === 'total')?.selectedQuote ?? null, 'total') : 'Unavailable'}</span>
          </div>
        </div>
         <p className="premium-market-note">{beforeKickoff ? game.recommendation.reason ?? 'All three markets have fresh complete evidence.' : 'Historical projections remain available; no current recommendations after kickoff.'}</p>
      </div>
    </section>

    <section className="premium-projection-section" data-section="gridline-projection" data-testid="premium-projection" aria-labelledby="projection-heading">
      <div className="consumer-section-heading">
        <div>
          <p className="consumer-eyebrow">Pregame outlook</p>
          <h2 id="projection-heading">Gridline projection</h2>
        </div>
        {prediction ? (
          <span className="premium-confidence-badge">
            <ShieldCheck className="h-4 w-4" /> {game.dataConfidence.label} confidence
          </span>
        ) : null}
      </div>

      {game.finalScore && (
        <div className="premium-final-result" data-testid="final-result">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          <span><small>Final score</small>{game.finalScore.away} – {game.finalScore.home}</span>
        </div>
      )}
      {prediction ? (
        <div className="premium-projection-grid">
          <div className="ppg-score">
             <small>Projected Score</small>
             <div className="ppg-score-value">{metric(prediction?.projectedAwayScore)} – {metric(prediction?.projectedHomeScore)}</div>
          </div>
          <div className="ppg-metrics">
            <div><small>Margin</small><span>{metric(prediction?.projectedMargin)}</span></div>
            <div><small>Total</small><span>{metric(prediction?.projectedTotal)}</span></div>
            <div><small>{game.matchup.away.abbreviation} Win %</small><span>{metric(prediction?.awayWinProbability, true)}</span></div>
            <div><small>{game.matchup.home.abbreviation} Win %</small><span>{metric(prediction?.homeWinProbability, true)}</span></div>
          </div>
        </div>
      ) : (
        <ConsumerMessage
          title={game.finalScore ? 'Pregame projection unavailable' : 'Projection is updating'}
          detail={game.availability.prediction ?? 'A saved Gridline projection is not available for this matchup.'}
        />
      )}
      <MarketConfidenceSummary value={game} />
    </section>

      <section className="premium-comparison-section" data-section="market-comparison" data-testid="premium-comparison" aria-labelledby="market-comparison-heading">
        <div className="consumer-section-heading">
          <div>
             <p className="consumer-eyebrow">{beforeKickoff ? 'Current market context' : 'Historical market context'}</p>
            <h2 id="market-comparison-heading">Gridline vs. market</h2>
          </div>
          <span className={`market-state market-state-${game.marketBoard.status}`}>
            {game.marketBoard.status === 'absent' ? 'Unavailable' : game.marketBoard.status}
          </span>
        </div>
         <p className="consumer-note">Differences are informational and appear only with fresh complete price evidence. Market context does not change the saved Gridline projection.</p>
        <div className="premium-comparison-grid">
          {game.marketBoard.comparisons.map((comparison) => (
             <ConsumerMarketComparisonCell key={comparison.market} comparison={comparison} eligible={beforeKickoff && game.recommendation.markets[comparison.market]} />
          ))}
        </div>
      </section>

    <ConsumerMatchupBoard board={game.matchupBoard} away={game.matchup.away} home={game.matchup.home} />

    <ConsumerDepthChart context={game.context} />

    <ConsumerKeyPlayers players={game.keyPlayers} away={game.matchup.away} home={game.matchup.home} />

    <ConsumerPlayerMatchups matchups={game.context.projectedMatchups} />

    <LineMovementExperience movement={game.movement} />

    <section className="premium-analysis-section" data-section="projection-explanation" data-testid="premium-analysis" aria-labelledby="projection-explanation-heading">
      <div className="consumer-section-heading">
        <div>
          <p className="consumer-eyebrow">Summary</p>
          <h2 id="projection-explanation-heading">Why Gridline projects this</h2>
        </div>
      </div>
      <div className="premium-analysis-content">
        {game.analysis.drivers.length ? (
          <ul className="premium-analysis-list">
            {game.analysis.drivers.map(driver => <li key={driver}><ShieldCheck className="h-5 w-5 text-accent" /> <span>{driver}</span></li>)}
          </ul>
        ) : (
          <p className="premium-analysis-empty">No verified analysis drivers are available for this matchup.</p>
        )}
      </div>
    </section>
  </div>;
}