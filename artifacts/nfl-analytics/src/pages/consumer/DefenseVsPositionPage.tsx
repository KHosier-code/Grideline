import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { TeamLogo } from '@/components/TeamLogo';
import { ReportMeta, Seg } from '@/components/UsageBits';
import { rankCellStyle, teamName } from '@/lib/team-colors';
import { fixed, useUsageReport, type DefenseLine } from '@/lib/usage-report';
import { ConsumerLoading } from './consumer-ui';

type Position = 'QB' | 'RB' | 'WR' | 'TE';
type Win = 'season' | 'last4';
type SortKey = 'pprRank' | 'yardsRank' | 'tdsRank' | 'receptionsRank' | 'targetsRank' | 'redZoneOppsRank';

const COLUMNS: Array<{ key: SortKey; label: string; value: (line: DefenseLine) => string; hideFor?: Position[] }> = [
  { key: 'pprRank', label: 'PPR points / g', value: line => fixed(line.pprPerGame) },
  { key: 'yardsRank', label: 'Yards / g', value: line => fixed(line.yardsPerGame) },
  { key: 'tdsRank', label: 'TDs / g', value: line => fixed(line.tdsPerGame, 2) },
  { key: 'receptionsRank', label: 'Catches / g', value: line => fixed(line.receptionsPerGame), hideFor: ['QB'] },
  { key: 'targetsRank', label: 'Targets / g', value: line => fixed(line.targetsPerGame), hideFor: ['QB'] },
  { key: 'redZoneOppsRank', label: 'Red-zone looks / g', value: line => fixed(line.redZoneOppsPerGame, 2) },
];

export default function DefenseVsPositionPage() {
  const { query, report } = useUsageReport();
  const [position, setPosition] = useState<Position>('WR');
  const [win, setWin] = useState<Win>('season');
  const [sort, setSort] = useState<SortKey>('pprRank');
  const columns = COLUMNS.filter(column => !column.hideFor?.includes(position));
  const rows = useMemo(() => (report?.defenses ?? [])
    .map(defense => ({ team: defense.team, line: defense[win][position] }))
    .filter((row): row is { team: string; line: DefenseLine } => Boolean(row.line))
    .sort((a, b) => a.line[sort] - b.line[sort] || a.line.pprRank - b.line.pprRank), [report, win, position, sort]);

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        {report ? <ReportMeta season={report.season} throughWeek={report.throughWeek} generatedAt={report.generatedAt} /> : <p className="gl-label">Defense vs position</p>}
        <h1 className="gl-title">Defense vs <span>Position</span></h1>
        <p className="gl-lede">What every defense gives up to quarterbacks, running backs, receivers and tight ends. Rank 1 allows the most, so green marks the matchups to target.</p>
      </div>
    </header>

    {query.isLoading && <ConsumerLoading label="Loading defenses…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load defense vs position.</strong>Refresh the page in a minute.</div>}
    {query.data?.status === 'unavailable' && <div className="gl-empty"><strong>Defense vs position isn&apos;t posted yet.</strong>It updates Tuesday morning after each week&apos;s games.</div>}

    {report && <>
      <div className="gl-controls">
        <Seg label="Position" value={position} onChange={value => { setPosition(value); if (value === 'QB' && (sort === 'receptionsRank' || sort === 'targetsRank')) setSort('pprRank'); }}
          options={[['QB', 'Quarterbacks'], ['RB', 'Running backs'], ['WR', 'Wide receivers'], ['TE', 'Tight ends']]} />
        <Seg label="Games" value={win} onChange={setWin} options={[['season', 'Season'], ['last4', 'Last 4 games']]} />
      </div>

      <div className="gl-card gl-table-wrap">
        <table className="gl-table gl-ratings gl-dvp">
          <caption className="sr-only">Points and production allowed to {position}s by each defense</caption>
          <thead><tr>
            <th scope="col">Rank</th>
            <th scope="col">Defense</th>
            {columns.map(column => <th key={column.key} scope="col" aria-sort={sort === column.key ? 'ascending' : 'none'}>
              <button type="button" onClick={() => setSort(column.key)}>{column.label}{sort === column.key ? ' ↓' : ''}</button>
            </th>)}
            <th scope="col">vs average</th>
          </tr></thead>
          <tbody>{rows.map(({ team, line }) => <tr key={team}>
            <td className="gl-rank-num"><b>{line[sort]}</b></td>
            <td className="gl-team-cell"><TeamLogo team={team} /><span><b>{teamName(team)}</b><small>{line.games} {line.games === 1 ? 'game' : 'games'}</small></span></td>
            {columns.map(column => <td key={column.key} className="gl-rank-cell">
              <span style={rankCellStyle(line[column.key])}><b>{column.value(line)}</b><small>#{line[column.key]}</small></span>
            </td>)}
            <td className={line.vsAverage === null ? '' : line.vsAverage > 0 ? 'gl-good' : 'gl-bad'}>
              {line.vsAverage === null ? '—' : `${line.vsAverage > 0 ? '+' : ''}${Math.round(line.vsAverage * 100)}%`}
            </td>
          </tr>)}</tbody>
        </table>
      </div>

      <p className="gl-note">Totals are everything the defense allowed to that position in a game, averaged per game. PPR points use standard full-point-per-catch scoring. &ldquo;vs average&rdquo; compares PPR points allowed with the league average for the position. Early in the season a single big game moves these numbers a lot. See who gets the ball on <Link href="/usage" className="gl-link">Player Usage</Link>.</p>
    </>}
  </div>;
}
