import { useMemo } from 'react';
import { Link } from 'wouter';
import { ConsumerLoading } from '@/pages/consumer/consumer-ui';
import { seasonLabel } from '@/lib/cbb';
import { useCbb } from '@/lib/cbb-data';
import { RecordPanel } from './CbbGames';
import './cbb.css';

/** The college spread record. Kept apart from the NFL record on purpose. */
export default function CbbRecord() {
  const { query, report, record } = useCbb();
  const teams = useMemo(() => new Map((report?.teams ?? []).map(team => [team.id, team])), [report]);
  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{report ? `College basketball · ${seasonLabel(report.season)}` : 'College basketball'}</p>
        <h1 className="gl-title">College <span>Record</span></h1>
        <p className="gl-lede">Every college spread pick, saved the first time it appears before tip-off and graded at the line shown then. NFL picks are graded separately on the <Link href="/performance" className="gl-link">NFL record</Link>.</p>
      </div>
    </header>
    {query.isLoading && <ConsumerLoading label="Loading the record…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load the record.</strong>Refresh the page in a minute.</div>}
    {query.data?.status === 'unavailable' && <div className="gl-empty"><strong>No college picks yet.</strong>The record starts with the first graded pick.</div>}
    {record && <RecordPanel record={record} teams={teams} />}
  </div>;
}
