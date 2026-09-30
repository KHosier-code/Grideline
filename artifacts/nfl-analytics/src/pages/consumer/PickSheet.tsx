import { useMemo } from 'react';
import { Link } from 'wouter';
import {
  getGetConsumerDashboardQueryKey, getGetConsumerGameProjectionsQueryKey, useGetConsumerDashboard,
  useGetConsumerGameProjections, useGetConsumerTouchdowns, type ConsumerProjectionQb,
} from '@workspace/api-client-react';
import { buildGameView, currentWeek, formatPrice, lineText, vegasLineText, type GameView } from '@/lib/pick-sheet';
import { teamColor, teamTextColor } from '@/lib/team-colors';
import { ConsumerLoading, useConsumerNow } from './consumer-ui';

export function TeamChip({ team, large = false }: { team: string; large?: boolean }) {
  return <span className={`gl-chip${large ? ' lg' : ''}`} style={{ background: teamColor(team), color: teamTextColor(team) }}>{team}</span>;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const gameHref = (view: GameView) => `/games/${view.game.gameId}?season=${view.game.season}&week=${view.game.week}`;

function QbLine({ qb }: { qb: ConsumerProjectionQb | null }) {
  if (!qb?.name) return null;
  return <span className="gl-qb">QB {qb.name}{qb.newStarter && <span className="gl-flag">Not usual starter</span>}{!qb.listed && <span className="gl-qb-note"> · expected</span>}</span>;
}

function TopTouchdowns({ now }: { now: number }) {
  const touchdowns = useGetConsumerTouchdowns();
  const picks = (touchdowns.data?.picks ?? []).filter(pick => !pick.kickoff || Date.parse(pick.kickoff) > now).slice(0, 10);
  if (touchdowns.isLoading) return <ConsumerLoading label="Loading touchdown picks…" />;
  if (!picks.length) return null;
  return <section className="gl-section" aria-labelledby="td-heading">
    <div className="gl-section-head"><h2 id="td-heading">Top touchdown picks</h2><Link href="/touchdowns" className="gl-link">All players and the reasons behind each pick ›</Link></div>
    <ol className="gl-td-grid">
      {picks.map((pick, index) => <li key={pick.playerId}>
        <Link href="/touchdowns" className="gl-card gl-td-card">
          <span className="gl-rank">{index + 1}</span>
          <span className="gl-who"><strong>{pick.name}</strong><span><span className="pos">{pick.position}</span><TeamChip team={pick.team} />{pick.isHome ? 'vs' : 'at'} {pick.opponent}</span></span>
          <span className="gl-td-card-odds"><b className="gl-pct">{percent(pick.probability)}</b><small>Fair {formatPrice(pick.fairOdds)}</small></span>
        </Link>
      </li>)}
    </ol>
  </section>;
}

function GameRow({ view, now }: { view: GameView; now: number }) {
  const { game, projection, winner, vegas, result } = view;
  const home = game.matchup.home;
  const away = game.matchup.away;
  const final = game.finalScore;
  const started = game.kickoffTime ? Date.parse(game.kickoffTime) <= now : false;
  const sides = [
    { side: 'away' as const, team: away, projected: projection?.away, actual: final?.away, qb: projection?.awayQb ?? null, probability: projection ? 1 - projection.homeWin : null },
    { side: 'home' as const, team: home, projected: projection?.home, actual: final?.home, qb: projection?.homeQb ?? null, probability: projection?.homeWin ?? null },
  ];
  return <Link href={gameHref(view)} className="gl-board-row gl-lines-row" aria-label={`${away.name} at ${home.name}`}>
    <span className="gl-time">{final ? 'Final' : started ? 'Live' : game.kickoffTime ? time(game.kickoffTime) : 'TBD'}</span>
    <div className="gl-teams">
      {sides.map(item => <div key={item.side} className={`gl-team${winner?.side === item.side ? ' fav' : ''}`}>
        <TeamChip team={item.team.abbreviation} />
        <span className="name">{item.team.name}<QbLine qb={item.qb} /></span>
        <span className="wp">{item.probability !== null ? percent(item.probability) : ''}</span>
        <span className="score">{final ? <span className="gl-final">{item.actual}</span> : item.projected !== undefined ? item.projected.toFixed(1) : '—'}</span>
      </div>)}
      {!projection && <span className="gl-note">Projection is being prepared for this game.</span>}
      {final && projection && <span className="gl-note gl-result">We projected {away.abbreviation} {projection.away.toFixed(1)}, {home.abbreviation} {projection.home.toFixed(1)}
        {result && <span className={`gl-pill ${result === 'win' ? 'win' : result === 'loss' ? 'loss' : 'small'}`}>{result === 'win' ? 'Winner right' : result === 'loss' ? 'Winner wrong' : 'Tie'}</span>}</span>}
    </div>
    <div className="gl-mkt">
      <span className="gl-label m-label">Spread</span>
      <span className="line">Gridline <b>{projection ? lineText(projection.margin, home.abbreviation, away.abbreviation) : '—'}</b></span>
      <span className="line">Vegas <b>{vegas.homeLine !== null ? vegasLineText(vegas.homeLine, home.abbreviation, away.abbreviation) : '—'}</b></span>
    </div>
    <div className="gl-mkt">
      <span className="gl-label m-label">Total</span>
      <span className="line">Gridline <b>{projection ? projection.total.toFixed(1) : '—'}</b></span>
      <span className="line">Vegas <b>{vegas.total ?? '—'}</b></span>
    </div>
    <span className="gl-go" aria-hidden="true">›</span>
  </Link>;
}

function HeroStats({ season }: { season: number | undefined }) {
  const touchdowns = useGetConsumerTouchdowns();
  const params = season ? { season } : undefined;
  const projections = useGetConsumerGameProjections(params, { query: { queryKey: getGetConsumerGameProjectionsQueryKey(params), enabled: season !== undefined } });
  const td = touchdowns.data;
  const games = projections.data;
  const winners = games?.record;
  const decided = winners ? winners.wins + winners.losses : 0;
  return <div className="gl-stats" aria-label="How the models are doing">
    {td?.record && td.record.weeksGraded > 0
      ? <div className="gl-stat"><b>{td.record.topTenHits}/{td.record.topTenPicks}</b><small>Top-10 TD picks that scored this season</small></div>
      : td?.evaluation.topTenHitRate != null && <div className="gl-stat"><b>{percent(td.evaluation.topTenHitRate)}</b><small>of top-10 TD picks scored in testing</small></div>}
    {decided > 0
      ? <div className="gl-stat"><b>{winners!.wins}–{winners!.losses}</b><small>Winners picked this season</small></div>
      : typeof games?.evaluation.winnersModel === 'number' && <div className="gl-stat"><b>{percent(games.evaluation.winnersModel)}</b><small>of winners picked in testing</small></div>}
    <p className="gl-stats-note">Tested on past seasons the models never trained on. <Link href="/methodology" className="gl-link">How we test</Link></p>
  </div>;
}

export default function PickSheet() {
  const dashboard = useGetConsumerDashboard({ query: { queryKey: getGetConsumerDashboardQueryKey(), staleTime: 60_000, refetchInterval: 120_000 } });
  const now = useConsumerNow();
  const week = useMemo(() => currentWeek(dashboard.data?.games ?? [], now), [dashboard.data, now]);
  const params = week ? { season: week.season } : undefined;
  const projections = useGetConsumerGameProjections(params, { query: { queryKey: getGetConsumerGameProjectionsQueryKey(params), enabled: week !== null } });
  const views = useMemo(() => {
    const byGame = new Map((projections.data?.games ?? []).map(projection => [projection.gameId, projection]));
    return (week?.games ?? []).map(game => buildGameView(game, byGame.get(game.gameId)));
  }, [week, projections.data]);
  const linesAt = views.map(view => view.game.market?.spread?.capturedAt ?? view.game.market?.total?.capturedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  const days = useMemo(() => {
    const groups = new Map<string, GameView[]>();
    for (const view of views) {
      const key = view.game.kickoffTime ? dayLabel(view.game.kickoffTime) : 'Time to be announced';
      groups.set(key, [...(groups.get(key) ?? []), view]);
    }
    return [...groups.entries()];
  }, [views]);

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{week ? `${week.season} season · Week ${week.week}` : 'NFL picks'}</p>
        <h1 className="gl-title">This week&apos;s <span>picks</span></h1>
        <p className="gl-lede">Who&apos;s most likely to score a touchdown, and our projected score for every game, adjusted for who&apos;s playing quarterback. Built from NFL play-by-play data and updated through the week.</p>
      </div>
      <HeroStats season={week?.season} />
    </header>

    <TopTouchdowns now={now} />

    {dashboard.isLoading && <ConsumerLoading label="Loading this week's games…" />}
    {dashboard.isError && <div className="gl-empty"><strong>We couldn&apos;t load this week&apos;s games.</strong>Refresh the page in a minute. If it keeps happening, the schedule feed may be updating.</div>}

    {week && <section className="gl-section" aria-labelledby="board-heading">
      <div className="gl-section-head">
        <h2 id="board-heading">Every game</h2>
        <p>Our projected score and line next to the sportsbook&apos;s{linesAt ? ` (lines as of ${new Date(linesAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })})` : ''}</p>
      </div>
      {days.map(([day, items]) => <div key={day} className="gl-day">
        <h3 className="gl-label">{day}</h3>
        <div className="gl-card gl-board">
          <div className="gl-board-head gl-lines-row gl-label"><span>Kickoff</span><span>Projected score · win chance</span><span>Spread</span><span>Total</span><span /></div>
          {items.map(view => <GameRow key={view.game.gameId} view={view} now={now} />)}
        </div>
      </div>)}
    </section>}

    {!dashboard.isLoading && !dashboard.isError && !week && <div className="gl-empty"><strong>No games on the schedule right now.</strong>Picks return when the next week&apos;s schedule is posted. <Link href="/games" className="gl-link">Browse past games</Link>.</div>}

    <footer className="gl-card" style={{ padding: 18 }}>
      <div className="gl-footer-inner" style={{ padding: 0 }}>
        <p><b>How the game projections work</b>Team offense and defense from every play this season and last, adjusted for each starting quarterback, rest and home field. Backup and new starters are flagged.</p>
        <p><b>Why no spread picks?</b>In testing on 2021–2025, our projections came within about 0.4 points of the Vegas closing line on average but didn&apos;t beat it against the spread. We show our number as a second opinion instead of calling it a bet.</p>
        <p><b>Touchdown picks</b>Ranked by the chance each player scores, using their role near the goal line, target and carry share, Vegas team totals and the defense they face. <Link href="/touchdowns" className="gl-link">See all</Link>.</p>
      </div>
    </footer>
  </div>;
}
