import { useEffect, useMemo, useState } from 'react';
import type { ConsumerGame } from '@workspace/api-client-react';
import { TeamLogo } from '@/components/TeamLogo';
import { abbr, other, type PoolGame } from '@/components/GameSim';
import { normalizeTeam } from '@/lib/parlay';
import { contrarianOptions, expectedPoints, survivorOptions, type PoolPick } from '@/lib/pool-strategy';

const pct = (value: number) => `${Math.round(value * 100)}%`;
const USED_KEY = 'gridline.survivor.used';

function readUsed(season: number) {
  try {
    const raw = window.localStorage.getItem(`${USED_KEY}.${season}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').map(normalizeTeam) : []);
  } catch {
    return new Set<string>();
  }
}

function writeUsed(season: number, used: Set<string>) {
  try {
    window.localStorage.setItem(`${USED_KEY}.${season}`, JSON.stringify([...used]));
  } catch {
    // Private windows can block storage; the picker still works for this visit.
  }
}

/** Contrarian options for big confidence pools. */
export function PoolStrategy({ games, points, now }: { games: PoolGame[]; points: (game: PoolGame) => number; now: number }) {
  const [big, setBig] = useState(false);
  const picks: PoolPick[] = games.map(game => ({
    gameId: game.view.game.gameId, team: abbr(game, game.pick), opponent: abbr(game, other(game.pick)),
    chance: game.wins / 100, points: points(game),
    modelDisagrees: game.modelPick !== null && game.modelPick !== game.pick && game.source !== 'gridline',
    locked: game.view.game.kickoffTime ? Date.parse(game.view.game.kickoffTime) <= now : false,
  }));
  const options = contrarianOptions(picks);
  const total = expectedPoints(picks);
  return <section className="gl-section" aria-labelledby="strategy-heading">
    <div className="gl-section-head">
      <h2 id="strategy-heading">Pool strategy</h2>
      <div className="gl-filters" role="group" aria-label="Pool size">
        <button type="button" aria-pressed={!big} onClick={() => setBig(false)}>Small pool</button>
        <button type="button" aria-pressed={big} onClick={() => setBig(true)}>Big pool (20+)</button>
      </div>
    </div>
    {!big ? <p className="gl-muted">In a small pool, the sheet above is the one to play: it scores the most points on average (about {total.toFixed(1)} this week).</p>
      : <div className="gl-card gl-strategy">
        <p>In a big pool, dozens of players send in nearly the same favorites-only sheet, so it rarely finishes first on its own. Taking an underdog in a close game or two sets you apart for the smallest cost in expected points. We don&apos;t know what your pool picks, so this is based on win chances alone.</p>
        {options.length ? <ul>{options.map(option => <li key={option.gameId}>
          <TeamLogo team={option.upset} size={22} /><b>{option.upset}</b> over {option.team}
          <span>{pct(option.upsetChance)} to win · costs {option.cost.toFixed(1)} of {total.toFixed(1)} expected points{option.modelDisagrees ? ' · our model leans this way' : ''}</span>
        </li>)}</ul> : <p className="gl-muted">No close games left this week to flip.</p>}
      </div>}
  </section>;
}

/** Survivor pool planner: unused teams this week, with each team's best later spot. */
export function SurvivorPlanner({ season, games, future, ratings, now }: {
  season: number; games: PoolGame[]; future: ConsumerGame[]; ratings: Map<string, number>; now: number;
}) {
  const [used, setUsed] = useState<Set<string>>(() => readUsed(season));
  useEffect(() => setUsed(readUsed(season)), [season]);
  // Every team, including those on bye, stored as nflverse codes (LA, WAS) so used picks survive either spelling.
  const teams = useMemo(() => [...new Set([...ratings.keys(), ...games.flatMap(game => [abbr(game, 'home'), abbr(game, 'away')].map(normalizeTeam))])].sort(),
    [games, ratings]);
  const currentWeek = games[0]?.view.game.week;
  const options = useMemo(() => survivorOptions(
    games.map(game => ({
      home: normalizeTeam(abbr(game, 'home')), away: normalizeTeam(abbr(game, 'away')), homeWin: game.homeWin,
      locked: game.view.game.kickoffTime ? Date.parse(game.view.game.kickoffTime) <= now : false,
    })),
    future.filter(game => game.week !== currentWeek && game.season === season)
      .map(game => ({ week: game.week, home: normalizeTeam(game.matchup.home.abbreviation), away: normalizeTeam(game.matchup.away.abbreviation) })),
    ratings,
    used,
  ).slice(0, 8), [games, future, ratings, used, now, season, currentWeek]);
  const toggle = (team: string) => {
    const next = new Set(used);
    team = normalizeTeam(team);
    if (next.has(team)) next.delete(team); else next.add(team);
    setUsed(next);
    writeUsed(season, next);
  };
  return <section className="gl-section" aria-labelledby="survivor-heading">
    <div className="gl-section-head"><h2 id="survivor-heading">Survivor pool</h2><p>Tap the teams you&apos;ve already used. We save them on this device.</p></div>
    <div className="gl-survivor-used" role="group" aria-label="Teams already used">
      {teams.map(team => <button key={team} type="button" className="gl-chip-button" aria-pressed={used.has(team)} onClick={() => toggle(team)}>
        <TeamLogo team={team} size={20} />{team}
      </button>)}
    </div>
    {options.length ? <div className="gl-card gl-table-wrap">
      <table className="gl-table">
        <thead><tr><th scope="col">Team</th><th scope="col">This week</th><th scope="col">Win chance</th><th scope="col">Better spot later</th></tr></thead>
        <tbody>{options.map(option => <tr key={option.team}>
          <th scope="row"><TeamLogo team={option.team} size={20} /> {option.team}</th>
          <td>vs {option.opponent}</td>
          <td>{pct(option.chance)}</td>
          <td>{option.bestLater ? `Week ${option.bestLater.week} vs ${option.bestLater.opponent} (${pct(option.bestLater.chance)})` : 'This is its best spot'}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="gl-muted">Every team playing this week is used or already kicked off.</p>}
    <p className="gl-note">This week&apos;s chances come from the betting line. Later weeks use our power ratings plus home field, since lines aren&apos;t posted yet, so treat them as rough. A team with a much better spot later may be worth saving if another pick this week is nearly as safe.</p>
  </section>;
}
