import { useState } from 'react';
import { getGetInitialLineAuditQueryKey, useGetDashboardSummary, useGetInitialLineAudit } from '@workspace/api-client-react';
import { Link } from 'wouter';

function timestamp(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' }) : 'Not recorded';
}

const labels: Record<string, string> = {
  awaiting_first_observation: 'Not observed',
  locked: 'Locked',
  no_line: 'No qualifying line',
  incomplete_market: 'Incomplete market',
  missing_input: 'Missing model input',
  invalid_model: 'Invalid model',
  legacy_unattributed: 'Historical, unattributed',
};

export default function InitialLineAudit() {
  const summary = useGetDashboardSummary();
  const [chosenSeason, setChosenSeason] = useState<number | null>(null);
  const [chosenWeek, setChosenWeek] = useState<number | null>(null);
  const season = chosenSeason ?? summary.data?.season ?? new Date().getFullYear();
  const week = chosenWeek ?? summary.data?.currentWeek ?? 1;
  const audit = useGetInitialLineAudit({ season, week }, { query: { queryKey: getGetInitialLineAuditQueryKey({ season, week }), staleTime: 30_000 } });
  const data = audit.data;

  return <div className="space-y-5">
    <header>
      <p className="eyebrow">Market evidence / Administrator review</p>
      <h1 className="text-2xl font-semibold text-ink">First-line pick audit</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        These are Gridline’s first observed, request-bound lines, not the sportsbook’s market opener.
        A first-line outcome is immutable; it is separate from the near-kickoff evaluation freeze.
        Later odds and models cannot fill an unavailable first observation.
      </p>
    </header>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-medium">Season
        <select aria-label="Audit season" className="week-select ml-2" value={season} onChange={e => setChosenSeason(Number(e.target.value))}>
          {Array.from({ length: Math.max(1, Math.max(season, summary.data?.season ?? new Date().getFullYear()) - 2019) }, (_, i) => Math.max(season, summary.data?.season ?? new Date().getFullYear()) - i).map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">Week
        <select aria-label="Audit week" className="week-select ml-2" value={week} onChange={e => setChosenWeek(Number(e.target.value))}>
          {Array.from({ length: 22 }, (_, i) => i + 1).map(value => <option key={value} value={value}>{value <= 18 ? `Week ${value}` : `Postseason ${value - 18}`}</option>)}
        </select>
      </label>
      <button type="button" className="button button-subtle" onClick={() => audit.refetch()} disabled={audit.isFetching}>Refresh evidence</button>
    </div>
    {audit.isPending ? <p role="status">Loading saved first-line evidence…</p>
      : audit.isError ? <p role="alert" className="text-red-600">First-line evidence could not be loaded. Try refreshing.</p>
      : data && <>
        <div className="rounded-lg border border-border p-4">
          <p className="eyebrow">Saved weekly selection</p>
          {data.selection ? <p className="mt-1 text-sm">Game <strong>{data.selection.gameId}</strong> · saved {timestamp(data.selection.selectedAt)}. This choice is not recomputed from later lines.</p>
            : <p className="mt-1 text-sm text-muted-foreground">No official weekly selection was saved for this slate.</p>}
        </div>
        {data.games.length === 0 ? <p className="rounded-lg border border-border p-5 text-sm">No scheduled games are stored for this season and week.</p>
          : <div className="space-y-3">{data.games.map(game => <section key={game.gameId} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-ink">{game.awayTeam} at {game.homeTeam} {game.selected && <span className="ml-2 text-xs text-accent">Official weekly selection</span>}</h2>
                <p className="text-xs text-muted-foreground">Kickoff {timestamp(game.kickoffTime)} · <Link href={`/admin/games/${game.gameId}`} className="underline">Game detail</Link></p>
              </div>
              <strong className="text-sm">{labels[game.status] ?? game.status}</strong>
            </div>
            {game.firstRequest ? <p className="mt-3 text-sm">First observed request <strong>#{game.firstRequest.id}</strong> ({game.firstRequest.status}) · requested {timestamp(game.firstRequest.requestedAt)} · observed {timestamp(game.firstRequest.observedAt)}</p>
              : <p className="mt-3 text-sm">First observed request: none recorded.</p>}
            {game.reason && <p className="mt-2 text-sm text-muted-foreground">{game.reason}</p>}
            {game.status === 'locked' && <div className="mt-3">
              <p className="text-sm font-medium">Locked winner: {game.winner} · {game.winnerProbability == null ? 'Probability unavailable' : `${(game.winnerProbability * 100).toFixed(1)}%`} · {game.sportsbook}</p>
              <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[580px] text-left text-xs">
                <thead><tr className="border-b border-border"><th className="py-2">Market</th><th>Side</th><th>Point</th><th>American price</th><th>Source timestamp</th></tr></thead>
                <tbody>{game.quotes?.map((quote, index) => <tr key={`${quote.market}-${quote.selection}-${index}`} className="border-b border-border">
                  <td className="py-2">{quote.market}</td><td>{quote.selection}</td><td>{quote.point ?? '—'}</td><td>{quote.price > 0 ? '+' : ''}{quote.price}</td><td>{timestamp(quote.sourceTimestamp)}</td>
                </tr>)}</tbody>
              </table></div>
            </div>}
          </section>)}</div>}
      </>}
  </div>;
}