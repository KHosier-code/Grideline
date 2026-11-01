import { useMemo } from 'react';
import { Link } from 'wouter';
import { ConsumerLoading } from '@/pages/consumer/consumer-ui';
import { formatRecord, formatSpread, seasonLabel, winRate, type CbbGradedPick, type CbbRecord as Record, type CbbTeam } from '@/lib/cbb';
import { useCbb } from '@/lib/cbb-data';
import './cbb.css';

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** College basketball's own record. It never mixes with the NFL record (/performance). */
function RecordPanel({ record, teams }: { record: Record; teams: Map<string, CbbTeam> }) {
  const graded = record.wins + record.losses + record.pushes;
  const rate = winRate(record);
  const name = (id: string) => teams.get(id)?.short ?? 'Unknown';
  const row = (pick: CbbGradedPick) => {
    const picked = pick.side === 'home' ? pick.home : pick.away;
    return <tr key={pick.id}>
      <td>{new Date(pick.tip).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}</td>
      <td><b>{name(picked)} {formatSpread(pick.line)}</b><small> vs {name(pick.side === 'home' ? pick.away : pick.home)}</small></td>
      <td>{pick.edge.toFixed(1)}</td>
      <td>{pick.awayPoints !== null ? `${name(pick.away)} ${pick.awayPoints}, ${name(pick.home)} ${pick.homePoints}` : '—'}</td>
      <td><span className={`gl-pill ${pick.outcome === 'win' ? 'win' : pick.outcome === 'loss' ? 'loss' : 'small'}`}>{pick.outcome}</span></td>
    </tr>;
  };
  return <section className="gl-card cbb-record" aria-labelledby="cbb-record-title">
    <h2 id="cbb-record-title">Against the spread <small>tracking</small></h2>
    {graded === 0
      ? <p className="cbb-muted">No picks graded yet. Every pick is saved the first time it appears on <Link href="/cbb" className="gl-link">today&apos;s games</Link>, before tip-off, at the line shown then.{record.pending ? ` ${record.pending} waiting on results.` : ''}</p>
      : <>
        <div className="gl-stats">
          <div className="gl-stat"><b>{formatRecord(record)}</b><small>against the spread</small></div>
          <div className="gl-stat"><b>{rate === null ? '—' : pct(rate)}</b><small>wins (52.4% breaks even)</small></div>
          <div className="gl-stat"><b className={record.units >= 0 ? 'gl-good' : 'gl-bad'}>{record.units >= 0 ? '+' : ''}{record.units.toFixed(1)}u</b><small>at −110</small></div>
        </div>
        <table className="gl-table cbb-edge-table">
          <thead><tr><th scope="col">We disagreed by</th><th scope="col">Record</th><th scope="col">Win %</th></tr></thead>
          <tbody>{record.byEdge.map(bucket => <tr key={bucket.min}>
            <th scope="row">{bucket.max === null ? `${bucket.min}+ points` : `${bucket.min}–${bucket.max} points`}</th>
            <td>{formatRecord(bucket)}</td>
            <td>{winRate(bucket) === null ? '—' : pct(winRate(bucket)!)}</td>
          </tr>)}</tbody>
        </table>
        {record.recent.length > 0 && <div className="gl-table-wrap"><table className="gl-table cbb-recent">
          <caption className="gl-table-caption">Latest graded picks</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Pick</th><th scope="col">Edge</th><th scope="col">Final</th><th scope="col">Result</th></tr></thead>
          <tbody>{record.recent.slice(0, 25).map(row)}</tbody>
        </table></div>}
      </>}
  </section>;
}

export default function CbbRecord() {
  const { query, report, record } = useCbb();
  const teams = useMemo(() => new Map((report?.teams ?? []).map(team => [team.id, team])), [report]);
  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{report ? `College basketball · ${seasonLabel(report.season)}` : 'College basketball'}</p>
        <h1 className="gl-title">College <span>record</span></h1>
        <p className="gl-lede">Every college spread pick we&apos;ve made this season, graded at the line we posted before tip-off. This record covers college basketball only; the NFL has <Link href="/performance" className="gl-link">its own</Link>.</p>
      </div>
    </header>
    {query.isLoading && <ConsumerLoading label="Loading the record…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load the record.</strong>Refresh the page in a minute.</div>}
    {query.data?.status === 'unavailable' && <div className="gl-empty"><strong>No college picks yet.</strong>The record starts with the first game of the season.</div>}
    {record && <RecordPanel record={record} teams={teams} />}
  </div>;
}
