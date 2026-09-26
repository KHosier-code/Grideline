import { useEffect, useState } from 'react';
import { AlertTriangle, Crosshair, X } from 'lucide-react';
import {
  getGetConsumerTeamAnalyticsQueryKey,
  useGetConsumerTeamAnalytics,
  type ConsumerTeamAnalyticsTeam,
  type ConsumerTeamObservation,
  type GetConsumerTeamAnalyticsWindow,
} from '@workspace/api-client-react';
import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import { ConsumerTeamTrendChart, teamTrendMetrics, trendValueLabel, validTrendValue, type TeamTrendMetric } from '../../components/ConsumerTeamTrendChart';
import './ConsumerTeams.css';
import { TeamMark } from '../../components/VerifiedImage';

type Metric = TeamTrendMetric;
type DotData = ConsumerTeamAnalyticsTeam & { offenseEpa: number; defenseEpa: number };

const colors = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))'];
const metrics = teamTrendMetrics;
const valid = validTrendValue;
const epa = (value: number | null | undefined) => valid(value) ? `${value > 0 ? '+' : ''}${value.toFixed(3)}` : 'Unavailable';
const valueLabel = trendValueLabel;

function TeamLogo({ team, small = false }: { team: Pick<ConsumerTeamAnalyticsTeam, 'abbreviation' | 'logoUrl'>; small?: boolean }) {
  return <TeamMark className="ct-mini-logo" url={team.logoUrl} abbreviation={team.abbreviation} />;
}

function ScatterLogo({
  cx, cy, payload, selected, onToggle,
}: {
  cx?: number; cy?: number; payload?: DotData; selected: boolean; onToggle: (code: string) => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!valid(cx) || !valid(cy) || !payload) return null;
  return <g
    className="ct-logo-point"
    role="button"
    tabIndex={0}
    aria-label={`${payload.name}, offense ${epa(payload.offenseEpa)} EPA per play, defense ${epa(payload.defenseEpa)} EPA allowed per play. ${selected ? 'Remove from' : 'Add to'} comparison`}
    aria-pressed={selected}
    onClick={() => onToggle(payload.abbreviation)}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(payload.abbreviation); }
    }}
    data-testid={`button-scatter-team-${payload.abbreviation}`}
  >
    <circle className="ct-dot-ring" cx={cx} cy={cy} r={19} fill="hsl(var(--card))" stroke={selected ? 'hsl(var(--chart-1))' : 'hsl(var(--border))'} strokeWidth={selected ? 2.5 : 1.5} />
    {payload.logoUrl && payload.logoUrl !== failedUrl
      ? <image href={payload.logoUrl} x={cx - 14} y={cy - 14} width={28} height={28} preserveAspectRatio="xMidYMid meet" onError={() => setFailedUrl(payload.logoUrl)} />
      : <text x={cx} y={cy + 3} textAnchor="middle" fill="hsl(var(--foreground))" fontSize={9} fontWeight={700}>{payload.abbreviation}</text>}
  </g>;
}

function ScatterTip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DotData }> }) {
  const team = payload?.[0]?.payload;
  if (!active || !team) return null;
  return <div className="ct-tip" style={{ padding: 13, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--tooltip))', color: 'hsl(var(--tooltip-foreground))', boxShadow: '0 10px 30px hsl(228 30% 5% / .15)' }}>
    <strong>{team.name}</strong>
    <div style={{ marginTop: 6, fontSize: 12 }}>Offense {epa(team.offenseEpa)} · {team.offenseSamples} valid games</div>
    <div style={{ fontSize: 12 }}>Defense {epa(team.defenseEpa)} allowed · {team.defenseSamples} valid games</div>
    <div style={{ marginTop: 5, fontSize: 11, opacity: .8 }}>{team.selectedGames} final games in window</div>
  </div>;
}

export default function ConsumerTeams() {
  const now = new Date();
  const [season, setSeason] = useState(now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear());
  const [throughWeek, setThroughWeek] = useState(18);
  const [autoWeekPending, setAutoWeekPending] = useState(true);
  const [windowValue, setWindowValue] = useState<GetConsumerTeamAnalyticsWindow>('season');
  const [selection, setSelection] = useState<string[] | null>(null);
  const [metric, setMetric] = useState<Metric>('offenseEpa');
  const params = { season, throughWeek, window: windowValue };
  const all = useGetConsumerTeamAnalytics(params, { query: { queryKey: getGetConsumerTeamAnalyticsQueryKey(params), staleTime: 60_000 } });
  useEffect(() => {
    if (!autoWeekPending || !all.data || all.data.season !== season || throughWeek !== 18) return;
    // The initial week-18 response is only a discovery query. Never infer a
    // completed week from the calendar or select a week without verified stats.
    const lastCompleteWeek = Math.max(0, ...all.data.coverage.weeks
      .filter(item => item.week <= 18 && item.finalGames > 0 && item.statGames === item.finalGames)
      .map(item => item.week));
    const lastVerifiedWeek = Math.max(0, ...all.data.coverage.weeks
      .filter(item => item.week <= 18 && item.statGames > 0)
      .map(item => item.week));
    setAutoWeekPending(false);
    const defaultWeek = lastCompleteWeek || lastVerifiedWeek;
    if (defaultWeek > 0 && defaultWeek < 18) setThroughWeek(defaultWeek);
  }, [all.data, autoWeekPending, season, throughWeek]);
  const teams = all.data?.teams ?? [];
  const plotted = teams.filter((team): team is DotData => valid(team.offenseEpa) && valid(team.defenseEpa));
  const selected = (selection ?? plotted.slice(0, 2).map(team => team.abbreviation)).filter(code => teams.some(team => team.abbreviation === code)).slice(0, 4);
  const trendParams = { ...params, teams: selected.join(',') };
  const trend = useGetConsumerTeamAnalytics(trendParams, {
    query: { queryKey: getGetConsumerTeamAnalyticsQueryKey(trendParams), enabled: !!all.data && selected.length > 0, staleTime: 60_000 },
  });
  const trendTeams = (trend.data?.teams ?? []).filter(team => selected.includes(team.abbreviation));
  const observedPoints = trendTeams.reduce((sum, team) => sum + team.observations.filter(item => valid(item[metric])).length, 0);
  const coverage = all.data?.coverage;
  const incomplete = (coverage?.weeks ?? []).filter(item => item.statGames < item.finalGames);
  const lastReportedWeek = Math.max(0, ...(coverage?.weeks ?? []).map(item => item.week));
  const unreportedWeeks = coverage
    ? Array.from({ length: Math.min(throughWeek, lastReportedWeek) }, (_, index) => index + 1).filter(week => !coverage.weeks.some(item => item.week === week))
    : [];
  const toggle = (code: string) => {
    setSelection(current => {
      const active = (current ?? plotted.slice(0, 2).map(team => team.abbreviation)).filter(item => teams.some(team => team.abbreviation === item));
      return active.includes(code) ? active.filter(item => item !== code) : active.length < 4 ? [...active, code] : active;
    });
  };
  const domainValues = plotted.flatMap(team => [team.offenseEpa, team.defenseEpa]);
  const extent = Math.max(.05, ...domainValues.map(value => Math.abs(value)));
  const domain = Math.ceil(extent * 1.15 * 20) / 20;
  const dataAvailable = !!all.data && teams.some(team => team.selectedGames > 0);

  return <div className="ct-page">
    <header className="ct-hero">
      <div>
        <p className="ct-kicker">GRIDLINE / TEAM EVIDENCE</p>
        <h1 data-testid="text-page-title">The league, in context.</h1>
        <p>See where each team stands on both sides of the ball. Every point is backed by final-game play data, not a projection.</p>
      </div>
      <div className="ct-hero-mark" aria-hidden="true"><Crosshair /></div>
    </header>

    <section className="ct-toolbar" aria-label="Analytics filters">
      <div className="ct-fields">
        <label className="ct-field">Season
          <select value={season} onChange={event => { setAutoWeekPending(false); setSeason(Number(event.target.value)); setSelection(null); }} data-testid="select-teams-season">
            {Array.from({ length: Math.max(1, now.getFullYear() - 2020) }, (_, index) => now.getFullYear() - index).map(year => <option value={year} key={year}>{year}</option>)}
          </select>
        </label>
        <label className="ct-field">Through week
          <select value={throughWeek} onChange={event => { setAutoWeekPending(false); setThroughWeek(Number(event.target.value)); }} data-testid="select-teams-week">
            {Array.from({ length: 18 }, (_, index) => index + 1).map(week => <option value={week} key={week}>Week {week}</option>)}
          </select>
        </label>
        <label className="ct-field">Sample window
          <select value={windowValue} onChange={event => setWindowValue(event.target.value as GetConsumerTeamAnalyticsWindow)} data-testid="select-teams-window">
            <option value="season">Season to date</option><option value="last3">Last 3 games</option><option value="last5">Last 5 games</option><option value="last8">Last 8 games</option>
          </select>
        </label>
      </div>
      <p className="ct-toolbar-note">Last-N windows use games from the selected season only. Future weeks are never estimated.</p>
    </section>

    {(coverage?.partialReasons.length || incomplete.length > 0 || (dataAvailable && unreportedWeeks.length > 0)) ? <div className="ct-alert" role="status" data-testid="status-teams-coverage">
      <AlertTriangle aria-hidden="true" /><div><strong>Coverage is incomplete</strong>
        <p>Only final games with available statistics contribute to the charts. Requested weeks without evidence remain unplotted.</p>
        {unreportedWeeks.length > 0 && <p>No week-level coverage reported for {unreportedWeeks.map(week => `W${week}`).join(', ')}.</p>}
        {!!coverage?.partialReasons.length && <ul>{coverage.partialReasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul>}
      </div>
    </div> : null}

    <section className="ct-panel" aria-labelledby="ct-scatter-title">
      <div className="ct-panel-heading">
        <div><p className="ct-overline">01 / LEAGUE MAP</p><h2 id="ct-scatter-title">Offense × defense</h2><p className="ct-subtitle">Right is stronger offense. Higher is better defense: fewer EPA allowed per play. Select a logo to compare.</p></div>
        <span className="ct-tag" data-testid="text-plotted-teams">{plotted.length} / {teams.length} teams plotted</span>
      </div>
      {all.isLoading ? <div className="ct-skeleton" aria-label="Loading team evidence" /> : all.isError ? <div className="ct-state" role="alert"><strong>Team evidence is unavailable</strong><p>We couldn't load verified team observations for this selection.</p><button type="button" onClick={() => all.refetch()} data-testid="button-retry-teams">Try again</button></div> : !dataAvailable ? <div className="ct-state" data-testid="status-teams-unavailable"><strong>No verified games for this selection</strong><p>The {season} season has no final-game team evidence through week {throughWeek}. Choose another season or week; no values will be inferred.</p></div> : !plotted.length ? <div className="ct-state" data-testid="status-teams-no-axes"><strong>No complete EPA pairs yet</strong><p>Teams require both offense and defense EPA to appear on the map. Available partial records are listed below.</p></div> :
        <>
          <ChartContainer config={{ offense: { color: 'hsl(var(--chart-1))' }, defense: { color: 'hsl(var(--chart-2))' } }} className="ct-chart" aria-label="Scatter plot of team offense EPA per play against defense EPA allowed per play, with the defense axis inverted">
            <ScatterChart margin={{ top: 28, right: 33, bottom: 34, left: 15 }}>
              <CartesianGrid stroke="hsl(var(--chart-grid))" strokeDasharray="3 5" />
              <XAxis type="number" dataKey="offenseEpa" name="Offense EPA / play" domain={[-domain, domain]} tickFormatter={value => Number(value).toFixed(2)} tick={{ fill: 'hsl(var(--chart-axis))', fontSize: 11 }} label={{ value: 'OFFENSE EPA / PLAY  →', position: 'insideBottom', offset: -20, fill: 'hsl(var(--chart-axis))', fontSize: 10 }} />
              <YAxis type="number" dataKey="defenseEpa" name="Defense EPA allowed / play" reversed domain={[-domain, domain]} tickFormatter={value => Number(value).toFixed(2)} tick={{ fill: 'hsl(var(--chart-axis))', fontSize: 11 }} width={47} label={{ value: '← BETTER DEFENSE', angle: -90, position: 'insideLeft', fill: 'hsl(var(--chart-axis))', fontSize: 10 }} />
              <ZAxis range={[400, 400]} />
              <ReferenceLine x={0} stroke="hsl(var(--chart-axis))" strokeDasharray="4 4" />
              <ReferenceLine y={0} stroke="hsl(var(--chart-axis))" strokeDasharray="4 4" />
              <Tooltip content={<ScatterTip />} cursor={{ strokeDasharray: '3 3' }} />
              <Scatter data={plotted} shape={(props: { cx?: number; cy?: number; payload?: DotData }) => <ScatterLogo {...props} selected={!!props.payload && selected.includes(props.payload.abbreviation)} onToggle={toggle} />} isAnimationActive={false} />
            </ScatterChart>
          </ChartContainer>
          <div className="ct-chart-caption"><span><strong>Zero lines</strong> separate above / below baseline EPA. Scatter values are unweighted means of game-level EPA, not play-weighted averages.</span><span>Defense axis inverted · lower allowed is better</span></div>
        </>}
    </section>

    <section className="ct-panel" aria-labelledby="ct-trend-title">
      <div className="ct-panel-heading">
        <div><p className="ct-overline">02 / GAME-BY-GAME</p><h2 id="ct-trend-title">Follow the evidence</h2><p className="ct-subtitle">Compare up to four teams. Gaps are missing observations, not zeroes.</p></div>
        <span className="ct-tag">{selected.length} / 4 selected</span>
      </div>
      <div className="ct-compare-controls">
        <div className="ct-chips">{selected.map((code, index) => <button type="button" className="ct-chip" key={code} onClick={() => toggle(code)} aria-label={`Remove ${code} from comparison`} style={{ '--chip-color': colors[index] } as React.CSSProperties} data-testid={`button-remove-team-${code}`}><i />{code}<X aria-hidden="true" /></button>)}</div>
        <div className="ct-fields">
          <label className="ct-field">Add team
            <select value="" disabled={!dataAvailable || selected.length >= 4} onChange={event => { if (event.target.value) toggle(event.target.value); }} data-testid="select-add-team">
              <option value="">{selected.length >= 4 ? 'Maximum 4 teams' : 'Choose a team'}</option>
              {teams.filter(team => !selected.includes(team.abbreviation)).map(team => <option key={team.teamId} value={team.abbreviation}>{team.name}</option>)}
            </select>
          </label>
          <label className="ct-field">Metric
            <select value={metric} onChange={event => setMetric(event.target.value as Metric)} data-testid="select-teams-metric">
              {metrics.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>
      </div>
      {selected.length === 0 ? <div className="ct-state"><strong>Pick teams to begin</strong><p>Select a team above or from the league table to see its final-game history.</p></div> : trend.isLoading ? <div className="ct-skeleton" aria-label="Loading game trends" /> : trend.isError ? <div className="ct-state" role="alert"><strong>Game history is unavailable</strong><p>We couldn't load observations for this comparison.</p><button type="button" onClick={() => trend.refetch()} data-testid="button-retry-trends">Try again</button></div> : !observedPoints ? <div className="ct-state"><strong>No observations for this metric</strong><p>Try another metric, week, or team. Missing game statistics are not drawn as values.</p></div> :
        <ConsumerTeamTrendChart teams={trendTeams} selected={selected} throughWeek={throughWeek} metric={metric} />}
      {trendTeams.length > 0 && <details style={{ marginTop: 18 }}><summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700 }} data-testid="button-show-observations">Read game-by-game values</summary>
        <div className="ct-table-wrap" style={{ marginTop: 12 }}><table className="ct-table"><thead><tr><th>Team</th><th>Week</th><th>Opponent</th><th>{metrics.find(item => item.value === metric)?.label}</th><th>Game</th></tr></thead><tbody>
          {trendTeams.flatMap(team => team.observations.map((observation: ConsumerTeamObservation) => <tr key={`${team.teamId}-${observation.gameId}`}><td>{team.name}</td><td>{observation.week}</td><td>{observation.opponent}</td><td>{valueLabel(observation[metric], metric)}</td><td>{new Date(observation.kickoffTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td></tr>))}
        </tbody></table></div>
      </details>}
    </section>

    <section className="ct-panel" aria-labelledby="ct-ledger-title">
        <div className="ct-panel-heading"><div><p className="ct-overline">03 / THE RECEIPTS</p><h2 id="ct-ledger-title">League ledger</h2><p className="ct-subtitle">A keyboard-accessible alternative to the map. Values and valid-game counts are shown separately.</p></div></div>
      {dataAvailable ? <div className="ct-table-wrap"><table className="ct-table">
        <thead><tr><th>Team / compare</th><th>Offense EPA / play</th><th>Off. valid games</th><th>Defense EPA allowed / play</th><th>Def. valid games</th><th>Final games</th></tr></thead>
        <tbody>{teams.map(team => <tr key={team.teamId} data-testid={`row-team-${team.abbreviation}`}><td><button type="button" onClick={() => toggle(team.abbreviation)} aria-pressed={selected.includes(team.abbreviation)} aria-label={`${selected.includes(team.abbreviation) ? 'Remove' : 'Add'} ${team.name} ${selected.includes(team.abbreviation) ? 'from' : 'to'} comparison`} data-testid={`button-compare-team-${team.abbreviation}`}><TeamLogo team={team} small />{team.name}</button></td><td>{epa(team.offenseEpa)}</td><td>{team.offenseSamples.toLocaleString()}</td><td>{epa(team.defenseEpa)}</td><td>{team.defenseSamples.toLocaleString()}</td><td>{team.selectedGames}</td></tr>)}</tbody>
      </table></div> : <p className="ct-muted">The ledger will appear when final-game team data is available.</p>}
    </section>

    <section className="ct-panel" aria-labelledby="ct-coverage-title">
      <div className="ct-coverage"><div><p className="ct-overline">METHODOLOGY / PROVENANCE</p><h2 id="ct-coverage-title">Coverage, not confidence theater.</h2><p className="ct-subtitle">Final games vs. games with play statistics, by week. A missing week is not a zero.</p></div><span className="ct-tag" data-testid="text-covered-weeks">{coverage?.weeks.length ?? 0} weeks with coverage records</span></div>
      <div className="ct-coverage-list" style={{ marginTop: 17 }}>{coverage ? Array.from({ length: throughWeek }, (_, index) => index + 1).map(week => {
        const item = coverage.weeks.find(entry => entry.week === week);
        return <div className={`ct-week ${item ? (item.statGames < item.finalGames ? 'is-partial' : '') : (week <= lastReportedWeek ? 'is-partial' : '')}`} key={week} data-testid={`status-coverage-week-${week}`}><b>WK {week}</b><small>{item ? `${item.statGames} / ${item.finalGames} games` : week <= lastReportedWeek ? 'Missing report' : 'Not reported'}</small></div>;
      }) : <p className="ct-muted">No week-level coverage reported for this selection.</p>}</div>
      <p className="ct-source" data-testid="text-teams-source"><strong>Source:</strong> {all.data?.source || 'Not available'} · Scatter EPA is the unweighted mean of available game-level EPA per-play values, not a play-weighted season estimate. Defense values represent EPA allowed, so lower is better. Success rates use the source's game observations. Windows never cross season boundaries.</p>
    </section>
  </div>;
}