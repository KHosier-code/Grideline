import {
  getListConsumerGamesQueryKey,
  getGetConsumerScheduleSelectionQueryKey,
  useListConsumerGames,
  useGetConsumerScheduleSelection,
  type ConsumerGame,
} from '@workspace/api-client-react';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ConsumerLoading, ConsumerMessage, SaveGameButton, formatKickoff } from './consumer-ui';
import { officialResult, readSlate, type Slate } from '../../lib/consumer-board';
import { TeamMark } from '../../components/VerifiedImage';
import { ConsumerOpeningSummary } from '../../components/ConsumerOpeningSummary';

function GameRow({ game, season, week }: { game: ConsumerGame; season: number; week: number }) {
  const final = officialResult(game);
  return (
    <article className="tb-row board-game" aria-label={`${game.matchup.away.abbreviation} at ${game.matchup.home.abbreviation}`}>
      <div className="tb-row-main">
        <div className="tb-cell tc-matchup">
          <div className="tc-time">
            <span>{formatKickoff(game.kickoffTime)}</span>
            <span>Official status: <b className={`market-state market-state-${game.gameState}`}>{game.gameState}</b></span>
          </div>
          <div className="tc-team"><TeamMark className="tc-team-mark" url={game.matchup.away.logoUrl} abbreviation={game.matchup.away.abbreviation} /><span>{game.matchup.away.name}</span>{final && <b>{final.away}</b>}</div>
          <div className="tc-team"><TeamMark className="tc-team-mark" url={game.matchup.home.logoUrl} abbreviation={game.matchup.home.abbreviation} /><span>{game.matchup.home.name}</span>{final && <b>{final.home}</b>}</div>
          {final && <small className="board-result">Official final result: {game.matchup.away.abbreviation} {final.away} – {game.matchup.home.abbreviation} {final.home}</small>}
        </div>
        <ConsumerOpeningSummary game={game} />
        <div className="tc-action">
          <SaveGameButton gameId={game.gameId} />
          <Link href={`/games/${game.gameId}?season=${season}&week=${week}`} className="btn-icon" aria-label={`Open ${game.matchup.away.abbreviation} at ${game.matchup.home.abbreviation} details`}>
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}

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

  return (
    <div className="terminal-page">
      <header className="terminal-header">
        <div><p className="consumer-eyebrow">Weekly games</p><h1 className="terminal-title">Games & projections</h1><p className="terminal-desc">Saved model projections with the best available lines from each game's first verified request.</p></div>
        <div className="terminal-controls">
          <label className="terminal-select">Season<input aria-label="Season" type="number" min="2020" value={season ?? ''} onChange={(event) => { const value = Number(event.target.value); if (value >= 2020) choose({ season: value, week: week ?? 1 }); }} /></label>
          <label className="terminal-select">Week<select aria-label="Week" value={week ?? ''} onChange={(event) => choose({ season: season ?? 2020, week: Number(event.target.value) })} disabled={!resolved}><option value="" disabled>Choose week</option>{Array.from({ length: 22 }, (_, index) => <option key={index + 1} value={index + 1}>{index < 18 ? `Week ${index + 1}` : `Postseason ${index - 17}`}</option>)}</select></label>
        </div>
      </header>
      {!manual && schedule.data?.reason === 'past' && <p className="board-slate-note">Past slate · No upcoming games in the persisted schedule. Showing the most recent scheduled week.</p>}
      {!manual && schedule.data?.reason === 'live' && <p className="board-slate-note">Live slate selected from the persisted schedule.</p>}
      {!manual && schedule.data?.reason === 'upcoming' && <p className="board-slate-note">Next upcoming slate selected from the persisted schedule.</p>}
      {schedule.isError && !manual && <ConsumerMessage error title="Schedule selection unavailable" detail="We couldn’t read persisted schedule evidence. Select a season and week to browse history." />}
      {!resolved && !schedule.isError && !schedule.isLoading && <ConsumerMessage title="No persisted schedule" detail="There is no dated schedule evidence to select a current week. Enter a season and week to browse manually." />}
       {!resolved ? schedule.isLoading && <ConsumerLoading label="Finding a scheduled slate…" /> : query.isLoading ? <ConsumerLoading label="Loading market board…" /> : query.isError ? <ConsumerMessage error title="Market board unavailable" detail="We couldn’t load this week right now. Please try again shortly." /> : query.data?.games.length ? (
        <section className="terminal-board" aria-label="Weekly NFL projections and opening lines">
           {query.data.games.map((game) => <GameRow key={game.gameId} game={game} season={season!} week={week!} />)}
        </section>
      ) : <ConsumerMessage title="No games found" detail="There are no available matchups for this season and week. Try another week." />}
    </div>
  );
}
