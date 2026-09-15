import { getGetConsumerDashboardQueryKey, useGetConsumerDashboard } from '@workspace/api-client-react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { ConsumerGameCard, ConsumerLoading, ConsumerMessage } from './consumer-ui';

export default function ConsumerHome() {
  const query = useGetConsumerDashboard({ query: { queryKey: getGetConsumerDashboardQueryKey(), staleTime: 30_000 } });
  if (query.isLoading) return <ConsumerLoading label="Loading this week’s matchups…" />;
  if (query.isError || !query.data) return <ConsumerMessage error title="The latest view is temporarily unavailable" detail="We’re updating the current projections. Please try again shortly." />;
  return <div className="consumer-page">
    <header className="consumer-hero"><div><p className="consumer-eyebrow">Current NFL outlook</p><h1>Understand the matchup.</h1><p>Persisted projections, current market context, and verified model performance—presented without engineering internals.</p></div><ShieldCheck className="consumer-hero-icon" /></header>
    <div className="consumer-section-heading"><div><p className="consumer-eyebrow">Upcoming games</p><h2>The current slate</h2></div><Link href="/games">Browse all games <ArrowRight className="h-4 w-4" /></Link></div>
    {query.data.games.length ? <div className="consumer-card-grid">{query.data.games.slice(0, 6).map(game => <ConsumerGameCard key={game.gameId} game={game} />)}</div> : <ConsumerMessage title="No upcoming games are available" detail="The next slate will appear here after the schedule and persisted projections are available." />}
  </div>;
}