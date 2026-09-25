import { useMemo, useState } from 'react';
import type { ConsumerMovement, ConsumerMovementItem, ConsumerMovementQuote } from '@workspace/api-client-react';
import { AlertTriangle, LineChart as LineChartIcon } from 'lucide-react';
import { preKickoffMovementLabel } from '../lib/consumer-presentation';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Market = 'spread' | 'total' | 'moneyline';
type BookFilter = 'All' | 'DraftKings' | 'FanDuel';

const markets: Array<{ value: Market; label: string }> = [
  { value: 'spread', label: 'Spread' },
  { value: 'total', label: 'Total' },
  { value: 'moneyline', label: 'Moneyline' },
];
const books: BookFilter[] = ['All', 'DraftKings', 'FanDuel'];
const colors = ['#ef7d32', '#172033', '#637083', '#9aa3b2', '#b85e28', '#424d61'];

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

function streamName(stream: ConsumerMovementItem) {
  return `${stream.sportsbook === 'DraftKings' ? 'DK' : 'FD'} · ${stream.selection}`;
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
  const chart = useMemo(() => {
    const rows = new Map<string, Record<string, string | number | null>>();
    streams.forEach((stream, streamIndex) => {
      stream.observations.forEach((observation) => {
        const row = rows.get(observation.capturedAt) ?? { capturedAt: observation.capturedAt };
        row[`point${streamIndex}`] = observation.point;
        row[`price${streamIndex}`] = observation.price;
        rows.set(observation.capturedAt, row);
      });
    });
    return [...rows.values()].sort((left, right) =>
      String(left.capturedAt).localeCompare(String(right.capturedAt)));
  }, [streams]);

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
          <div className="movement-chart" role="img" aria-label={`${markets.find((item) => item.value === market)?.label} movement chart`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 16, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 5" />
                <XAxis
                  dataKey="capturedAt"
                  minTickGap={48}
                  tickFormatter={(value) => observedAt(String(value))}
                  tick={{ fontSize: 9 }}
                />
                <YAxis yAxisId="point" hide={market === 'moneyline'} tick={{ fontSize: 9 }} width={42} />
                <YAxis yAxisId="price" orientation="right" tickFormatter={price} tick={{ fontSize: 9 }} width={45} />
                <Tooltip
                  labelFormatter={(value) => observedAt(String(value))}
                  formatter={(value, name) => [String(name).endsWith(' price') ? price(Number(value)) : value, name]}
                />
                <Legend />
                {streams.flatMap((stream, index) => {
                  const color = colors[index % colors.length];
                  const name = streamName(stream);
                  const lines = [
                    <Line
                      connectNulls
                      dataKey={`price${index}`}
                      dot={{ r: 3 }}
                      key={`price-${name}`}
                      name={`${name} price`}
                      stroke={color}
                      strokeDasharray="5 4"
                      type="linear"
                      yAxisId="price"
                    />,
                  ];
                  if (market !== 'moneyline') lines.unshift(<Line
                    connectNulls
                    dataKey={`point${index}`}
                    dot={{ r: 3 }}
                    key={`point-${name}`}
                    name={`${name} point`}
                    stroke={color}
                    strokeWidth={2.5}
                    type="linear"
                    yAxisId="point"
                  />);
                  return lines;
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
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