import { getGetConsumerDashboardQueryKey, useGetConsumerDashboard, type ConsumerDashboard, type ConsumerGame } from '@workspace/api-client-react';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { ConsumerLoading, ConsumerMessage, formatKickoff, useConsumerNow } from './consumer-ui';
import { nextHomeSlate } from '../../lib/consumer-home';
import { ConsumerHomeMatchupFeature } from '../../components/ConsumerHomeMatchupFeature';
import { ConsumerOpeningSummary } from '../../components/ConsumerOpeningSummary';
import { WeeklyPickSection } from './VisitorHomeContent';
import './VisitorHome.css';

const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? 'Unavailable' : value.toFixed(1);

function HomeGame({ game, now, selected, onSelect }: {
  game: ConsumerGame; now: number; selected: boolean; onSelect: () => void;
}) {
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
      <span className="weekly-metric"><small>Initial favored spread</small>{game.initialMarkets?.spread
        ? `${game.initialMarkets.spread.selection} ${game.initialMarkets.spread.point}`
        : 'Unavailable'}</span>
      <span className="weekly-expand" aria-hidden="true">{selected ? '−' : '+'}</span>
    </button>
    {selected && <div id={id} className="weekly-evidence">
      <ConsumerOpeningSummary game={game} />
      <p className="weekly-disclaimer">Initial lines are historical and are not a promise of current availability.</p>
      <Link href={detailHref} className="weekly-detail-link">Open Game Detail <ArrowRight size={16} aria-hidden="true" /></Link>
    </div>}
  </article>;
}

export default function ConsumerHome() {
  const query = useGetConsumerDashboard({ query: { queryKey: getGetConsumerDashboardQueryKey(), staleTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: true } });
  const now = useConsumerNow();
  return <ConsumerHomeContent dashboard={query.data} now={now}
    state={query.isLoading ? 'loading' : query.isError || !query.data ? 'error' : 'ready'} />;
}

export function ConsumerHomeContent({ dashboard, now, state }: {
  dashboard?: ConsumerDashboard;
  now: number;
  state: 'loading' | 'error' | 'ready';
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pick = <WeeklyPickSection initialWeeklyPick={dashboard?.initialWeeklyPick} state={state} headingLevel="h2" />;
  if (state === 'loading') return <div className="consumer-page weekly-home">{pick}<ConsumerLoading label="Loading the weekly games…" /></div>;
  if (state === 'error' || !dashboard) return <div className="consumer-page weekly-home">{pick}<ConsumerMessage error title="Weekly view unavailable" detail="We couldn’t load the scheduled games right now. Please try again shortly." /></div>;
  const slate = nextHomeSlate(dashboard.games, now);
  return <div className="consumer-page weekly-home">
    <header className="weekly-intro">
      <div><p className="consumer-eyebrow">Gridline / Weekly home</p><h1>{slate ? `${slate.season} · Week ${slate.week}` : 'No upcoming slate in the saved schedule'}</h1>
        <p>{slate ? `${slate.games.length} upcoming ${slate.games.length === 1 ? 'game' : 'games'} in the next saved week. Projections and lines appear only when eligible evidence exists.` : 'No future games are available here. Browse saved matchups and past weeks in Games.'}</p></div>
    </header>
    {pick}
    {slate && <ConsumerHomeMatchupFeature key={slate.games[0].gameId} game={slate.games[0]} now={now} />}
    <div className="consumer-section-heading"><div><p className="consumer-eyebrow">Upcoming schedule</p><h2>{slate ? 'The next slate' : 'No upcoming games'}</h2></div><Link href="/games">Browse all games <ArrowRight className="h-4 w-4" /></Link></div>
    {slate ? <section className="weekly-list" aria-label={`${slate.season} week ${slate.week} matchups`}>
      {slate.games.map(game => <HomeGame key={game.gameId} game={game} now={now} selected={selectedId === game.gameId} onSelect={() => setSelectedId(current => current === game.gameId ? null : game.gameId)} />)}
    </section> : <ConsumerMessage title="No upcoming games are available" detail="The schedule has no future pregame matchups right now. Browse Games to see saved past matchups." />}
    <p className="consumer-note mt-6">Saved projections and opening lines are not guarantees or current offers. <Link href="/methodology" className="font-semibold text-accent underline">Read how Gridline handles evidence and limitations</Link>.</p>
  </div>;
}
