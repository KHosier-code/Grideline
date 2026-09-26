import { lazy, Suspense, useMemo, useState } from 'react';
import type { ConsumerMovement, ConsumerMovementQuote } from '@workspace/api-client-react';
import { AlertTriangle, LineChart as LineChartIcon } from 'lucide-react';
import { preKickoffMovementLabel } from '../lib/consumer-presentation';

const LineMovementPlot = lazy(() => import('./LineMovementPlot'));

type Market = 'spread' | 'total' | 'moneyline';
type BookFilter = 'All' | 'DraftKings' | 'FanDuel';

const markets: Array<{ value: Market; label: string }> = [
  { value: 'spread', label: 'Spread' },
  { value: 'total', label: 'Total' },
  { value: 'moneyline', label: 'Moneyline' },
];
const books: BookFilter[] = ['All', 'DraftKings', 'FanDuel'];

function price(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function quoteValue(quote: ConsumerMovementQuote, market: string) {
  const point = market === 'moneyline' || quote.point === null
    ? ''
    : `${quote.point > 0 ? '+' : ''}${quote.point} · `;
  return `${point}${price(quote.price)}`;
}

function observedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function SummaryValue({
  label,
  quote,
  market,
}: {
  label: string;
  quote: ConsumerMovementQuote | null;
  market: string;
}) {
  return <div className="movement-summary-value">
    <small>{label}</small>
    {quote
      ? <><strong>{quoteValue(quote, market)}</strong><time dateTime={quote.capturedAt}>{observedAt(quote.capturedAt)}</time></>
      : <strong className="movement-unavailable">Unavailable</strong>}
  </div>;
}

export function LineMovementExperience({ movement, beforeKickoff }: { movement: ConsumerMovement; beforeKickoff: boolean }) {
  const [market, setMarket] = useState<Market>('spread');
  const [book, setBook] = useState<BookFilter>('All');
  const streams = useMemo(() => movement.streams.filter((stream) =>
    stream.market === market && (book === 'All' || stream.sportsbook === book)), [movement.streams, market, book]);
  const chartable = streams.some(stream => stream.observations.length > 0);

  return <section className="movement-section" data-section="line-movement" aria-labelledby="movement-heading">
    <div className="consumer-section-heading">
      <div>
        <p className="consumer-eyebrow">Sportsbook history</p>
        <h2 id="movement-heading">Line movement</h2>
      </div>
      {movement.completeness.status === 'truncated' &&
        <span className="movement-partial"><AlertTriangle /> Partial history</span>}
    </div>
    <div className="movement-controls">
      <div className="movement-tabs" role="tablist" aria-label="Market">
        {markets.map((item) => <button
          aria-selected={market === item.value}
          className={market === item.value ? 'active' : ''}
          key={item.value}
          onClick={() => setMarket(item.value)}
          role="tab"
          type="button"
        >{item.label}</button>)}
      </div>
      <div className="movement-books" aria-label="Sportsbook filter">
        {books.map((item) => <button
          aria-pressed={book === item}
          className={book === item ? 'active' : ''}
          key={item}
          onClick={() => setBook(item)}
          type="button"
        >{item === 'All' ? 'Compare books' : item}</button>)}
      </div>
    </div>
    {movement.completeness.status === 'truncated' && <p className="movement-notice">
      Showing the latest {movement.completeness.returnedObservations} of {movement.completeness.totalObservations} observations.
      First and current summaries still use the complete persisted history.
    </p>}
    {!movement.available
      ? <div className="movement-empty"><LineChartIcon /><strong>No line history available</strong><p>{movement.message}</p></div>
      : streams.length === 0
        ? <div className="movement-empty"><LineChartIcon /><strong>No {markets.find((item) => item.value === market)?.label.toLowerCase()} history</strong><p>No observations are available for this market and sportsbook filter.</p></div>
        : <>
          {chartable ? <Suspense fallback={<div className="movement-chart" role="status">Loading line history chart…</div>}>
            <LineMovementPlot streams={streams} market={market} label={markets.find(item => item.value === market)!.label} />
          </Suspense> : <div className="movement-empty" role="status">No chartable observations are available for this market and sportsbook filter.</div>}
          <div className="movement-streams">
            {streams.map((stream) => <article key={`${stream.sportsbook}-${stream.market}-${stream.selection}`}>
              <header><div><span>{stream.sportsbook}</span><h3>{stream.selection}</h3></div><small>{stream.observations.length} shown</small></header>
              <div className="movement-summary-grid">
                <SummaryValue label="First observed by Gridline" market={stream.market} quote={stream.firstObserved} />
                 <SummaryValue label="Last recorded by Gridline" market={stream.market} quote={stream.current} />
                 {preKickoffMovementLabel(beforeKickoff) && <SummaryValue label={preKickoffMovementLabel(beforeKickoff)!} market={stream.market} quote={stream.finalPreKickoff} />}
              </div>
            </article>)}
          </div>
        </>}
    <p className="movement-methodology">“First observed by Gridline” is the earliest persisted observation available here. The last recorded price may be after kickoff on completed games. The last recorded pre-kickoff observation is not a verified sportsbook closing line.</p>
  </section>;
}