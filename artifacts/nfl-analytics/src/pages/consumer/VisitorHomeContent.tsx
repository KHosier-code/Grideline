import type { ConsumerGame } from '@workspace/api-client-react';
import { weeklyHomePick } from '../../lib/consumer-home';

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
  </div>;
}