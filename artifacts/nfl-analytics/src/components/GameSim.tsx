import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'wouter';
import { TeamLogo } from '@/components/TeamLogo';
import { lineText, vegasLineText, type GameView } from '@/lib/pick-sheet';
import { homeWinChance, outcomeCounts, simulateMargins } from '@/lib/sim';
import { matchupAccents, teamAccent } from '@/lib/team-colors';

/** "If they played 100 times": shared by Pick'em and Game Detail. */
export type Side = 'home' | 'away';
export type PoolGame = {
  view: GameView;
  homeWin: number;
  source: 'sportsbook' | 'consensus' | 'gridline';
  pick: Side;
  wins: number;
  expectedHomeMargin: number;
  modelPick: Side | null;
  modelWins: number | null;
};

export const other = (side: Side): Side => (side === 'home' ? 'away' : 'home');
export const abbr = (game: PoolGame, side: Side) => game.view.game.matchup[side].abbreviation;

export function toPoolGame(view: GameView): PoolGame | null {
  const model = view.projection;
  const expected = view.market?.homeMargin ?? model?.margin;
  if (expected === undefined || expected === null) return null;
  const homeWin = view.market ? homeWinChance(expected) : model!.homeWin;
  const pick: Side = homeWin >= 0.5 ? 'home' : 'away';
  // The model's pick follows its own win chance, and only counts as a lean at 52% or more.
  const modelPick: Side | null = model && Math.abs(model.homeWin - 0.5) >= 0.02 ? (model.homeWin > 0.5 ? 'home' : 'away') : null;
  return {
    view, homeWin, source: view.market?.source ?? 'gridline', pick,
    wins: Math.round((pick === 'home' ? homeWin : 1 - homeWin) * 100),
    expectedHomeMargin: expected, modelPick,
    modelWins: model && modelPick ? Math.round((modelPick === 'home' ? model.homeWin : 1 - model.homeWin) * 100) : null,
  };
}

/** 100 squares: the pick's wins in its color, the rest in the opponent's. */
export function HundredGrid({ wins, winColor, lossColor, label, animate = false, cells }: {
  wins: number; winColor: string; lossColor: string; label: string; animate?: boolean; cells?: boolean[];
}) {
  const squares = cells ?? Array.from({ length: 100 }, (_, index) => index < wins);
  return <span className={`gl-hundred${animate ? ' run' : ''}`} role="img" aria-label={label}>
    {squares.map((won, index) => <i key={index} style={{ background: won ? winColor : lossColor, animationDelay: animate ? `${index * 14}ms` : undefined } as CSSProperties} />)}
  </span>;
}

export function TeamSide({ game, side, records }: { game: PoolGame; side: Side; records: Map<string, string> }) {
  const team = game.view.game.matchup[side];
  const picked = game.pick === side;
  const qb = side === 'home' ? game.view.projection?.homeQb : game.view.projection?.awayQb;
  return <span className={`gl-pool-team${picked ? ' picked' : ''}`} style={picked ? { '--team': teamAccent(team.abbreviation) } as CSSProperties : undefined}>
    <TeamLogo team={team.abbreviation} size={34} />
    <span>
      <b>{team.abbreviation}</b>
      <small>{records.get(team.abbreviation) ?? team.name}</small>
      {qb?.outName && <em className="gl-flag out">{qb.outName.split(' ').slice(1).join(' ')} out</em>}
    </span>
  </span>;
}

export function Simulator({ game, showLink = true, title = 'If they played 100 times' }: { game: PoolGame; showLink?: boolean; title?: string }) {
  const [seed, setSeed] = useState<number | null>(null);
  const home = abbr(game, 'home');
  const away = abbr(game, 'away');
  const [pickColor, dogColor] = matchupAccents(abbr(game, game.pick), abbr(game, other(game.pick)));
  const colors = game.pick === 'home' ? { home: pickColor, away: dogColor } : { home: dogColor, away: pickColor };
  const outcomes = outcomeCounts(game.expectedHomeMargin);
  const run = useMemo(() => seed === null ? null : simulateMargins(game.expectedHomeMargin, seed), [seed, game.expectedHomeMargin]);
  const pickSign = game.pick === 'home' ? 1 : -1;
  const runWins = run ? run.filter(margin => margin * pickSign > 0).length : 0;
  const biggest = run ? run.reduce((best, margin) => (Math.abs(margin) > Math.abs(best) ? margin : best), 0) : 0;
  const close = outcomes.filter(item => item.label === '1-7').reduce((sum, item) => sum + item.count, 0);
  const blowouts = outcomes.filter(item => item.label === '15+').reduce((sum, item) => sum + item.count, 0);
  const pickName = abbr(game, game.pick);
  const dogName = abbr(game, other(game.pick));
  const upsets = 100 - game.wins;

  return <div className="gl-pool-detail">
    <div className="gl-pool-sim">
      <h3>{title}</h3>
      <div className="gl-outcomes" role="img" aria-label={outcomes.map(item => `${item.side === 'home' ? home : away} by ${item.label}: ${item.count}`).join(', ')}>
        {outcomes.filter(item => item.count > 0).map(item => {
          const strength = item.label === '15+' ? 1 : item.label === '8-14' ? 0.72 : 0.45;
          return <span key={`${item.side}${item.label}`} style={{ flexGrow: item.count, background: colors[item.side], opacity: strength }} title={`${item.side === 'home' ? home : away} by ${item.label}: ${item.count} of 100`}>
            {item.count >= 7 && <b>{item.count}</b>}
          </span>;
        })}
      </div>
      <div className="gl-outcome-legend">
        {outcomes.map(item => <span key={`${item.side}${item.label}`}><i style={{ background: colors[item.side], opacity: item.label === '15+' ? 1 : item.label === '8-14' ? 0.72 : 0.45 }} />{item.side === 'home' ? home : away} by {item.label}<b>{item.count}</b></span>)}
      </div>
      <ul className="gl-sim-facts">
        <li><b>{game.wins}</b> {pickName} wins</li>
        <li><b>{upsets}</b> {dogName} upsets</li>
        <li><b>{close}</b> decided by 7 or fewer</li>
        <li><b>{blowouts}</b> blowouts (15+)</li>
      </ul>
    </div>
    <div className="gl-pool-run">
      <h3>Play them out</h3>
      <p>Each square is one simulated game. Every run is different, which is the point: an 80% favorite still loses about 1 in 5.</p>
      {run ? <HundredGrid key={seed} animate wins={runWins} winColor={colors[game.pick]} lossColor={colors[other(game.pick)]}
        cells={run.map(margin => margin * pickSign > 0)} label={`Simulated run: ${pickName} won ${runWins} of 100`} />
        : <span className="gl-hundred placeholder" aria-hidden="true">{Array.from({ length: 100 }, (_, index) => <i key={index} />)}</span>}
      <div className="gl-run-foot">
        <button type="button" className="gl-button" onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>{run ? 'Run again' : 'Run 100 games'}</button>
        {run && <span aria-live="polite">{pickName} won <b>{runWins}</b>, {dogName} won <b>{100 - runWins}</b>. Biggest: {biggest > 0 ? home : away} by {Math.abs(biggest)}.</span>}
      </div>
    </div>
    <div className="gl-pool-lines">
      <span>Line <b>{game.view.vegas.homeLine !== null ? vegasLineText(game.view.vegas.homeLine, home, away) : lineText(game.expectedHomeMargin, home, away)}</b>
        <small>{game.source === 'sportsbook' ? 'DraftKings/FanDuel' : game.source === 'consensus' ? 'consensus' : 'no line yet: Gridline model'}</small></span>
      {game.view.projection && <span>Gridline <b>{lineText(game.view.projection.margin, home, away)}</b><small>{game.modelWins !== null && game.modelPick ? `${abbr(game, game.modelPick)} ${game.modelWins} of 100` : ''}</small></span>}
      {showLink && <Link href={`/games/${game.view.game.gameId}`} className="gl-link">Full game breakdown ›</Link>}
    </div>
  </div>;
}
