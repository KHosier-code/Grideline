import { useMemo } from 'react';
import { Link } from 'wouter';
import {
  getGetConsumerDashboardQueryKey, getGetConsumerGameProjectionsQueryKey, useGetConsumerDashboard,
  useGetConsumerGameProjections, useGetConsumerTouchdowns,
} from '@workspace/api-client-react';
import { buildGameView, currentWeek, formatPrice, lineGap } from '@/lib/pick-sheet';
import { GameBoard, TeamChip, openHomeLine } from '@/components/GameBoard';
import { HundredGrid, abbr, toPoolGame } from '@/components/GameSim';
import { matchupAccents } from '@/lib/team-colors';
import { ConsumerLoading, useConsumerNow } from './consumer-ui';

export { TeamChip };

const percent = (value: number) => `${Math.round(value * 100)}%`;

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

function HeroStats({ season }: { season: number | undefined }) {
  const touchdowns = useGetConsumerTouchdowns();
  const params = season ? { season } : undefined;
  const projections = useGetConsumerGameProjections(params, { query: { queryKey: getGetConsumerGameProjectionsQueryKey(params), enabled: season !== undefined } });
  const td = touchdowns.data;
  const games = projections.data;
  const winners = games?.record;
  const decided = winners ? winners.wins + winners.losses : 0;
  const favorite = games?.favoriteRecord;
  const favoriteDecided = favorite ? favorite.wins + favorite.losses : 0;
  return <div className="gl-stats" aria-label="How the models are doing">
    {td?.record && td.record.weeksGraded > 0
      ? <div className="gl-stat"><b>{td.record.topTenHits}/{td.record.topTenPicks}</b><small>Top-10 TD picks that scored this season</small></div>
      : td?.evaluation.topTenHitRate != null && <div className="gl-stat"><b>{percent(td.evaluation.topTenHitRate)}</b><small>of top-10 TD picks scored in testing</small></div>}
    {decided > 0
      ? <div className="gl-stat"><b>{winners!.wins}–{winners!.losses}</b><small>Winners picked this season{favoriteDecided > 0 ? ` (Vegas favorite ${favorite!.wins}–${favorite!.losses})` : ''}</small></div>
      : typeof games?.evaluation.winnersModel === 'number' && <div className="gl-stat"><b>{percent(games.evaluation.winnersModel)}</b><small>of winners picked in testing{typeof games.evaluation.winnersFavorite === 'number' ? ` (Vegas favorite ${percent(games.evaluation.winnersFavorite)})` : ''}</small></div>}
    <p className="gl-stats-note">Tested on past seasons the models never trained on. <Link href="/methodology" className="gl-link">How we test</Link></p>
  </div>;
}

/** Three surest winners this week, linking to the full Pool Picks page. */
function PoolTeaser({ views, now }: { views: ReturnType<typeof buildGameView>[]; now: number }) {
  const games = views
    .filter(view => !view.game.finalScore && (!view.game.kickoffTime || Date.parse(view.game.kickoffTime) > now))
    .map(toPoolGame).filter((game): game is NonNullable<typeof game> => game !== null)
    .sort((a, b) => b.wins - a.wins).slice(0, 3);
  if (games.length < 3) return null;
  return <Link href="/pickem" className="gl-card gl-pool-teaser">
    <span className="gl-pool-teaser-copy"><span className="gl-label">Pool Picks</span><b>Safest picks this week</b><small>Winners, spreads and totals for your pool ›</small></span>
    {games.map(game => {
      const [win, loss] = matchupAccents(abbr(game, game.pick), abbr(game, game.pick === 'home' ? 'away' : 'home'));
      return <span key={game.view.game.gameId} className="gl-pool-teaser-pick">
        <HundredGrid wins={game.wins} winColor={win} lossColor={loss} label={`${abbr(game, game.pick)} wins ${game.wins} of 100`} />
        <span><b>{abbr(game, game.pick)}</b> over {abbr(game, game.pick === 'home' ? 'away' : 'home')}<small>{game.wins} of 100</small></span>
      </span>;
    })}
  </Link>;
}

/** Upcoming games where Gridline's line is furthest from the book's. A second opinion, not a pick. */
function BiggestGaps({ views, now }: { views: ReturnType<typeof buildGameView>[]; now: number }) {
  const gaps = views
    .filter(view => !view.game.finalScore && (!view.game.kickoffTime || Date.parse(view.game.kickoffTime) > now))
    .map(view => ({ view, gap: lineGap(view, openHomeLine(view)?.line ?? null) }))
    .filter((item): item is { view: typeof item.view; gap: NonNullable<typeof item.gap> & { side: 'home' | 'away' } } => item.gap?.side != null)
    .sort((a, b) => b.gap.points - a.gap.points)
    .slice(0, 3);
  if (!gaps.length) return null;
  return <section className="gl-section" aria-labelledby="gaps-heading">
    <div className="gl-section-head"><h2 id="gaps-heading">Where we disagree with Vegas</h2><p>Biggest gaps between our line and the current line. Not picks: we track whether the line moves our way.</p></div>
    <div className="gl-gap-list">{gaps.map(({ view, gap }) => {
      const team = view.game.matchup[gap.side].abbreviation;
      const other = view.game.matchup[gap.side === 'home' ? 'away' : 'home'].abbreviation;
      return <Link key={view.game.gameId} href={`/games/${view.game.gameId}?season=${view.game.season}&week=${view.game.week}`} className="gl-card gl-gap-card">
        <TeamChip team={team} />
        <span><b>{gap.points} pts</b> more on {team} vs {other}<small>{gap.moved === null || gap.moved === 0 ? 'Line unchanged since open' : `Line moved ${Math.abs(gap.moved)} ${gap.moved > 0 ? 'toward' : 'away from'} us since open`}</small></span>
      </Link>;
    })}</div>
  </section>;
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

    <PoolTeaser views={views} now={now} />

    <BiggestGaps views={views} now={now} />

    {dashboard.isLoading && <ConsumerLoading label="Loading this week's games…" />}
    {dashboard.isError && <div className="gl-empty"><strong>We couldn&apos;t load this week&apos;s games.</strong>Refresh the page in a minute. If it keeps happening, the schedule feed may be updating.</div>}

    {week && <section className="gl-section" aria-labelledby="board-heading">
      <div className="gl-section-head">
        <h2 id="board-heading">Every game</h2>
        <p>Our projected score and line next to the sportsbook&apos;s{linesAt ? ` (lines as of ${new Date(linesAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })})` : ''}</p>
      </div>
      <GameBoard views={views} now={now} />
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
