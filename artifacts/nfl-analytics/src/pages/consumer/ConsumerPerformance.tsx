import {
  getGetConsumerGradedChartsQueryKey,
  getGetConsumerPerformanceQueryKey,
  useGetConsumerGradedCharts,
  useGetConsumerPerformance,
} from '@workspace/api-client-react';
import type { ConsumerGradedAggregate, ConsumerGradedPoint } from '@workspace/api-client-react';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import { Link } from 'wouter';
import { ConsumerLoading, ConsumerMessage, metric } from './consumer-ui';
import './ConsumerPerformance.css';

const familyLabels: Record<string, string> = { moneyline: 'Winner accuracy', spread: 'Projection margin', totals: 'Projected total' };
const chartConfig = {
  measure: { label: 'Selected measure', color: 'hsl(var(--chart-1))' },
};

type MetricKey = 'winnerAccuracy' | 'marginMae' | 'totalMae';

const metricOptions: Array<{ key: MetricKey; label: string; unit: string; denominator: keyof ConsumerGradedAggregate }> = [
  { key: 'winnerAccuracy', label: 'Winner accuracy', unit: '%', denominator: 'winnerGraded' },
  { key: 'marginMae', label: 'Margin MAE', unit: 'points', denominator: 'marginGraded' },
  { key: 'totalMae', label: 'Total MAE', unit: 'points', denominator: 'totalGraded' },
];

function metricValue(value: number | null, key: MetricKey) {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  return key === 'winnerAccuracy' ? `${(value * 100).toFixed(1)}%` : `${value.toFixed(1)} points`;
}

function sampleLabel(row: ConsumerGradedPoint) {
  return `${row.season} week ${row.week}`;
}

function MeasureTooltip({ active, payload, metricKey }: {
  active?: boolean;
  payload?: Array<{ payload?: ConsumerGradedPoint | ConsumerGradedAggregate }>;
  metricKey: MetricKey;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const row = payload[0].payload;
  const option = metricOptions.find((item) => item.key === metricKey)!;
  const value = row[metricKey];
  const denominator = row[option.denominator];
  return (
    <div className="rounded-lg border border-border bg-background p-3 text-xs text-foreground shadow-lg">
      <strong className="block">{'week' in row ? sampleLabel(row) : `${row.season} season`}</strong>
      <span className="mt-1 block">{option.label}: {metricValue(value, metricKey)}</span>
      <span className="block">Metric denominator: {denominator} graded</span>
      <span className="block">Cumulative graded predictions: {row.graded}</span>
      {'week' in row && <span className="block text-muted-foreground">{row.gameId} · {new Date(row.kickoffTime).toLocaleDateString()}</span>}
    </div>
  );
}

function MetricTables({ cumulative, bySeason, metricKey }: {
  cumulative: ConsumerGradedPoint[];
  bySeason: ConsumerGradedAggregate[];
  metricKey: MetricKey;
}) {
  const option = metricOptions.find((item) => item.key === metricKey)!;
  return (
    <details className="consumer-chart-data">
      <summary>View chart data as tables</summary>
      <div className="consumer-chart-tables">
        <table>
          <caption>Cumulative graded performance by game</caption>
          <thead><tr><th scope="col">Season and week</th><th scope="col">{option.label}</th><th scope="col">Metric denominator</th><th scope="col">Cumulative graded predictions</th></tr></thead>
          <tbody>{cumulative.map((row) => <tr key={`${row.season}-${row.gameId}`}>
            <th scope="row">{sampleLabel(row)}</th>
            <td>{metricValue(row[metricKey], metricKey)}</td>
            <td>{row[option.denominator]}</td>
            <td>{row.graded}</td>
          </tr>)}</tbody>
        </table>
        <table>
          <caption>Season comparison</caption>
          <thead><tr><th scope="col">Season</th><th scope="col">{option.label}</th><th scope="col">Metric denominator</th><th scope="col">Total graded predictions</th></tr></thead>
          <tbody>{bySeason.map((row) => <tr key={row.season}>
            <th scope="row">{row.season}</th>
            <td>{metricValue(row[metricKey], metricKey)}</td>
            <td>{row[option.denominator]}</td>
            <td>{row.graded}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

export default function ConsumerPerformance() {
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [coverageSeason, setCoverageSeason] = useState<number | undefined>();
  const [coverageWeek, setCoverageWeek] = useState<number | undefined>();
  const [metricKey, setMetricKey] = useState<MetricKey>('winnerAccuracy');
  const coverageParams = coverageSeason === undefined && coverageWeek === undefined ? undefined : {
    season: coverageSeason, week: coverageWeek,
  };
  const query = useGetConsumerPerformance(coverageParams, {
    query: { queryKey: getGetConsumerPerformanceQueryKey(coverageParams), staleTime: 60_000 },
  });
  const chartParams = season === undefined ? undefined : { season };
  const charts = useGetConsumerGradedCharts(chartParams, {
    query: { queryKey: getGetConsumerGradedChartsQueryKey(chartParams), staleTime: 60_000 },
  });

  if (query.isLoading) return <ConsumerLoading label="Loading verified performance…" />;
  if (query.isError || !query.data) return <ConsumerMessage error title="Performance is temporarily unavailable" detail="Verified results could not be loaded right now." />;
  const data = query.data;
  const coverage = data.coverage;
  const families = Object.entries(data.byFamily as unknown as Record<string, Record<string, unknown>>);
  const chartData = charts.data;
  const selectedMetric = metricOptions.find((item) => item.key === metricKey)!;
  const seasons = Array.from(new Set([...(chartData?.bySeason.map((row) => row.season) ?? []), ...(season === undefined ? [] : [season])])).sort((a, b) => b - a);
  const cumulative = chartData?.cumulative ?? [];
  const bySeason = chartData?.bySeason ?? [];
  const cumulativeChartData = cumulative.map((row) => ({
    ...row,
    pointLabel: `${row.season} W${row.week}`,
  }));

  return <div className="consumer-page"><header className="consumer-page-header"><div><p className="consumer-eyebrow">Verified results</p><h1>Performance</h1><p>Accuracy and error measures from persisted, graded official predictions. These are model-quality measures, not claims of profitability.</p></div></header>
    <div className="consumer-summary-grid"><span><small>Official predictions · recent 5,000</small>{data.officialPredictions}</span><span><small>Graded predictions · recent 5,000</small>{data.gradedPredictions}</span><span><small>Winner hit rate · graded only</small>{metric(data.byFamily.moneyline.accuracy, true)}</span></div>
    <section className="consumer-coverage" aria-labelledby="pick-coverage-heading">
      <div className="consumer-chart-heading">
        <div><p className="consumer-eyebrow">Scheduled slate · official picks</p><h2 id="pick-coverage-heading">Pick coverage and abstention</h2>
          <p>As of {coverage ? new Date(coverage.asOf).toLocaleString() : 'unavailable'}. One scheduled game is counted once, not once per market. This is separate from winner hit rate among graded picks.</p></div>
        <div className="consumer-chart-controls">
          <label htmlFor="coverage-season">Season<select id="coverage-season" value={coverage?.season ?? ''} onChange={(event) => { setCoverageSeason(Number(event.target.value)); setCoverageWeek(undefined); }}>
            {coverage?.seasons.map((year) => <option key={year} value={year}>{year}</option>)}
          </select></label>
          <label htmlFor="coverage-week">Slate<select id="coverage-week" value={coverage?.week ?? ''} onChange={(event) => setCoverageWeek(Number(event.target.value))}>
            {coverage?.weeks.map((week) => <option key={week} value={week}>Week {week}</option>)}
          </select></label>
        </div>
      </div>
      {coverage?.states ? <>
        <p className="consumer-coverage-total">{coverage.season} · Week {coverage.week}: <strong>{coverage.scheduled} scheduled</strong>, {coverage.eligible} past the pick cutoff and not cancelled.</p>
        <div className="consumer-coverage-values">
          <div><small>Official pick coverage</small><strong>{coverage.pickCoverage === null ? 'Unavailable' : `${(coverage.pickCoverage * 100).toFixed(1)}%`}</strong><span>{coverage.picked} frozen or graded / {coverage.eligible} eligible</span></div>
          <div><small>Known abstention</small><strong>{coverage.abstentionRate === null ? 'Unavailable' : `${(coverage.abstentionRate * 100).toFixed(1)}%`}</strong><span>{coverage.abstained} without an official pick / {coverage.eligible} eligible</span></div>
        </div>
        <dl className="consumer-coverage-states">
          {([
            ['graded', 'Graded'], ['frozen', 'Frozen, awaiting grade'],
            ['missing_inputs', 'Missing model inputs'], ['missing_markets', 'Missing cutoff markets'],
            ['missed_cutoff', 'Missed prediction cutoff'], ['nonfinal', 'Nonfinal, no pick'],
            ['cancelled', 'Cancelled or postponed'], ['pending', 'Before cutoff'],
            ['unobserved', 'No recorded attempt or freeze'],
          ] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{coverage.states?.[key] ?? 'Unavailable'}</dd></div>)}
        </dl>
        <p className="consumer-note">The denominator excludes cancelled/postponed games and games whose 30-minute pregame cutoff has not passed. Rates stay unavailable when a nonfinal game or missing attempt history prevents a supported abstention conclusion. Frozen picks are not automatically graded; accuracy uses only final, graded results.</p>
      </> : <p className="consumer-note">No persisted dated schedule is available for this selection; pick coverage cannot be measured.</p>}
    </section>
    {data.status === 'unavailable' || !families.length ? <ConsumerMessage title="Not enough graded predictions yet" detail="Performance measures will appear after official predictions have legitimate final results." /> : <div className="consumer-performance-grid">{families.map(([name, values]) => <article key={name}><p className="consumer-eyebrow">{familyLabels[name] ?? name}</p><h2>{name === 'moneyline' ? metric(values.accuracy, true) : metric(values.mae)}</h2><p>{name === 'moneyline' ? 'Winner accuracy' : 'Mean absolute projection error'}</p><dl><div><dt>Predictions</dt><dd>{typeof values.predictions === 'number' ? values.predictions : 'Unavailable'}</dd></div>{name === 'moneyline' ? <div><dt>Brier score</dt><dd>{metric(values.brier)}</dd></div> : <><div><dt>RMSE</dt><dd>{metric(values.rmse)}</dd></div><div><dt>Average CLV</dt><dd>{metric(values.avgClv)}</dd></div></>}</dl></article>)}</div>}
    {charts.isLoading ? <ConsumerLoading label="Loading complete graded performance…" /> : charts.isError || !chartData ? <ConsumerMessage error title="Graded charts are temporarily unavailable" detail="Verified cumulative and season comparisons could not be loaded right now." /> : <section className="consumer-graded-charts" aria-labelledby="graded-charts-heading">
      <div className="consumer-chart-heading">
         <div><p className="consumer-eyebrow">{chartData.truncated ? 'Bounded graded history · partial' : 'Graded history'}</p><h2 id="graded-charts-heading">Performance by game and season</h2><p>{chartData.note}</p></div>
        <div className="consumer-chart-controls">
          <label htmlFor="graded-season">Season<select id="graded-season" data-testid="select-graded-season" value={season ?? ''} onChange={(event) => setSeason(event.target.value ? Number(event.target.value) : undefined)}>
            <option value="">All seasons</option>
            {seasons.map((year) => <option key={year} value={year}>{year}</option>)}
          </select></label>
          <label htmlFor="graded-metric">Measure<select id="graded-metric" data-testid="select-graded-metric" value={metricKey} onChange={(event) => setMetricKey(event.target.value as MetricKey)}>
            {metricOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select></label>
        </div>
      </div>
      {chartData.truncated && <p className="consumer-chart-partial" role="status">The returned graded history is truncated. Totals shown here are partial, not complete. The legacy summary and cards above use a 5,000-prediction window and are also partial.</p>}
      {chartData.status === 'not_configured' || (!cumulative.length && !bySeason.length) ? <ConsumerMessage title="No graded chart data available" detail={chartData.note || 'There are no persisted final results to chart for this selection yet.'} /> : <>
        <div className="consumer-chart-grid">
          <article className="consumer-chart-card">
            <div className="consumer-chart-card-heading"><h3>Cumulative {selectedMetric.label.toLowerCase()}</h3><p>Ordered by kickoff; each point includes its graded metric denominator and cumulative graded count.</p></div>
            {cumulative.length ? <ChartContainer config={chartConfig} className="consumer-chart-plot" aria-label={`Area chart of cumulative ${selectedMetric.label.toLowerCase()} by game`}>
              <AreaChart data={cumulativeChartData} margin={{ top: 10, right: 18, left: 4, bottom: 5 }}>
                <CartesianGrid stroke="hsl(var(--chart-grid))" strokeDasharray="3 3" />
                <XAxis dataKey="pointLabel" tick={{ fill: 'hsl(var(--chart-axis))', fontSize: 10 }} tickLine={{ stroke: 'hsl(var(--chart-grid))' }} axisLine={{ stroke: 'hsl(var(--chart-grid))' }} minTickGap={24} />
                <YAxis tick={{ fill: 'hsl(var(--chart-axis))', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(value: number) => metricKey === 'winnerAccuracy' ? `${Math.round(value * 100)}%` : String(value)} />
                <Tooltip content={<MeasureTooltip metricKey={metricKey} />} />
                <Area type="monotone" dataKey={metricKey} name={selectedMetric.label} stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1) / 0.18)" strokeWidth={2.5} connectNulls={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ChartContainer> : <p className="consumer-chart-empty">No cumulative graded values are available for this selection.</p>}
          </article>
          <article className="consumer-chart-card">
            <div className="consumer-chart-card-heading"><h3>{selectedMetric.label} by season</h3><p>Season aggregates use their own eligible metric denominator.</p></div>
            {bySeason.length ? <ChartContainer config={chartConfig} className="consumer-chart-plot" aria-label={`Bar chart comparing season ${selectedMetric.label.toLowerCase()}`}>
              <BarChart data={bySeason} margin={{ top: 10, right: 14, left: 4, bottom: 5 }}>
                <CartesianGrid stroke="hsl(var(--chart-grid))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="season" tick={{ fill: 'hsl(var(--chart-axis))', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'hsl(var(--chart-grid))' }} />
                <YAxis tick={{ fill: 'hsl(var(--chart-axis))', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(value: number) => metricKey === 'winnerAccuracy' ? `${Math.round(value * 100)}%` : String(value)} />
                <Tooltip content={<MeasureTooltip metricKey={metricKey} />} />
                <Bar dataKey={metricKey} name={selectedMetric.label} fill="hsl(var(--chart-1))" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ChartContainer> : <p className="consumer-chart-empty">No season aggregates are available for this selection.</p>}
          </article>
        </div>
        <div className="consumer-chart-counts" aria-label="Graded sample counts">
          <h3>Sample counts</h3>
          <p>All counts are from persisted graded predictions. The metric denominator changes with the selected measure.</p>
          <ul>{bySeason.map((row) => <li key={row.season}><strong>{row.season}</strong><span>{row.graded} total graded</span><span>{row[selectedMetric.denominator]} {selectedMetric.label.toLowerCase()} denominator</span></li>)}</ul>
        </div>
        <MetricTables cumulative={cumulative} bySeason={bySeason} metricKey={metricKey} />
      </>}
      <p className="consumer-note">Opening and closing line comparisons are unavailable and are not shown. {chartData.openingClosingReason}</p>
    </section>}
    <p className="consumer-note">{data.note} <Link href="/methodology" className="font-semibold text-accent underline">How official predictions are graded and limited</Link>.</p>
  </div>;
}