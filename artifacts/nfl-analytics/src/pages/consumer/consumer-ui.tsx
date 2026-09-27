import type { ConsumerGame, ConsumerMarketQuote } from '@workspace/api-client-react';
import type { ReactNode } from 'react';
import { getListSavedGameIdsQueryKey, getListSavedGamesQueryKey, useListSavedGameIds, useSaveConsumerGame, useRemoveSavedConsumerGame } from '@workspace/api-client-react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bookmark, CalendarDays, ChevronRight, Loader2 } from 'lucide-react';
import { Link } from 'wouter';
import { useEffect, useState } from 'react';
import { TeamMark } from '../../components/VerifiedImage';

export function useConsumerNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function ConsumerLoading({ label = 'Loading the latest view…' }: { label?: string }) {
  return <div className="consumer-state"><Loader2 className="h-6 w-6 animate-spin" /><p>{label}</p></div>;
}

export function ConsumerMessage({ title, detail, error = false }: { title: string; detail: string; error?: boolean }) {
  return <div className="consumer-state">{error ? <AlertTriangle className="h-7 w-7 text-amber-600" /> : <CalendarDays className="h-7 w-7" />}<h2>{title}</h2><p>{detail}</p></div>;
}

export function formatKickoff(value: string | null) {
  if (!value) return 'Kickoff time to be announced';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Kickoff time to be announced';
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export function formatQuote(quote: ConsumerMarketQuote | null, kind: 'spread' | 'moneyline' | 'total') {
  if (!quote) return 'Updating';
  const price = quote.price > 0 ? `+${quote.price}` : String(quote.price);
  const selection = typeof quote.selection === 'string' ? quote.selection.trim() : '';
  if (kind === 'moneyline') return `${selection ? `${selection} ` : ''}${price} · ${quote.sportsbook}`;
  const point = quote.point === null ? '—' : `${quote.point > 0 ? '+' : ''}${quote.point}`;
  return `${selection ? `${selection} ` : ''}${point} (${price}) · ${quote.sportsbook}`;
}

const score = (value?: number | null) => value === null || value === undefined ? '—' : value.toFixed(1);

export function SaveGameButton({ gameId }: { gameId: string }) {
  const { isSignedIn, userId } = useAuth();
  const client = useQueryClient();
  const ids = useListSavedGameIds({ query: {
    queryKey: [...getListSavedGameIdsQueryKey(), userId],
    enabled: Boolean(isSignedIn && userId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  } });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getListSavedGameIdsQueryKey() });
    void client.invalidateQueries({ queryKey: getListSavedGamesQueryKey() });
  };
  const save = useSaveConsumerGame({ mutation: { onSuccess: refresh } });
  const remove = useRemoveSavedConsumerGame({ mutation: { onSuccess: refresh } });
  const saved = ids.data?.includes(gameId) ?? false;
  const pending = save.isPending || remove.isPending;
  return <SaveGameControl isSignedIn={Boolean(isSignedIn)} saved={saved} pending={pending} loading={ids.isLoading} unavailable={ids.isError}
    error={ids.isError ? 'Saved games unavailable. Reload to retry.' : save.isError || remove.isError ? 'Could not update saved games. Try again.' : null}
    onToggle={() => saved ? remove.mutate({ gameId }) : save.mutate({ gameId })} />;
}

export function SaveGameControl({ isSignedIn, saved, pending = false, loading = false, unavailable = false, error = null, onToggle }: {
  isSignedIn: boolean; saved: boolean; pending?: boolean; loading?: boolean; unavailable?: boolean; error?: string | null; onToggle: () => void;
}) {
  if (!isSignedIn) return <Link href="/sign-in" className="save-game-button" aria-label="Sign in to save this game"><Bookmark size={15} aria-hidden="true" /> Sign in to save</Link>;
  return <span className="save-game-control">
    <button type="button" className="save-game-button" aria-pressed={saved} disabled={pending || loading || unavailable}
      onClick={onToggle}>
      <Bookmark size={15} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" /> {pending ? 'Updating…' : saved ? 'Remove saved game' : 'Save game'}
    </button>
    {error && <small role="alert">{error}</small>}
  </span>;
}

export function ConsumerGameCard({ game, compact = false, href = `/games/${game.gameId}`, renderSaveControl }: { game: ConsumerGame; compact?: boolean; href?: string; renderSaveControl?: (gameId: string) => ReactNode }) {
  const final = game.finalScore;
  const prediction = game.prediction;
  const spread = game.marketBoard.comparisons.find((comparison) => comparison.market === 'spread');
  const spreadQuote = game.recommendation.markets.spread && (!game.kickoffTime || new Date(game.kickoffTime).getTime() > Date.now())
    ? spread?.selectedQuote ?? null : null;
  return (
    <div className="consumer-game-card">
    <Link href={href} className="consumer-game-card-link">
      <div className="consumer-game-card-head"><span>{formatKickoff(game.kickoffTime)}</span><span>{final ? 'Final' : game.dataConfidence.label}</span></div>
      <div className="consumer-matchup">
        <div><TeamMark className="consumer-team-mark" url={game.matchup.away.logoUrl} abbreviation={game.matchup.away.abbreviation} /><span>{game.matchup.away.name}</span></div><b>{final ? final.away : score(prediction?.projectedAwayScore)}</b>
        <div><TeamMark className="consumer-team-mark" url={game.matchup.home.logoUrl} abbreviation={game.matchup.home.abbreviation} /><span>{game.matchup.home.name}</span></div><b>{final ? final.home : score(prediction?.projectedHomeScore)}</b>
      </div>
      {!compact && <div className="consumer-card-metrics">
        <span><small>Projection</small>{prediction ? `${score(prediction.projectedMargin)} margin` : game.availability.prediction ?? 'Updating'}</span>
         <span><small>Market spread</small>{spreadQuote ? formatQuote(spreadQuote, 'spread') : game.availability.market ?? 'Current comparison unavailable'}</span>
      </div>}
      <div className="consumer-game-card-foot"><span>{game.dataConfidence.reason ?? `${game.dataConfidence.label} data confidence`}</span><ChevronRight className="h-4 w-4" /></div>
    </Link>
    <div className="consumer-game-card-save">{renderSaveControl ? renderSaveControl(game.gameId) : <SaveGameButton gameId={game.gameId} />}</div>
    </div>
  );
}

export function recordRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

export function metric(value: unknown, percent = false) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(percent ? value * 100 : value).toFixed(1)}${percent ? '%' : ''}` : 'Unavailable';
}
