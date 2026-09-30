import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { TeamLogo } from '@/components/TeamLogo';
import { PlayerCell, ReportMeta, Seg, ShareBar } from '@/components/UsageBits';
import { rankCellStyle, teamName } from '@/lib/team-colors';
import { fixed, pct, useUsageReport, type RedZoneTeam } from '@/lib/usage-report';
import { ConsumerLoading } from './consumer-ui';

type TeamSort = 'tdRateRank' | 'tripsPerGameRank' | 'allowedTdRateRank' | 'allowedTripsPerGameRank';
type Win = 'season' | 'last3';
type PosFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE';

function RankCell({ rank, value }: { rank: number | null; value: string }) {
  return <td className="gl-rank-cell"><span style={rankCellStyle(rank)}><b>{value}</b>{rank !== null && <small>#{rank}</small>}</span></td>;
}

export default function RedZone() {
  const { query, report } = useUsageReport();
  const [sort, setSort] = useState<TeamSort>('tdRateRank');
  const [win, setWin] = useState<Win>('season');
  const [position, setPosition] = useState<PosFilter>('ALL');
  const teams = useMemo(() => [...(report?.redZoneTeams ?? [])]
    .sort((a, b) => (a[sort] ?? 99) - (b[sort] ?? 99)), [report, sort]);
  const players = useMemo(() => (report?.players ?? [])
    .filter(p => (position === 'ALL' || p.position === position) && p[win].games > 0 && (p[win].redZoneOppsPerGame ?? 0) > 0)
    .sort((a, b) => (b[win].redZoneOppsPerGame ?? 0) - (a[win].redZoneOppsPerGame ?? 0)
      || (b[win].inside10OppsPerGame ?? 0) - (a[win].inside10OppsPerGame ?? 0))
    .slice(0, 30), [report, win, position]);
  const header = (key: TeamSort, label: string) => <th scope="col" aria-sort={sort === key ? 'ascending' : 'none'}>
    <button type="button" onClick={() => setSort(key)}>{label}{sort === key ? ' ↓' : ''}</button>
  </th>;
  const rankOf = (team: RedZoneTeam) => team[sort];

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        {report ? <ReportMeta season={report.season} throughWeek={report.throughWeek} generatedAt={report.generatedAt} /> : <p className="gl-label">Red zone</p>}
        <h1 className="gl-title">Red <span>Zone</span></h1>
        <p className="gl-lede">Which offenses get inside the 20 and finish with touchdowns, which defenses hold, and the players who get the ball when it matters most.</p>
      </div>
    </header>

    {query.isLoading && <ConsumerLoading label="Loading red zone…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load the red zone numbers.</strong>Refresh the page in a minute.</div>}
    {query.data?.status === 'unavailable' && <div className="gl-empty"><strong>Red zone numbers aren&apos;t posted yet.</strong>They update Tuesday morning after each week&apos;s games.</div>}

    {report && <>
      <section className="gl-section" aria-labelledby="rz-teams">
        <div className="gl-section-head"><h2 id="rz-teams">Teams</h2><p>A trip is a drive that reached the opponent&apos;s 20. Green is good for that team.</p></div>
        <div className="gl-card gl-table-wrap">
          <table className="gl-table gl-ratings">
            <thead><tr>
              <th scope="col">Rank</th><th scope="col">Team</th>
              {header('tdRateRank', 'TD rate')}{header('tripsPerGameRank', 'Trips / g')}
              <th scope="col">TDs / trips</th><th scope="col">Pass rate</th>
              {header('allowedTdRateRank', 'TD rate allowed')}{header('allowedTripsPerGameRank', 'Trips allowed / g')}
            </tr></thead>
            <tbody>{teams.map(team => <tr key={team.team}>
              <td className="gl-rank-num"><b>{rankOf(team) ?? '—'}</b></td>
              <td className="gl-team-cell"><TeamLogo team={team.team} /><span><b>{teamName(team.team)}</b><small>{team.games} games</small></span></td>
              <RankCell rank={team.tdRateRank} value={pct(team.tdRate)} />
              <RankCell rank={team.tripsPerGameRank} value={fixed(team.tripsPerGame)} />
              <td>{team.touchdowns} / {team.trips}</td>
              <td>{pct(team.passRate)}</td>
              <RankCell rank={team.allowedTdRateRank} value={pct(team.allowedTdRate)} />
              <RankCell rank={team.allowedTripsPerGameRank} value={fixed(team.allowedTripsPerGame)} />
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="gl-section" aria-labelledby="rz-players">
        <div className="gl-section-head"><h2 id="rz-players">Players</h2><p>Targets plus carries inside the 20, per game</p></div>
        <div className="gl-controls">
          <Seg label="Games" value={win} onChange={setWin} options={[['season', 'Season'], ['last3', 'Last 3 games']]} />
          <Seg label="Position" value={position} onChange={setPosition} options={[['ALL', 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']]} />
        </div>
        <div className="gl-card gl-table-wrap">
          <table className="gl-table gl-usage-table gl-leaders">
            <thead><tr>
              <th scope="col">#</th><th scope="col">Player</th><th scope="col">Red-zone looks / g</th><th scope="col">Share of team</th>
              <th scope="col">Inside the 10 / g</th><th scope="col">Games</th><th scope="col">TDs</th>
            </tr></thead>
            <tbody>{players.map((p, index) => { const w = p[win]; return <tr key={`${p.playerId}-${p.team}`}>
              <td className="gl-rank-num"><b>{index + 1}</b></td>
              <td><PlayerCell name={p.name} position={p.position} team={p.team} headshot={p.headshot} /></td>
              <td><b className="gl-big-num">{fixed(w.redZoneOppsPerGame)}</b></td>
              <td><ShareBar value={w.redZoneShare} max={0.5} /></td>
              <td>{fixed(w.inside10OppsPerGame)}</td><td>{w.games}</td><td>{w.touchdowns}</td>
            </tr>; })}</tbody>
          </table>
        </div>
      </section>

      <p className="gl-note">Built from nflverse play-by-play for completed regular-season games. Kneel-downs, spikes and two-point tries are left out. These feed the <Link href="/touchdowns" className="gl-link">TD Picks</Link> model.</p>
    </>}
  </div>;
}
