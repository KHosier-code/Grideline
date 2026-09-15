import { getListConsumerGamesQueryKey, useListConsumerGames } from '@workspace/api-client-react';
import { useState } from 'react';
import { ConsumerGameCard, ConsumerLoading, ConsumerMessage } from './consumer-ui';

export default function ConsumerGames() {
  const now = new Date();
  const [season, setSeason] = useState(now.getFullYear());
  const [week, setWeek] = useState(1);
  const params = { season, week };
  const query = useListConsumerGames(params, { query: { queryKey: getListConsumerGamesQueryKey(params), staleTime: 30_000 } });
  return <div className="consumer-page">
    <header className="consumer-page-header"><div><p className="consumer-eyebrow">Schedule</p><h1>Games & projections</h1><p>Choose a week to review persisted projections and available market context.</p></div><div className="consumer-filters"><label>Season<input aria-label="Season" type="number" min="2020" value={season} onChange={e => setSeason(Number(e.target.value))} /></label><label>Week<select aria-label="Week" value={week} onChange={e => setWeek(Number(e.target.value))}>{Array.from({ length: 22 }, (_, i) => <option key={i + 1} value={i + 1}>{i < 18 ? `Week ${i + 1}` : `Postseason ${i - 17}`}</option>)}</select></label></div></header>
    {query.isLoading ? <ConsumerLoading /> : query.isError ? <ConsumerMessage error title="Games are temporarily unavailable" detail="We couldn’t load this schedule right now. Please try again shortly." /> : query.data?.games.length ? <div className="consumer-card-grid">{query.data.games.map(game => <ConsumerGameCard key={game.gameId} game={game} />)}</div> : <ConsumerMessage title="No games found" detail="There are no available matchups for this season and week. Try another week." />}
  </div>;
}