import { useMemo } from 'react';
import type { ConsumerMovementItem } from '@workspace/api-client-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const colors = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];
const price = (value: number) => value > 0 ? `+${value}` : String(value);
const observedAt = (value: string) => new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(value));

export default function LineMovementPlot({ streams, market, label }: {
  streams: ConsumerMovementItem[];
  market: 'spread' | 'total' | 'moneyline';
  label: string;
}) {
  const chart = useMemo(() => {
    const rows = new Map<string, Record<string, string | number | null>>();
    streams.forEach((stream, streamIndex) => {
      stream.observations.forEach((observation) => {
        const row = rows.get(observation.capturedAt) ?? { capturedAt: observation.capturedAt };
        row[`point${streamIndex}`] = observation.point;
        row[`price${streamIndex}`] = observation.price;
        rows.set(observation.capturedAt, row);
      });
    });
    return [...rows.values()].sort((left, right) =>
      String(left.capturedAt).localeCompare(String(right.capturedAt)));
  }, [streams]);
  return <div className="movement-chart" role="img" aria-label={`${label} movement chart`}>
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chart} margin={{ top: 16, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="hsl(var(--chart-grid))" strokeDasharray="3 5" />
        <XAxis dataKey="capturedAt" minTickGap={48} tickFormatter={(value) => observedAt(String(value))}
          tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} />
        <YAxis yAxisId="point" hide={market === 'moneyline'} tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} width={42} />
        <YAxis yAxisId="price" orientation="right" tickFormatter={price} tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} width={45} />
        <Tooltip
          contentStyle={{ background: 'hsl(var(--tooltip))', border: '1px solid hsl(var(--border))', borderRadius: 9, color: 'hsl(var(--tooltip-foreground))' }}
          labelStyle={{ color: 'hsl(var(--tooltip-foreground))' }}
          itemStyle={{ color: 'hsl(var(--tooltip-foreground))' }}
          labelFormatter={(value) => observedAt(String(value))}
          formatter={(value, name) => [String(name).endsWith(' price') ? price(Number(value)) : value, name]}
        />
        <Legend wrapperStyle={{ color: 'hsl(var(--chart-axis))', fontSize: 11 }} />
        {streams.flatMap((stream, index) => {
          if (!stream.observations.length) return [];
          const color = colors[index % colors.length];
          const name = `${stream.sportsbook === 'DraftKings' ? 'DK' : 'FD'} · ${stream.selection}`;
          const lines = [<Line connectNulls dataKey={`price${index}`} dot={{ r: 3 }} key={`price-${name}`}
            name={`${name} price`} stroke={color} strokeDasharray="5 4" type="linear" yAxisId="price" />];
          if (market !== 'moneyline') lines.unshift(<Line connectNulls dataKey={`point${index}`} dot={{ r: 3 }}
            key={`point-${name}`} name={`${name} point`} stroke={color} strokeWidth={2.5} type="linear" yAxisId="point" />);
          return lines;
        })}
      </LineChart>
    </ResponsiveContainer>
  </div>;
}