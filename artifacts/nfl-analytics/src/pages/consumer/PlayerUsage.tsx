import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { TeamLogo } from '@/components/TeamLogo';
import { PlayerCell, ReportMeta, Seg, ShareBar, Sparkline } from '@/components/UsageBits';
import { rankCellStyle, teamName } from '@/lib/team-colors';
import { fixed, pct, useUsageReport, type UsagePlayer, type UsageReport, type UsageWindow } from '@/lib/usage-report';
import { getGetConsumerDashboardQueryKey, useGetConsumerDashboard } from '@workspace/api-client-react';
import { MatchupTag } from '@/components/GameDvp';
import { normalizeTeam } from '@/lib/parlay';
import { nextGames, playerMatchup, type NextGame } from '@/lib/dvp-matchups';
import { ConsumerLoading, useConsumerNow } from './consumer-ui';

type Next = Map<string, NextGame>;

/** The player's next opponent and how that defense treats their position. */
function MatchupCell({ report, next, player }: { report: UsageReport; next: Next; player: UsagePlayer }) {
  const matchup = playerMatchup(report, next, player.team, player.position);
  if (!matchup) return <td className="gl-muted">—</td>;
  const { game, line } = matchup;
  return <td className="gl-usage-matchup" title={line ? `${game.opponent} allows ${fixed(line.pprPerGame)} PPR points per game to ${player.position}s (#${line.pprRank} of 32)` : undefined}>
    <span>{game.home ? 'vs' : '@'} <TeamLogo team={normalizeTeam(game.opponent)} size={16} />{game.opponent}</span>
    <MatchupTag rank={line?.pprRank} />
  </td>;
}

type View = 'team' | 'leaders';
type Win = 'season' | 'last3';
type Leader = 'targetShare' | 'carryShare' | 'redZoneShare' | 'airYardsShare' | 'pprPerGame';
type PosFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE';

const LEADERS: Array<[Leader, string]> = [
  ['targetShare', 'Target share'], ['carryShare', 'Carry share'], ['redZoneShare', 'Red-zone share'],
  ['airYardsShare', 'Air yards share'], ['pprPerGame', 'PPR points'],
];

function readParams() {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  return {
    team: params.get('team')?.toUpperCase() ?? null,
    view: (params.get('view') === 'leaders' ? 'leaders' : 'team') as View,
    window: (params.get('window') === 'last3' ? 'last3' : 'season') as Win,
  };
}

function TeamPicker({ teams, value, onChange }: { teams: string[]; value: string; onChange: (team: string) => void }) {
  return <div className="gl-team-picker" role="group" aria-label="Choose a team">
    {teams.map(team => <button key={team} type="button" aria-pressed={team === value} title={teamName(team)} onClick={() => onChange(team)}>
      <TeamLogo team={team} size={26} /><span>{team}</span>
    </button>)}
  </div>;
}

function TeamSummary({ report, team, players, win, next }: { report: UsageReport; team: string; players: UsagePlayer[]; win: Win; next: Next }) {
  const rz = report.redZoneTeams.find(row => row.team === team);
  const nextGame = next.get(normalizeTeam(team));
  const lead = (key: keyof UsageWindow) => [...players].sort((a, b) => ((b[win][key] as number) ?? 0) - ((a[win][key] as number) ?? 0))[0];
  const target = lead('targetShare');
  const carry = lead('carryShare');
  const redZone = lead('redZoneShare');
  return <div className="gl-card gl-usage-team">
    <div className="gl-usage-team-name"><TeamLogo team={team} size={56} /><div><h2>{teamName(team)}</h2><p>{rz ? `${rz.games} games played` : ''}{nextGame ? ` · Next: ${nextGame.home ? 'vs' : 'at'} ${teamName(normalizeTeam(nextGame.opponent))}, week ${nextGame.week}` : ''}</p></div></div>
    <dl className="gl-usage-kpis">
      <div><dt>Top target</dt><dd><b>{target?.name ?? '—'}</b><span>{pct(target?.[win].targetShare ?? null)} of targets</span></dd></div>
      <div><dt>Lead back</dt><dd><b>{carry?.name ?? '—'}</b><span>{pct(carry?.[win].carryShare ?? null)} of carries</span></dd></div>
      <div><dt>Red-zone focus</dt><dd><b>{redZone?.name ?? '—'}</b><span>{pct(redZone?.[win].redZoneShare ?? null)} of looks inside the 20</span></dd></div>
      <div><dt>Red-zone offense</dt><dd><b style={rankCellStyle(rz?.tdRateRank)} className="gl-kpi-rank">{pct(rz?.tdRate ?? null)}</b><span>TD rate · {fixed(rz?.tripsPerGame ?? null)} trips per game</span></dd></div>
    </dl>
  </div>;
}

function PassCatchers({ rows, win, report, next }: { rows: UsagePlayer[]; win: Win; report: UsageReport; next: Next }) {
  return <div className="gl-card gl-table-wrap">
    <table className="gl-table gl-usage-table">
      <caption className="gl-table-caption">Pass catchers <small>sorted by share of team targets</small></caption>
      <thead><tr>
        <th scope="col">Player</th><th scope="col">Games</th><th scope="col">Targets / g</th><th scope="col">Target share</th>
        <th scope="col">Air yards share</th><th scope="col">Rec yds / g</th><th scope="col">Red-zone looks / g</th>
        <th scope="col">TDs</th><th scope="col">PPR / g</th><th scope="col">Weekly share</th><th scope="col">Next matchup</th>
      </tr></thead>
      <tbody>{rows.map(p => { const w = p[win]; return <tr key={p.playerId}>
        <td><PlayerCell name={p.name} position={p.position} team={p.team} headshot={p.headshot} showTeam={false} /></td>
        <td>{w.games}</td><td>{fixed(w.targetsPerGame)}</td><td><ShareBar value={w.targetShare} max={0.4} /></td>
        <td>{pct(w.airYardsShare)}</td><td>{fixed(w.receivingYardsPerGame)}</td><td>{fixed(w.redZoneOppsPerGame)}</td>
        <td>{w.touchdowns}</td><td>{fixed(w.pprPerGame)}</td>
        <td className="gl-spark-cell"><Sparkline values={p.weekly.map(week => week.targetShare)} label={`${p.name} weekly target share`} /></td>
        <MatchupCell report={report} next={next} player={p} />
      </tr>; })}</tbody>
    </table>
  </div>;
}

function Backfield({ rows, win, report, next }: { rows: UsagePlayer[]; win: Win; report: UsageReport; next: Next }) {
  return <div className="gl-card gl-table-wrap">
    <table className="gl-table gl-usage-table">
      <caption className="gl-table-caption">Backfield <small>sorted by share of team carries</small></caption>
      <thead><tr>
        <th scope="col">Player</th><th scope="col">Games</th><th scope="col">Carries / g</th><th scope="col">Carry share</th>
        <th scope="col">Rush yds / g</th><th scope="col">Targets / g</th><th scope="col">Red-zone looks / g</th>
        <th scope="col">Inside the 10 / g</th><th scope="col">TDs</th><th scope="col">PPR / g</th><th scope="col">Weekly share</th><th scope="col">Next matchup</th>
      </tr></thead>
      <tbody>{rows.map(p => { const w = p[win]; return <tr key={p.playerId}>
        <td><PlayerCell name={p.name} position={p.position} team={p.team} headshot={p.headshot} showTeam={false} /></td>
        <td>{w.games}</td><td>{fixed(w.carriesPerGame)}</td><td><ShareBar value={w.carryShare} max={0.8} /></td>
        <td>{fixed(w.rushingYardsPerGame)}</td><td>{fixed(w.targetsPerGame)}</td><td>{fixed(w.redZoneOppsPerGame)}</td>
        <td>{fixed(w.inside10OppsPerGame)}</td><td>{w.touchdowns}</td><td>{fixed(w.pprPerGame)}</td>
        <td className="gl-spark-cell"><Sparkline values={p.weekly.map(week => week.carryShare)} label={`${p.name} weekly carry share`} /></td>
        <MatchupCell report={report} next={next} player={p} />
      </tr>; })}</tbody>
    </table>
  </div>;
}

function Quarterbacks({ rows, win, report, next }: { rows: UsagePlayer[]; win: Win; report: UsageReport; next: Next }) {
  return <div className="gl-card gl-table-wrap">
    <table className="gl-table gl-usage-table">
      <caption className="gl-table-caption">Quarterbacks</caption>
      <thead><tr>
        <th scope="col">Player</th><th scope="col">Games</th><th scope="col">Pass yds / g</th><th scope="col">Carries / g</th>
        <th scope="col">Rush yds / g</th><th scope="col">Red-zone carries / g</th><th scope="col">TDs</th><th scope="col">PPR / g</th><th scope="col">Next matchup</th>
      </tr></thead>
      <tbody>{rows.map(p => { const w = p[win]; return <tr key={p.playerId}>
        <td><PlayerCell name={p.name} position={p.position} team={p.team} headshot={p.headshot} showTeam={false} /></td>
        <td>{w.games}</td><td>{fixed(w.passingYardsPerGame)}</td><td>{fixed(w.carriesPerGame)}</td>
        <td>{fixed(w.rushingYardsPerGame)}</td><td>{fixed(w.redZoneOppsPerGame)}</td><td>{w.touchdowns}</td><td>{fixed(w.pprPerGame)}</td>
        <MatchupCell report={report} next={next} player={p} />
      </tr>; })}</tbody>
    </table>
  </div>;
}

function Leaders({ report, win, metric, position, next }: { report: UsageReport; win: Win; metric: Leader; position: PosFilter; next: Next }) {
  const minGames = win === 'season' ? Math.min(2, report.throughWeek) : 1;
  const rows = report.players
    .filter(p => position === 'ALL' || p.position === position)
    .filter(p => p[win].games >= minGames && (metric !== 'carryShare' || p.position !== 'QB'))
    .filter(p => p[win][metric] !== null)
    .sort((a, b) => (b[win][metric] ?? 0) - (a[win][metric] ?? 0))
    .slice(0, 30);
  const max = rows[0]?.[win][metric] ?? 1;
  const isShare = metric !== 'pprPerGame';
  return <div className="gl-card gl-table-wrap">
    <table className="gl-table gl-usage-table gl-leaders">
      <thead><tr>
        <th scope="col">#</th><th scope="col">Player</th><th scope="col">{LEADERS.find(([key]) => key === metric)?.[1]}</th>
        <th scope="col">Targets / g</th><th scope="col">Carries / g</th><th scope="col">Red-zone looks / g</th><th scope="col">TDs</th><th scope="col">PPR / g</th><th scope="col">Next matchup</th>
      </tr></thead>
      <tbody>{rows.map((p, index) => { const w = p[win]; return <tr key={`${p.playerId}-${p.team}`}>
        <td className="gl-rank-num"><b>{index + 1}</b></td>
        <td><PlayerCell name={p.name} position={p.position} team={p.team} headshot={p.headshot} /></td>
        <td>{isShare ? <ShareBar value={w[metric]} max={max} /> : <span className="gl-share"><b>{fixed(w[metric])}</b><i aria-hidden="true"><em style={{ width: `${((w[metric] ?? 0) / max) * 100}%` }} /></i></span>}</td>
        <td>{fixed(w.targetsPerGame)}</td><td>{fixed(w.carriesPerGame)}</td><td>{fixed(w.redZoneOppsPerGame)}</td>
        <td>{w.touchdowns}</td><td>{fixed(w.pprPerGame)}</td>
        <MatchupCell report={report} next={next} player={p} />
      </tr>; })}</tbody>
    </table>
  </div>;
}

export default function PlayerUsage() {
  const { query, report } = useUsageReport();
  const dashboard = useGetConsumerDashboard({ query: { queryKey: getGetConsumerDashboardQueryKey(), staleTime: 60_000 } });
  const now = useConsumerNow();
  const next = useMemo(() => nextGames(dashboard.data?.games ?? [], now), [dashboard.data, now]);
  const initial = useMemo(readParams, []);
  const [view, setView] = useState<View>(initial.view);
  const [win, setWin] = useState<Win>(initial.window);
  const [team, setTeam] = useState<string | null>(initial.team);
  const [metric, setMetric] = useState<Leader>('targetShare');
  const [position, setPosition] = useState<PosFilter>('ALL');
  const teams = useMemo(() => report ? report.redZoneTeams.map(row => row.team).sort() : [], [report]);
  const activeTeam = team && teams.includes(team) ? team : teams[0] ?? null;

  useEffect(() => {
    const params = new URLSearchParams();
    if (view === 'leaders') params.set('view', 'leaders');
    else if (activeTeam) params.set('team', activeTeam);
    if (win === 'last3') params.set('window', 'last3');
    const search = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
  }, [view, win, activeTeam]);

  const teamPlayers = useMemo(() => report && activeTeam ? report.players.filter(p => p.team === activeTeam && p[win].games > 0) : [], [report, activeTeam, win]);
  const catchers = teamPlayers.filter(p => p.position !== 'QB' && ((p[win].targetShare ?? 0) >= 0.03 || (p[win].targetsPerGame ?? 0) >= 1))
    .sort((a, b) => (b[win].targetShare ?? 0) - (a[win].targetShare ?? 0));
  const backs = teamPlayers.filter(p => p.position === 'RB' && ((p[win].carryShare ?? 0) >= 0.03 || (p[win].carriesPerGame ?? 0) >= 1))
    .sort((a, b) => (b[win].carryShare ?? 0) - (a[win].carryShare ?? 0));
  const qbs = teamPlayers.filter(p => p.position === 'QB' && (p[win].passingYardsPerGame ?? 0) > 20)
    .sort((a, b) => (b[win].passingYardsPerGame ?? 0) - (a[win].passingYardsPerGame ?? 0));

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        {report ? <ReportMeta season={report.season} throughWeek={report.throughWeek} generatedAt={report.generatedAt} /> : <p className="gl-label">Player usage</p>}
        <h1 className="gl-title">Player <span>Usage</span></h1>
        <p className="gl-lede">Who gets the ball. Each team&apos;s targets, carries and red-zone looks, and how those shares are trending week to week.</p>
      </div>
    </header>

    {query.isLoading && <ConsumerLoading label="Loading player usage…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load player usage.</strong>Refresh the page in a minute.</div>}
    {query.data?.status === 'unavailable' && <div className="gl-empty"><strong>Usage isn&apos;t posted yet.</strong>It updates Tuesday morning after each week&apos;s games.</div>}

    {report && <>
      <div className="gl-controls">
        <Seg label="View" value={view} onChange={setView} options={[['team', 'By team'], ['leaders', 'League leaders']]} />
        <Seg label="Games" value={win} onChange={setWin} options={[['season', 'Season'], ['last3', 'Last 3 games']]} />
        {view === 'leaders' && <Seg label="Position" value={position} onChange={setPosition} options={[['ALL', 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']]} />}
      </div>

      {view === 'team' && activeTeam && <>
        <TeamPicker teams={teams} value={activeTeam} onChange={setTeam} />
        <TeamSummary report={report} team={activeTeam} players={teamPlayers} win={win} next={next} />
        {qbs.length > 0 && <Quarterbacks rows={qbs} win={win} report={report} next={next} />}
        {backs.length > 0 && <Backfield rows={backs} win={win} report={report} next={next} />}
        {catchers.length > 0 && <PassCatchers rows={catchers} win={win} report={report} next={next} />}
      </>}

      {view === 'leaders' && <>
        <Seg label="Rank by" value={metric} onChange={setMetric} options={LEADERS} />
        <Leaders report={report} win={win} metric={metric} position={position} next={next} />
      </>}

      <p className="gl-note">Shares are the player&apos;s portion of their team&apos;s targets, carries or plays inside the opponent&apos;s 20 in the games they played. Red-zone looks are targets plus carries inside the 20. Next matchup is favorable when the opponent ranks in the top 8 for PPR points allowed to the player&apos;s position this season, and tough in the bottom 8. Built from nflverse play-by-play; see <Link href="/red-zone" className="gl-link">Red Zone</Link> and <Link href="/defense-vs-position" className="gl-link">Defense vs Position</Link>.</p>
    </>}
  </div>;
}
