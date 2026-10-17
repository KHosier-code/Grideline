import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { TeamLogo } from '@/components/TeamLogo';
import { ReportMeta, Seg } from '@/components/UsageBits';
import { rankCellStyle, teamName } from '@/lib/team-colors';
import { cell, formatMetric, ordinal, type MatchupMetric, type MatchupWindow } from '@/lib/matchup-edges';
import { useMatchupReport } from '@/lib/matchup-report';
import { ConsumerLoading } from './consumer-ui';

type Unit = 'defense' | 'offense';

function MetricCellView({ metric, unit, value, rank }: { metric: MatchupMetric; unit: Unit; value: number | null; rank: number | null }) {
  // Style metrics (blitz rate, play action...) are not good or bad, so they get no color.
  const style = metric[unit] ? rankCellStyle(rank) : undefined;
  return <td className="gl-rank-cell"><span style={style} title={metric.help}>
    <b>{formatMetric(value, metric.format)}</b>{rank !== null && <small>#{rank}</small>}
  </span></td>;
}

function rankNote(metric: MatchupMetric, unit: Unit) {
  const direction = metric[unit];
  if (!direction) return '#1 = does it most';
  return '#1 = best';
}

export default function Matchups() {
  const { query, report } = useMatchupReport();
  const [unit, setUnit] = useState<Unit>('defense');
  const [win, setWin] = useState<MatchupWindow>('season');
  const [group, setGroup] = useState('Efficiency');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [focus, setFocus] = useState<string>('');

  const groups = useMemo(() => [...new Set((report?.metrics ?? []).map(metric => metric.group))], [report]);
  // Offense has no missed-tackle numbers, so only show metrics with data for this unit.
  const columns = useMemo(() => (report?.metrics ?? []).filter(metric => metric.group === group
    && report?.league[win][unit][metric.key] !== undefined), [report, group, win, unit]);
  const sortBy = columns.find(metric => metric.key === sortKey) ?? columns[0];
  const rows = useMemo(() => [...(report?.teams ?? [])].sort((a, b) =>
    (cell(a[win][unit], sortBy?.key ?? '')?.rank ?? 99) - (cell(b[win][unit], sortBy?.key ?? '')?.rank ?? 99)), [report, win, unit, sortBy]);
  const focusTeam = report?.teams.find(team => team.team === focus) ?? rows[0];

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        {report ? <ReportMeta season={report.season} throughWeek={report.throughWeek} generatedAt={report.generatedAt} /> : <p className="gl-label">Matchups</p>}
        <h1 className="gl-title">Match<span>ups</span></h1>
        <p className="gl-lede">How every offense and defense actually plays: who brings pressure, who blitzes, who gives up big plays, who misses tackles, and which defenses teams avoid running or throwing on.</p>
      </div>
    </header>

    {query.isLoading && <ConsumerLoading label="Loading matchups…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load the matchup numbers.</strong>Refresh the page in a minute.</div>}
    {query.data?.status === 'unavailable' && <div className="gl-empty"><strong>Matchup numbers aren&apos;t posted yet.</strong>They update Tuesday morning after each week&apos;s games.</div>}

    {report && <>
      <section className="gl-section" aria-labelledby="mu-league">
        <div className="gl-section-head"><h2 id="mu-league">All 32 teams</h2><p>Green is good for that {unit}. Grey columns are style, not quality.</p></div>
        <div className="gl-controls">
          <Seg label="Unit" value={unit} onChange={setUnit} options={[['defense', 'Defense'], ['offense', 'Offense']]} />
          <Seg label="Games" value={win} onChange={setWin} options={[['season', 'Season'], ['last4', 'Last 4 games']]} />
          <Seg label="Show" value={group} onChange={setGroup} options={groups.map(name => [name, name] as [string, string])} />
        </div>
        <div className="gl-card gl-table-wrap">
          <table className="gl-table gl-ratings">
            <thead><tr>
              <th scope="col">Team</th>
              {columns.map(metric => <th scope="col" key={metric.key} aria-sort={sortBy?.key === metric.key ? 'ascending' : 'none'}>
                <button type="button" onClick={() => setSortKey(metric.key)} title={metric.help}>
                  {metric.label}{sortBy?.key === metric.key ? ' ↓' : ''}<small className="gl-th-note">{rankNote(metric, unit)}</small>
                </button>
              </th>)}
            </tr></thead>
            <tbody>
              <tr className="gl-league-row"><td><b>League average</b></td>
                {columns.map(metric => <td key={metric.key}>{formatMetric(report.league[win][unit][metric.key], metric.format)}</td>)}
              </tr>
              {rows.map(team => <tr key={team.team}>
                <td className="gl-team-cell"><button type="button" className="gl-team-button" onClick={() => setFocus(team.team)}>
                  <TeamLogo team={team.team} /><span><b>{teamName(team.team)}</b><small>{team[win][unit].games ?? 0} games</small></span>
                </button></td>
                {columns.map(metric => { const c = cell(team[win][unit], metric.key);
                  return <MetricCellView key={metric.key} metric={metric} unit={unit} value={c?.value ?? null} rank={c?.rank ?? null} />; })}
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      {focusTeam && <section className="gl-section" aria-labelledby="mu-team">
        <div className="gl-section-head">
          <h2 id="mu-team">Team profile</h2>
          <label className="gl-select-label">Team{' '}
            <select value={focusTeam.team} onChange={event => setFocus(event.target.value)}>
              {[...report.teams].sort((a, b) => teamName(a.team).localeCompare(teamName(b.team)))
                .map(team => <option key={team.team} value={team.team}>{teamName(team.team)}</option>)}
            </select>
          </label>
        </div>
        <div className="gl-profile-grid">
          {(['offense', 'defense'] as const).map(side => <div className="gl-card gl-table-wrap" key={side}>
            <table className="gl-table gl-matchup-ranks">
              <caption className="sr-only">{teamName(focusTeam.team)} {side}, {win === 'season' ? 'season' : 'last 4 games'}</caption>
              <thead><tr><th scope="col"><TeamLogo team={focusTeam.team} size={22} /> {teamName(focusTeam.team)} {side}</th><th scope="col">Value</th><th scope="col">Rank</th><th scope="col">League</th></tr></thead>
              {groups.map(name => {
                const metrics = report.metrics.filter(metric => metric.group === name && cell(focusTeam[win][side], metric.key));
                if (!metrics.length) return null;
                return <tbody key={name}>
                  <tr className="gl-group-row"><th scope="rowgroup" colSpan={4}>{name}</th></tr>
                  {metrics.map(metric => { const c = cell(focusTeam[win][side], metric.key)!;
                    return <tr key={metric.key}>
                      <th scope="row" title={metric.help}>{metric.label}</th>
                      <td>{formatMetric(c.value, metric.format)}</td>
                      <td className="gl-rank-cell"><span style={metric[side] ? rankCellStyle(c.rank) : undefined}>
                        <b>{c.rank ? ordinal(c.rank) : '—'}</b><small>{metric[side] ? '' : 'most'}</small>
                      </span></td>
                      <td>{formatMetric(report.league[win][side][metric.key], metric.format)}</td>
                    </tr>; })}
                </tbody>;
              })}
            </table>
          </div>)}
        </div>
      </section>}

      <details className="gl-card gl-glossary">
        <summary>What these numbers mean</summary>
        <dl>{report.metrics.map(metric => <div key={metric.key}><dt>{metric.label}</dt><dd>{metric.help}</dd></div>)}</dl>
      </details>

      <p className="gl-note">
        Play-by-play through week {report.sources.playByPlay}
        {report.sources.ftnCharting !== null && <>; FTN charting through week {report.sources.ftnCharting}</>}
        {report.sources.pfrAdvanced !== null && <>; Pro Football Reference pressures and tackles through week {report.sources.pfrAdvanced}</>}
        {report.sources.nextGenStats !== null && <>; Next Gen Stats through week {report.sources.nextGenStats}</>}.
        All free public data from nflverse, regular season only. Each game page shows where these matchups line up, under <Link href="/games" className="gl-link">Game lines</Link>.
      </p>
    </>}
  </div>;
}
