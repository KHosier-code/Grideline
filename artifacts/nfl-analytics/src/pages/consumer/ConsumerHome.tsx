import { getGetConsumerDashboardQueryKey, useGetConsumerDashboard } from '@workspace/api-client-react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { ConsumerGameCard, ConsumerLoading, ConsumerMessage, useConsumerNow } from './consumer-ui';
import { ConsumerSourceHealth } from '../../components/ConsumerSourceHealth';

export default function ConsumerHome() {
  const query = useGetConsumerDashboard({ query: { queryKey: getGetConsumerDashboardQueryKey(), staleTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: true } });
  const now = useConsumerNow();
  if (query.isLoading) return <ConsumerLoading label="Loading this week’s matchups…" />;
  if (query.isError || !query.data) return <ConsumerMessage error title="The latest view is temporarily unavailable" detail="We’re updating the current projections. Please try again shortly." />;
  const upcoming = query.data.games.filter(game => game.kickoffTime && new Date(game.kickoffTime).getTime() > now
    && (game.gameState === 'pregame' || game.gameState === 'scheduled')).slice(0, 6);
  return <div className="consumer-page">
    <header className="consumer-hero"><div><p className="consumer-eyebrow">Upcoming NFL games</p><h1>The next matchups, clearly explained.</h1><p>Explore saved projections and current market evidence without treating incomplete information as a recommendation.</p><Link href="/games" className="button button-primary">Browse games <ArrowRight className="h-4 w-4" /></Link></div><img src={`${import.meta.env.BASE_URL}logo-icon.png`} alt="" className="consumer-hero-icon" /></header>
    <div className="consumer-section-heading"><div><p className="consumer-eyebrow">Upcoming games</p><h2>The next slate</h2></div><Link href="/games">Browse all games <ArrowRight className="h-4 w-4" /></Link></div>
    {upcoming.length ? <div className="consumer-card-grid">{upcoming.map(game => <ConsumerGameCard key={game.gameId} game={game} />)}</div> : <ConsumerMessage title="No upcoming games are available" detail="The next slate will appear here when the persisted schedule is available. Browse Games for past matchups." />}
    <ConsumerSourceHealth health={query.data.sourceHealth} compact />
  </div>;
}