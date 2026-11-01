import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ConsumerLoading } from '@/pages/consumer/consumer-ui';
import {
  favorite, formatRecord, formatSpread, gamesByDay, modelHomeSpread, seasonLabel, winRate,
  type CbbGame, type CbbRecord, type CbbTeam,
} from '@/lib/cbb';
import { useCbb } from '@/lib/cbb-data';
import './cbb.css';

const pct = (value: number) => `${Math.round(value * 100)}%`;
const tipTime = (tip: string) => new Date(tip).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

export function CbbLogo({ team, size = 28 }: { team: CbbTeam | undefined; size?: number }) {
  if (!team?.logo) return <span className="cbb-logo-blank" style={{ width: size, height: size }} aria-hidden="true" />;
  return <img className="cbb-logo" src={team.logo} alt="" width={size} height={size} loading="lazy" />;
}

function TeamLine({ team, rank, apRank, home, neutral }: { team: CbbTeam | undefined; rank: number; apRank: number | null; home: boolean; neutral: boolean }) {
  return <div className="cbb-team">
    <CbbLogo team={team} />
    <span>
      <b>{apRank ? <small className="cbb-ap">{apRank}</small> : null}{team?.name ?? 'Unknown'}</b>
      <small>#{rank} in our ratings{team ? ` · ${team.wins}-${team.losses}` : ''}{home && !neutral ? ' · home' : ''}</small>
    </span>
  </div>;
}

/** "DUKE −6.5" from a home spread. */
function lineText(homeSpread: number | null, game: CbbGame, teams: Map<string, CbbTeam>) {
  const fav = favorite(homeSpread, game);
  if (!fav) return '—';
  if (Math.round(fav.points * 2) === 0) return 'Pick’em';
  return `${teams.get(fav.team)?.abbr ?? teams.get(fav.team)?.short ?? ''} ${formatSpread(-fav.points)}`;
}

function GameCard({ game, teams }: { game: CbbGame; teams: Map<string, CbbTeam> }) {
  const home = teams.get(game.home.id);
  const away = teams.get(game.away.id);
  const pickTeam = game.pick ? teams.get(game.pick.team) : undefined;
  const homeProb = game.model.homeWinProb;
  return <article className={`gl-card cbb-game${game.pick ? ' has-pick' : ''}`}>
    <header className="cbb-game-head">
      <span>{tipTime(game.tip)} ET{game.neutral ? ' · neutral site' : ''}</span>
      {game.pick && <span className="gl-pill strong">Pick: {pickTeam?.short ?? 'side'} {formatSpread(game.pick.line)}</span>}
    </header>
    <div className="cbb-game-body">
      <div className="cbb-teams">
        <TeamLine team={away} rank={game.away.rank} apRank={game.away.apRank} home={false} neutral={game.neutral} />
        <TeamLine team={home} rank={game.home.rank} apRank={game.home.apRank} home neutral={game.neutral} />
      </div>
      <dl className="cbb-lines">
        <div><dt>Opened</dt><dd>{game.line ? lineText(game.line.homeSpreadOpen, game, teams) : '—'}</dd></div>
        <div><dt>Now</dt><dd>{game.line ? lineText(game.line.homeSpread, game, teams) : 'No line yet'}</dd></div>
        <div className="ours"><dt>Probable</dt><dd>{lineText(modelHomeSpread(game), game, teams)}</dd></div>
        <div><dt>Total</dt><dd>{game.line?.total ?? '—'}<small> · ours {game.model.total.toFixed(1)}</small></dd></div>
      </dl>
    </div>
    <footer className="cbb-game-foot">
      <span className="cbb-prob" aria-label={`Win chance: ${away?.short} ${pct(1 - homeProb)}, ${home?.short} ${pct(homeProb)}`}>
        <b>{away?.abbr ?? away?.short} {pct(1 - homeProb)}</b>
        <span className="cbb-prob-bar" aria-hidden="true"><i style={{ width: `${(1 - homeProb) * 100}%` }} /></span>
        <b>{pct(homeProb)} {home?.abbr ?? home?.short}</b>
      </span>
      <span className="cbb-score">Projected {Math.round(game.model.awayPoints)}–{Math.round(game.model.homePoints)}</span>
    </footer>
  </article>;
}

/** One line of the season record on the games page; the full record has its own page. */
function RecordStrip({ record }: { record: CbbRecord }) {
  const graded = record.wins + record.losses + record.pushes;
  const rate = winRate(record);
  return <Link href="/cbb/record" className="gl-card cbb-record-strip">
    <span className="gl-label">College record</span>
    {graded === 0
      ? <b>No picks graded yet{record.pending ? ` · ${record.pending} waiting on results` : ''}</b>
      : <b>{formatRecord(record)} against the spread{rate === null ? '' : ` · ${pct(rate)}`} · {record.units >= 0 ? '+' : ''}{record.units.toFixed(1)}u</b>}
    <small>Every pick, graded at the line we posted ›</small>
  </Link>;
}

export default function CbbGames() {
  const { query, report, record } = useCbb();
  const [picksOnly, setPicksOnly] = useState(false);
  const teams = useMemo(() => new Map((report?.teams ?? []).map(team => [team.id, team])), [report]);
  const days = useMemo(() => gamesByDay((report?.games ?? []).filter(game => !picksOnly || game.pick)), [report, picksOnly]);
  const pickCount = report?.games.filter(game => game.pick).length ?? 0;

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{report ? `College basketball · ${seasonLabel(report.season)}` : 'College basketball'}</p>
        <h1 className="gl-title">Today&apos;s <span>games</span></h1>
        <p className="gl-lede">Our line for every Division I game today and tomorrow, next to the sportsbook&apos;s opening and current numbers. A pick means we disagree with the current spread by {report?.model.pickEdge ?? 2}+ points.</p>
      </div>
    </header>

    <aside className="gl-card cbb-note" aria-label="About these picks">
      <b>New for this season, and still proving itself.</b> In testing on the last three seasons, our numbers did not beat closing lines (50.2%). Against 2025-26 opening lines, games where we disagreed by 2–6 points won 52–54%, and the line moved our way about twice as often as against us. That&apos;s a thin edge, so we&apos;re tracking every pick in public before calling it one. <Link href="/cbb/how-it-works" className="gl-link">How it works</Link>.
    </aside>

    {query.isLoading && <ConsumerLoading label="Loading games…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load the games.</strong>Refresh the page in a minute.</div>}
    {query.data?.status === 'unavailable' && <div className="gl-empty"><strong>College games aren&apos;t posted yet.</strong>The board starts before the season tips off on November 2.</div>}

    {report && <>
      <div className="gl-section-head">
        <div className="gl-filters" role="group" aria-label="Show games">
          <button type="button" aria-pressed={!picksOnly} onClick={() => setPicksOnly(false)}>All games ({report.games.length})</button>
          <button type="button" aria-pressed={picksOnly} onClick={() => setPicksOnly(true)}>Picks only ({pickCount})</button>
        </div>
        <p className="cbb-muted">Updated {new Date(report.generatedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET · lines from {report.games.find(game => game.line?.provider)?.line?.provider ?? 'ESPN'}</p>
      </div>
      {days.length === 0 && <div className="gl-empty"><strong>{picksOnly ? 'No picks on the board right now.' : 'No Division I games today or tomorrow.'}</strong>{picksOnly ? 'We only pick a game when we disagree with the line by 2+ points.' : 'Check back on the next game day.'}</div>}
      {days.map(day => <section key={day.key} className="cbb-day" aria-label={day.label}>
        <h2 className="cbb-day-title">{day.label} <small>{day.games.length} games</small></h2>
        <div className="cbb-grid">{day.games.map(game => <GameCard key={game.id} game={game} teams={teams} />)}</div>
      </section>)}
    </>}

    {record && <RecordStrip record={record} />}
  </div>;
}
