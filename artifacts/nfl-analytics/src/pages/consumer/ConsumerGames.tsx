import {
  getListConsumerGamesQueryKey,
  getGetConsumerScheduleSelectionQueryKey,
  useListConsumerGames,
  useGetConsumerScheduleSelection,
  type ConsumerGame,
  type ConsumerMarketQuote,
} from '@workspace/api-client-react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Link } from 'wouter';
import { ConsumerLoading, ConsumerMessage, SaveGameButton, formatKickoff, formatQuote, useConsumerNow } from './consumer-ui';
import { ConsumerMarketComparisonCell } from '../../components/ConsumerMarketComparison';
import { MarketConfidenceSummary } from '../../components/MarketConfidence';
import { ConsumerSourceHealth } from '../../components/ConsumerSourceHealth';
import { eligibleMarkets, marketBlocker, officialResult, readSlate, type Slate } from '../../lib/consumer-board';

function EvidenceQuote({
  label,
  quote,
  market,
}: {
  label: string;
  quote: ConsumerMarketQuote | null;
  market: 'spread' | 'total' | 'moneyline';
}) {
  return (
    <div className="quote-line">
      <span className="quote-label">{label}</span>
      <span className="quote-val">{quote ? formatQuote(quote, market) : 'No market'}</span>
      <time className="quote-time" dateTime={quote?.capturedAt ?? undefined}>
        {quote?.capturedAt ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(quote.capturedAt)) : '—'}
      </time>
    </div>
  );
}

function GameRow({ game, season, week }: { game: ConsumerGame; season: number; week: number }) {
  const [expanded, setExpanded] = useState(false);
  const now = useConsumerNow();
  const evidenceId = useId();
  const final = officialResult(game);
  const prediction = game.prediction;
  const eligible = eligibleMarkets(game, now);
  const blocked = game.marketBoard.comparisons.filter((item) => !eligible.includes(item))
    .map((item) => `${item.market}: ${marketBlocker(game, item, now)}`);
  const blockers = blocked.map((item) => item.split(': ').slice(1).join(': '));
  const blockerSummary = blockers.length && blockers.every((reason) => reason === blockers[0])
    ? blockers[0] : blocked.join(' · ');
  const score = (value: number | null | undefined) => value == null ? '—' : value.toFixed(1);

  return (
    <article className="tb-row board-game" aria-label={`${game.matchup.away.abbreviation} at ${game.matchup.home.abbreviation}`}>
      <div className="tb-row-main">
        <div className="tb-cell tc-matchup">
          <div className="tc-time">
            <span>{formatKickoff(game.kickoffTime)}</span>
            <span>Official status: <b className={`market-state market-state-${game.gameState}`}>{game.gameState}</b></span>
          </div>
          <div className="tc-team"><strong>{game.matchup.away.abbreviation}</strong><span>{game.matchup.away.name}</span>{final && <b>{final.away}</b>}</div>
          <div className="tc-team"><strong>{game.matchup.home.abbreviation}</strong><span>{game.matchup.home.name}</span>{final && <b>{final.home}</b>}</div>
          {final && <small className="board-result">Official final result: {game.matchup.away.abbreviation} {final.away} – {game.matchup.home.abbreviation} {final.home}</small>}
          <p className="board-projection"><strong>Saved Gridline projection:</strong> {prediction
            ? prediction.projectedAwayScore == null || prediction.projectedHomeScore == null
              ? `${score(prediction.projectedMargin)} margin · ${score(prediction.projectedTotal)} total (scores unavailable)`
              : `${game.matchup.away.abbreviation} ${score(prediction.projectedAwayScore)} – ${game.matchup.home.abbreviation} ${score(prediction.projectedHomeScore)}`
             : game.availability.prediction ?? 'No eligible saved prediction returned.'}</p>
          {prediction && <small className="board-result">{prediction.officialFinalPrediction
            ? 'Verified official pregame prediction · frozen before kickoff'
            : 'Saved model projection · not a verified official pregame prediction'}</small>}
        </div>
        <div className="board-market-summary">
          <strong>Eligible comparisons: {eligible.length ? eligible.map((item) => item.market).join(', ') : 'None'}</strong>
          {blocked.length > 0 && <p>Not eligible · {blockerSummary}</p>}
          <small>Informational comparisons only.</small>
        </div>
        <div className="tc-action">
          <SaveGameButton gameId={game.gameId} />
          <button
            type="button"
            className="btn-icon evidence-toggle"
            aria-expanded={expanded}
            aria-controls={evidenceId}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown aria-hidden="true" className={expanded ? 'is-open' : ''} />
            <span className="sr-only">{expanded ? 'Hide' : 'Show'} evidence for {game.matchup.away.abbreviation} at {game.matchup.home.abbreviation}</span>
          </button>
          <Link href={`/games/${game.gameId}?season=${season}&week=${week}`} className="btn-icon" aria-label={`Open ${game.matchup.away.abbreviation} at ${game.matchup.home.abbreviation} details`}>
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
      </div>
      {expanded && (
        <div className="tb-evidence" id={evidenceId}>
           <p className="consumer-note">{game.recommendation.reason ?? 'Only complete, fresh comparisons before kickoff are eligible.'}</p>
          <MarketConfidenceSummary value={game} />
          <div className="evidence-summary">
            <strong>Comparison evidence</strong>
            <span>{game.dataConfidence.label} data confidence</span>
            <span>{game.marketBoard.selectionRule}</span>
          </div>
          {game.marketBoard.comparisons.map((comparison) => (
            <section className="ev-block" key={comparison.market}>
               <ConsumerMarketComparisonCell comparison={comparison} eligible={eligible.includes(comparison)} />
               {!eligible.includes(comparison) && <p>Not eligible: {marketBlocker(game, comparison, now)}. Values below are evidence only, not current comparisons.</p>}
               <strong>{comparison.label} · {comparison.state}</strong>
               <p>Saved model: {comparison.modelValue === null ? 'Unavailable' : comparison.modelValue} · Selected market: {comparison.marketValue === null ? 'Unavailable' : comparison.marketValue} · {comparison.freshnessLabel}</p>
               <p>Selected book: {comparison.selectedQuote ? formatQuote(comparison.selectedQuote, comparison.market) : 'Unavailable'}</p>
              <EvidenceQuote label="First observed by Gridline" quote={comparison.firstObserved} market={comparison.market} />
              <EvidenceQuote label="Current" quote={comparison.current} market={comparison.market} />
              <p className="timestamp-pair">
                <span>Model timestamp: {comparison.modelTimestamp ? new Date(comparison.modelTimestamp).toLocaleString() : 'Unavailable'}</span>
                <span>Market timestamp: {comparison.marketTimestamp ? new Date(comparison.marketTimestamp).toLocaleString() : 'Unavailable'}</span>
              </p>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

export default function ConsumerGames() {
  const [selection, setSelection] = useState<Slate | null>(() => readSlate(window.location.search));
  const [manual, setManual] = useState(() => readSlate(window.location.search) !== null);
  const schedule = useGetConsumerScheduleSelection({ query: { queryKey: getGetConsumerScheduleSelectionQueryKey(), staleTime: 60_000, refetchOnWindowFocus: true } });
  const resolved = manual ? selection : schedule.data?.selection ?? null;
  const season = resolved?.season;
  const week = resolved?.week;
  useEffect(() => {
    if (!resolved || !manual) return;
    const search = new URLSearchParams({ season: String(resolved.season), week: String(resolved.week) });
    window.history.replaceState(window.history.state, '', `/games?${search.toString()}`);
  }, [manual, resolved?.season, resolved?.week]);
  useEffect(() => {
    const onPop = () => { const next = readSlate(window.location.search); setSelection(next); setManual(next !== null); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const choose = (next: Slate) => { setSelection(next); setManual(true); };
  const params = { season: season ?? 2020, week: week ?? 1 };
  const query = useListConsumerGames(params, { query: { queryKey: getListConsumerGamesQueryKey(params), enabled: Boolean(resolved), staleTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: true } });
  const recordsHaveResults = query.data?.teamRecords.some((record) => record.games > 0);

  return (
    <div className="terminal-page">
      <header className="terminal-header">
        <div><p className="consumer-eyebrow">Weekly comparison</p><h1 className="terminal-title">Gridline market board</h1><p className="terminal-desc">Persisted model projections compared with valid DraftKings and FanDuel evidence. Differences are informational.</p></div>
        <div className="terminal-controls">
          <label className="terminal-select">Season<input aria-label="Season" type="number" min="2020" value={season ?? ''} onChange={(event) => { const value = Number(event.target.value); if (value >= 2020) choose({ season: value, week: week ?? 1 }); }} /></label>
          <label className="terminal-select">Week<select aria-label="Week" value={week ?? ''} onChange={(event) => choose({ season: season ?? 2020, week: Number(event.target.value) })} disabled={!resolved}><option value="" disabled>Choose week</option>{Array.from({ length: 22 }, (_, index) => <option key={index + 1} value={index + 1}>{index < 18 ? `Week ${index + 1}` : `Postseason ${index - 17}`}</option>)}</select></label>
        </div>
      </header>
      {!manual && schedule.data?.reason === 'past' && <p className="board-slate-note">Past slate · No upcoming games in the persisted schedule. Showing the most recent scheduled week.</p>}
      {!manual && schedule.data?.reason === 'live' && <p className="board-slate-note">Live slate selected from the persisted schedule.</p>}
      {!manual && schedule.data?.reason === 'upcoming' && <p className="board-slate-note">Next upcoming slate selected from the persisted schedule.</p>}
      {schedule.isError && !manual && <ConsumerMessage error title="Schedule selection unavailable" detail="We couldn’t read persisted schedule evidence. Select a season and week to browse history." />}
      {!resolved && !schedule.isError && !schedule.isLoading && <ConsumerMessage title="No persisted schedule" detail="There is no dated schedule evidence to select a current week. Enter a season and week to browse manually." />}
      {query.data && !query.isError && <ConsumerSourceHealth health={query.data.sourceHealth} compact />}

      {query.data && !query.isError && (
        <section className="terminal-summary-bar" aria-label="Board coverage">
          <div className="ts-stat"><span>Board status</span><strong className={`market-state market-state-${query.data.status}`}>{query.data.status}</strong></div>
          <div className="ts-stat"><span>Games compared</span><strong>{query.data.coverage.gamesWithComparison} / {query.data.coverage.games}</strong></div>
        </section>
      )}
      {query.data && <details className="board-disclosure board-records">
        <summary>Team records · {!query.data.teamRecords.length ? 'No record evidence' : !recordsHaveResults ? 'No prior results to verify' : query.data.recordVerification.complete ? 'Verified' : 'Verification incomplete — view warnings'}</summary>
        {!query.data.teamRecords.length && <p>No team records are available for this selection; none are verified.</p>}
        {query.data.teamRecords.length > 0 && !recordsHaveResults && <p>No completed prior games have contributed to these records. Zeroes are not proof of verified results.</p>}
        {!query.data.recordVerification.complete && <div role="status"><strong>Records are not fully verified.</strong><ul>{query.data.recordVerification.discrepancies.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
        <div className="board-record-grid">{query.data.teamRecords.map((record) => <div key={record.teamId}>{record.abbreviation}: {record.games ? `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ''}` : 'No verified record'}</div>)}</div>
      </details>}

       {!resolved ? schedule.isLoading && <ConsumerLoading label="Finding a scheduled slate…" /> : query.isLoading ? <ConsumerLoading label="Loading market board…" /> : query.isError ? <ConsumerMessage error title="Market board unavailable" detail="We couldn’t load this week right now. Please try again shortly." /> : query.data?.games.length ? (
        <section className="terminal-board" aria-label="Weekly NFL market comparisons">
           {query.data.games.map((game) => <GameRow key={game.gameId} game={game} season={season!} week={week!} />)}
        </section>
      ) : <ConsumerMessage title="No games found" detail="There are no available matchups for this season and week. Try another week." />}
    </div>
  );
}