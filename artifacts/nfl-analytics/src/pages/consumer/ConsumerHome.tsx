import { getGetConsumerDashboardQueryKey, useGetConsumerDashboard, type ConsumerGame } from '@workspace/api-client-react';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { ConsumerLoading, ConsumerMessage, formatKickoff, useConsumerNow } from './consumer-ui';
import { ConsumerSourceHealth } from '../../components/ConsumerSourceHealth';
import { homeProjection, homeSpread, nextHomeSlate } from '../../lib/consumer-home';
import { ConsumerHomeMatchupFeature } from '../../components/ConsumerHomeMatchupFeature';

const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? 'Unavailable' : value.toFixed(1);
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

function HomeGame({ game, now, selected, onSelect }: {
  game: ConsumerGame; now: number; selected: boolean; onSelect: () => void;
}) {
  const projection = homeProjection(game);
  const spread = homeSpread(game, now);
  const id = `home-evidence-${game.gameId}`;
  const detailHref = `/games/${game.gameId}?season=${game.season}&week=${game.week}`;
  return <article className={`weekly-card${selected ? ' is-selected' : ''}`}>
    <button type="button" className="weekly-card-toggle" aria-expanded={selected} aria-controls={id}
      aria-label={`${selected ? 'Hide' : 'Show'} evidence for ${game.matchup.away.name} at ${game.matchup.home.name}`}
      onClick={onSelect}>
      <span className="weekly-kickoff"><CalendarDays size={15} aria-hidden="true" /> {formatKickoff(game.kickoffTime)}</span>
      <span className="weekly-teams"><strong>{game.matchup.away.abbreviation} <small>at</small> {game.matchup.home.abbreviation}</strong><span>{game.matchup.away.name} at {game.matchup.home.name}</span></span>
      <span className="weekly-metric"><small>Saved projection</small>{game.prediction
        ? `${number(game.prediction.projectedAwayScore)} – ${number(game.prediction.projectedHomeScore)}`
        : 'Unavailable'}<em>{game.prediction ? game.prediction.officialFinalPrediction ? 'Official frozen pregame' : 'Saved outlook · not official' : game.availability.prediction ?? 'No eligible projection returned'}</em></span>
      <span className="weekly-metric"><small>Home spread evidence</small>{spread.comparison
        ? `${game.matchup.home.abbreviation} ${signed(spread.comparison.selectedQuote!.point!)}`
        : spread.reason}{spread.comparison && <em>{spread.comparison.selectedQuote!.sportsbook} · {new Date(spread.comparison.selectedQuote!.capturedAt!).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}</em>}</span>
      <span className="weekly-expand" aria-hidden="true">{selected ? '−' : '+'}</span>
    </button>
    {selected && <div id={id} className="weekly-evidence">
      <div><small>Projection provenance</small><strong>{projection.label}</strong><p>{projection.detail}</p>
        {game.prediction && <p>Home margin: {number(game.prediction.projectedMargin)} points (home score minus away score).</p>}</div>
      <div><small>Spread evidence</small>{spread.comparison ? <>
        <strong>{game.matchup.home.abbreviation} {signed(spread.comparison.selectedQuote!.point!)} ({spread.comparison.selectedQuote!.price > 0 ? '+' : ''}{spread.comparison.selectedQuote!.price}) · {spread.comparison.selectedQuote!.sportsbook}</strong>
        <p>Observed {new Date(spread.comparison.selectedQuote!.capturedAt!).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}. Model home margin {signed(spread.comparison.modelValue!)} vs market implied home margin {signed(-spread.comparison.marketValue!)}. Difference {signed(spread.comparison.difference!)} points (model minus market implied margin).</p>
      </> : <><strong>{spread.reason}</strong><p>{game.recommendation.reason ?? 'A fresh, complete comparison is not available.'}</p></>}</div>
       <p className="weekly-disclaimer">Informational evidence only; not a recommendation. {game.prediction ? game.dataConfidence.reason ?? `${game.dataConfidence.label} data confidence.` : game.availability.prediction ?? 'No eligible saved prediction was returned.'}</p>
      <Link href={detailHref} className="weekly-detail-link">Open Game Detail <ArrowRight size={16} aria-hidden="true" /></Link>
    </div>}
  </article>;
}

export default function ConsumerHome() {
  const query = useGetConsumerDashboard({ query: { queryKey: getGetConsumerDashboardQueryKey(), staleTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: true } });
  const now = useConsumerNow();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (query.isLoading) return <ConsumerLoading label="Loading the persisted schedule and feed status…" />;
  if (query.isError || !query.data) return <ConsumerMessage error title="Weekly view unavailable" detail="We couldn’t read the saved schedule and feed evidence. Please try again shortly." />;
  const slate = nextHomeSlate(query.data.games, now);
  const health = query.data.sourceHealth;
  return <div className="consumer-page weekly-home">
    <header className="weekly-intro">
      <div><p className="consumer-eyebrow">Gridline / Weekly home</p><h1>{slate ? `${slate.season} · Week ${slate.week}` : 'No upcoming slate in the saved schedule'}</h1>
        <p>{slate ? `${slate.games.length} upcoming ${slate.games.length === 1 ? 'game' : 'games'} in the next saved week. Projections and lines appear only when eligible evidence exists.` : 'No future games are available here. Browse saved matchups and past weeks in Games.'}</p></div>
      <div className="weekly-status"><small>Persisted feed status</small><strong className={`market-state market-state-${health.status}`}>{health.status}</strong><span>Schedule: {health.sources.schedule.status} · Odds: {health.sources.odds.status}</span></div>
    </header>
    {slate && <ConsumerHomeMatchupFeature key={slate.games[0].gameId} game={slate.games[0]} now={now} />}
    <div className="consumer-section-heading"><div><p className="consumer-eyebrow">Upcoming schedule</p><h2>{slate ? 'The next slate' : 'No upcoming games'}</h2></div><Link href="/games">Browse all games <ArrowRight className="h-4 w-4" /></Link></div>
    {slate ? <section className="weekly-list" aria-label={`${slate.season} week ${slate.week} matchups`}>
      {slate.games.map(game => <HomeGame key={game.gameId} game={game} now={now} selected={selectedId === game.gameId} onSelect={() => setSelectedId(current => current === game.gameId ? null : game.gameId)} />)}
    </section> : <ConsumerMessage title="No upcoming games are available" detail="The schedule has no future pregame matchups right now. Browse Games to see saved past matchups." />}
    <ConsumerSourceHealth health={health} compact />
    <p className="consumer-note mt-6">Saved projections and source status are not guarantees. <Link href="/methodology" className="font-semibold text-accent underline">Read how Gridline handles evidence and limitations</Link>.</p>
  </div>;
}
