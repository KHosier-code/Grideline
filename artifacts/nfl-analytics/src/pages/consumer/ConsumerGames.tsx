import {
  getListConsumerGamesQueryKey,
  useListConsumerGames,
  type ConsumerGame,
  type ConsumerMarketQuote,
} from '@workspace/api-client-react';
import { ChevronDown, ChevronRight, Clock3 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Link } from 'wouter';
import { ConsumerLoading, ConsumerMessage, ConsumerPredictionStates, formatKickoff, formatQuote, useConsumerNow } from './consumer-ui';
import { ConsumerMarketComparisonCell } from '../../components/ConsumerMarketComparison';
import { MarketConfidenceSummary } from '../../components/MarketConfidence';
import { ConsumerSourceHealth } from '../../components/ConsumerSourceHealth';

function readPositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

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
  const final = game.finalScore;
  const prediction = game.prediction;
  const beforeKickoff = Boolean(game.kickoffTime && new Date(game.kickoffTime).getTime() > now
    && (game.gameState === 'pregame' || game.gameState === 'scheduled'));

  return (
    <article className="tb-row" aria-label={`Model difference for ${game.matchup.away.abbreviation} at ${game.matchup.home.abbreviation}`}>
      <div className="tb-row-main">
        <div className="tb-cell tc-matchup">
          <div className="tc-time">
            <span>{formatKickoff(game.kickoffTime)}</span>
            <span className={`market-state market-state-${game.gameState}`}>{game.gameState}</span>
          </div>
          <div className="tc-team"><strong>{game.matchup.away.abbreviation}</strong><span>{game.matchup.away.name}</span><b>{final ? final.away : prediction?.projectedAwayScore?.toFixed(1) ?? '—'}</b></div>
          <div className="tc-team"><strong>{game.matchup.home.abbreviation}</strong><span>{game.matchup.home.name}</span><b>{final ? final.home : prediction?.projectedHomeScore?.toFixed(1) ?? '—'}</b></div>
        </div>
        {game.marketBoard.comparisons.map((comparison) => <ConsumerMarketComparisonCell className="tb-cell" key={comparison.market} comparison={comparison} eligible={beforeKickoff && game.recommendation.markets[comparison.market]} />)}
        <div className="tc-action">
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
      <MarketConfidenceSummary value={game} compact />
      <ConsumerPredictionStates game={game} />
      <p className="consumer-note">{beforeKickoff ? game.recommendation.reason ?? 'Fresh complete market evidence is available.' : 'Historical game: no current recommendations.'}</p>
      {expanded && (
        <div className="tb-evidence" id={evidenceId}>
          <MarketConfidenceSummary value={game} />
          <div className="evidence-summary">
            <strong>Comparison evidence</strong>
            <span>{game.dataConfidence.label} data confidence</span>
            <span>{game.marketBoard.selectionRule}</span>
          </div>
          {game.marketBoard.comparisons.map((comparison) => (
            <section className="ev-block" key={comparison.market}>
              <strong>{comparison.label}</strong>
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
  const now = new Date();
  const [season, setSeason] = useState(() => readPositiveInteger(new URLSearchParams(window.location.search).get('season'), now.getFullYear()));
  const [week, setWeek] = useState(() => readPositiveInteger(new URLSearchParams(window.location.search).get('week'), 1));
  useEffect(() => {
    const search = new URLSearchParams({ season: String(season), week: String(week) });
    window.history.replaceState(window.history.state, '', `/games?${search.toString()}`);
  }, [season, week]);
  const params = { season, week };
   const query = useListConsumerGames(params, { query: { queryKey: getListConsumerGamesQueryKey(params), staleTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: true } });

  return (
    <div className="terminal-page">
      <header className="terminal-header">
        <div><p className="consumer-eyebrow">Weekly comparison</p><h1 className="terminal-title">Gridline market board</h1><p className="terminal-desc">Persisted model projections compared with valid DraftKings and FanDuel evidence. Differences are informational.</p></div>
        <div className="terminal-controls">
          <label className="terminal-select">Season<input aria-label="Season" type="number" min="2020" value={season} onChange={(event) => setSeason(Number(event.target.value))} /></label>
          <label className="terminal-select">Week<select aria-label="Week" value={week} onChange={(event) => setWeek(Number(event.target.value))}>{Array.from({ length: 22 }, (_, index) => <option key={index + 1} value={index + 1}>{index < 18 ? `Week ${index + 1}` : `Postseason ${index - 17}`}</option>)}</select></label>
        </div>
      </header>
       {query.data && !query.isError && <ConsumerSourceHealth health={query.data.sourceHealth} />}

      {query.data && !query.isError && (
        <section className="terminal-summary-bar" aria-label="Board coverage">
          <div className="ts-stat"><span>Board status</span><strong className={`market-state market-state-${query.data.status}`}>{query.data.status}</strong></div>
          <div className="ts-stat"><span>Games compared</span><strong>{query.data.coverage.gamesWithComparison} / {query.data.coverage.games}</strong></div>
          <div className="ts-stat"><span>DraftKings coverage</span><strong>{query.data.coverage.DraftKings} games</strong></div>
          <div className="ts-stat"><span>FanDuel coverage</span><strong>{query.data.coverage.FanDuel} games</strong></div>
          <div className="ts-stat"><span>Evidence</span><strong><Clock3 aria-hidden="true" /> First / current</strong></div>
        </section>
      )}
      {query.data?.teamRecords?.length ? (
        <section className="terminal-summary-bar" aria-label="Team records">
          <div className="ts-stat"><span>Records</span><strong>{query.data.recordVerification.complete ? 'Verified' : 'Check data'}</strong></div>
          {!query.data.recordVerification.complete && (
            <div className="ts-stat ts-stat-warning" role="status">
              <span>Record evidence</span>
              <strong>{query.data.recordVerification.discrepancies[0] ?? 'Authoritative results incomplete'}</strong>
            </div>
          )}
          {query.data.teamRecords.map((record) => (
            <div className="ts-stat" key={record.teamId}><span>{record.abbreviation}</span><strong>{record.games ? `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ''}` : 'No verified record'}</strong></div>
          ))}
        </section>
      ) : null}

      {query.isLoading ? <ConsumerLoading label="Loading market board…" /> : query.isError ? <ConsumerMessage error title="Market board unavailable" detail="We couldn’t load this week right now. Please try again shortly." /> : query.data?.games.length ? (
        <section className="terminal-board" aria-label="Weekly NFL market comparisons">
          <div className="tb-header" aria-hidden="true"><div>Kickoff & matchup</div><div>Spread comparison</div><div>Total comparison</div><div>Moneyline comparison</div><div>Evidence</div></div>
          {query.data.games.map((game) => <GameRow key={game.gameId} game={game} season={season} week={week} />)}
        </section>
      ) : <ConsumerMessage title="No games found" detail="There are no available matchups for this season and week. Try another week." />}
    </div>
  );
}