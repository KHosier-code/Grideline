import { useId, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';

type State = { kind: 'idle' | 'sending' | 'done' | 'error'; message?: string };

/**
 * "Get Tuesday's picks": the newsletter signup (POST /api/newsletter/subscribe,
 * sent on to Buttondown). Hidden until BUTTONDOWN_API_KEY is set on the server.
 */
export function NewsletterSignup({ source }: { source: string }) {
  const id = useId();
  const status = useQuery({
    queryKey: ['newsletter-status'],
    queryFn: async () => {
      const response = await fetch('/api/newsletter/status');
      return response.ok ? (await response.json() as { enabled: boolean }).enabled : false;
    },
    staleTime: 10 * 60_000,
  });
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  if (!status.data) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ kind: 'sending' });
    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source, website }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (response.ok) setState({ kind: 'done' });
      else setState({ kind: 'error', message: body.message ?? 'Something went wrong. Please try again.' });
    } catch {
      setState({ kind: 'error', message: 'Something went wrong. Please try again.' });
    }
  }

  return <section className="gl-signup" aria-labelledby={`${id}-title`}>
    <div className="gl-signup-copy">
      <h2 id={`${id}-title`}>Get Tuesday&apos;s picks</h2>
      <p>The top 10 anytime TD picks every Tuesday, with last week&apos;s receipts, wins and losses. Free, and one click to unsubscribe.</p>
    </div>
    {state.kind === 'done'
      ? <p className="gl-signup-done" role="status"><b>Almost there.</b> Check your inbox and tap the confirmation link.</p>
      : <form className="gl-signup-form" onSubmit={submit} noValidate>
        <label htmlFor={`${id}-email`}>Email</label>
        <div className="gl-signup-row">
          <input id={`${id}-email`} type="email" name="email" autoComplete="email" inputMode="email" required placeholder="you@example.com"
            value={email} onChange={event => setEmail(event.target.value)} aria-invalid={state.kind === 'error'} aria-describedby={`${id}-msg`} />
          <button type="submit" disabled={state.kind === 'sending' || !email.trim()}>{state.kind === 'sending' ? 'Signing up…' : 'Sign up'}</button>
        </div>
        {/* Honeypot: off-screen and skipped by keyboard and screen readers; bots fill it in. */}
        <input className="gl-signup-trap" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
          value={website} onChange={event => setWebsite(event.target.value)} />
        <p id={`${id}-msg`} className="gl-signup-msg" role={state.kind === 'error' ? 'alert' : undefined}>
          {state.kind === 'error' ? state.message : 'We only email picks. 21+ where legal.'}
        </p>
      </form>}
  </section>;
}
