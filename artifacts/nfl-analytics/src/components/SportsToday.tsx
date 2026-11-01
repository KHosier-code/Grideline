import { useMemo } from 'react';
import { Link } from 'wouter';
import { useGetConsumerTouchdowns } from '@workspace/api-client-react';
import { formatSpread, modelHomeSpread, topCbbPicks, type CbbTeam } from '@/lib/cbb';
import { useCbb } from '@/lib/cbb-data';
import { formatPrice } from '@/lib/pick-sheet';
import { playerSlug } from '@/lib/player-slug';
import { SPORTS } from '@/lib/sports';
import { TeamChip } from '@/components/GameBoard';

const percent = (value: number) => `${Math.round(value * 100)}%`;
const tipTime = (tip: string) => new Date(tip).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

function NflCard({ now, week }: { now: number; week: string | null }) {
  const touchdowns = useGetConsumerTouchdowns();
  const picks = (touchdowns.data?.picks ?? []).filter(pick => !pick.kickoff || Date.parse(pick.kickoff) > now).slice(0, 3);
  return <section className="gl-card gl-sport-card" data-sport="nfl" aria-labelledby="today-nfl">
    <header><span className="gl-label">{week ?? SPORTS.nfl.name}</span><h2 id="today-nfl">NFL: top touchdown picks</h2></header>
    {touchdowns.isLoading ? <p className="gl-sport-card-empty">Loading picks…</p>
      : picks.length === 0 ? <p className="gl-sport-card-empty">Touchdown picks post early in the week once lines are up.</p>
      : <ol className="gl-sport-card-list">{picks.map(pick => <li key={pick.playerId}>
        <Link href={`/td/${playerSlug(pick.name)}`}>
          <span><b>{pick.name}</b><small><TeamChip team={pick.team} />{pick.isHome ? 'vs' : 'at'} {pick.opponent}</small></span>
          <span className="gl-sport-card-num"><b>{percent(pick.probability)}</b><small>Fair {formatPrice(pick.fairOdds)}</small></span>
        </Link>
      </li>)}</ol>}
    <footer><Link href="/touchdowns" className="gl-link">All NFL picks ›</Link><Link href={SPORTS.nfl.record} className="gl-link">NFL record</Link></footer>
  </section>;
}

function CbbCard({ now }: { now: number }) {
  const { query, report } = useCbb();
  const teams = useMemo(() => new Map((report?.teams ?? []).map(team => [team.id, team])), [report]);
  const top = useMemo(() => topCbbPicks(report?.games ?? [], now), [report, now]);
  const name = (team: CbbTeam | undefined) => team?.short ?? 'Unknown';
  return <section className="gl-card gl-sport-card" data-sport="cbb" aria-labelledby="today-cbb">
    <header><span className="gl-label">{top.label ?? 'Today'}</span><h2 id="today-cbb">College Basketball: top picks</h2></header>
    {query.isLoading ? <p className="gl-sport-card-empty">Loading picks…</p>
      : top.picks.length === 0 ? <p className="gl-sport-card-empty">No college picks on the board right now. We pick a game only when our line is 2+ points off the sportsbook&apos;s.</p>
      : <ol className="gl-sport-card-list">{top.picks.map(game => {
        const pick = game.pick!;
        const picked = teams.get(pick.team);
        const other = teams.get(pick.side === 'home' ? game.away.id : game.home.id);
        const ours = pick.side === 'home' ? modelHomeSpread(game) : -modelHomeSpread(game);
        return <li key={game.id}><Link href="/cbb">
          <span><b>{name(picked)} {formatSpread(pick.line)}</b><small>{pick.side === 'home' ? 'vs' : 'at'} {name(other)} · {tipTime(game.tip)} ET</small></span>
          <span className="gl-sport-card-num"><b>{formatSpread(ours)}</b><small>our line</small></span>
        </Link></li>;
      })}</ol>}
    <footer><Link href="/cbb" className="gl-link">All college games ›</Link><Link href={SPORTS.cbb.record} className="gl-link">College record</Link></footer>
  </section>;
}

/** The home page's opener once college basketball is visible: each sport's top picks, leading into its section. */
export function SportsToday({ now, week }: { now: number; week: string | null }) {
  return <div className="gl-sports-today">
    <NflCard now={now} week={week} />
    <CbbCard now={now} />
  </div>;
}
