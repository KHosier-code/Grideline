import type { ConsumerMatchupAssessment, ConsumerMatchupBoard, ConsumerMatchupMetric, ConsumerTeam } from '@workspace/api-client-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from './ui/chart';

const comparisonSpecs = [
  { category: 'passing', label: 'Passing', metricLabel: 'Blended pass EPA / dropback' },
  { category: 'rushing', label: 'Rushing', metricLabel: 'Blended rush EPA / carry' },
  { category: 'red_zone', label: 'Offensive red zone', metricLabel: 'Offensive red-zone rate' },
  { category: 'pace_tendency', label: 'Pace', metricLabel: 'Seconds per play' },
] as const;

type ComparisonRow = {
  category: string;
  label: string;
  assessment: ConsumerMatchupAssessment | undefined;
  metric: ConsumerMatchupMetric | undefined;
};

function supported(metric: ConsumerMatchupMetric | undefined, assessment: ConsumerMatchupAssessment | undefined) {
  return Boolean(
    metric
    && typeof metric.homeValue === 'number' && Number.isFinite(metric.homeValue)
    && typeof metric.awayValue === 'number' && Number.isFinite(metric.awayValue)
    && assessment
    && assessment.edge !== 'insufficient'
    && assessment.confidence !== 'unavailable',
  );
}

function metricUnit(metric: ConsumerMatchupMetric) {
  if (metric.label === 'Blended pass EPA / dropback') return 'EPA/dropback';
  if (metric.label === 'Blended rush EPA / carry') return 'EPA/carry';
  if (metric.label === 'Offensive red-zone rate') return '%';
  return 'seconds/play';
}

function chartValue(metric: ConsumerMatchupMetric, value: number) {
  return metric.label === 'Offensive red-zone rate' ? value * 100 : value;
}

function formatValue(metric: ConsumerMatchupMetric, value: number | null) {
  if (value === null) return 'Unavailable';
  if (metric.label === 'Offensive red-zone rate') return `${(value * 100).toFixed(1)}%`;
  if (metric.label === 'Seconds per play') return `${value.toFixed(1)} sec/play`;
  return `${value.toFixed(3)} ${metricUnit(metric)}`;
}

export function ConsumerPregameComparisonChart({ board, away, home }: {
  board: ConsumerMatchupBoard;
  away: ConsumerTeam;
  home: ConsumerTeam;
}) {
  const [selectedCategory, setSelectedCategory] = useState('');
  const rows: ComparisonRow[] = comparisonSpecs.map((spec) => {
    const assessment = board.assessments.find((item) => item.category === spec.category);
    return {
      category: spec.category,
      label: spec.label,
      assessment,
      metric: assessment?.metrics.find((item) => item.label === spec.metricLabel),
    };
  });
  const plotted = rows.filter((row) => supported(row.metric, row.assessment));
  const selected = plotted.find((row) => row.category === selectedCategory) ?? plotted[0];
  const selectedMetric = selected?.metric;
  const data = selected && selectedMetric ? [{
    category: selected.label,
    awayValue: chartValue(selectedMetric, selectedMetric.awayValue!),
    homeValue: chartValue(selectedMetric, selectedMetric.homeValue!),
    metric: selectedMetric,
  }] : [];
  const config: ChartConfig = {
    awayValue: { label: away.abbreviation, color: 'hsl(var(--chart-1))' },
    homeValue: { label: home.abbreviation, color: 'hsl(var(--chart-2))' },
  };
  const cutoff = new Date(board.sourceCutoff);
  const cutoffLabel = Number.isNaN(cutoff.getTime()) ? 'Unavailable' : cutoff.toLocaleString();

  return <section className="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground sm:p-5" data-section="pregame-team-comparison" aria-labelledby="pregame-team-comparison-title">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pregame comparison</p>
        <h2 id="pregame-team-comparison-title" className="text-lg font-semibold">Pregame team comparison</h2>
      </div>
      <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
        {plotted.length} of {comparisonSpecs.length} supported
      </span>
    </div>
    <p className="m-0 text-sm leading-relaxed text-muted-foreground">
      Cutoff-safe, both-team values only. Descriptive evidence; not a prediction.
    </p>

    {plotted.length > 0 && selectedMetric ? <>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="pregame-comparison-metric" className="text-sm font-medium">Metric</label>
        <select
          id="pregame-comparison-metric"
          aria-label="Select a supported metric to compare"
          className="min-h-9 min-w-40 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
          value={selected.category}
          onChange={(event) => setSelectedCategory(event.target.value)}
        >
          {plotted.map((row) => <option key={row.category} value={row.category}>{row.label}</option>)}
        </select>
      </div>
      <ChartContainer config={config} className="h-52 w-full aspect-auto" aria-label={`${selected.label}: ${metricUnit(selectedMetric)}, ${away.abbreviation} compared with ${home.abbreviation}`}>
        <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <XAxis dataKey="category" tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} interval={0} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
            tickFormatter={(value: number) => selectedMetric.label === 'Offensive red-zone rate' ? `${value}%` : value.toFixed(selectedMetric.unit === 'seconds' ? 1 : 3)}
            width={48}
            label={{ value: metricUnit(selectedMetric), angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
          />
          <ChartTooltip content={<ChartTooltipContent formatter={(value) => (
            <span>{formatValue(selectedMetric, Number(value))}</span>
          )} />} />
          <Bar dataKey="awayValue" name={away.abbreviation} fill="var(--color-awayValue)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="homeValue" name={home.abbreviation} fill="var(--color-homeValue)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </> : <p className="m-0 rounded-lg bg-secondary/50 px-3 py-3 text-sm text-muted-foreground" role="status">
      No supported two-team values are available for these pregame metrics yet.
    </p>}

    <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2" aria-label="Accessible list of pregame comparison values">
      {rows.map(({ category, label, assessment, metric }) => {
        const isSupported = supported(metric, assessment);
        return <li key={category} className="min-w-0 rounded-lg border border-border/70 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <strong className="text-sm">{label}</strong>
            <span className="text-xs text-muted-foreground">{isSupported ? assessment!.confidence + ' confidence' : 'Unavailable'}</span>
          </div>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 text-xs">
            <div><dt className="text-muted-foreground">{away.abbreviation}</dt><dd className="m-0 font-medium tabular-nums">{isSupported && metric ? formatValue(metric, metric.awayValue) : 'Unavailable'}</dd></div>
            <div><dt className="text-muted-foreground">{home.abbreviation}</dt><dd className="m-0 font-medium tabular-nums">{isSupported && metric ? formatValue(metric, metric.homeValue) : 'Unavailable'}</dd></div>
          </dl>
          <p className="mb-0 mt-1 text-[11px] leading-relaxed text-muted-foreground">Coverage: {assessment?.coverage ?? 'Verified evidence unavailable'}</p>
        </li>;
      })}
    </ul>

    <footer className="text-[11px] leading-relaxed text-muted-foreground">
      Sources: {board.sources.length ? board.sources.join(' · ') : 'No supported sources'} · Pregame evidence through {cutoffLabel}
    </footer>
  </section>;
}