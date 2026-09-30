import { Link } from 'wouter';
import type { ConsumerProjectionQb } from '@workspace/api-client-react';
import { lineText, vegasLineText, type GameView } from '@/lib/pick-sheet';
import { teamColor, teamTextColor } from '@/lib/team-colors';

const percent = (value: number) => `${Math.round(value * 100)}%`;
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const gameHref = (view: GameView) => `/games/${view.game.gameId}?season=${view.game.season}&week=${view.game.week}`;

export function TeamChip({ team, large = false }: { team: string; large?: boolean }) {
  return <span className={`gl-chip${large ? ' lg' : ''}`} style={{ background: teamColor(team), color: teamTextColor(team) }}>{team}</span>;
}

function QbLine({ qb }: { qb: ConsumerProjectionQb | null }) {
  if (!qb?.name) return null;
  return <span className="gl-qb">QB {qb.name}{qb.newStarter && <span className="gl-flag">Not usual starter</span>}{!qb.listed && <span className="gl-qb-note"> · expected</span>}</span>;
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

/** Every game in a week, grouped by day: our projection next to the sportsbook line. */
export function GameBoard({ views, now }: { views: GameView[]; now: number }) {
  const groups = new Map<string, GameView[]>();
  for (const view of views) {
    const key = view.game.kickoffTime ? dayLabel(view.game.kickoffTime) : 'Time to be announced';
    groups.set(key, [...(groups.get(key) ?? []), view]);
  }
  return <>{[...groups.entries()].map(([day, items]) => <div key={day} className="gl-day">
    <h3 className="gl-label">{day}</h3>
    <div className="gl-card gl-board">
      <div className="gl-board-head gl-lines-row gl-label"><span>Kickoff</span><span>Projected score · win chance</span><span>Spread</span><span>Total</span><span /></div>
      {items.map(view => <GameRow key={view.game.gameId} view={view} now={now} />)}
    </div>
  </div>)}</>;
}
