import { useAuth } from '@clerk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

const expectedUrl = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv.gz';

export function AdminPlayerStatsImport() {
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const plan = useQuery({
    queryKey: ['player-stats-2026-import-plan', isSignedIn],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch('/api/data-sync/player-stats-2026', {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error('The published importer is not available.');
      return response.json() as Promise<{ season: number; dataset: string; sourceUrl: string }>;
    },
    enabled: Boolean(isSignedIn),
    retry: false,
  });
  const matches = plan.data?.season === 2026 && plan.data?.dataset === 'player_stats' && plan.data?.sourceUrl === expectedUrl;

  const importStats = async () => {
    if (!matches || !confirmed || working) return;
    setWorking(true);
    setMessage('');
    try {
      const token = await getToken();
      const response = await fetch('/api/data-sync/player-stats-2026', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ sourceUrl: expectedUrl, confirmation: 'IMPORT_2026_PLAYER_STATS' }),
      });
      const result = await response.json();
      if (!response.ok || result.status !== 'success') {
        throw new Error(result.error ?? result.failures?.join('; ') ?? 'The import did not succeed.');
      }
      setMessage(`Import succeeded: ${result.recordsProcessed} 2026 player-game rows processed. Verify public usage before calling the site repaired.`);
      setConfirmed(false);
      await queryClient.invalidateQueries();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="mt-5 rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold text-ink">2026 player usage recovery</h2>
      <p className="mt-2 text-sm text-muted-foreground">Admin-only, manual import of 2026 weekly player stats. This does not refresh other NFLverse feeds or seasons.</p>
      <p className="mt-2 break-all text-xs text-muted-foreground">Published importer source: {plan.isLoading ? 'Checking…' : plan.data?.sourceUrl ?? 'Unavailable'}</p>
      {plan.isError && <p role="alert" className="mt-2 text-sm text-destructive">The published importer cannot be confirmed. Publish the corrected API before importing.</p>}
      {plan.data && !matches && <p role="alert" className="mt-2 text-sm text-destructive">Source mismatch. Import disabled.</p>}
      {matches && (
        <>
          <label className="mt-4 flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            I confirm this import will update live 2026 player-game stats from the weekly source above.
          </label>
          <button type="button" className="button button-primary mt-3" disabled={!confirmed || working} onClick={importStats}>
            {working ? 'Importing 2026 player stats…' : 'Import 2026 player stats'}
          </button>
        </>
      )}
      {message && <p role="status" className="mt-3 text-sm text-ink">{message}</p>}
    </section>
  );
}