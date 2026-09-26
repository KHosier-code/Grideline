import { useMemo, useState } from 'react';
import { getGetConsumerRedZoneOpportunitiesQueryKey, getListConsumerPlayerUsageGamesQueryKey, useGetConsumerRedZoneOpportunities, useListConsumerPlayerUsageGames, type GetConsumerRedZoneOpportunitiesParams } from '@workspace/api-client-react';
import { ArrowDown, ArrowUp, ArrowUpDown, RotateCcw, Target } from 'lucide-react';
import { ConsumerMessage } from './consumer-ui';
import { formatRedZoneValue, normalizeRedZoneResponse, readableTime, scheduleTeamAbbreviation, sortRedZonePlayers, type RedZonePeriod, type RedZoneStat, type RedZoneZone } from '../../lib/consumer-red-zone';

type SortColumn = RedZoneStat | 'playerName' | 'gamesPlayed';
const columns: { key: SortColumn; label: string; percent?: boolean }[] = [
  { key: 'playerName', label: 'Player' },
  { key: 'gamesPlayed', label: 'Games' },
  { key: 'targets', label: 'Targets' },
  { key: 'carries', label: 'Carries' },
  { key: 'targetShare', label: 'Target share', percent: true },
  { key: 'carryShare', label: 'Carry share', percent: true },
  { key: 'receivingTds', label: 'Rec TD' },
  { key: 'rushingTds', label: 'Rush TD' },
  { key: 'snaps', label: 'Snaps' },
  { key: 'snapPct', label: 'Snap %', percent: true },
];
const zoneLabels: Record<RedZoneZone, string> = { 20: 'Inside 20', 10: 'Inside 10', 5: 'Inside 5' };

export default function ConsumerRedZone() {
  const [season, setSeason] = useState<number | undefined>();
  const [team, setTeam] = useState('');
  const [position, setPosition] = useState('');
  const [zone, setZone] = useState<RedZoneZone>(20);
  const [period, setPeriod] = useState<RedZonePeriod>('season');
  const [sortColumn, setSortColumn] = useState<SortColumn>('targets');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const params: GetConsumerRedZoneOpportunitiesParams = { ...(season !== undefined ? { season } : {}), ...(team ? { team } : {}), ...(position ? { position: position as GetConsumerRedZoneOpportunitiesParams['position'] } : {}), zone, period };
  const query = useGetConsumerRedZoneOpportunities(params, { query: { queryKey: getGetConsumerRedZoneOpportunitiesQueryKey(params), staleTime: 60_000 } });
  const schedule = useListConsumerPlayerUsageGames({ query: { queryKey: getListConsumerPlayerUsageGamesQueryKey(), staleTime: 300_000 } });
  const data = useMemo(() => normalizeRedZoneResponse(query.data, period, zone), [query.data, period, zone]);
  const players = useMemo(() => sortRedZonePlayers(data.players, period, sortColumn, sortDirection), [data.players, period, sortColumn, sortDirection]);
  const currentSeason = data.season ?? schedule.data?.season;
  const seasons = Array.from(new Set([...(data.availableSeasons), ...(currentSeason !== undefined && currentSeason !== null ? Array.from({ length: 5 }, (_, index) => currentSeason - index) : []), ...(season !== undefined ? [season] : [])])).sort((a, b) => b - a);
  const teams = Array.from(new Set([...data.availableTeams, ...(schedule.data?.games ?? []).flatMap(game => [scheduleTeamAbbreviation(game.matchup.home), scheduleTeamAbbreviation(game.matchup.away)]), ...data.players.map(player => player.team), ...(team ? [team] : [])])).filter((value): value is string => Boolean(value)).sort();
  const reset = () => { setSeason(undefined); setTeam(''); setPosition(''); setZone(20); setPeriod('season'); setSortColumn('targets'); setSortDirection('desc'); };
  function sort(column: SortColumn) {
    if (column === sortColumn) setSortDirection(current => current === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(column); setSortDirection(column === 'playerName' ? 'asc' : 'desc'); }
  }

  return <div className="consumer-page rz-page" data-testid="red-zone-page">
    <header className="rz-intro">
      <div>
        <p className="consumer-eyebrow">Player lab / field position</p>
        <h1>Red Zone<br />Opportunity</h1>
        <p>Who gets the ball when the field gets short. Actual targets, carries and touchdowns from completed games, not projected volume.</p>
      </div>
      <div className="rz-intro-aside"><strong>How to read the zones</strong>Inside 5 is also inside 10 and inside 20. These are overlapping field-position cutoffs, not additive buckets.</div>
    </header>

    <div className="rz-controls" role="group" aria-label="Red zone filters">
      <label>Season<select data-testid="select-red-zone-season" value={season ?? ''} onChange={event => setSeason(event.target.value ? Number(event.target.value) : undefined)}><option value="">Current ({currentSeason ?? 'season'})</option>{seasons.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      <label>Team<select data-testid="select-red-zone-team" value={team} onChange={event => setTeam(event.target.value)}><option value="">All teams</option>{teams.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Position<select data-testid="select-red-zone-position" value={position} onChange={event => setPosition(event.target.value)}><option value="">All positions</option>{['QB', 'RB', 'WR', 'TE'].map(value => <option value={value} key={value}>{value}</option>)}</select></label>
      <label>Field position<select data-testid="select-red-zone-zone" value={zone} onChange={event => setZone(Number(event.target.value) as RedZoneZone)}>{([20, 10, 5] as RedZoneZone[]).map(value => <option key={value} value={value}>{zoneLabels[value]} (inclusive)</option>)}</select></label>
      <label>Sample period<select data-testid="select-red-zone-period" value={period} onChange={event => setPeriod(event.target.value as RedZonePeriod)}><option value="season">Season to date</option><option value="last3">Last 3 completed appearances</option></select></label>
      <button className="rz-reset" type="button" onClick={reset} data-testid="button-red-zone-reset"><RotateCcw className="inline h-3.5 w-3.5 mr-1" /> Reset</button>
    </div>

    <div className="rz-status" role="status" data-testid="status-red-zone-source">
      <span><strong>{query.isLoading ? 'Loading source evidence' : data.season ?? 'Current season'} · {zoneLabels[zone]}</strong> · {period === 'season' ? 'Season to date' : 'Last 3 completed appearances'}{!query.isLoading && ` · ${data.status}`}</span>
      {!query.isLoading && <span>Source updated {readableTime(data.sourceUpdatedAt)} · Ingested {readableTime(data.ingestedAt)}</span>}
    </div>

    {query.isLoading ? <div className="rz-ledger" aria-label="Loading opportunities"><div className="rz-ledger-head"><div className="skeleton h-6 w-44" /></div>{[1, 2, 3, 4].map(index => <div className="border-b border-border p-5 flex gap-5" key={index}><div className="skeleton h-5 w-40" /><div className="skeleton h-5 flex-1" /></div>)}</div>
      : query.isError ? <div><ConsumerMessage error title="Opportunity data unavailable" detail="The source-backed red zone ledger could not be loaded." /><button className="rz-reset mt-3" type="button" onClick={() => query.refetch()} data-testid="button-red-zone-retry">Try again</button></div>
      : <>
        {(data.status === 'partial' || data.status === 'unavailable' || data.partialReasons.length > 0 || data.players.some(player => player[period].status !== 'available')) && <div className="rz-warning" role="status" data-testid="status-red-zone-coverage"><strong>{data.status === 'unavailable' ? 'Unavailable coverage' : 'Limited coverage'}</strong> · {data.partialReasons.length ? data.partialReasons.join(' · ') : 'Some player appearances lack verified play-by-play. See each row’s source sample; missing values are not zeros.'}</div>}
        {players.length === 0 ? <div className="consumer-state" data-testid="empty-red-zone"><Target className="h-6 w-6 text-accent" /><h2>No verified opportunities in this view</h2><p>Try another team, position, season or zone. No missing play is counted as zero.</p></div>
          : <section className="rz-ledger" aria-labelledby="rz-ledger-title">
            <div className="rz-ledger-head"><h2 id="rz-ledger-title">Opportunity ledger</h2><span data-testid="text-red-zone-count">{players.length} players · {period === 'last3' ? 'up to 3 completed appearances' : 'completed games'}</span></div>
            <div className="rz-table-scroll" role="region" aria-label="Scrollable red zone opportunities" tabIndex={0}>
              <table className="rz-table"><caption className="sr-only">{zoneLabels[zone]} inclusive opportunity totals for {period === 'season' ? 'the season' : 'the last three completed appearances'}</caption>
                <thead><tr>{columns.map(column => <th key={column.key} scope="col" aria-sort={sortColumn === column.key ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="rz-sort" type="button" onClick={() => sort(column.key)} data-testid={`button-red-zone-sort-${column.key}`}>{column.label}{sortColumn === column.key ? sortDirection === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" /> : <ArrowUpDown aria-hidden="true" />}</button></th>)}</tr></thead>
                <tbody>{players.map((player, index) => { const window = player[period]; return <tr key={`${player.playerId}:${player.team}:${index}`} data-testid={`row-red-zone-${index}`}>
                  <td><span className="rz-player-name">{player.playerName}</span><span className="rz-player-meta">{player.team} · {player.position}{window.status !== 'available' ? ` · ${window.status}` : ''}</span></td>
                  {columns.slice(1).map(column => { const value = column.key === 'gamesPlayed' ? window.gamesPlayed : window.stats[column.key as RedZoneStat]; return <td key={column.key} className={value === null ? 'rz-value-muted' : column.key === 'targets' ? 'rz-primary-value' : ''} title={value === null ? window.reason ?? 'Unavailable from source' : undefined} data-testid={`text-red-zone-${column.key}-${index}`}>{formatRedZoneValue(value, column.percent)}{column.key === 'gamesPlayed' && window.sampleGames !== null && window.includedGames !== null ? <span className="rz-value-muted" title="Sourced appearances / requested appearances"> · {window.includedGames}/{window.sampleGames} source</span> : null}{column.key === 'snaps' && window.snapGames !== null && window.gamesPlayed !== null ? <span className="rz-value-muted" title="Verified snap games / player appearances"> ({window.snapGames}/{window.gamesPlayed})</span> : null}</td>; })}
                </tr>; })}</tbody>
              </table>
            </div>
            <div className="rz-legend"><strong>Games</strong> = player completed appearances; source sample = included / requested appearances. <strong>Shares</strong> are percentages of team opportunities in the selected zone. Snaps and snap % appear only when independently verified; snap coverage can be smaller than appearance coverage. A dash means unavailable, not zero. TD columns distinguish receiving from rushing. Players changing teams have separate rows.</div>
          </section>}
      </>}
  </div>;
}