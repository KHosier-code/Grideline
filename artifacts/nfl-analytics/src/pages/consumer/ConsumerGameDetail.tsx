import { getGetConsumerGameQueryKey, useGetConsumerGame } from '@workspace/api-client-react';
import { ChevronLeft, CloudRain, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useLocation, useParams, Link } from 'wouter';
import { ConsumerDepthChart } from '../../components/ConsumerDepthChart';
import { ConsumerKeyPlayers } from '../../components/ConsumerKeyPlayers';
import { LineMovementExperience } from '../../components/LineMovementExperience';
import { ConsumerMatchupBoard } from '../../components/ConsumerMatchupBoard';
import { ConsumerPregameComparisonChart } from '../../components/ConsumerPregameComparisonChart';
import { ConsumerMarketEvidence } from '../../components/ConsumerMarketEvidence';
import { ConsumerProjectionEvidence } from '../../components/ConsumerProjectionEvidence';
import { ConsumerPlayerMatchups } from '../../components/ConsumerPlayerMatchups';
import { ConsumerSourceHealth } from '../../components/ConsumerSourceHealth';
import { GameDefenseVsPosition } from '../../components/DefenseVsPosition';
import { GameAlerts } from './GameAlerts';
import { ConsumerLoading, ConsumerMessage, SaveGameButton, formatKickoff, useConsumerNow } from './consumer-ui';
import { useEffect } from 'react';
import { setPublicMetadata } from '../../lib/public-metadata';

export default function ConsumerGameDetail() {
  const { gameId = '' } = useParams();
  const [location] = useLocation();
  const detailSearch = location.includes('?') ? location.slice(location.indexOf('?')) : '';
  const backHref = detailSearch ? `/games${detailSearch}` : '/games';
   const query = useGetConsumerGame(gameId, { query: { queryKey: getGetConsumerGameQueryKey(gameId), enabled: Boolean(gameId), staleTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: true } });
  const now = useConsumerNow();
  useEffect(() => {
    if (query.data) {
      const away = query.data.matchup.away.name;
      const home = query.data.matchup.home.name;
      setPublicMetadata(`/games/${encodeURIComponent(gameId)}`, `${away} at ${home} | Gridline Game Detail`,
        `View the ${away} at ${home} matchup, schedule and available saved model evidence. Predictions and market comparisons appear only when eligible data exists.`);
    } else if (query.isError) {
      setPublicMetadata(`/games/${encodeURIComponent(gameId)}`, 'Game unavailable | Gridline', 'This matchup could not be verified.', false);
    }
  }, [gameId, query.data, query.isError]);
  if (query.isLoading) return <ConsumerLoading label="Loading matchup details…" />;
  if (query.isError || !query.data) return <ConsumerMessage error title="This matchup is unavailable" detail="We couldn’t load this game right now. Return to Games and try again shortly." />;
  const game = query.data;
  const personnelLimitation = game.context.modelPersonnelLimitation;
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
    <div className="consumer-detail-save"><SaveGameButton gameId={game.gameId} /></div>
    <p className="consumer-note mb-5">Saved evidence is not automatically an official prediction. <Link href="/methodology" className="font-semibold text-accent underline">Read how projections and results are verified</Link>.</p>

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

    </section>

    <GameAlerts gameId={game.gameId} upcoming={beforeKickoff} />

    {personnelLimitation.active && (
      <aside className="premium-personnel-warning" role="status" data-testid="qb-model-limitation">
        <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        <div>
          <strong>{personnelLimitation.recommendationSuppressed ? 'Expected QB changed since this projection' : 'Saved model does not identify its quarterback'}</strong>
          <p>{personnelLimitation.reason ?? 'This saved model does not retain a named quarterback identity.'} The score and saved history are unchanged.{personnelLimitation.recommendationSuppressed ? ' An official betting recommendation is withheld.' : ''}</p>
        </div>
      </aside>
    )}
    <ConsumerProjectionEvidence game={game} />
    <ConsumerMarketEvidence game={game} beforeKickoff={beforeKickoff} />
    <ConsumerSourceHealth health={game.sourceHealth} />

    <ConsumerMatchupBoard board={game.matchupBoard} away={game.matchup.away} home={game.matchup.home} />
    <ConsumerPregameComparisonChart board={game.matchupBoard} away={game.matchup.away} home={game.matchup.home} />

    {(game.gameState === 'pregame' || game.gameState === 'scheduled') && <GameDefenseVsPosition gameId={game.gameId} season={game.season} away={game.matchup.away} home={game.matchup.home} />}

    <ConsumerDepthChart context={game.context} />

    <ConsumerKeyPlayers players={game.keyPlayers} away={game.matchup.away} home={game.matchup.home} season={game.season} week={game.week} gameId={game.gameId} />

    <ConsumerPlayerMatchups matchups={game.context.projectedMatchups} />

    <LineMovementExperience movement={game.movement} beforeKickoff={beforeKickoff} />

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
