import type { ConsumerMatchupMetric, ConsumerTeam } from '@workspace/api-client-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from './ui/chart';

function metricUnit(metric: ConsumerMatchupMetric) {
  if (metric.label === 'Blended pass EPA / dropback') return 'EPA/dropback';
  if (metric.label === 'Blended rush EPA / carry') return 'EPA/carry';
  if (metric.label === 'Offensive red-zone rate') return '%';
  return 'seconds/play';
}

export default function PregameComparisonPlot({ label, metric, away, home }: {
  label: string;
  metric: ConsumerMatchupMetric;
  away: ConsumerTeam;
  home: ConsumerTeam;
}) {
  const data = [{
    category: label,
    awayValue: metric.label === 'Offensive red-zone rate' ? metric.awayValue! * 100 : metric.awayValue!,
    homeValue: metric.label === 'Offensive red-zone rate' ? metric.homeValue! * 100 : metric.homeValue!,
  }];
  const config: ChartConfig = {
    awayValue: { label: away.abbreviation, color: 'hsl(var(--chart-1))' },
    homeValue: { label: home.abbreviation, color: 'hsl(var(--chart-2))' },
  };
  return <ChartContainer config={config} className="h-52 w-full aspect-auto" aria-label={`${label}: ${metricUnit(metric)}, ${away.abbreviation} compared with ${home.abbreviation}`}>
    <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }} accessibilityLayer>
      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
      <XAxis dataKey="category" tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} interval={0} />
      <YAxis tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
        tickFormatter={(value: number) => metric.label === 'Offensive red-zone rate' ? `${value}%` : value.toFixed(metric.unit === 'seconds' ? 1 : 3)}
        width={48} label={{ value: metricUnit(metric), angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
      <ChartTooltip content={<ChartTooltipContent formatter={(value) => (
        <span>{metric.label === 'Offensive red-zone rate' ? `${Number(value).toFixed(1)}%` : metric.label === 'Seconds per play' ? `${Number(value).toFixed(1)} sec/play` : `${Number(value).toFixed(3)} ${metricUnit(metric)}`}</span>
      )} />} />
      <Bar dataKey="awayValue" name={away.abbreviation} fill="var(--color-awayValue)" radius={[3, 3, 0, 0]} />
      <Bar dataKey="homeValue" name={home.abbreviation} fill="var(--color-homeValue)" radius={[3, 3, 0, 0]} />
    </BarChart>
  </ChartContainer>;
}