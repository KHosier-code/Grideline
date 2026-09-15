import { getGetConsumerTrendsQueryKey, useGetConsumerTrends } from '@workspace/api-client-react';
import { ConsumerLoading, ConsumerMessage, metric, recordRows } from './consumer-ui';

function TrendSection({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return <section className="consumer-trend-section"><h2>{title}</h2>{rows.length ? <div className="consumer-trend-list">{rows.map((row, index) => <article key={`${String(row.group)}-${index}`}><strong>{String(row.group ?? 'Other')}</strong><span>{String(row.predictions ?? 0)} graded</span><dl><div><dt>Winner accuracy</dt><dd>{metric(row.moneylineAccuracy, true)}</dd></div><div><dt>Margin error</dt><dd>{metric(row.spreadMae)}</dd></div><div><dt>Total error</dt><dd>{metric(row.totalsMae)}</dd></div><div><dt>Average CLV</dt><dd>{metric(row.avgClv)}</dd></div></dl></article>)}</div> : <p className="consumer-note">No verified trend data is available for this segment.</p>}</section>;
}

export default function ConsumerTrends() {
  const query = useGetConsumerTrends({ query: { queryKey: getGetConsumerTrendsQueryKey(), staleTime: 60_000 } });
  if (query.isLoading) return <ConsumerLoading label="Loading verified trends…" />;
  if (query.isError || !query.data) return <ConsumerMessage error title="Trends are temporarily unavailable" detail="Verified trend data could not be loaded right now." />;
  const data = query.data;
  return <div className="consumer-page"><header className="consumer-page-header"><div><p className="consumer-eyebrow">Model behavior</p><h1>Trends</h1><p>See how prediction accuracy, projection error, and closing-line value vary across graded samples.</p></div></header>{data.status === 'unavailable' ? <ConsumerMessage title="Trends are not measured yet" detail="Trend views require persisted, graded official predictions." /> : <><TrendSection title="By week" rows={recordRows(data.byWeek)} /><TrendSection title="By confidence" rows={recordRows(data.byConfidence)} /><TrendSection title="By projected edge" rows={recordRows(data.byEdge)} /></>}<p className="consumer-note">{data.note}</p></div>;
}