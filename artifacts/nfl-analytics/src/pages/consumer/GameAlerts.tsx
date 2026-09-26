import { useAuth } from '@clerk/react';
import {
  getGetConsumerGameAlertsQueryKey, useDisableConsumerGameAlerts,
  useEnableConsumerGameAlerts, useGetConsumerGameAlerts,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react';
import { Link } from 'wouter';

export function GameAlerts({ gameId, upcoming }: { gameId: string; upcoming: boolean }) {
  const { isSignedIn, userId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = [...getGetConsumerGameAlertsQueryKey(gameId), userId];
  const alerts = useGetConsumerGameAlerts(gameId, {
    query: { queryKey, enabled: Boolean(isSignedIn && userId && gameId), staleTime: 0, refetchInterval: 60_000, refetchOnWindowFocus: true },
  });
  const enable = useEnableConsumerGameAlerts({ mutation: {
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  } });
  const disable = useDisableConsumerGameAlerts({ mutation: {
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: () => queryClient.setQueryData(queryKey, { enabled: false, events: [] }),
  } });
  if (!upcoming && !alerts.data?.enabled) return null;
  const pending = enable.isPending || disable.isPending;
  return <section className="rounded-xl border border-border bg-card p-4 md:p-5" aria-label="Matchup change alerts">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 h-5 w-5 text-accent" aria-hidden="true" />
        <div>
          <h2 className="font-semibold text-foreground">Matchup change alerts</h2>
          <p className="mt-1 text-sm text-muted-foreground">Optional in-app updates when a saved projection, personnel availability, or market context changes materially. Check this page to see them; no betting action is taken.</p>
        </div>
      </div>
      {!isSignedIn ? <Link href="/sign-in" className="button button-subtle">Sign in for alerts</Link>
        : alerts.isLoading ? <span role="status" className="text-sm text-muted-foreground">Checking alerts…</span>
        : alerts.isError ? <span role="alert" className="text-sm text-amber-600">Alerts unavailable right now. Try again later.</span>
        : alerts.data?.enabled ? <button type="button" className="button button-subtle" disabled={pending} onClick={() => disable.mutate({ gameId })}><BellOff className="h-4 w-4" /> Disable alerts</button>
        : upcoming ? <button type="button" className="button button-subtle" disabled={pending} onClick={() => enable.mutate({ gameId })}><Bell className="h-4 w-4" /> Enable alerts</button> : null}
    </div>
    {(enable.isError || disable.isError) && <p role="alert" className="mt-3 text-sm text-amber-600">Could not update alerts. Please try again.</p>}
    {alerts.data?.enabled && <div className="mt-4 border-t border-border pt-3" role="status">
      {alerts.data.events.length ? <ul className="space-y-3">
        {alerts.data.events.map((event, index) => <li key={`${event.detectedAt}-${event.category}-${index}`} className="text-sm">
          <strong className="capitalize text-foreground">{event.category} changed</strong>
          <span className="ml-2 text-muted-foreground">{new Date(event.detectedAt).toLocaleString()}</span>
          <p className="mt-1 text-muted-foreground">{event.detail}</p>
        </li>)}
      </ul> : <p className="text-sm text-muted-foreground">Alerts are on. No material changes detected since you enabled them.</p>}
    </div>}
  </section>;
}