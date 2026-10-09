import { getListSavedGamesQueryKey, useListSavedGames } from '@workspace/api-client-react';
import type { ConsumerGame } from '@workspace/api-client-react';
import type { ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { ArrowRight, Bookmark, LockKeyhole, RefreshCw, WifiOff } from 'lucide-react';
import { Link } from 'wouter';
import { MyPicksList, MyPicksRecord, PickControls, useMyPicks } from '@/components/MyPicks';
import { ConsumerGameCard } from './consumer-ui';
import './ConsumerSavedGames.css';

export default function ConsumerSavedGames() {
  const { isLoaded, userId } = useAuth();
  const query = useListSavedGames({ query: {
    queryKey: [...getListSavedGamesQueryKey(), userId],
    enabled: Boolean(userId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  } });

  const picks = useMyPicks();
  const mine = picks.data?.picks ?? [];
  return <ConsumerSavedGamesView isLoaded={isLoaded} userId={userId ?? null} games={query.data ?? []}
    isLoading={query.isLoading} isError={query.isError} onRetry={() => void query.refetch()}
    record={picks.data ? <><MyPicksRecord data={picks.data} /><MyPicksList picks={mine} /></> : null}
    renderPicks={picks.isError ? undefined : game => <PickControls game={game} picks={mine.filter(pick => pick.gameId === game.gameId)} />} />;
}

export function ConsumerSavedGamesView({ isLoaded, userId, games, isLoading, isError, onRetry, renderSaveControl, renderPicks, record }: {
  isLoaded: boolean;
  userId: string | null;
  games: ConsumerGame[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  renderSaveControl?: (gameId: string) => ReactNode;
  /** Moneyline, spread and over/under pick buttons under each saved game. */
  renderPicks?: (game: ConsumerGame) => ReactNode;
  /** The signed-in user's pick record, above the list. */
  record?: ReactNode;
}) {
  const loading = !isLoaded || (Boolean(userId) && isLoading);
  const signedOut = isLoaded && !userId;
  const hasError = Boolean(userId && isError);
  const count = loading || signedOut || hasError ? null : String(games.length).padStart(2, '0');

  return (
    <div className="consumer-page saved-view my-scope">
      <header className="sv-hero">
        <div className="sv-hero-content">
          <p className="sv-kicker">Your picks and saved games</p>
          <h1>My <span>picks.</span></h1>
          <p className="sv-hero-copy">Make your own moneyline, spread and over/under picks from any game page or on your saved games below. Each pick locks at kickoff at the number you took, and your record fills in as games finish.</p>
          <div className="sv-hero-actions">
            <Link href="/games" className="sv-primary-link" data-testid="link-browse-saved-games">
              Browse games <ArrowRight size={16} aria-hidden="true" />
            </Link>
            {signedOut && <Link href="/sign-in" className="sv-secondary-link" data-testid="link-sign-in-saved-games">Sign in to make picks</Link>}
          </div>
        </div>
        <div className="sv-hero-side" aria-hidden="true">
          <span className="sv-hero-index">MY PICKS</span>
          <div className="sv-count"><strong>{count ?? <LockKeyhole size={54} />}</strong><span>{count === null ? signedOut ? 'Sign in to view' : loading ? 'Loading list' : 'List unavailable' : count === '01' ? 'game saved' : 'games saved'}</span></div>
        </div>
      </header>

      <section className="sv-body" aria-labelledby="sv-list-title" aria-busy={loading}>
        <div className="sv-section-head">
          <div>
                        <h2 id="sv-list-title">{signedOut ? 'Your picks, your record.' : 'Your picks'}</h2>
          </div>
          <span className="sv-section-meta">{signedOut ? 'SIGN IN TO SYNC' : loading ? 'LOADING YOUR LIST' : hasError ? 'LIST UNAVAILABLE' : `${games.length} ${games.length === 1 ? 'MATCHUP' : 'MATCHUPS'} SAVED`}</span>
        </div>

        {loading ? (
          <div className="sv-loading-list" role="status" aria-label="Loading saved games">
            {[0, 1].map((item) => <div className="sv-skeleton" key={item} aria-hidden="true">
              <div className="sv-skeleton-line" /><div className="sv-skeleton-line" /><div className="sv-skeleton-line" /><div className="sv-skeleton-line" />
            </div>)}
            <span className="sr-only">Loading saved games…</span>
          </div>
        ) : signedOut ? (
          <div className="sv-state" data-testid="status-saved-games-signed-out">
            <div className="sv-state-content">
              <span className="sv-state-mark"><LockKeyhole size={20} aria-hidden="true" /></span>
              <p className="sv-overline">Picks and saved games</p>
              <h3>Track how your picks do.</h3>
              <p>Sign in to make moneyline, spread and over/under picks, save games, and see your record week by week. Everything stays private to your account.</p>
              <Link href="/sign-in" className="sv-primary-link" data-testid="link-sign-in-watchlist">Sign in <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
            <div className="sv-state-visual" aria-hidden="true"><span>YOUR FIELD / YOUR VIEW</span></div>
          </div>
        ) : hasError ? (
          <div className="sv-state sv-state-error" role="alert" data-testid="status-saved-games-error">
            <div className="sv-state-content">
              <span className="sv-state-mark"><WifiOff size={20} aria-hidden="true" /></span>
              <p className="sv-overline">Connection interrupted</p>
              <h3>We couldn’t load your list.</h3>
              <p>Your saved games have not been changed. Try again to get the latest view of your matchups.</p>
               <button type="button" className="sv-retry" onClick={onRetry} data-testid="button-retry-saved-games">
                <RefreshCw size={16} aria-hidden="true" /> Try again
              </button>
            </div>
            <div className="sv-state-visual" aria-hidden="true"><span>AWAITING CONNECTION</span></div>
          </div>
        ) : games.length === 0 ? (<>
          {record}
          <div className="sv-state" data-testid="status-saved-games-empty">
            <div className="sv-state-content">
              <span className="sv-state-mark"><Bookmark size={20} aria-hidden="true" /></span>
              <p className="sv-overline">No saved games yet</p>
              <h3>Start with a matchup.</h3>
              <p>Save a game from its page to keep it here with pick buttons underneath. You can also pick straight from any game page.</p>
              <Link href="/games" className="sv-primary-link" data-testid="link-explore-empty-saved-games">Explore games <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
            <div className="sv-state-visual" aria-hidden="true"><span>THE BOARD IS OPEN</span></div>
          </div>
        </>) : (
          <>
            {record}
            <div className="sv-grid" data-testid="list-saved-games">
              {games.map((game) => <div key={game.gameId} data-testid={`card-saved-game-${game.gameId}`}><ConsumerGameCard game={game} renderSaveControl={renderSaveControl} />{renderPicks?.(game)}</div>)}
            </div>
          </>
        )}
      </section>

      <footer className="sv-footnote">
        <span><strong>Read the signals separately.</strong> Projections are model outputs; market lines are observed quotes when available. Neither is a guarantee.</span>
        <Link href="/methodology" data-testid="link-saved-games-methodology">How Probable reads a game</Link>
      </footer>
    </div>
  );
}