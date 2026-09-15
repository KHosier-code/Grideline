import { getGetConsumerGameQueryKey, useGetConsumerGame } from '@workspace/api-client-react';
import { ChevronLeft, CloudRain, Gauge, ShieldCheck, Users } from 'lucide-react';
import { useParams, Link } from 'wouter';
import { ConsumerLoading, ConsumerMessage, formatKickoff, formatQuote, metric } from './consumer-ui';

export default function ConsumerGameDetail() {
  const { gameId = '' } = useParams();
  const query = useGetConsumerGame(gameId, { query: { queryKey: getGetConsumerGameQueryKey(gameId), enabled: Boolean(gameId), staleTime: 30_000 } });
  if (query.isLoading) return <ConsumerLoading label="Loading matchup details…" />;
  if (query.isError || !query.data) return <ConsumerMessage error title="This matchup is unavailable" detail="We couldn’t load this game right now. Return to Games and try again shortly." />;
  const game = query.data;
  const prediction = game.prediction;
  const weather = game.weather as { summary?: unknown; temperature?: unknown; sustainedWind?: unknown; precipitationProbability?: unknown } | null;
  const weatherParts = weather ? [
    typeof weather.summary === 'string' ? weather.summary : null,
    typeof weather.temperature === 'number' ? `${weather.temperature.toFixed(0)}°F` : null,
    typeof weather.sustainedWind === 'number' ? `${weather.sustainedWind.toFixed(0)} mph wind` : null,
    typeof weather.precipitationProbability === 'number' ? `${weather.precipitationProbability.toFixed(0)}% precipitation` : null,
  ].filter(Boolean) : [];
  return <div className="consumer-page consumer-detail">
    <Link href="/games" className="consumer-back"><ChevronLeft className="h-4 w-4" /> Back to games</Link>
    <section className="consumer-matchup-hero">
      <p>{formatKickoff(game.kickoffTime)}{game.venue ? ` · ${game.venue}` : ''}</p>
      <div className="consumer-teams">
        <div><strong>{game.matchup.away.abbreviation}</strong><span>{game.matchup.away.name}</span></div>
        <div className="consumer-projection-score">{game.finalScore ? `${game.finalScore.away} – ${game.finalScore.home}` : prediction ? `${metric(prediction.projectedAwayScore)} – ${metric(prediction.projectedHomeScore)}` : 'VS'}<small>{game.finalScore ? 'Final score' : prediction ? 'Gridline projection' : 'Projection updating'}</small></div>
        <div><strong>{game.matchup.home.abbreviation}</strong><span>{game.matchup.home.name}</span></div>
      </div>
      <div className="consumer-detail-metrics">
        <span><small>Home win probability</small>{prediction ? metric(prediction.homeWinProbability, true) : 'Unavailable'}</span>
        <span><small>Projected margin</small>{prediction ? metric(prediction.projectedMargin) : 'Unavailable'}</span>
        <span><small>Projected total</small>{prediction ? metric(prediction.projectedTotal) : 'Unavailable'}</span>
        <span><small>Data confidence</small>{game.dataConfidence.label}</span>
      </div>
    </section>
    {!prediction && <ConsumerMessage title="Projection is updating" detail={game.availability.prediction ?? 'A persisted production projection is not available yet.'} />}
    <section><div className="consumer-section-heading"><div><p className="consumer-eyebrow">Available evidence</p><h2>Matchup context</h2></div></div>
      <div className="consumer-evidence-grid">
        <details><summary><Gauge /> Current market</summary><div><p><b>Spread</b>{formatQuote(game.market.spread, 'spread')}</p><p><b>Moneyline</b>{formatQuote(game.market.moneyline, 'moneyline')}</p><p><b>Total</b>{formatQuote(game.market.total, 'total')}</p>{game.availability.market && <em>{game.availability.market}</em>}</div></details>
        <details><summary><CloudRain /> Weather</summary><div>{weatherParts.length ? <p>{weatherParts.join(' · ')}</p> : <p>{game.analysis.availability.weather ?? 'Weather is not available for this matchup.'}</p>}</div></details>
        <details><summary><Users /> Personnel</summary><div><p>{game.analysis.availability.personnel ?? 'No material personnel alert is available.'}</p></div></details>
        <details><summary><ShieldCheck /> Analysis drivers</summary><div>{game.analysis.drivers.length ? <ul>{game.analysis.drivers.map(driver => <li key={driver}>{driver}</li>)}</ul> : <p>No verified analysis drivers are available for this matchup.</p>}</div></details>
      </div>
    </section>
  </div>;
}