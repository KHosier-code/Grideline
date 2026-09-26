import { getListSavedGamesQueryKey, useListSavedGames } from '@workspace/api-client-react';
import { useAuth } from '@clerk/react';
import { Link } from 'wouter';
import { ConsumerGameCard, ConsumerLoading, ConsumerMessage } from './consumer-ui';

export default function ConsumerSavedGames() {
  const { userId } = useAuth();
  const query = useListSavedGames({ query: {
    queryKey: [...getListSavedGamesQueryKey(), userId],
    enabled: Boolean(userId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  } });
  if (query.isLoading || !userId) return <ConsumerLoading label="Loading saved games…" />;
  return <div className="consumer-page">
    <header className="consumer-section-heading"><div><p className="consumer-eyebrow">Your matchups</p><h1>Saved games</h1>
      <p>Games you follow, with the latest eligible persisted projection and market evidence.</p></div>
      <Link href="/games">Browse games</Link>
    </header>
    {query.isError ? <ConsumerMessage error title="Saved games unavailable" detail="We couldn’t load your saved games. Please try again shortly." />
      : query.data?.length ? <div className="saved-games-grid">{query.data.map((game) => <ConsumerGameCard key={game.gameId} game={game} />)}</div>
      : <ConsumerMessage title="No saved games yet" detail="Browse Games and save a matchup to keep it here." />}
  </div>;
}