import { Link } from 'wouter';
import { getGetConsumerPowerRatingsQueryKey, useGetConsumerPowerRatings, type ConsumerProjectionQb } from '@workspace/api-client-react';
import { TeamLogo } from './TeamLogo';
import { lineText, vegasLineText, type GameView } from '@/lib/pick-sheet';
import { teamColor, teamTextColor } from '@/lib/team-colors';

const percent = (value: number) => `${Math.round(value * 100)}%`;
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const gameHref = (view: GameView) => `/games/${view.game.gameId}?season=${view.game.season}&week=${view.game.week}`;

export function TeamChip({ team, large = false }: { team: string; large?: boolean }) {
  return <span className={`gl-chip${large ? ' lg' : ''}`} style={{ background: teamColor(team), color: teamTextColor(team) }}>{team}</span>;
}

const lastName = (name: string) => name.split(' ').slice(1).join(' ') || name;

function QbLine({ qb }: { qb: ConsumerProjectionQb | null }) {
  if (!qb?.name) return null;
  return <span className="gl-qb">QB {qb.name}{qb.outName ? <span className="gl-flag out">{qb.outName} {(qb.outReason ?? 'out').toLowerCase()}</span> : qb.newStarter && <span className="gl-flag">Not usual starter</span>}{!qb.listed && <span className="gl-qb-note"> · expected</span>}</span>;
}

export function GameRow({ view, now }: { view: GameView; now: number }) {
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

/** Opening spread as the HOME team's line, from the first line we captured for the game. */
export function openHomeLine(view: GameView): { line: number; price: number | null } | null {
  const open = view.game.initialMarkets?.spread;
  if (!open || typeof open.point !== 'number') return null;
  const home = view.game.matchup.home;
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const selection = normalize(open.selection);
  const isHome = [home.name, home.abbreviation].some(value => {
    const candidate = normalize(value);
    return candidate.length > 1 && (selection.includes(candidate) || candidate.includes(selection));
  });
  return { line: isHome ? open.point : -open.point, price: isHome ? open.price : null };
}

const lineNumber = (value: number) => value === 0 ? 'PK' : `${value > 0 ? '+' : ''}${Number.isInteger(value) ? value : value.toFixed(1)}`;
const half = (value: number) => Math.round(value * 2) / 2;
const price = (value: number | null | undefined) => value === null || value === undefined ? '' : value > 0 ? `+${value}` : String(value);

/** One game: each team's open, current and Gridline line side by side. */
export function GameCard({ view, now, records }: { view: GameView; now: number; records?: Map<string, string> }) {
  const { game, projection, result } = view;
  const final = game.finalScore;
  const started = game.kickoffTime ? Date.parse(game.kickoffTime) <= now : false;
  const open = openHomeLine(view);
  const currentHome = view.vegas.homeLine;
  const currentPrice = game.market?.spread?.price ?? null;
  const sides = [
    { side: 'away' as const, team: game.matchup.away, sign: -1, qb: projection?.awayQb ?? null, score: final?.away,
      win: projection ? 1 - projection.homeWin : null },
    { side: 'home' as const, team: game.matchup.home, sign: 1, qb: projection?.homeQb ?? null, score: final?.home,
      win: projection?.homeWin ?? null },
  ];
  return <Link href={gameHref(view)} className="gl-card gl-game-card" aria-label={`${game.matchup.away.name} at ${game.matchup.home.name}`}>
    <div className="gl-gc-head">
      <span>{final ? 'Final' : started ? 'Live' : game.kickoffTime ? time(game.kickoffTime) : 'TBD'}</span>
      {final ? <span>{result ? (result === 'win' ? 'Our winner ✓' : result === 'loss' ? 'Our winner ✗' : 'Tie') : ''}</span>
        : <><span>Open</span><span>Current</span><span>Gridline</span></>}
    </div>
    {sides.map(item => {
      const homeFactor = item.side === 'home' ? 1 : -1;
      const ourLine = projection ? half(-projection.margin * homeFactor) : null;
      const isFavorite = view.winner?.side === item.side;
      return <div key={item.side} className={`gl-gc-row${isFavorite ? ' fav' : ''}`}>
        <TeamLogo team={item.team.abbreviation} size={30} />
        <span className="gl-gc-team">
          <b>{item.team.abbreviation}</b>
          <small>{records?.get(item.team.abbreviation) ?? ''}{item.qb?.name ? `${records?.get(item.team.abbreviation) ? ' · ' : ''}${item.qb.name}` : ''}</small>
          {item.qb?.outName
            ? <em className="gl-flag out" title={`${item.qb.outName} is listed ${item.qb.outReason ?? 'out'}; ${item.qb.name ?? 'the backup'} is expected to start`}>{lastName(item.qb.outName)} {(item.qb.outReason ?? 'out').toLowerCase()}</em>
            : item.qb?.newStarter && <em className="gl-flag" title="Not the team's usual starting quarterback">New QB</em>}
        </span>
        {final ? <span className="gl-gc-score">{item.score}</span> : <>
          <span className="gl-gc-line">{open ? <><b>{lineNumber(open.line * homeFactor)}</b><small>{item.side === 'home' ? price(open.price) : ''}</small></> : <b className="gl-muted">—</b>}</span>
          <span className="gl-gc-line">{currentHome !== null ? <><b>{lineNumber(currentHome * homeFactor)}</b><small>{item.side === 'home' ? price(currentPrice) : ''}</small></> : <b className="gl-muted">—</b>}</span>
          <span className={`gl-gc-line gl-gc-model${isFavorite ? ' fav' : ''}`}>{ourLine !== null ? <><b>{lineNumber(ourLine)}</b><small>{item.win !== null ? percent(item.win) : ''}</small></> : <b className="gl-muted">—</b>}</span>
        </>}
      </div>;
    })}
    {final && projection && <p className="gl-gc-foot">We projected {game.matchup.away.abbreviation} {projection.away.toFixed(1)}, {game.matchup.home.abbreviation} {projection.home.toFixed(1)}</p>}
    {!final && projection && <p className="gl-gc-foot">Total: Gridline {projection.total.toFixed(1)} · Vegas {view.vegas.total ?? '—'}</p>}
  </Link>;
}

/** Every game in a week, grouped by day, as cards. */
export function GameBoard({ views, now }: { views: GameView[]; now: number }) {
  const ratings = useGetConsumerPowerRatings(undefined, { query: { queryKey: getGetConsumerPowerRatingsQueryKey(), staleTime: 5 * 60_000 } });
  const records = new Map((ratings.data?.teams ?? []).filter(team => team.record)
    .map(team => [team.team === 'LA' ? 'LAR' : team.team, `${team.record!.wins}-${team.record!.losses}${team.record!.ties ? `-${team.record!.ties}` : ''}`]));
  for (const [team, record] of [...records]) {
    if (team === 'LAR') records.set('LA', record);
    if (team === 'WAS') records.set('WSH', record);
  }
  const groups = new Map<string, GameView[]>();
  for (const view of views) {
    const key = view.game.kickoffTime ? dayLabel(view.game.kickoffTime) : 'Time to be announced';
    groups.set(key, [...(groups.get(key) ?? []), view]);
  }
  return <div className="gl-days">{[...groups.entries()].map(([day, items]) => <section key={day} className="gl-day-col" aria-label={day}>
    <h3 className="gl-day-head"><span className="gl-dot" aria-hidden="true" />{day}</h3>
    <div className="gl-day-cards">{items.map(view => <GameCard key={view.game.gameId} view={view} now={now} records={records} />)}</div>
  </section>)}</div>;
}
