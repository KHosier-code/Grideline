import type { CSSProperties } from 'react';
import type { ConsumerTeamAnalyticsTeam } from '@workspace/api-client-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import { validTrendValue } from './team-trend-values';

export type TeamTrendMetric = 'offenseEpa' | 'defenseEpa' | 'offenseSuccessRate' | 'defenseSuccessRate';
export const teamTrendMetrics: { value: TeamTrendMetric; label: string; unit: string }[] = [
  { value: 'offenseEpa', label: 'Offense EPA / play', unit: 'EPA / play' },
  { value: 'defenseEpa', label: 'Defense EPA allowed / play', unit: 'EPA allowed / play' },
  { value: 'offenseSuccessRate', label: 'Offense success rate', unit: 'Success rate' },
  { value: 'defenseSuccessRate', label: 'Defense success rate allowed', unit: 'Success rate allowed' },
];
const colors = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))'];
export { validTrendValue } from './team-trend-values';
export const trendValueLabel = (value: number | null | undefined, metric: TeamTrendMetric) =>
  !validTrendValue(value) ? 'Unavailable' : metric.includes('SuccessRate') ? `${(value * 100).toFixed(1)}%` : `${value > 0 ? '+' : ''}${value.toFixed(3)}`;

export function ConsumerTeamTrendChart({ teams, selected, throughWeek, metric, compact = false }: {
  teams: ConsumerTeamAnalyticsTeam[];
  selected: string[];
  throughWeek: number;
  metric: TeamTrendMetric;
  compact?: boolean;
}) {
  const rows = Array.from({ length: throughWeek }, (_, index) => {
    const week = index + 1;
    const row: Record<string, number | null> = { week };
    teams.forEach(team => {
      const observation = team.observations.find(item => item.week === week);
      row[team.abbreviation] = observation && validTrendValue(observation[metric]) ? observation[metric] : null;
    });
    return row;
  });
  return <>
    <ChartContainer config={Object.fromEntries(teams.map((team, index) => [team.abbreviation, { label: team.name, color: colors[selected.indexOf(team.abbreviation) >= 0 ? selected.indexOf(team.abbreviation) : index] }]))} className="ct-chart ct-trend-chart" aria-label={`Weekly ${teamTrendMetrics.find(item => item.value === metric)?.label} trends for ${teams.map(team => team.name).join(', ')}`}>
      <LineChart data={rows} margin={{ top: 18, right: 20, left: 3, bottom: 17 }}>
        <CartesianGrid stroke="hsl(var(--chart-grid))" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="week" ticks={Array.from({ length: throughWeek }, (_, index) => index + 1)} tick={{ fill: 'hsl(var(--chart-axis))', fontSize: 10 }} label={{ value: 'WEEK', position: 'insideBottom', offset: -12, fill: 'hsl(var(--chart-axis))', fontSize: 10 }} />
        <YAxis width={52} tick={{ fill: 'hsl(var(--chart-axis))', fontSize: 10 }} tickFormatter={value => metric.includes('SuccessRate') ? `${(Number(value) * 100).toFixed(0)}%` : Number(value).toFixed(2)} />
        {!metric.includes('SuccessRate') && <ReferenceLine y={0} stroke="hsl(var(--chart-axis))" strokeDasharray="4 4" />}
        <Tooltip content={({ active, label, payload }) => active && payload?.length ? <div style={{ padding: 12, background: 'hsl(var(--tooltip))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--tooltip-foreground))', fontSize: 12 }}><strong>Week {label}</strong>{payload.filter(item => validTrendValue(item.value as number)).map(item => {
          const team = teams.find(candidate => candidate.abbreviation === item.dataKey);
          const observation = team?.observations.find(game => game.week === Number(label) && validTrendValue(game[metric]));
          const validGames = team?.observations.filter(game => validTrendValue(game[metric])).length ?? 0;
          return <div key={String(item.dataKey)} style={{ marginTop: 7, color: String(item.color) }}>
            <strong>{item.name}: {trendValueLabel(Number(item.value), metric)}</strong>
            <div style={{ fontSize: 11, color: 'hsl(var(--tooltip-foreground))' }}>{observation?.opponent ? `vs ${observation.opponent} · ` : ''}{validGames} valid {validGames === 1 ? 'game' : 'games'} in window</div>
          </div>;
        })}</div> : null} />
        {teams.map(team => <Line key={team.teamId} type="linear" dataKey={team.abbreviation} name={team.name} stroke={colors[selected.indexOf(team.abbreviation)]} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 1 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />)}
      </LineChart>
    </ChartContainer>
    <ul className="ct-legend" aria-label="Trend team colors">{teams.map(team => <li key={team.teamId}><i style={{ '--legend-color': colors[selected.indexOf(team.abbreviation)] } as CSSProperties} />{team.name}</li>)}</ul>
    <p className="ct-chart-caption">Each point is one final game. Bye weeks and unavailable statistics stay blank. {teamTrendMetrics.find(item => item.value === metric)?.unit}.{compact ? ' Historical form only.' : ''}</p>
  </>;
}