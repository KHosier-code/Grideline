import {
  getGetConsumerGameProjectionsQueryKey,
  getListConsumerGamesQueryKey,
  getGetConsumerScheduleSelectionQueryKey,
  useGetConsumerGameProjections,
  useListConsumerGames,
  useGetConsumerScheduleSelection,
} from '@workspace/api-client-react';
import { useEffect, useMemo, useState } from 'react';
import { ConsumerLoading, useConsumerNow } from './consumer-ui';
import { readSlate, type Slate } from '../../lib/consumer-board';
import { buildGameView } from '../../lib/pick-sheet';
import { GameBoard } from '../../components/GameBoard';

export default function ConsumerGames() {
  const [selection, setSelection] = useState<Slate | null>(() => readSlate(window.location.search));
  const [manual, setManual] = useState(() => readSlate(window.location.search) !== null);
  const schedule = useGetConsumerScheduleSelection({ query: { queryKey: getGetConsumerScheduleSelectionQueryKey(), staleTime: 60_000, refetchOnWindowFocus: true } });
  const resolved = manual ? selection : schedule.data?.selection ?? null;
  const season = resolved?.season;
  const week = resolved?.week;
  useEffect(() => {
    if (!resolved || !manual) return;
    const search = new URLSearchParams({ season: String(resolved.season), week: String(resolved.week) });
    window.history.replaceState(window.history.state, '', `/games?${search.toString()}`);
  }, [manual, resolved?.season, resolved?.week]);
  useEffect(() => {
    const onPop = () => { const next = readSlate(window.location.search); setSelection(next); setManual(next !== null); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const choose = (next: Slate) => { setSelection(next); setManual(true); };
  const params = { season: season ?? 2020, week: week ?? 1 };
  const query = useListConsumerGames(params, { query: { queryKey: getListConsumerGamesQueryKey(params), enabled: Boolean(resolved), staleTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: true } });

  const now = useConsumerNow();
  const projectionParams = season ? { season } : undefined;
  const projections = useGetConsumerGameProjections(projectionParams, { query: { queryKey: getGetConsumerGameProjectionsQueryKey(projectionParams), enabled: Boolean(season) } });
  const views = useMemo(() => {
    const byGame = new Map((projections.data?.games ?? []).map(projection => [projection.gameId, projection]));
    return (query.data?.games ?? []).map(game => buildGameView(game, byGame.get(game.gameId)));
  }, [query.data, projections.data]);

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{season && week ? `${season} season · ${week <= 18 ? `Week ${week}` : `Postseason round ${week - 18}`}` : 'Games'}</p>
        <h1 className="gl-title">Every <span>game</span></h1>
        <p className="gl-lede">Our projected score and line for every game next to the sportsbook&apos;s, with final scores once games are played. Pick any week this season or past seasons.</p>
      </div>
      <div className="gl-week-nav">
        <label className="gl-week-nav"><span className="gl-label">Season</span>
          <select id="games-season" value={season ?? ''} onChange={event => choose({ season: Number(event.target.value), week: week ?? 1 })}>
            {!season && <option value="" disabled>Season</option>}
            {Array.from({ length: Math.max(1, (schedule.data?.selection?.season ?? new Date().getFullYear()) - 2020 + 1) }, (_, index) => (schedule.data?.selection?.season ?? new Date().getFullYear()) - index)
              .map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="gl-week-nav"><span className="gl-label">Week</span>
          <select id="games-week" value={week ?? ''} disabled={!resolved} onChange={event => choose({ season: season ?? 2020, week: Number(event.target.value) })}>
            <option value="" disabled>Week</option>
            {Array.from({ length: 22 }, (_, index) => <option key={index + 1} value={index + 1}>{index < 18 ? `Week ${index + 1}` : `Postseason ${index - 17}`}</option>)}
          </select>
        </label>
      </div>
    </header>

    {schedule.isError && !manual && <div className="gl-empty"><strong>We couldn&apos;t find this week&apos;s schedule.</strong>Pick a season and week above.</div>}
    {!resolved && schedule.isLoading && <ConsumerLoading label="Finding this week's games…" />}
    {resolved && query.isLoading && <ConsumerLoading label="Loading games…" />}
    {resolved && query.isError && <div className="gl-empty"><strong>We couldn&apos;t load these games.</strong>Refresh the page in a minute.</div>}
    {resolved && query.data && (views.length
      ? <section className="gl-section" aria-label="Games this week"><GameBoard views={views} now={now} /></section>
      : <div className="gl-empty"><strong>No games this week.</strong>Try another week.</div>)}
  </div>;
}
