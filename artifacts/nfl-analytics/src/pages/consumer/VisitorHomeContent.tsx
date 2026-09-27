import type { ConsumerDashboard } from '@workspace/api-client-react';
import { Link } from 'wouter';

function SavedFirstLines({ lines, observedAt }: {
  lines: NonNullable<NonNullable<ConsumerDashboard['initialWeeklyPick']['pick']>['firstLines']>;
  observedAt: string;
}) {
  const moneyline = lines.quotes.filter(quote => quote.market === 'moneyline');
  const spread = lines.quotes.filter(quote => quote.market === 'spread');
  if (moneyline.length !== 2 || spread.length !== 2 ||
    moneyline.some(quote => quote.point !== null || !spread.some(side => side.selection === quote.selection))) return null;
  const signed = (value: number) => value > 0 ? `+${value}` : String(value);
  return <details className="visitor-first-lines">
    <summary>See saved first-line quotes</summary>
    <p>First observed at {new Date(observedAt).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC from {lines.sportsbook}. These are the lines saved with this pick, not current odds or betting advice.</p>
    <div className="visitor-first-lines-scroll">
      <table>
        <caption className="sr-only">Saved {lines.sportsbook} first-line moneyline and spread quotes for both teams</caption>
        <thead><tr><th scope="col">Team</th><th scope="col">Moneyline</th><th scope="col">Spread</th></tr></thead>
        <tbody>{moneyline.map(quote => {
          const side = spread.find(item => item.selection === quote.selection)!;
          return <tr key={quote.selection}><th scope="row">{quote.selection}</th><td>{signed(quote.price)}</td><td>{signed(side.point!)} ({signed(side.price)})</td></tr>;
        })}</tbody>
      </table>
    </div>
  </details>;
}

export function WeeklyPickSection({ initialWeeklyPick, state, headingLevel = 'h1' }: {
  initialWeeklyPick?: ConsumerDashboard['initialWeeklyPick'];
  state: 'loading' | 'error' | 'ready';
  headingLevel?: 'h1' | 'h2';
}) {
  const pick = state === 'ready' ? initialWeeklyPick?.pick : null;
  const Heading = headingLevel;
  return <section className="visitor-pick" aria-live="polite">
      <p className="consumer-eyebrow">Gridline / Home</p>
      <Heading>Pick of the week</Heading>
      {state === 'loading' ? <p>Loading this week’s pick…</p>
        : state === 'error' ? <p>Pick unavailable right now. Please try again later.</p>
        : pick ? <><strong data-testid="weekly-pick-team">{pick.teamName}</strong><p>Winner locked from Gridline’s first verified lines for week {pick.week}. Not a guaranteed result.</p>
          {pick.firstLines && <SavedFirstLines lines={pick.firstLines} observedAt={pick.observedAt} />}</>
        : <p>{initialWeeklyPick?.reason ?? 'Initial-line pick evidence is unavailable.'}</p>}
      <Link href="/weekly-picks" className="visitor-pick-history">Review past official weekly picks</Link>
    </section>;
}

export function VisitorHomeContent({ initialWeeklyPick, now: _now, state }: {
  initialWeeklyPick?: ConsumerDashboard['initialWeeklyPick'];
  now: number;
  state: 'loading' | 'error' | 'ready';
}) {
  return <div className="visitor-home">
    <WeeklyPickSection initialWeeklyPick={initialWeeklyPick} state={state} />
    <p className="consumer-note mt-6">A pick depends on available evidence and is not a guaranteed result. <Link href="/methodology" className="font-semibold text-accent underline">Read Gridline’s methodology and limitations</Link>.</p>
  </div>;
}