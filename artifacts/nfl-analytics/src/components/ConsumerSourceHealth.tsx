import type { ConsumerSourceHealth as Health } from '@workspace/api-client-react';

const labels = { schedule: 'Schedule', injuries: 'Injuries', odds: 'Sportsbook odds', players: 'Player status' };

export function ConsumerSourceHealth({ health }: { health: Health }) {
  return (
    <section className="consumer-source-health" aria-label="Data source health">
      <div className="consumer-source-heading">
        <strong>Data feeds</strong>
        <span className={`market-state market-state-${health.status}`}>{health.status}</span>
      </div>
      <div className="consumer-source-grid">
        {(Object.keys(labels) as Array<keyof typeof labels>).map((name) => {
          const source = health.sources[name];
          const when = (value: string | null) => value
            ? new Date(value).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })
            : 'Not recorded';
          return <div className="consumer-source-item" key={name}>
            <div><strong>{labels[name]}</strong><span className={`market-state market-state-${source.status}`}>{source.status}</span></div>
            <small>Attempt: {when(source.lastAttemptAt)} · {source.lastAttemptStatus ?? 'none'}</small>
            <small>Success: {when(source.lastSuccessAt)}</small>
            <small>Source: {when(source.sourceTimestamp)} · freshness limit {source.staleAfterMinutes} min</small>
            {source.message && <p>{source.message}</p>}
          </div>;
        })}
      </div>
    </section>
  );
}