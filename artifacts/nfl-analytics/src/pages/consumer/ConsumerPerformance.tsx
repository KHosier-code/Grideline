import { getGetConsumerPerformanceQueryKey, useGetConsumerPerformance } from '@workspace/api-client-react';
import { ConsumerLoading, ConsumerMessage, metric } from './consumer-ui';

const familyLabels: Record<string, string> = { moneyline: 'Winner accuracy', spread: 'Projection margin', totals: 'Projected total' };

export default function ConsumerPerformance() {
  const query = useGetConsumerPerformance({ query: { queryKey: getGetConsumerPerformanceQueryKey(), staleTime: 60_000 } });
  if (query.isLoading) return <ConsumerLoading label="Loading verified performance…" />;
  if (query.isError || !query.data) return <ConsumerMessage error title="Performance is temporarily unavailable" detail="Verified results could not be loaded right now." />;
  const data = query.data;
  const families = Object.entries(data.byFamily as Record<string, Record<string, unknown>>);
  return <div className="consumer-page"><header className="consumer-page-header"><div><p className="consumer-eyebrow">Verified results</p><h1>Performance</h1><p>Accuracy and error measures from persisted, graded official predictions. These are model-quality measures, not claims of profitability.</p></div></header>
    <div className="consumer-summary-grid"><span><small>Official predictions</small>{data.officialPredictions}</span><span><small>Graded predictions</small>{data.gradedPredictions}</span><span><small>Coverage</small>{data.status === 'available' ? 'Measured' : 'Not yet measured'}</span></div>
    {data.status === 'unavailable' || !families.length ? <ConsumerMessage title="Not enough graded predictions yet" detail="Performance measures will appear after official predictions have legitimate final results." /> : <div className="consumer-performance-grid">{families.map(([name, values]) => <article key={name}><p className="consumer-eyebrow">{familyLabels[name] ?? name}</p><h2>{name === 'moneyline' ? metric(values.accuracy, true) : metric(values.mae)}</h2><p>{name === 'moneyline' ? 'Winner accuracy' : 'Mean absolute projection error'}</p><dl><div><dt>Predictions</dt><dd>{typeof values.predictions === 'number' ? values.predictions : 'Unavailable'}</dd></div>{name === 'moneyline' ? <div><dt>Brier score</dt><dd>{metric(values.brier)}</dd></div> : <><div><dt>RMSE</dt><dd>{metric(values.rmse)}</dd></div><div><dt>Average CLV</dt><dd>{metric(values.avgClv)}</dd></div></>}</dl></article>)}</div>}
    <p className="consumer-note">{data.note}</p>
  </div>;
}