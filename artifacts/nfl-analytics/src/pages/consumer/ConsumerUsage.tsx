import { useEffect, useMemo, useState } from 'react';
import {
  getGetConsumerPlayerUsageQueryKey,
  getListConsumerPlayerUsageGamesQueryKey,
  useGetConsumerPlayerUsage,
  useListConsumerPlayerUsageGames,
  type ConsumerUsageMetric,
  type ConsumerUsagePlayer,
  type GetConsumerPlayerUsageParams,
} from '@workspace/api-client-react';
import { Link, useSearchParams } from 'wouter';
import { ResponsiveContainer, LineChart, Line, XAxis, Tooltip, YAxis, CartesianGrid } from 'recharts';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, FilterX, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ConsumerLoading, ConsumerMessage, metric } from './consumer-ui';
import { defaultUsageFilters, parseUsageSearch, primaryUsage, serializeUsageSearch, sortUsagePlayers, trendLabel, usageChartData, type UsageFilters, type UsageSortColumn } from '../../lib/consumer-usage';
import { trackEvent } from '../../lib/analytics';

type SortDir = 'asc' | 'desc';
const redZoneEnabled = import.meta.env.VITE_GRIDLINE_RED_ZONE_ENABLED === '1';
const metricGroups = [
  { title: 'Passing', items: [['Attempts', 'attempts'], ['Completions', 'completions'], ['Passing yards', 'passingYards'], ['Passing TDs', 'passingTds']] },
  { title: 'Rushing', items: [['Carries', 'carries'], ['Rushing yards', 'rushingYards'], ['Yards per carry', 'yardsPerCarry']] },
  { title: 'Receiving', items: [['Targets', 'targets'], ['Target share', 'targetShare'], ['Receptions', 'receptions'], ['Receiving yards', 'receivingYards'], ['Yards per target', 'yardsPerTarget']] },
  { title: 'Situational', items: [['Snap share', 'snapShare'], ['Explosive play rate', 'explosiveRate'], ['Total TDs', 'totalTd']] },
] as const;

function MetricText({ value, percent = false }: { value?: ConsumerUsageMetric; percent?: boolean }) {
  if (!value?.available || value.value === null) return <span className="text-muted-foreground" title={value?.reason || 'Unavailable'}>—</span>;
  return <span>{metric(value.value, percent)}</span>;
}

function UsageChart({ player }: { player: ConsumerUsagePlayer }) {
  if (!player.games.length) return <p className="text-sm text-muted-foreground">No game history in this window.</p>;
  return <div className="h-56 w-full" aria-label={`Game-by-game ${player.position === 'QB' ? 'passing yards' : 'targets and carries'} chart`}>
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={usageChartData(player.games)} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--chart-grid))" />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--chart-axis))' }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--chart-axis))' }} />
        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--tooltip))', color: 'hsl(var(--tooltip-foreground))', borderColor: 'hsl(var(--border))' }} />
        {player.position === 'QB'
          ? <Line name="Pass yards" type="monotone" dataKey="passingYards" stroke="hsl(var(--primary))" strokeWidth={2} />
          : <>
            <Line name="Targets" type="monotone" dataKey="targets" stroke="hsl(var(--primary))" strokeWidth={2} />
            <Line name="Carries" type="monotone" dataKey="carries" stroke="hsl(var(--chart-2))" strokeWidth={2} />
          </>}
      </LineChart>
    </ResponsiveContainer>
  </div>;
}

function PlayerDetail({ player }: { player: ConsumerUsagePlayer }) {
  const redZone = [player.aggregate.redZoneTouches, player.aggregate.redZoneTargets];
  const redZoneAvailable = redZone.some(value => value?.available && value.value !== null);
  const reasons = [...new Set(player.sourceCoverage.partialReasons)];
  const historyKeys = player.position === 'QB'
    ? [['Attempts', 'attempts'], ['Pass yds', 'passingYards'], ['Pass TD', 'passingTds']]
    : player.position === 'RB'
      ? [['Carries', 'carries'], ['Rush yds', 'rushingYards'], ['Targets', 'targets'], ['TD', 'totalTd']]
      : [['Targets', 'targets'], ['Receptions', 'receptions'], ['Rec yds', 'receivingYards'], ['TD', 'totalTd']];
  return <>
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Game-by-game observed usage</h3>
      <UsageChart player={player} />
      {player.games.length > 0 && <div className="mt-3 border-t border-border pt-3">
        <p className="mb-2 text-xs text-muted-foreground">Recent games · unavailable values are not zeros</p>
        <ul className="space-y-2" data-testid="list-usage-game-history">{player.games.map(game => <li key={game.gameId} className="rounded-md bg-muted/40 p-2 text-xs">
          <strong className="block">Week {game.week} · {game.season}</strong>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{historyKeys.map(([label, key]) => <div key={key} className="flex gap-1"><dt className="text-muted-foreground">{label}</dt><dd className="font-mono"><MetricText value={game.metrics[key]} /></dd></div>)}</dl>
          {redZoneAvailable && (game.metrics.redZoneTouches?.available || game.metrics.redZoneTargets?.available) && <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <div className="flex gap-1"><dt>RZ touches</dt><dd className="font-mono"><MetricText value={game.metrics.redZoneTouches} /></dd></div>
            <div className="flex gap-1"><dt>RZ targets</dt><dd className="font-mono"><MetricText value={game.metrics.redZoneTargets} /></dd></div>
          </dl>}
        </li>)}</ul>
      </div>}
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      {metricGroups.map(group => <section key={group.title} className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.title}</h3>
        <dl className="divide-y divide-border/60">
          {group.items.map(([label, key]) => <div key={key} className="flex items-center justify-between gap-3 py-2 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono font-semibold"><MetricText value={player.aggregate[key]} percent={['snapShare', 'targetShare', 'explosiveRate'].includes(key)} /></dd>
          </div>)}
        </dl>
      </section>)}
    </div>
    <section className="rounded-lg border border-border bg-card p-4 text-sm">
      <h3 className="font-semibold">Red-zone evidence</h3>
      {redZoneAvailable
        ? <dl className="mt-2 grid grid-cols-2 gap-3">
          <div><dt className="text-muted-foreground">Touches</dt><dd className="font-mono"><MetricText value={player.aggregate.redZoneTouches} /></dd></div>
          <div><dt className="text-muted-foreground">Targets</dt><dd className="font-mono"><MetricText value={player.aggregate.redZoneTargets} /></dd></div>
        </dl>
        : <p className="mt-2 text-muted-foreground">Red-zone usage is unavailable from this Usage sample. A dash is not zero.</p>}
      {redZoneEnabled && <Link href="/red-zone" className="mt-3 inline-flex items-center gap-1 font-semibold text-accent underline underline-offset-2" data-testid="link-usage-red-zone">Explore verified Red Zone opportunities <ChevronRight className="h-4 w-4" /></Link>}
    </section>
    <section className="rounded-lg bg-muted/50 p-4 text-xs leading-relaxed text-muted-foreground" data-testid="status-usage-player-coverage">
      <strong className="text-foreground">Coverage · {player.sourceCoverage.includedGames}/{player.sourceCoverage.requestedGames} games</strong>
      <p className="mt-1">Volume trend: {trendLabel(player.trend)} across the selected window.</p>
      {reasons.length > 0 ? <ul className="mt-2 list-inside list-disc">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p className="mt-1">No partial-coverage reasons reported for this player.</p>}
      <p className="mt-2">Observed stats only; no touchdown forecast probabilities are shown. Unavailable metrics are not zeros.</p>
    </section>
  </>;
}

function SortHeader({ column, label, current, direction, onSort }: { column: UsageSortColumn; label: string; current: UsageSortColumn; direction: SortDir; onSort: (col: UsageSortColumn) => void }) {
  return <th scope="col" aria-sort={current === column ? direction === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
    <button type="button" className="inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground" onClick={() => onSort(column)} data-testid={`button-usage-sort-${column}`}>
      {label}{current !== column ? <ArrowUpDown className="h-3 w-3" /> : direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
    </button>
  </th>;
}

export default function ConsumerUsage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const gamesQuery = useListConsumerPlayerUsageGames({ query: { queryKey: getListConsumerPlayerUsageGamesQueryKey(), staleTime: 300_000 } });
  const requestedGame = searchParams.get('game');
  const gamePending = Boolean(requestedGame) && !gamesQuery.isSuccess && !gamesQuery.isError;
  const validGames = useMemo(() => gamesQuery.data ? new Set(gamesQuery.data.games.map(context => context.gameId)) : null, [gamesQuery.data]);
  const filters = parseUsageSearch(search, validGames);
  const { team, position, window: windowFilter, game, sort: sortCol, direction: sortDir } = filters;

  useEffect(() => {
    if (gamePending) return;
    const canonical = serializeUsageSearch(filters);
    if (search !== canonical) setSearchParams(canonical, { replace: true });
  }, [search, gamePending, filters.team, filters.position, filters.window, filters.game, filters.sort, filters.direction, setSearchParams]);

  function updateFilters(next: UsageFilters) {
    setSearchParams(serializeUsageSearch(next), { replace: true });
    setExpandedId(null);
  }
  const params: GetConsumerPlayerUsageParams = {
    ...(team ? { team } : {}),
    ...(position ? { position: position as GetConsumerPlayerUsageParams['position'] } : {}),
    ...(game ? { game } : {}),
    window: windowFilter as GetConsumerPlayerUsageParams['window'],
  };
  const query = useGetConsumerPlayerUsage(params, { query: { queryKey: getGetConsumerPlayerUsageQueryKey(params), enabled: !gamePending, staleTime: 60_000 } });
  const sortedPlayers = useMemo(() => sortUsagePlayers(query.data?.players ?? [], sortCol, sortDir), [query.data?.players, sortCol, sortDir]);
  const playerKey = (player: ConsumerUsagePlayer) => `${player.playerId}:${player.teamId}`;
  const selectedPlayer = sortedPlayers.find(player => playerKey(player) === expandedId);

  function handleSort(col: UsageSortColumn) {
    const direction: SortDir = col === sortCol && sortDir === 'desc' ? 'asc' : 'desc';
    trackEvent('usage_sort_changed', { column: col, direction });
    updateFilters({ ...filters, sort: col, direction });
  }
  function handleFilterChange(filter: 'team' | 'position' | 'window', value: string) {
    updateFilters({
      ...filters,
      ...(filter === 'team' ? { team: value } : {}),
      ...(filter === 'position' ? { position: value as UsageFilters['position'], sort: 'primaryVolume' as const, direction: 'desc' as const } : {}),
      ...(filter === 'window' ? { window: value as UsageFilters['window'] } : {}),
    });
    trackEvent('usage_filter_changed', { filter, value: value || 'all' });
  }
  function handleGameFilterChange(value: string) {
    updateFilters({ ...filters, game: value });
    trackEvent('usage_filter_changed', { filter: 'game', value: value ? 'specific_game' : 'all' });
  }
  function togglePlayer(player: ConsumerUsagePlayer, open: boolean) {
    trackEvent('usage_row_toggled', {
      action: open ? 'expand' : 'collapse',
      position: player.position ?? 'unknown',
      trend: player.trend,
      coverage: player.sourceCoverage.partialReasons.length ? 'partial' : 'complete',
      window: windowFilter,
    });
    setExpandedId(open ? playerKey(player) : null);
  }
  function handleReset() {
    trackEvent('usage_filters_reset', { had_team: Boolean(team), had_position: Boolean(position), had_game: Boolean(game.trim()), window: windowFilter });
    updateFilters(defaultUsageFilters);
  }

  return <div className="consumer-page min-w-0 max-w-full space-y-6" data-testid="page-player-usage">
    <header className="consumer-page-header">
      <div><p className="consumer-eyebrow">Player Lab</p><h1>Usage & Production</h1><p>Observed offensive roles and production from completed games, not forecasts.</p></div>
      {redZoneEnabled && <Link href="/red-zone" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-accent underline underline-offset-2" data-testid="link-usage-red-zone-overview">Explore verified Red Zone <ChevronRight className="h-4 w-4" /></Link>}
    </header>
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm" role="group" aria-label="Player usage filters">
      <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground sm:w-32">Team
          <select className="h-10 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={team} onChange={e => handleFilterChange('team', e.target.value)} data-testid="select-usage-team">
            <option value="">All teams</option>{team && !query.data?.availableTeams.some(({ abbreviation }) => abbreviation === team) && <option value={team}>{team}</option>}{query.data?.availableTeams.map(({ teamId, abbreviation }) => <option key={teamId} value={abbreviation}>{abbreviation}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground sm:w-32">Position
          <select className="h-10 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={position} onChange={e => handleFilterChange('position', e.target.value)} data-testid="select-usage-position">
            <option value="">All positions</option>{['QB', 'RB', 'WR', 'TE'].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted-foreground sm:w-44">Window
          <select className="h-10 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={windowFilter} onChange={e => handleFilterChange('window', e.target.value)} data-testid="select-usage-window">
            <option value="last3">Last 3 games</option><option value="last5">Last 5 games</option><option value="last8">Last 8 games</option><option value="season">Season to date</option>
          </select>
        </label>
        <button type="button" className="col-span-2 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-secondary px-4 text-sm font-medium text-secondary-foreground sm:ml-auto" onClick={handleReset} data-testid="button-usage-reset"><FilterX className="h-4 w-4" /> Reset</button>
      </div>
      <details className="mt-3 border-t border-border pt-2 text-sm" data-testid="disclosure-usage-context">
        <summary className="w-fit cursor-pointer font-medium text-accent focus-visible:outline focus-visible:outline-2">Game context {game ? '· selected' : '· optional'}</summary>
        <label className="mt-3 flex max-w-lg flex-col gap-1 text-xs text-muted-foreground">Use only games played before a matchup
          <select className="h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground" aria-describedby="usage-game-context-status" value={game} disabled={gamesQuery.isLoading || gamesQuery.isError || !gamesQuery.data?.games.length} onChange={e => handleGameFilterChange(e.target.value)} data-testid="select-usage-game">
            <option value="">{gamesQuery.isLoading ? 'Loading schedule…' : gamesQuery.isError ? 'Schedule unavailable' : gamesQuery.data?.games.length ? 'Current season (default)' : `No ${gamesQuery.data?.season ?? 'current-season'} games`}</option>
            {gamesQuery.data?.games.map(context => <option key={context.gameId} value={context.gameId}>{context.season} · Week {context.week} · {context.matchup.away} at {context.matchup.home}</option>)}
          </select>
        </label>
        <p id="usage-game-context-status" className="mt-2 text-xs text-muted-foreground">{gamesQuery.isLoading ? 'Loading valid game contexts.' : gamesQuery.isError ? 'Game context is unavailable; current-season usage still works.' : gamesQuery.data?.games.length ? 'Optional cutoff for games played before the selected matchup.' : `No game contexts are available for ${gamesQuery.data?.season ?? 'the current season'}.`}</p>
      </details>
    </div>
    {gamePending || query.isLoading ? <ConsumerLoading label={gamePending ? "Validating game context..." : "Analyzing usage data..."} /> : query.isError
      ? <ConsumerMessage error title="Usage data unavailable" detail="Could not load player usage for the requested filters." />
      : !query.data?.players.length
        ? <ConsumerMessage title="No players found" detail={query.data?.sourceCoverage.partialReasons.join(' · ') || 'No persisted player-game records match the current filters.'} />
        : <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm" aria-label="Participation evidence">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/20 px-4 py-3">
            <div><h2 className="font-serif text-lg">Participation Evidence</h2><p className="text-xs text-muted-foreground" data-testid="text-usage-count">{query.data.players.length} players · {query.data.season} season</p></div>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Info className="h-4 w-4" /> {query.data.sourceCoverage.includedGames}/{query.data.sourceCoverage.requestedGames} games covered</span>
          </div>
          {query.data.status === 'partial' && <p role="status" className="border-b border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-300" data-testid="status-usage-partial"><strong>Partial coverage.</strong> {query.data.sourceCoverage.partialReasons.join(' · ') || 'Some metrics are unavailable for this window.'} A dash means unavailable, not zero.</p>}
          <div className="border-b border-border px-4 py-3 text-xs text-muted-foreground">Volume is pass attempts for QBs, carries for RBs, and targets for WRs/TEs. Yards follow the same roles. TDs are observed totals.</div>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 lg:hidden">
            <label htmlFor="usage-mobile-sort" className="text-xs font-medium">Sort by</label>
            <select id="usage-mobile-sort" className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm" value={sortCol} onChange={e => handleSort(e.target.value as UsageSortColumn)} data-testid="select-usage-sort">
              <option value="primaryVolume">Volume</option><option value="primaryYards">Yards</option><option value="totalTd">TDs</option><option value="snapShare">Snap %</option><option value="trend">Trend</option><option value="name">Player</option>
            </select>
            <button type="button" aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`} onClick={() => handleSort(sortCol)} className="rounded border border-border p-2" data-testid="button-usage-sort-direction">{sortDir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}</button>
          </div>
          <div className="hidden lg:block">
            <table className="w-full text-left text-sm" data-testid="table-usage-players">
              <thead className="border-b border-border bg-muted/30"><tr>
                <SortHeader column="name" label="Player" current={sortCol} direction={sortDir} onSort={handleSort} />
                <SortHeader column="primaryVolume" label="Volume" current={sortCol} direction={sortDir} onSort={handleSort} />
                <SortHeader column="primaryYards" label="Yards" current={sortCol} direction={sortDir} onSort={handleSort} />
                <SortHeader column="totalTd" label="TDs" current={sortCol} direction={sortDir} onSort={handleSort} />
                <SortHeader column="trend" label="Trend" current={sortCol} direction={sortDir} onSort={handleSort} />
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Coverage</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Detail</th>
              </tr></thead>
              <tbody className="divide-y divide-border">{sortedPlayers.map(player => {
                const primary = primaryUsage(player);
                return <tr key={playerKey(player)} className="hover:bg-muted/30">
                  <td className="px-4 py-3"><strong>{player.playerName}</strong><span className="block text-xs text-muted-foreground">{player.teamId} · {player.position}</span></td>
                  <td className="px-4 py-3 font-mono"><MetricText value={player.aggregate[primary.volume]} /><span className="ml-1 text-xs text-muted-foreground">{primary.volumeLabel}</span></td>
                  <td className="px-4 py-3 font-mono"><MetricText value={player.aggregate[primary.yards]} /></td>
                  <td className="px-4 py-3 font-mono"><MetricText value={player.aggregate.totalTd} /></td>
                  <td className="px-4 py-3">{trendLabel(player.trend)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{player.sourceCoverage.includedGames}/{player.sourceCoverage.requestedGames}{player.sourceCoverage.partialReasons.length ? ' · partial' : ''}</td>
                  <td className="px-4 py-3"><button type="button" className="rounded-md text-accent underline underline-offset-2 focus-visible:outline focus-visible:outline-2" onClick={() => togglePlayer(player, true)} data-testid={`button-usage-detail-${playerKey(player)}`} aria-haspopup="dialog">View details</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <ul className="divide-y divide-border lg:hidden" data-testid="list-usage-players">{sortedPlayers.map(player => {
            const primary = primaryUsage(player);
            return <li key={playerKey(player)} className="p-4" data-testid={`card-usage-player-${playerKey(player)}`}>
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block break-words">{player.playerName}</strong><span className="text-xs text-muted-foreground">{player.teamId} · {player.position} · {player.sourceCoverage.includedGames}/{player.sourceCoverage.requestedGames} games{player.sourceCoverage.partialReasons.length ? ' · partial' : ''}</span></div><span className="shrink-0 text-xs text-muted-foreground">{trendLabel(player.trend)}</span></div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">{primary.volumeLabel}</dt><dd className="font-mono font-semibold"><MetricText value={player.aggregate[primary.volume]} /></dd></div><div><dt className="text-xs text-muted-foreground">Yards</dt><dd className="font-mono font-semibold"><MetricText value={player.aggregate[primary.yards]} /></dd></div><div><dt className="text-xs text-muted-foreground">TDs</dt><dd className="font-mono font-semibold"><MetricText value={player.aggregate.totalTd} /></dd></div></dl>
              <button type="button" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent underline underline-offset-2" onClick={() => togglePlayer(player, true)} data-testid={`button-usage-mobile-detail-${playerKey(player)}`} aria-haspopup="dialog">View details <ChevronRight className="h-4 w-4" /></button>
            </li>;
          })}</ul>
        </section>}
    <Dialog open={Boolean(selectedPlayer)} onOpenChange={open => { if (!open && selectedPlayer) togglePlayer(selectedPlayer, false); }}>
      {selectedPlayer && <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl gap-5" data-testid="dialog-usage-player">
        <div><DialogTitle className="pr-8 font-serif text-2xl">{selectedPlayer.playerName}</DialogTitle><DialogDescription className="mt-1">{selectedPlayer.teamId} · {selectedPlayer.position} · {trendLabel(selectedPlayer.trend)} · observed usage</DialogDescription></div>
        <PlayerDetail player={selectedPlayer} />
      </DialogContent>}
    </Dialog>
  </div>;
}