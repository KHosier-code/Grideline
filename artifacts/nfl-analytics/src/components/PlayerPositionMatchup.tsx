import { useState } from 'react';
import {
  getGetConsumerPlayerPositionMatchupQueryKey, useGetConsumerPlayerPositionMatchup,
  type GetConsumerPlayerPositionMatchupParams,
} from '@workspace/api-client-react';

type Position = 'QB' | 'RB' | 'WR' | 'TE';
type Window = 'season' | 'last3' | 'last5';
const value = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : n.toFixed(1).replace(/\.0$/, '');

export function PlayerPositionMatchup({ gameId }: { gameId: string }) {
  const [position, setPosition] = useState<Position>('TE');
  const [window, setWindow] = useState<Window>('last5');
  const [player, setPlayer] = useState('');
  const [unit, setUnit] = useState<'total' | 'perGame'>('perGame');
  const params: GetConsumerPlayerPositionMatchupParams = { game: gameId, position, window, ...(player ? { player } : {}) };
  const query = useGetConsumerPlayerPositionMatchup(params, {
    query: { queryKey: getGetConsumerPlayerPositionMatchupQueryKey(params), enabled: Boolean(gameId), staleTime: 60_000, retry: false },
  });
  const data = query.data;
  const chosen = data?.candidates.find(item => item.selectionKey === player);
  const metrics = Object.entries(data?.metrics ?? {});
  return <section className="mt-6 min-w-0 rounded-xl border border-border bg-card p-4 sm:p-6" aria-label="Player and position matchup comparison" data-testid="player-position-matchup">
    <p className="consumer-eyebrow">Observed comparison / player lens</p>
    <h3 className="font-serif text-xl">Player vs opponent position</h3>
    <p className="mt-1 text-sm text-muted-foreground">Compare a player's own prior appearances with the entire position's production against the opposing defense. The defensive figure is not an individual-player projection.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1 text-xs font-medium">Position
        <select className="h-10 rounded-md border border-input bg-background px-2 text-sm" value={position} onChange={e => { setPosition(e.target.value as Position); setPlayer(''); }} data-testid="select-matchup-position">
          {(['QB', 'RB', 'WR', 'TE'] as const).map(p => <option key={p}>{p}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">Observed player (not confirmed active)
        <select className="h-10 min-w-0 rounded-md border border-input bg-background px-2 text-sm" value={chosen ? player : ''} onChange={e => setPlayer(e.target.value)} disabled={!data?.candidates.length} data-testid="select-matchup-player">
          <option value="">Choose a player</option>
          {data?.candidates.map(p => <option key={p.selectionKey} value={p.selectionKey}>{p.playerName} · {p.team} vs {p.opponent}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">Prior team-game window
        <select className="h-10 rounded-md border border-input bg-background px-2 text-sm" value={window} onChange={e => setWindow(e.target.value as Window)} data-testid="select-matchup-window">
          <option value="last3">Last 3</option><option value="last5">Last 5</option><option value="season">Season</option>
        </select>
      </label>
      <div className="flex flex-col gap-1 text-xs font-medium">Display
        <div role="group" aria-label="Observed measure" className="flex h-10 overflow-hidden rounded-md border border-input">
          {(['perGame', 'total'] as const).map(mode => <button type="button" key={mode} onClick={() => setUnit(mode)} aria-pressed={unit === mode} className={`flex-1 px-2 text-sm ${unit === mode ? 'bg-primary text-primary-foreground' : 'bg-background'}`} data-testid={`button-matchup-${mode}`}>{mode === 'total' ? 'Totals' : 'Per game'}</button>)}
        </div>
      </div>
    </div>
    {query.isLoading ? <p role="status" className="mt-5 text-sm">Loading player and defensive history…</p>
      : query.isError ? <div role="alert" className="mt-5 text-sm">Matchup data unavailable. <button type="button" className="underline" onClick={() => query.refetch()}>Retry</button></div>
        : !data?.candidates.length ? <p className="mt-5 text-sm text-muted-foreground">No verified prior {position} appearances for either offense in this season.</p>
          : !data.selected ? <p className="mt-5 text-sm text-muted-foreground">Choose a player to see the comparison. Prior appearances do not establish current roster status or availability.</p>
            : <div className="mt-5 space-y-5">
              <p className="text-sm"><strong>{data.selected.playerName}</strong> · {data.selected.team} vs {data.selected.opponent} defense · {data.season} regular season · {data.window} · cutoff {new Date(data.cutoff).toLocaleString()}</p>
              <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm">
                <thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="py-2">Measure</th><th>Player / appearances</th><th>{data.selected.opponent} vs all {position}s / covered defensive games</th></tr></thead>
                <tbody>{metrics.map(([key, item]) => <tr key={key} className="border-b border-border/60 align-top">
                  <th scope="row" className="py-3 font-medium">{item.label}</th>
                  <td className="py-3"><strong>{value(item.player[unit])}</strong><small className="block text-muted-foreground">{item.player.coveredGames}/{item.player.requestedGames} team games · weeks {item.player.coveredWeeks.join(', ') || 'none'}</small>{item.player.missingWeeks.length > 0 && <small className="block text-amber-600">Missing weeks: {item.player.missingWeeks.join(', ')}</small>}{item.player.reason && <small className="block">{item.player.reason}</small>}</td>
                  <td className="py-3"><strong>{value(item.defense?.[unit])}</strong><small className="block text-muted-foreground">{item.defense?.coveredGames ?? 0}/{item.defense?.completedGames ?? 0} defensive games · weeks {item.defense?.coveredWeeks.join(', ') || 'none'}</small>{item.defense?.missingWeeks.length ? <small className="block text-amber-600">Missing weeks: {item.defense.missingWeeks.join(', ')}</small> : null}{item.defense?.reason && <small className="block">{item.defense.reason}</small>}</td>
                </tr>)}</tbody>
              </table></div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg bg-muted/40 p-4" data-testid="matchup-score">
                  <h4 className="font-semibold">Descriptive matchup index {data.score.value === null ? '— unavailable' : `${data.score.value}/100`}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">{data.score.version} · {data.score.direction}</p>
                  <p className="mt-2 text-xs">Inputs: {String(data.score.ingredients.roleMetric)} {value(data.score.ingredients.rolePerAppearance as number | null)} / appearance; {String(data.score.ingredients.yardMetric)} {value(data.score.ingredients.yardsPerAppearance as number | null)} / appearance; opponent position yards {value(data.score.ingredients.opponentPositionYardsPerGame as number | null)} / covered game. Defense adjustment {data.score.ingredients.defenseAdjustment == null ? '—' : `${value((data.score.ingredients.defenseAdjustment as number) * 100)}%`} (shrunk and capped). {String(data.score.ingredients.playerAppearances)} player appearances, {String(data.score.ingredients.defenseGames)} defensive games.</p>
                  {data.score.reason && <p className="mt-2 text-xs">{data.score.reason}</p>}
                </div>
                <div className="rounded-lg border border-border p-4" data-testid="matchup-projections">
                  <h4 className="font-semibold">Pregame projections</h4>
                  <p className="mt-1 text-xs text-muted-foreground">Not the observed totals or the descriptive index. No unqualified model output is substituted.</p>
                  {Object.entries(data.projections).filter(([key]) => key === 'targets' || key === 'passingYards' || key === 'rushingYards' || key === 'receivingYards' || key === 'scoringTdProbability').map(([key, projection]) => <p key={key} className="mt-2 text-xs"><strong>{key === 'scoringTdProbability' ? 'At least one rushing/receiving TD probability' : key.replace(/([A-Z])/g, ' $1')}</strong>: {projection.value === null ? 'Unavailable' : projection.kind === 'probability' ? `${value(projection.value * 100)}%` : value(projection.value)}. {projection.reason} {projection.modelVersion && `Model: ${projection.modelVersion}; pregame cutoff: ${projection.cutoffAt}; quality: ${projection.quality}.`} {projection.recentAverage != null && `Recent observed average: ${value(projection.recentAverage)}.`} {projection.leaguePositionBaseline != null && `League position baseline: ${value(projection.leaguePositionBaseline)}.`}</p>)}
                  <p className="mt-2 text-xs">Passing TD counts are separate from rushing/receiving scoring probability; no expected TD count is implied.</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{data.note} Source: {data.source}. Source publication: {data.sourceUpdatedAt ?? 'not archived'}; imported: {data.ingestedAt ?? 'not recorded'}.</p>
            </div>}
  </section>;
}