import React, { useState, useMemo } from 'react';
import {
  getGetConsumerPlayerUsageQueryKey,
  useGetConsumerPlayerUsage,
  type ConsumerUsageMetric,
  type ConsumerUsagePlayer,
  type GetConsumerPlayerUsageParams,
} from '@workspace/api-client-react';
import { ConsumerLoading, ConsumerMessage, metric } from './consumer-ui';
import { ResponsiveContainer, LineChart, Line, XAxis, Tooltip, YAxis, CartesianGrid } from 'recharts';
import { AlertTriangle, Info, ChevronDown, ArrowDown, ArrowUp, ArrowUpDown, FilterX, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { sortUsagePlayers, usageChartData, type UsageSortColumn } from '../../lib/consumer-usage';

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

function UsageChart({ games }: { games: ConsumerUsagePlayer['games'] }) {
  if (!games?.length) return <div className="text-xs text-muted-foreground flex h-full items-center justify-center">No game history</div>;

  const data = usageChartData(games);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} dy={10} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
        <Tooltip
          contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', fontSize: '11px', borderRadius: '8px', color: 'hsl(var(--foreground))', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
          itemStyle={{ fontSize: '11px', fontWeight: 600 }}
          cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 4' }}
        />
        <Line name="Targets" type="monotone" dataKey="targets" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--background))', strokeWidth: 2 }} />
        <Line name="Carries" type="monotone" dataKey="carries" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ fill: 'hsl(var(--chart-2))', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: 'hsl(var(--chart-2))', stroke: 'hsl(var(--background))', strokeWidth: 2 }} />
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

  const sortedPlayers = useMemo(
    () => sortUsagePlayers(query.data?.players ?? [], sortCol, sortDir),
    [query.data?.players, sortCol, sortDir],
  );

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  }

  const handleReset = () => {
    setTeam('');
    setPosition('');
    setWindowFilter('last5');
    setGame('');
    setSortCol('targets');
    setSortDir('desc');
    setExpandedId(null);
  };

  return (
    <div className="consumer-page space-y-8">
      <header className="consumer-page-header flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <p className="consumer-eyebrow">Player Lab</p>
          <h1>Usage & Production</h1>
          <p>Review persisted offensive roles, recent volume, and production efficiency.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-end bg-card p-4 rounded-xl border border-border shadow-sm w-full md:w-auto">
          <label className="flex flex-col gap-1.5 w-full sm:w-24">
            <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground font-semibold">Team</span>
            <select className="h-9 bg-background border border-input rounded-md px-3 text-sm focus:ring-1 focus:ring-accent outline-none transition-shadow" value={team} onChange={e => setTeam(e.target.value)}>
              <option value="">All</option>
              {query.data?.availableTeams.map(({ teamId, abbreviation }) => (
                <option key={teamId} value={abbreviation}>{abbreviation}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 w-full sm:w-24">
            <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground font-semibold">Position</span>
            <select className="h-9 bg-background border border-input rounded-md px-3 text-sm focus:ring-1 focus:ring-accent outline-none transition-shadow" value={position} onChange={e => setPosition(e.target.value)}>
              <option value="">All</option>
              <option value="QB">QB</option>
              <option value="RB">RB</option>
              <option value="WR">WR</option>
              <option value="TE">TE</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 w-full sm:w-32">
            <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground font-semibold">Window</span>
            <select className="h-9 bg-background border border-input rounded-md px-3 text-sm focus:ring-1 focus:ring-accent outline-none transition-shadow" value={windowFilter} onChange={e => setWindowFilter(e.target.value)}>
              <option value="last3">Last 3 games</option>
              <option value="last5">Last 5 games</option>
              <option value="last8">Last 8 games</option>
              <option value="season">Season to date</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 w-full sm:w-32">
            <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground font-semibold">Game ID</span>
            <input type="text" placeholder="Optional" className="h-9 bg-background border border-input rounded-md px-3 text-sm focus:ring-1 focus:ring-accent outline-none transition-shadow placeholder:text-muted-foreground/50" value={game} onChange={e => setGame(e.target.value)} />
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
        <div className="border border-border rounded-xl bg-card shadow-sm overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-5 py-4 border-b border-border bg-muted/20 gap-3">
            <div className="flex items-center gap-3">
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

          <div className="overflow-x-auto w-full">
            <table className="w-full text-sm text-left min-w-[950px]">
              <thead className="bg-muted/30 border-b border-border select-none">
                <tr>
                    <SortableHeader col="name" label="Player" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
                    <SortableHeader col="snapShare" label="Snap %" align="right" currentSort={sortCol} currentDir={sortDir} onSort={handleSort} />
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
                        onClick={() => setExpandedId(isExpanded ? null : rowId)}
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
                          <td colSpan={11} className="p-0 border-b border-border bg-accent/[0.02]">
                            <div className="p-6 border-l-2 border-accent overflow-hidden shadow-inner flex flex-col lg:flex-row gap-8">
                              <div className="flex-1 min-w-0">
                                <h4 className="text-[11px] uppercase tracking-widest text-accent font-mono font-semibold mb-4">Volume & Efficiency Trends</h4>
                                <div className="h-56 w-full bg-card border border-border rounded-xl p-4 shadow-sm">
                                  <UsageChart games={player.games} />
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