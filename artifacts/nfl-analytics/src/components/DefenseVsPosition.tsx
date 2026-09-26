import { type ReactNode, useMemo, useState } from 'react';
import { getGetConsumerDefenseVsPositionQueryKey, getGetConsumerPlayerUsageQueryKey, useGetConsumerDefenseVsPosition, useGetConsumerPlayerUsage, type ConsumerDefenseVsPosition, type ConsumerDefenseVsPositionDefensesItem, type DefensePositionMetric, type GetConsumerDefenseVsPositionParams, type GetConsumerPlayerUsageParams } from '@workspace/api-client-react';
import { ArrowDown, ArrowRight, Database, Info, RefreshCw, Shield, Users } from 'lucide-react';
import { Link } from 'wouter';

type Position = 'QB' | 'RB' | 'WR' | 'TE';
type Window = 'season' | 'last3' | 'last5';
const positions: Position[] = ['QB', 'RB', 'WR', 'TE'];
const windows: { value: Window; label: string }[] = [{ value: 'season', label: 'Season' }, { value: 'last3', label: 'Last 3' }, { value: 'last5', label: 'Last 5' }];
const preferred: Record<Position, string[]> = {
  QB: ['passingYards', 'passYards', 'completions', 'passingTds'],
  RB: ['rushingYards', 'rushYards', 'carries', 'receivingYards'],
  WR: ['receivingYards', 'receptions', 'targets'],
  TE: ['receivingYards', 'receptions', 'targets'],
};
const usageKeys: Record<Position, string[]> = {
  QB: ['attempts', 'completions', 'passingYards', 'passingTds'],
  RB: ['snapShare', 'carries', 'rushingYards', 'targets', 'receivingYards'],
  WR: ['snapShare', 'targets', 'receptions', 'receivingYards'],
  TE: ['snapShare', 'targets', 'receptions', 'receivingYards'],
};
const readable = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const dateTime = (value: string | null | undefined) => {
  if (!value) return 'Not supplied';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date);
};
const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: value % 1 ? 1 : 0 }).format(value);
const ordinal = (rank: number) => `${rank}${rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th'}`;
const coveredValue = (metric: DefensePositionMetric | undefined) => metric && metric.coveredGames > 0 && metric.perGame !== null && Number.isFinite(metric.perGame) ? metric.perGame : null;
const metricsFor = (row: ConsumerDefenseVsPositionDefensesItem | undefined, position: Position) => row?.positions?.[position] ?? {};
const metricKeys = (data: ConsumerDefenseVsPosition | undefined, position: Position) => {
  const keys = [...new Set((data?.defenses ?? []).flatMap(row => Object.keys(metricsFor(row, position))))];
  return keys.sort((a, b) => {
    const order = preferred[position];
    const rank = (key: string) => { const index = order.indexOf(key); return index < 0 ? 100 : index; };
    return rank(a) - rank(b) || a.localeCompare(b);
  });
};

function TabGroup<T extends string>({ label, items, selected, onChange, id }: { label: string; items: { value: T; label: string }[]; selected: T; onChange: (value: T) => void; id: string }) {
  return <div className="dvp-control"><span className="dvp-control-label">{label}</span><div className="dvp-tabs" role="group" aria-label={label}>{items.map(item => <button key={item.value} type="button" className={selected === item.value ? 'is-active' : ''} aria-pressed={selected === item.value} onClick={() => onChange(item.value)} data-testid={`button-${id}-${item.value}`}>{item.label}</button>)}</div></div>;
}

function Evidence({ metric, compact = false }: { metric: DefensePositionMetric | undefined; compact?: boolean }) {
  if (!metric) return <span className="dvp-unavailable">Not sourced for this position</span>;
  return <div className="dvp-evidence" data-testid={`text-coverage-${metric.label.replace(/\s+/g, '-').toLowerCase()}`}>
    <span><strong>{metric.coveredGames}/{metric.completedGames}</strong> games covered for this metric</span>
    <span>Covered weeks: {metric.coveredWeeks.length ? metric.coveredWeeks.join(', ') : 'none'}</span>
    {metric.missingWeeks.length > 0 && <span className="dvp-gap">Missing weeks: {metric.missingWeeks.join(', ')}</span>}
    {!compact && metric.missingGames.length > 0 && <span className="dvp-gap">Missing games: {metric.missingGames.join(', ')}</span>}
    {metric.reason && <span className="dvp-gap">{metric.reason}</span>}
  </div>;
}

function MetricDisplay({ metric }: { metric: DefensePositionMetric | undefined }) {
  return <><strong className="dvp-big-number">{number(metric?.perGame)}</strong><span className="dvp-unit">{metric?.unit ?? '—'} / covered game</span><span className="dvp-total">{metric?.total == null ? 'Total unavailable' : `${number(metric.total)} total ${metric.unit}`}</span></>;
}

function RedZonePanel({ position, metrics }: { position: Position; metrics: Record<string, DefensePositionMetric> }) {
  if (position === 'QB') return <p className="dvp-quiet dvp-zone-notice">QB scoring-area opportunities are not source-verified for this view.</p>;
  const keys = position === 'RB'
    ? ['rz20Carries', 'rz10Carries', 'rz20Targets', 'rz10Targets']
    : ['rz20Targets', 'rz10Targets'];
  return <div className="dvp-zones" aria-label={`${position} scoring-area allowances`}>
    <p className="dvp-kicker">Separate PBP scoring-area opportunity coverage</p>
    <div className="dvp-zone-grid">{keys.map(key => {
      const metric = metrics[key];
      return <div className="dvp-zone" key={key}><strong>{metric?.label ?? readable(key)} allowed</strong>
        <p>{number(metric?.perGame)} / covered defensive game</p>
        <Evidence metric={metric} compact />
      </div>;
    })}</div>
    <p className="dvp-quiet">Inside-10 opportunities are also inside 20. These are team-position allowances, not an individual player's scoring prediction.</p>
  </div>;
}

function UsagePanel({ team, position, game }: { team: string; position: Position; game: string }) {
  const seasonParams: GetConsumerPlayerUsageParams = { team, position, window: 'season', game };
  const last3Params: GetConsumerPlayerUsageParams = { team, position, window: 'last3', game };
  const seasonQuery = useGetConsumerPlayerUsage(seasonParams, { query: { queryKey: getGetConsumerPlayerUsageQueryKey(seasonParams), enabled: Boolean(team && game), staleTime: 60_000 } });
  const last3Query = useGetConsumerPlayerUsage(last3Params, { query: { queryKey: getGetConsumerPlayerUsageQueryKey(last3Params), enabled: Boolean(team && game), staleTime: 60_000 } });
  const periods = [{ label: 'Season', query: seasonQuery }, { label: 'Last 3', query: last3Query }];
  const players = [...new Map(periods.flatMap(({ query }) => query.data?.players ?? []).map(player => [player.playerId, player])).values()].slice(0, 8);
  return <div className="dvp-usage">
    <div className="dvp-usage-heading"><div><span className="dvp-kicker"><Users size={14} /> Observed offensive roles</span><h4>{team} · {position} usage</h4></div><Link href="/usage" data-testid={`link-usage-${team}-${position}`}>Usage lab <ArrowRight size={14} /></Link></div>
    <p className="dvp-quiet">Season and last-three completed appearances before this matchup. This history does not verify who starts, is active, or is healthy.</p>
    {seasonQuery.isLoading || last3Query.isLoading ? <div className="dvp-skeleton-row skeleton" aria-label="Loading season and last-three player usage" /> : players.length === 0 ? <div className="dvp-empty-small">{seasonQuery.isError || last3Query.isError ? <>Usage source unavailable. <button type="button" onClick={() => { seasonQuery.refetch(); last3Query.refetch(); }} data-testid={`button-retry-usage-${team}`}>Retry</button></> : `No observed ${position} appearances for ${team} in either window.`}</div> : <div className="dvp-player-list">{players.map(player => <div className="dvp-player dvp-player-periods" key={player.playerId} data-testid={`row-recent-player-${team}-${player.playerId}`}>
      <strong>{player.playerName}</strong>
      <div className="dvp-period-grid">{periods.map(({ label, query }) => {
        const observed = query.data?.players.find(item => item.playerId === player.playerId);
        return <div className="dvp-period" key={label}><span className="dvp-kicker">{label}</span>{query.isError ? <p className="dvp-quiet">Source unavailable <button type="button" onClick={() => query.refetch()} data-testid={`button-retry-usage-${team}-${label.replace(' ', '').toLowerCase()}`}>Retry</button></p> : observed ? <><small>{observed.sourceCoverage.includedGames}/{observed.sourceCoverage.requestedGames} appearances sourced</small><div className="dvp-player-stats">{usageKeys[position].map(key => { const item = observed.aggregate[key]; return item?.available && item.value != null ? <span key={key}><small>{readable(key)}</small><b>{key === 'snapShare' ? `${number(item.value * 100)}%` : number(item.value)}</b></span> : null; })}</div>{observed.sourceCoverage.partialReasons.length > 0 && <small className="dvp-gap">{observed.sourceCoverage.partialReasons.join('; ')}</small>}</> : <small>No observed appearances</small>}</div>;
      })}</div>
    </div>)}</div>}
  </div>;
}

function DataState({ loading, error, onRetry, empty, children }: { loading: boolean; error: boolean; onRetry: () => void; empty: boolean; children: ReactNode }) {
  if (loading) return <div className="dvp-loading" aria-label="Loading observed defensive history"><div className="skeleton h-5 w-44" /><div className="skeleton h-24 w-full" /><div className="skeleton h-24 w-full" /></div>;
  if (error) return <div className="dvp-state"><Database size={24} /><strong>Defensive history unavailable</strong><p>The source did not return this window. No estimate is substituted.</p><button type="button" onClick={onRetry} data-testid="button-retry-defense"><RefreshCw size={14} /> Retry</button></div>;
  if (empty) return <div className="dvp-state"><Shield size={24} /><strong>No covered matchups yet</strong><p>Recorded games for this cutoff will appear here when the source has them.</p></div>;
  return <>{children}</>;
}

export function GameDefenseVsPosition({ gameId, season, away, home }: { gameId: string; season: number; away: { abbreviation: string; name: string }; home: { abbreviation: string; name: string } }) {
  const [position, setPosition] = useState<Position>('WR');
  const [windowFilter, setWindowFilter] = useState<Window>('season');
  const params: GetConsumerDefenseVsPositionParams = { season, game: gameId, window: windowFilter };
  const query = useGetConsumerDefenseVsPosition(params, { query: { queryKey: getGetConsumerDefenseVsPositionQueryKey(params), enabled: Boolean(gameId), staleTime: 60_000 } });
  const keys = metricKeys(query.data, position);
  const [chosenMetric, setChosenMetric] = useState('');
  const selectedMetric = keys.includes(chosenMetric) ? chosenMetric : keys[0];
  const sides = [{ offense: away, defense: home }, { offense: home, defense: away }];
  return <section className="dvp-section" data-section="defense-vs-position" data-testid="section-defense-vs-position" aria-labelledby="dvp-game-title">
    <div className="dvp-head"><div><p className="consumer-eyebrow">Historical matchup context / 01</p><h2 id="dvp-game-title">Defense vs position</h2><p>What each defense has allowed to the opposing position in completed games. This is observed history, not a player forecast.</p></div><Link href={`/defense-vs-position?season=${season}&position=${position}&window=${windowFilter}`} className="dvp-league-link" data-testid="link-defense-league">Compare the league <ArrowRight size={16} /></Link></div>
    <div className="dvp-toolbar"><TabGroup label="Offensive position" items={positions.map(value => ({ value, label: value }))} selected={position} onChange={value => setPosition(value as Position)} id="game-position" /><TabGroup label="Sample window" items={windows} selected={windowFilter} onChange={value => setWindowFilter(value as Window)} id="game-window" /></div>
    <DataState loading={query.isLoading} error={query.isError} onRetry={() => query.refetch()} empty={!query.data?.defenses?.length || !keys.length}>
      <div className="dvp-matchup-grid">{sides.map(({ offense, defense }, index) => {
        const row = query.data?.defenses.find(item => item.abbreviation === defense.abbreviation || item.teamId === defense.abbreviation);
        const metric = metricsFor(row, position)[selectedMetric];
        return <article className="dvp-side" key={index} data-testid={`card-defense-${defense.abbreviation}-${position}`}>
          <div className="dvp-side-top"><span className="dvp-index">0{index + 1} / MATCHUP LENS</span><span className="dvp-def-mark">{defense.abbreviation} DEF</span></div>
          <div className="dvp-versus"><div><small>OFFENSE</small><strong>{offense.name}</strong></div><ArrowRight size={18} /><div><small>FACES DEFENSE</small><strong>{defense.name}</strong></div></div>
          <div className="dvp-primary"><small>{metric?.label ?? readable(selectedMetric || 'Metric')} allowed to {position}</small><MetricDisplay metric={metric} /></div>
          <Evidence metric={metric} />
          <div className="dvp-all-metrics"><p className="dvp-kicker">All observed {position} allowance metrics · choose focus</p>{keys.map(key => {
            const item = metricsFor(row, position)[key];
            return <button type="button" key={key} className={`dvp-metric-row ${selectedMetric === key ? 'is-selected' : ''}`} onClick={() => setChosenMetric(key)} aria-pressed={selectedMetric === key} data-testid={`button-game-metric-${defense.abbreviation}-${key}`}><span><strong>{item?.label ?? readable(key)}</strong><small>{item?.coveredGames ?? 0}/{item?.completedGames ?? 0} games · covered weeks {item?.coveredWeeks.join(', ') || 'none'}{item?.missingWeeks.length ? ` · missing ${item.missingWeeks.join(', ')}` : ''}</small></span><span><b>{number(item?.perGame)}</b><small>{item?.unit ?? '—'} / covered game</small></span></button>;
          })}</div>
           <RedZonePanel position={position} metrics={metricsFor(row, position)} />
           <UsagePanel team={offense.abbreviation} position={position} game={gameId} />
        </article>;
      })}</div>
       <div className="dvp-provenance"><Info size={16} /><span>{query.data?.note} Source: <strong>{query.data?.source}</strong> · Source updated <strong>{dateTime(query.data?.sourceUpdatedAt)}</strong> · Ingested <strong>{dateTime(query.data?.ingestedAt)}</strong> · Cutoff <strong>{dateTime(query.data?.cutoff)}</strong>. Red-zone metrics have their own PBP coverage and denominators.</span></div>
    </DataState>
  </section>;
}

export default function DefenseVsPositionLeague() {
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const [position, setPosition] = useState<Position>(positions.includes(initial.get('position') as Position) ? initial.get('position') as Position : 'WR');
  const [windowFilter, setWindowFilter] = useState<Window>(windows.some(item => item.value === initial.get('window')) ? initial.get('window') as Window : 'season');
  const [season, setSeason] = useState<number | undefined>(() => { const value = Number(initial.get('season')); return value >= 2000 && value <= 2100 ? value : undefined; });
  const params: GetConsumerDefenseVsPositionParams = { ...(season ? { season } : {}), window: windowFilter };
  const query = useGetConsumerDefenseVsPosition(params, { query: { queryKey: getGetConsumerDefenseVsPositionQueryKey(params), staleTime: 60_000 } });
  const keys = metricKeys(query.data, position);
  const [chosenMetric, setChosenMetric] = useState('');
  const selectedMetric = keys.includes(chosenMetric) ? chosenMetric : keys[0];
  const [ascending, setAscending] = useState(false);
  const rows = useMemo(() => [...(query.data?.defenses ?? [])].sort((a, b) => {
    const aCovered = coveredValue(metricsFor(a, position)[selectedMetric]);
    const bCovered = coveredValue(metricsFor(b, position)[selectedMetric]);
    if (aCovered === null && bCovered === null) return a.abbreviation.localeCompare(b.abbreviation);
    if (aCovered === null) return 1;
    if (bCovered === null) return -1;
    return (ascending ? aCovered - bCovered : bCovered - aCovered) || a.abbreviation.localeCompare(b.abbreviation);
  }), [query.data, position, selectedMetric, ascending]);
  const metricLabel = query.data?.defenses.flatMap(row => Object.entries(metricsFor(row, position))).find(([key]) => key === selectedMetric)?.[1].label ?? readable(selectedMetric || 'Metric');
  const currentYear = new Date().getFullYear();
  return <div className="consumer-page dvp-league-page">
    <header className="dvp-league-hero"><div><p className="consumer-eyebrow">Gridline / Defensive history</p><h1>Defense vs<br /><em>position.</em></h1><p>One league, every defense. Compare what opponents actually produced—not what might happen next.</p></div><div className="dvp-hero-stamp"><Shield size={28} /><span>OBSERVED<br />NOT PROJECTED</span></div></header>
    <div className="dvp-toolbar dvp-league-toolbar"><TabGroup label="Offensive position" items={positions.map(value => ({ value, label: value }))} selected={position} onChange={value => setPosition(value as Position)} id="league-position" /><TabGroup label="Sample window" items={windows} selected={windowFilter} onChange={value => setWindowFilter(value as Window)} id="league-window" /><label className="dvp-select-wrap"><span className="dvp-control-label">Season · regular season</span><select value={season ?? ''} onChange={e => setSeason(e.target.value ? Number(e.target.value) : undefined)} data-testid="select-league-season"><option value="">Latest available</option>{Array.from({ length: 7 }, (_, i) => currentYear - i).map(year => <option key={year} value={year}>{year}</option>)}</select></label>{keys.length > 0 && <label className="dvp-select-wrap"><span className="dvp-control-label">Metric allowed</span><select value={selectedMetric} onChange={e => setChosenMetric(e.target.value)} data-testid="select-league-metric">{keys.map(key => <option value={key} key={key}>{query.data?.defenses.flatMap(row => Object.entries(metricsFor(row, position))).find(([name]) => name === key)?.[1].label ?? readable(key)}</option>)}</select></label>}</div>
    <DataState loading={query.isLoading} error={query.isError} onRetry={() => query.refetch()} empty={!query.data?.defenses?.length || !keys.length}>
      <section className="dvp-table-section" aria-label="League defensive comparison"><div className="dvp-table-heading"><div><p className="consumer-eyebrow">{query.data?.season} REGULAR SEASON / {windows.find(w => w.value === windowFilter)?.label.toUpperCase()}</p><h2>{position} · {metricLabel} allowed</h2><p>Sorted by {ascending ? 'fewest' : 'most'} allowed per covered game. Missing metric observations are excluded from the denominator.</p></div><span>{rows.length} DEFENSES</span></div>
      <div className="dvp-table-scroll"><table className="dvp-table"><thead><tr><th scope="col">Rank · {ascending ? 'fewest' : 'most'} allowed</th><th scope="col">Defense</th><th scope="col"><button type="button" onClick={() => setAscending(!ascending)} aria-label={`Sort by ${metricLabel}, ${ascending ? 'most' : 'fewest'} allowed first`} data-testid="button-sort-most-allowed">{metricLabel} / covered game <ArrowDown size={13} className={ascending ? 'dvp-rotated' : ''} /></button></th><th scope="col">Total allowed</th><th scope="col">Metric coverage</th><th scope="col">Weeks</th></tr></thead><tbody>{rows.map((row, index) => { const metric = metricsFor(row, position)[selectedMetric]; const ranked = coveredValue(metric) !== null; return <tr key={row.teamId} data-testid={`row-defense-${row.abbreviation}`}><td className="dvp-rank">{ranked ? <><strong>{ordinal(index + 1)}</strong><small>{ascending ? 'fewest' : 'most'} {metricLabel.toLowerCase()} allowed to {position}s</small></> : <><strong>Unranked</strong><small>No covered games for this metric</small></>}</td><td><strong>{row.abbreviation}</strong><small>{row.teamId !== row.abbreviation ? row.teamId : 'Defense'}</small></td><td><strong className="dvp-table-value">{ranked ? number(metric?.perGame) : '—'}</strong><small>{metric?.unit ?? '—'} / game</small></td><td>{ranked ? number(metric?.total) : '—'} <small>{metric?.unit ?? ''}</small></td><td><Evidence metric={metric} compact /></td><td className="dvp-week-cell"><span>{metric?.coveredWeeks.length ? metric.coveredWeeks.join(', ') : '—'}</span>{Boolean(metric?.missingWeeks.length) && <small>Missing: {metric?.missingWeeks.join(', ')}</small>}</td></tr>; })}</tbody></table></div>
      <div className="dvp-provenance"><Info size={16} /><span>{query.data?.note} Source: <strong>{query.data?.source}</strong> · Source updated <strong>{dateTime(query.data?.sourceUpdatedAt)}</strong> · Ingested <strong>{dateTime(query.data?.ingestedAt)}</strong> · Cutoff <strong>{dateTime(query.data?.cutoff)}</strong>. League table uses the latest available cutoff, not a future matchup cutoff. Red-zone opportunity is reported separately.</span></div>
    </section></DataState>
    <div className="dvp-footer-note"><span>READ THE SAMPLE, NOT JUST THE RANK.</span><p>Different metrics can cover different numbers of games. A smaller denominator is a source limitation, not a zero. Historical allowance does not establish who will play or how often.</p><Link href="/games" data-testid="link-defense-games">Explore games <ArrowRight size={15} /></Link></div>
  </div>;
}