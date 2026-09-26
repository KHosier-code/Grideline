import type { ConsumerDashboard } from '@workspace/api-client-react';
import { Link } from 'wouter';

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
        : pick ? <><strong data-testid="weekly-pick-team">{pick.teamName}</strong><p>Winner locked from Gridline’s first verified lines for week {pick.week}. Not a guaranteed result.</p></>
        : <p>{initialWeeklyPick?.reason ?? 'Initial-line pick evidence is unavailable.'}</p>}
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