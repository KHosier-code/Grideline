import React, { useState, useMemo } from 'react';
import {
  getGetConsumerPlayerUsageQueryKey,
  getListConsumerPlayerUsageGamesQueryKey,
  useGetConsumerPlayerUsage,
  useListConsumerPlayerUsageGames,
  type ConsumerUsageMetric,
  type ConsumerUsagePlayer,
  type GetConsumerPlayerUsageParams,
} from '@workspace/api-client-react';
import { ConsumerLoading, ConsumerMessage, metric } from './consumer-ui';
import { ResponsiveContainer, LineChart, Line, XAxis, Tooltip, YAxis, CartesianGrid } from 'recharts';
import { AlertTriangle, Info, ChevronDown, ArrowDown, ArrowUp, ArrowUpDown, FilterX, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { sortUsagePlayers, usageChartData, type UsageSortColumn } from '../../lib/consumer-usage';
import { trackEvent } from '../../lib/analytics';

type SortCol = UsageSortColumn;
type SortDir = 'asc' | 'desc';

function MetricText({ metric: m, percent = false }: { metric?: ConsumerUsageMetric, percent?: boolean }) {
  if (!m?.available || m.value === null) return <span className="text-muted-foreground/40" title={m?.reason || 'Unavailable'}>—</span>;
  return <span className="text-foreground">{metric(m.value, percent)}</span>;
}

function TrendIndicator({ trend }: { trend: string }) {
  if (trend === 'up') return <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full"><TrendingUp className="h-3 w-3" /> Up</span>;
  if (trend === 'down') return <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider text-rose-600 bg-rose-500/10 px-2 py-0.5 rounded-full"><TrendingDown className="h-3 w-3" /> Down</span>;
  if (trend === 'flat') return <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-full"><Minus className="h-3 w-3" /> Flat</span>;
  return <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">N/A</span>;
}

function SortableHeader({ col, label, currentSort, currentDir, onSort, align = 'left' }: {
  col: SortCol;
  label: string;
  currentSort: SortCol;
  currentDir: SortDir;
  onSort: (column: SortCol) => void;
  align?: "left" | "right";
}) {
  const isActive = currentSort === col;
  return (
    <th className={`px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button type="button" className={`flex w-full items-center gap-1.5 hover:text-foreground transition-colors group select-none ${align === 'right' ? 'justify-end' : ''}`} onClick={() => onSort(col)}>
        {label}
        <span className="inline-flex flex-col opacity-0 group-hover:opacity-100 transition-opacity w-3">
          {isActive ? (
            currentDir === 'asc' ? <ArrowUp className="h-3 w-3 opacity-100" /> : <ArrowDown className="h-3 w-3 opacity-100" />
          ) : (
            <ArrowUpDown className="h-3 w-3" />
          )}
        </span>
      </button>
    </th>
  )
}

function SituationalRow({ label, metric: m, percent = false }: { label: string, metric?: ConsumerUsageMetric, percent?: boolean }) {
  if (!m) return null;
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0 px-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {m.available && m.value !== null ? (
        <span className="font-mono text-sm font-semibold text-foreground">{metric(m.value, percent)}</span>
      ) : (
        <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground/50 flex items-center gap-1" title={m.reason || 'Unavailable'}><AlertTriangle className="h-3 w-3" /> N/A</span>
      )}
    </div>
  )
}

function UsageChart({ games, position }: { games: ConsumerUsagePlayer['games']; position: string | null }) {
  if (!games?.length) return <div className="text-xs text-muted-foreground flex h-full items-center justify-center">No game history</div>;

  const data = usageChartData(games);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--chart-grid))" />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} dy={10} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} />
        <Tooltip
          contentStyle={{ backgroundColor: 'hsl(var(--tooltip))', borderColor: 'hsl(var(--border))', fontSize: '11px', borderRadius: '8px', color: 'hsl(var(--tooltip-foreground))', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
          labelStyle={{ color: 'hsl(var(--tooltip-foreground))' }}
          itemStyle={{ fontSize: '11px', fontWeight: 600, color: 'hsl(var(--tooltip-foreground))' }}
          cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 4' }}
        />
        {position === 'QB' ? (
          <Line name="Pass yards" type="monotone" dataKey="passingYards" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--background))', strokeWidth: 2 }} />
        ) : (
          <>
            <Line name="Targets" type="monotone" dataKey="targets" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--background))', strokeWidth: 2 }} />
            <Line name="Carries" type="monotone" dataKey="carries" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ fill: 'hsl(var(--chart-2))', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: 'hsl(var(--chart-2))', stroke: 'hsl(var(--background))', strokeWidth: 2 }} />
          </>
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function ConsumerUsage() {
  const [team, setTeam] = useState('');
  const [position, setPosition] = useState('');
  const [windowFilter, setWindowFilter] = useState('last5');
  const [game, setGame] = useState('');

  const [sortCol, setSortCol] = useState<SortCol>('targets');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const params: GetConsumerPlayerUsageParams = {
    ...(team ? { team } : {}),
    ...(position ? { position: position as GetConsumerPlayerUsageParams['position'] } : {}),
    ...(game ? { game } : {}),
    ...(windowFilter ? { window: windowFilter as GetConsumerPlayerUsageParams['window'] } : {}),
  };

  const query = useGetConsumerPlayerUsage(params, {
    query: {
      queryKey: getGetConsumerPlayerUsageQueryKey(params),
      staleTime: 60_000
    }
  });
  const gamesQuery = useListConsumerPlayerUsageGames({
    query: {
      queryKey: getListConsumerPlayerUsageGamesQueryKey(),
      staleTime: 300_000,
    },
  });

  const sortedPlayers = useMemo(
    () => sortUsagePlayers(query.data?.players ?? [], sortCol, sortDir),
    [query.data?.players, sortCol, sortDir],
  );

  function handleSort(col: SortCol) {
    const direction: SortDir = sortCol === col
      ? (sortDir === 'asc' ? 'desc' : 'asc')
      : 'desc';

    trackEvent('usage_sort_changed', {
      column: col,
      direction,
    });

    if (sortCol === col) {
      setSortDir(direction);
    } else {
      setSortCol(col);
      setSortDir(direction);
    }
  }

  function handleFilterChange(filter: 'team' | 'position' | 'window', value: string) {
    if (filter === 'position') {
      setSortCol(value === 'QB' ? 'passingYards' : 'targets');
      setSortDir('desc');
    }
    trackEvent('usage_filter_changed', {
      filter,
      value: value || 'all',
    });
  }

  function handleGameFilterChange(value: string) {
    setGame(value);
    trackEvent('usage_filter_changed', {
      filter: 'game',
      value: value ? 'specific_game' : 'all',
    });
  }

  function handleRowToggle(player: ConsumerUsagePlayer, rowId: string, isExpanded: boolean) {
    trackEvent('usage_row_toggled', {
      action: isExpanded ? 'collapse' : 'expand',
      position: player.position ?? 'unknown',
      trend: player.trend,
      coverage: player.sourceCoverage.partialReasons.length > 0 ? 'partial' : 'complete',
      window: windowFilter,
    });
    setExpandedId(isExpanded ? null : rowId);
  }

  const handleReset = () => {
    trackEvent('usage_filters_reset', {
      had_team: Boolean(team),
      had_position: Boolean(position),
      had_game: Boolean(game.trim()),
      window: windowFilter,
    });
    setTeam('');
    setPosition('');
    setWindowFilter('last5');
    setGame('');
    setSortCol('targets');
    setSortDir('desc');
    setExpandedId(null);
  };

  return (
    <div className="consumer-page min-w-0 max-w-full space-y-8">
      <header className="consumer-page-header min-w-0 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="consumer-eyebrow">Player Lab</p>
          <h1>Usage & Production</h1>
          <p>Review persisted offensive roles, recent volume, and production efficiency.</p>
        </div>
        <div className="flex min-w-0 max-w-full flex-col sm:flex-row gap-3 items-end bg-card p-4 rounded-xl border border-border shadow-sm w-full md:w-auto">
          <label className="flex flex-col gap-1.5 w-full sm:w-24">
            <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground font-semibold">Team</span>
            <select className="h-9 bg-background border border-input rounded-md px-3 text-sm focus:ring-1 focus:ring-accent outline-none transition-shadow" value={team} onChange={e => {
              setTeam(e.target.value);
              handleFilterChange('team', e.target.value);
            }}>
              <option value="">All</option>
              {query.data?.availableTeams.map(({ teamId, abbreviation }) => (
                <option key={teamId} value={abbreviation}>{abbreviation}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 w-full sm:w-24">
            <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground font-semibold">Position</span>
            <select className="h-9 bg-background border border-input rounded-md px-3 text-sm focus:ring-1 focus:ring-accent outline-none transition-shadow" value={position} onChange={e => {
              setPosition(e.target.value);
              handleFilterChange('position', e.target.value);
            }}>
              <option value="">All</option>
              <option value="QB">QB</option>
              <option value="RB">RB</option>
              <option value="WR">WR</option>
              <option value="TE">TE</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 w-full sm:w-32">
            <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground font-semibold">Window</span>
            <select className="h-9 bg-background border border-input rounded-md px-3 text-sm focus:ring-1 focus:ring-accent outline-none transition-shadow" value={windowFilter} onChange={e => {
              setWindowFilter(e.target.value);
              handleFilterChange('window', e.target.value);
            }}>
              <option value="last3">Last 3 games</option>
              <option value="last5">Last 5 games</option>
              <option value="last8">Last 8 games</option>
              <option value="season">Season to date</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 w-full sm:w-64">
            <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground font-semibold">Game context</span>
            <select
              aria-describedby="usage-game-context-status"
              className="h-9 bg-background border border-input rounded-md px-3 text-sm focus:ring-1 focus:ring-accent outline-none transition-shadow"
              value={game}
              disabled={gamesQuery.isLoading || gamesQuery.isError || !gamesQuery.data?.games.length}
              onChange={event => handleGameFilterChange(event.target.value)}
            >
              <option value="">
                {gamesQuery.isLoading
                  ? 'Loading schedule…'
                  : gamesQuery.isError
                    ? 'Schedule unavailable'
                    : gamesQuery.data?.games.length
                      ? 'Current season (default)'
                      : `No ${gamesQuery.data?.season ?? 'current-season'} games`}
              </option>
              {gamesQuery.data?.games.map((context) => (
                <option key={context.gameId} value={context.gameId}>
                  {context.season} · Week {context.week} · {context.matchup.away} at {context.matchup.home}
                </option>
              ))}
            </select>
            <span id="usage-game-context-status" className="text-[10px] leading-tight text-muted-foreground">
              {gamesQuery.isLoading
                ? 'Loading valid game contexts.'
                : gamesQuery.isError
                  ? 'Game context is unavailable; current-season usage still works.'
                  : gamesQuery.data?.games.length
                    ? 'Optional cutoff for games played before the selected matchup.'
                    : `No game contexts are available for ${gamesQuery.data?.season ?? 'the current season'}.`}
            </span>
          </label>
          <button
            className="h-9 px-4 bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm rounded-md transition-colors font-medium inline-flex items-center justify-center gap-2 border border-border w-full sm:w-auto"
            onClick={handleReset}
          >
            <FilterX className="h-4 w-4" /> <span className="sm:hidden">Reset</span>
          </button>
        </div>
      </header>

      {query.isLoading ? (
        <ConsumerLoading label="Analyzing usage data..." />
      ) : query.isError ? (
        <ConsumerMessage error title="Usage data unavailable" detail="Could not load player usage for the requested filters." />
      ) : !query.data?.players.length ? (
        <ConsumerMessage
          title="No players found"
          detail={query.data?.sourceCoverage.partialReasons.join(' · ') || 'No persisted player-game records match the current filters.'}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {query.data.status === 'partial' && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong className="font-semibold">Partial coverage</strong>
                <p className="mt-0.5 text-xs leading-relaxed">
                  {query.data.sourceCoverage.partialReasons.join(' · ') || 'Some metrics are unavailable for this window.'}
                </p>
              </div>
            </div>
          )}
        <div className="min-w-0 w-full max-w-full border border-border rounded-xl bg-card shadow-sm overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-500">
           <div className="min-w-0 flex flex-col sm:flex-row items-start sm:items-center justify-between px-5 py-4 border-b border-border bg-muted/20 gap-3">
             <div className="min-w-0 flex flex-wrap items-center gap-3">
              <h2 className="font-serif text-lg m-0">Participation Evidence</h2>
              <span className="bg-accent/10 text-accent text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full tracking-widest">
              {query.data.players.length} PLAYERS · {query.data.season} SEASON
              </span>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2 font-mono tracking-wide">
              <Info className="h-3.5 w-3.5" />
              {query.data.sourceCoverage.includedGames} / {query.data.sourceCoverage.requestedGames} GAMES COVERED
            </div>
          </div>

           <div className="min-w-0 max-w-full overflow-x-auto w-full">
             <table className="w-full text-sm text-left min-w-[1290px]">
              <thead className="bg-muted/30 border-b border-border select-none">
                <tr>
                    <SortableHeader col="name" label="Player" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    <SortableHeader col="snapShare" label="Snap %" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    <SortableHeader col="attempts" label="Pass Att" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    <SortableHeader col="completions" label="Cmp" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    <SortableHeader col="passingYards" label="Pass Yds" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    <SortableHeader col="passingTds" label="Pass TD" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                   <SortableHeader col="targets" label="Tgts" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                   <SortableHeader col="receptions" label="Rec" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    <SortableHeader col="receivingYards" label="Rec Yds" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                   <SortableHeader col="carries" label="Carries" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    <SortableHeader col="rushingYards" label="Rush Yds" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                   <SortableHeader col="totalTd" label="Tot TD" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                   <SortableHeader col="trend" label="Trend" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Coverage</th>
                   <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedPlayers.map(player => {
                  const rowId = `${player.playerId}:${player.teamId}`;
                  const isExpanded = expandedId === rowId;
                  return (
                    <React.Fragment key={rowId}>
                      <tr
                        onClick={() => handleRowToggle(player, rowId, isExpanded)}
                        className={`cursor-pointer group transition-colors ${isExpanded ? 'bg-accent/[0.04]' : 'hover:bg-muted/30'}`}
                      >
                        <td className="sticky left-0 z-10 bg-card px-4 py-3.5 whitespace-nowrap group-hover:bg-muted">
                          <div className="flex flex-col">
                            <span className={`font-semibold transition-colors ${isExpanded ? 'text-accent' : 'text-foreground group-hover:text-accent'}`}>
                              {player.playerName}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-0.5">{player.teamId} • {player.position}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono"><MetricText metric={player.aggregate.snapShare} percent /></td>
                         <td className="px-4 py-3.5 text-right font-mono"><MetricText metric={player.aggregate.attempts} /></td>
                         <td className="px-4 py-3.5 text-right font-mono"><MetricText metric={player.aggregate.completions} /></td>
                         <td className="px-4 py-3.5 text-right font-mono"><MetricText metric={player.aggregate.passingYards} /></td>
                         <td className="px-4 py-3.5 text-right font-mono"><MetricText metric={player.aggregate.passingTds} /></td>
                        <td className="px-4 py-3.5 text-right font-mono"><MetricText metric={player.aggregate.targets} /></td>
                        <td className="px-4 py-3.5 text-right font-mono"><MetricText metric={player.aggregate.receptions} /></td>
                        <td className="px-4 py-3.5 text-right font-mono"><MetricText metric={player.aggregate.receivingYards} /></td>
                        <td className="px-4 py-3.5 text-right font-mono"><MetricText metric={player.aggregate.carries} /></td>
                        <td className="px-4 py-3.5 text-right font-mono"><MetricText metric={player.aggregate.rushingYards} /></td>
                        <td className="px-4 py-3.5 text-right font-mono"><MetricText metric={player.aggregate.totalTd} /></td>
                        <td className="px-4 py-3.5 text-right"><TrendIndicator trend={player.trend} /></td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs whitespace-nowrap">
                          {player.sourceCoverage.includedGames}/{player.sourceCoverage.requestedGames}
                        </td>
                        <td className="px-4 py-3.5 text-right text-muted-foreground/50">
                          <ChevronDown className={`h-4 w-4 inline-block transition-transform duration-200 ${isExpanded ? 'rotate-180 text-accent' : 'group-hover:text-foreground'}`} />
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                           <td colSpan={15} className="p-0 border-b border-border bg-accent/[0.02]">
                            <div className="p-6 border-l-2 border-accent overflow-hidden shadow-inner flex flex-col lg:flex-row gap-8">
                              <div className="flex-1 min-w-0">
                                   <h4 className="text-[11px] uppercase tracking-widest text-accent font-mono font-semibold mb-4">{player.position === 'QB' ? 'Passing yards by game' : 'Volume & Efficiency Trends'}</h4>
                                <div className="h-56 w-full bg-card border border-border rounded-xl p-4 shadow-sm">
                                     <UsageChart games={player.games} position={player.position} />
                                </div>
                              </div>

                              <div className="w-full lg:w-80 flex flex-col gap-6 shrink-0">
                                <div>
                                  <h4 className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono font-semibold mb-3">Situational Context</h4>
                                  <div className="bg-card border border-border rounded-xl py-1 shadow-sm">
                                    <SituationalRow label="Red Zone Touches" metric={player.aggregate.redZoneTouches} />
                                    <SituationalRow label="Red Zone Targets" metric={player.aggregate.redZoneTargets} />
                                    <SituationalRow label="Explosive Play Rate" metric={player.aggregate.explosiveRate} percent />
                                  </div>
                                </div>

                                {(player.sourceCoverage.partialReasons.length > 0 || !player.metricAvailability?.redZoneTouches) && (
                                  <div>
                                    <h4 className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono font-semibold mb-3">Coverage Notes</h4>
                                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-xs text-amber-700 dark:text-amber-400 flex flex-col gap-2 shadow-sm">
                                      {player.sourceCoverage.partialReasons.map(r => (
                                        <div key={r} className="flex items-start gap-2">
                                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                          <span className="leading-tight">{r}</span>
                                        </div>
                                      ))}
                                      {!player.metricAvailability?.redZoneTouches && (
                                        <div className="flex items-start gap-2">
                                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                          <span className="leading-tight">Situational metrics unavailable in selected window.</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}