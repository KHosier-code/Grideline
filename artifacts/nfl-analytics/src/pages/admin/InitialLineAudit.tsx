import { useState } from 'react';
import { getGetInitialLineAuditQueryKey, getGetRetrospectiveWeeklyReviewQueryKey, useGetDashboardSummary, useGetInitialLineAudit, useGetRetrospectiveWeeklyReview, useRecordRetrospectiveWeeklyReview } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();
  const summary = useGetDashboardSummary();
  const [chosenSeason, setChosenSeason] = useState<number | null>(null);
  const [chosenWeek, setChosenWeek] = useState<number | null>(null);
  const season = chosenSeason ?? summary.data?.season ?? new Date().getFullYear();
  const week = chosenWeek ?? summary.data?.currentWeek ?? 1;
  const audit = useGetInitialLineAudit({ season, week }, { query: { queryKey: getGetInitialLineAuditQueryKey({ season, week }), staleTime: 30_000 } });
  const inScope = season === 2026 && week >= 1 && week <= 3;
  const review = useGetRetrospectiveWeeklyReview({ season: 2026, week }, { query: {
    enabled: inScope, queryKey: getGetRetrospectiveWeeklyReviewQueryKey({ season: 2026, week }), staleTime: 0,
  } });
  const record = useRecordRetrospectiveWeeklyReview();
  const [confirmed, setConfirmed] = useState(false);
  const submitReview = async () => {
    if (!confirmed || !review.data) return;
    try {
      await record.mutateAsync({
        data: {
          season: 2026, week, evidenceId: review.data.candidate?.evidenceId ?? null,
          confirm: 'I confirm this is retrospective, not an official first-line pick',
        },
      });
      setConfirmed(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetRetrospectiveWeeklyReviewQueryKey({ season: 2026, week }) }),
        queryClient.invalidateQueries({ queryKey: ['getConsumerWeeklyPicks'] }),
      ]);
    } catch { /* the mutation error is shown below */ }
  };
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
    {inScope && <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h2 className="font-semibold">2026 retrospective algorithm review · Week {week}</h2>
      <p className="text-sm">This is not a pick locked at the first-line cutoff. A saved result is never backdated or included in official statistics.</p>
      {review.isPending ? <p role="status">Checking saved evidence…</p>
        : review.isError ? <p role="alert">Retrospective evidence could not be checked.</p>
        : review.data && <>
          {review.data.officialExists && <p className="text-sm">A separate official selection also exists for this week.</p>}
          {review.data.candidate ? <p className="text-sm">Verified algorithmic candidate: <strong>{review.data.candidate.teamName}</strong> · {review.data.candidate.matchup} · cutoff {timestamp(review.data.candidate.cutoffAt)} · evidence {review.data.candidate.evidenceId}</p>
            : <p className="text-sm" role="status">Choice unavailable: {review.data.reason}</p>}
          {review.data.review ? <p className="text-sm">Immutable review: {review.data.review.status} · reviewed {timestamp(review.data.review.reviewedAt)}{review.data.review.publishedAt && <> · published {timestamp(review.data.review.publishedAt)}</>}</p>
            : <>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I confirm this is retrospective, not an official first-line pick.</label>
              <button type="button" className="button button-subtle" disabled={!confirmed || record.isPending || (week === 3 && !review.data.candidate)}
                onClick={submitReview}>{week === 3 ? 'Manually publish Week 3 retrospective choice' : review.data.candidate ? 'Record retrospective algorithm review' : 'Record unavailable retrospective review'}</button>
              {week === 3 && !review.data.candidate && <p className="text-sm">Publication blocked until complete cutoff-safe evidence verifies.</p>}
              {record.isError && <p role="alert" className="text-red-600">{record.error instanceof Error ? record.error.message : 'Review could not be recorded. Refresh evidence.'}</p>}
            </>}
        </>}
    </section>}
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