import { useMemo } from 'react';
import { Link } from 'wouter';
import {
  getGetConsumerDashboardQueryKey, getGetConsumerGameProjectionsQueryKey, useGetConsumerDashboard,
  useGetConsumerGameProjections, useGetConsumerTouchdowns,
} from '@workspace/api-client-react';
import { NewsletterSignup } from '@/components/NewsletterSignup';
import { TeamChip } from '@/components/GameBoard';
import { currentWeek } from '@/lib/pick-sheet';
import { playerSlug } from '@/lib/player-slug';
import { favorite, formatRecord, formatSpread, modelHomeSpread, type CbbGame, type CbbTeam } from '@/lib/cbb';
import { nextStart, nflRecordText, topCbbPicks, units } from '@/lib/home-sports';
import { useCbb } from '@/lib/cbb-data';
import { useCbbAccess } from '@/lib/sports';
import { CbbLogo } from '@/pages/cbb/CbbLogo';
import { ConsumerLoading, useConsumerNow } from './consumer-ui';

const percent = (value: number) => `${Math.round(value * 100)}%`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

function SportCardHead({ title, href, cta, record, start }: { title: string; href: string; cta: string; record: string; start: string | null }) {
  return <header className="gl-sport-card-head">
    <div>
      <h2>{title}</h2>
      <p className="gl-sport-record">{record}</p>
    </div>
    <div className="gl-sport-card-side">
      <Link href={href} className="gl-link">{cta} ›</Link>
      {start && <span className="gl-sport-start">{start}</span>}
    </div>
  </header>;
}

function NflCard({ now }: { now: number }) {
  const dashboard = useGetConsumerDashboard({ query: { queryKey: getGetConsumerDashboardQueryKey(), staleTime: 60_000, refetchInterval: 120_000 } });
  const week = useMemo(() => currentWeek(dashboard.data?.games ?? [], now), [dashboard.data, now]);
  const params = week ? { season: week.season } : undefined;
  const projections = useGetConsumerGameProjections(params, { query: { queryKey: getGetConsumerGameProjectionsQueryKey(params), enabled: week !== null } });
  const touchdowns = useGetConsumerTouchdowns();
  const tds = (touchdowns.data?.picks ?? []).filter(pick => !pick.kickoff || Date.parse(pick.kickoff) > now).slice(0, 3);
  const early = projections.data?.early;
  const earlyPicks = (early?.games ?? []).filter(pick => !pick.started && Date.parse(pick.kickoff) > now).sort((a, b) => b.gap - a.gap).slice(0, 3);
  const start = nextStart((week?.games ?? []).filter(game => !game.finalScore).map(game => game.kickoffTime).filter((time): time is string => Boolean(time)), now, 'kickoff');

  return <section className="gl-card gl-sport-card" data-sport="nfl" aria-labelledby="home-nfl">
    <SportCardHead title={week ? `NFL · Week ${week.week}` : 'NFL'} href="/nfl" cta="All NFL picks"
      record={`NFL early lines: ${nflRecordText(early?.record)}`} start={start} />
    <h3 id="home-nfl" className="gl-label">Top anytime TD picks</h3>
    {touchdowns.isLoading ? <ConsumerLoading label="Loading touchdown picks…" />
      : tds.length ? <ol className="gl-sport-list">{tds.map((pick, index) => <li key={pick.playerId}>
        <Link href={`/td/${playerSlug(pick.name)}`} className="gl-sport-row">
          <span className="gl-sport-rank">{index + 1}</span>
          <span className="gl-sport-main"><b>{pick.name}</b><small>{pick.position} · <TeamChip team={pick.team} /> {pick.isHome ? 'vs' : 'at'} {pick.opponent}</small></span>
          <span className="gl-sport-num"><b>{percent(pick.probability)}</b><small>chance</small></span>
        </Link>
      </li>)}</ol>
      : <p className="gl-sport-empty">Touchdown picks post early in the week once lines are up.</p>}
    {earlyPicks.length > 0 && <>
      <h3 className="gl-label">Early-line spread picks</h3>
      <ul className="gl-sport-chips">{earlyPicks.map(pick => {
        const team = pick.side === 'home' ? pick.homeTeam : pick.awayTeam;
        const other = pick.side === 'home' ? pick.awayTeam : pick.homeTeam;
        return <li key={pick.gameId}><Link href={`/games/${pick.gameId}`} className="gl-sport-chip">
          <b>{team} {formatSpread(pick.line)}</b><small>{pick.side === 'home' ? 'vs' : 'at'} {other} · gap {pick.gap.toFixed(1)}</small>
        </Link></li>;
      })}</ul>
    </>}
  </section>;
}

function cbbLine(homeSpread: number | null, game: CbbGame, teams: Map<string, CbbTeam>) {
  const fav = favorite(homeSpread, game);
  if (!fav) return '—';
  if (Math.round(fav.points * 2) === 0) return 'Pick’em';
  const team = teams.get(fav.team);
  return `${team?.abbr ?? team?.short ?? ''} ${formatSpread(-fav.points)}`;
}

function CbbCard({ now }: { now: number }) {
  const { query, report, record } = useCbb();
  const teams = useMemo(() => new Map((report?.teams ?? []).map(team => [team.id, team])), [report]);
  const picks = useMemo(() => topCbbPicks(report?.games ?? [], now), [report, now]);
  const top = useMemo(() => [...(report?.teams ?? [])].sort((a, b) => a.rank - b.rank).slice(0, 3), [report]);
  const graded = record ? record.wins + record.losses + record.pushes : 0;
  const recordText = record && graded ? `${formatRecord(record)}, ${units(record.units)}` : 'tracking since Nov 2, none graded yet';
  const start = nextStart((report?.games ?? []).map(game => game.tip), now, 'tip');

  return <section className="gl-card gl-sport-card" data-sport="cbb" aria-labelledby="home-cbb">
    <SportCardHead title="College Basketball · Today" href="/cbb" cta="All games" record={`College spreads: ${recordText}`} start={start} />
    <h3 id="home-cbb" className="gl-label">Biggest disagreements with the line</h3>
    {query.isLoading ? <ConsumerLoading label="Loading college games…" />
      : query.isError ? <p className="gl-sport-empty">College games couldn&apos;t load. Refresh in a minute.</p>
      : picks.length ? <ol className="gl-sport-list">{picks.map(game => {
        const home = teams.get(game.home.id);
        const away = teams.get(game.away.id);
        const pickTeam = teams.get(game.pick!.team);
        const line = game.line ? cbbLine(game.line.homeSpread, game, teams) : '—';
        const ours = cbbLine(modelHomeSpread(game), game, teams);
        return <li key={game.id}><Link href="/cbb" className="gl-sport-row gl-sport-row-cbb">
          <span className="gl-sport-main"><b>{away?.short ?? 'Away'} at {home?.short ?? 'Home'}</b><small>{clock(game.tip)} ET{game.neutral ? ' · neutral' : ''}</small>
            <small className="gl-sport-phone-lines">Line {line} · Probable {ours}</small></span>
          <span className="gl-sport-num"><small>Line</small><b>{line}</b></span>
          <span className="gl-sport-num ours"><small>Probable</small><b>{ours}</b></span>
          <span className="gl-pill strong">{pickTeam?.abbr ?? pickTeam?.short} {formatSpread(game.pick!.line)}</span>
        </Link></li>;
      })}</ol>
      : <p className="gl-sport-empty">No picks on the board right now. We only pick a game when we disagree with the line by {report?.model.pickEdge ?? 2}+ points.</p>}
    {top.length > 0 && <>
      <h3 className="gl-label">Power ratings · top 3</h3>
      <ul className="gl-sport-chips">{top.map(team => <li key={team.id}><Link href="/cbb/ratings" className="gl-sport-chip gl-sport-chip-team">
        <CbbLogo team={team} size={22} />
        <span><b>{team.rank}. {team.short}</b><small>{team.net >= 0 ? '+' : '−'}{Math.abs(team.net).toFixed(1)} per 100</small></span>
      </Link></li>)}</ul>
    </>}
  </section>;
}

/**
 * The front door: today's top picks from each sport, each leading into that
 * sport's section. College basketball shows only once it's open to this visitor.
 */
export default function Home() {
  const now = useConsumerNow();
  const cbb = useCbbAccess();
  const today = new Date(now).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{today}</p>
        <h1 className="gl-title">Today&apos;s best picks, <span>priced against the books.</span></h1>
        <p className="gl-lede">{cbb.visible
          ? 'NFL and college basketball, each with its own model and its own public record. Every pick is timestamped before kickoff or tip-off.'
          : 'Anytime touchdown chances and a projected score for every NFL game, from play-by-play data. Every pick is timestamped before kickoff.'}</p>
      </div>
    </header>
    <div className={`gl-sport-cards${cbb.visible ? '' : ' single'}`}>
      <NflCard now={now} />
      {cbb.visible && <CbbCard now={now} />}
    </div>
    <NewsletterSignup source="home" />
  </div>;
}
