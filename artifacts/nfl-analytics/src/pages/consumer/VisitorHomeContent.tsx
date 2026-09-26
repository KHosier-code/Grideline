import type { ConsumerGame } from '@workspace/api-client-react';
import { weeklyHomePick } from '../../lib/consumer-home';
import { Link } from 'wouter';

export function VisitorHomeContent({ games, now, state }: {
  games?: ConsumerGame[];
  now: number;
  state: 'loading' | 'error' | 'ready';
}) {
  const pick = state === 'ready' && games ? weeklyHomePick(games, now) : null;
  return <div className="visitor-home">
    <section className="visitor-pick" aria-live="polite">
      <p className="consumer-eyebrow">Gridline / Home</p>
      <h1>Pick of the week</h1>
      {state === 'loading' ? <p>Loading this week’s pick…</p>
        : state === 'error' ? <p>Pick unavailable right now. Please try again later.</p>
        : pick ? <><strong data-testid="weekly-pick-team">{pick.teamName}</strong><p>Model-selected winner for an upcoming game. Not a guaranteed result.</p></>
        : <p>A pick is unavailable for the next slate.</p>}
    </section>
    <p className="consumer-note mt-6">A pick depends on available evidence and is not a guaranteed result. <Link href="/methodology" className="font-semibold text-accent underline">Read Gridline’s methodology and limitations</Link>.</p>
  </div>;
}