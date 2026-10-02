import './MyPicks.css';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import { Link } from 'wouter';
import {
  getListMyPicksQueryKey, useListMyPicks, useRemoveMyPick, useSaveMyPick,
  type ConsumerGame, type ConsumerMyPick, type ConsumerMyPickRecord, type ConsumerMyPicks,
} from '@workspace/api-client-react';

type Market = 'moneyline' | 'spread' | 'total';
type PickSide = 'home' | 'away' | 'over' | 'under';

const MARKETS: Array<{ key: Market; label: string }> = [
  { key: 'moneyline', label: 'Moneyline' }, { key: 'spread', label: 'Spread' }, { key: 'total', label: 'Over/under' },
];

const price = (value: number | null | undefined) => value === null || value === undefined ? '' : value > 0 ? `+${value}` : String(value);
const point = (value: number) => value === 0 ? 'PK' : `${value > 0 ? '+' : ''}${value}`;
const units = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}u`;

export function useMyPicks() {
  const { userId } = useAuth();
  return useListMyPicks({ query: { queryKey: [...getListMyPicksQueryKey(), userId], enabled: Boolean(userId), staleTime: 0, refetchOnWindowFocus: true } });
}

/** The two buttons for a market, from the game's latest captured quotes. */
function options(game: ConsumerGame, market: Market): Array<{ side: PickSide; text: string }> | null {
  const home = game.matchup.home.abbreviation;
  const away = game.matchup.away.abbreviation;
  const m = game.market;
  if (market === 'moneyline') return [
    { side: 'away', text: `${away} ${price(m.awayMoneyline?.price)}`.trim() },
    { side: 'home', text: `${home} ${price(m.moneyline?.price)}`.trim() },
  ];
  if (market === 'spread') {
    const line = m.spread?.point;
    if (line === null || line === undefined) return null;
    return [{ side: 'away', text: `${away} ${point(-line)}` }, { side: 'home', text: `${home} ${point(line)}` }];
  }
  const total = m.total?.point;
  if (total === null || total === undefined) return null;
  return [{ side: 'over', text: `Over ${total}` }, { side: 'under', text: `Under ${total}` }];
}

/** How the pick reads at the number it was locked at, e.g. "KC -3.5 (-110)". */
export function lockedText(pick: ConsumerMyPick) {
  const team = pick.side === 'home' ? pick.home.abbreviation : pick.side === 'away' ? pick.away.abbreviation : null;
  const quoted = pick.price === null ? '' : ` (${price(pick.price)})`;
  if (pick.market === 'moneyline') return `${team} to win${quoted}`;
  if (pick.market === 'spread') return `${team} ${point(pick.line ?? 0)}${quoted}`;
  return `${pick.side === 'over' ? 'Over' : 'Under'} ${pick.line}${quoted}`;
}

const RESULT = { win: ['win', 'Won'], loss: ['loss', 'Lost'], push: ['small', 'Push'] } as const;

/** Moneyline, spread and over/under buttons for one game. Locked at kickoff. */
export function PickControls({ game, picks }: { game: ConsumerGame; picks: ConsumerMyPick[] }) {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: getListMyPicksQueryKey() });
  const save = useSaveMyPick({ mutation: { onSuccess: refresh } });
  const remove = useRemoveMyPick({ mutation: { onSuccess: refresh } });
  const kickoff = game.kickoffTime ? Date.parse(game.kickoffTime) : NaN;
  const locked = !Number.isFinite(kickoff) || kickoff <= Date.now() || !(game.gameState === 'scheduled' || game.gameState === 'pregame');
  const busy = save.isPending || remove.isPending;
  const error = (save.error ?? remove.error) as { data?: { error?: string } } | null;
  return <div className="my-picks" aria-label={`Your picks for ${game.matchup.away.abbreviation} at ${game.matchup.home.abbreviation}`}>
    <p className="my-picks-title">Your picks{locked ? ' · locked' : ''}</p>
    {MARKETS.map(({ key, label }) => {
      const mine = picks.find(pick => pick.market === key);
      const buttons = options(game, key);
      return <div className="my-picks-row" key={key}>
        <span className="my-picks-label">{label}</span>
        {locked || !buttons
          ? <span className="my-picks-locked">{mine ? <><b>{lockedText(mine)}</b>{mine.result && <span className={`gl-pill ${RESULT[mine.result][0]}`}>{RESULT[mine.result][1]}</span>}</>
            : locked ? 'No pick' : 'Line not posted yet'}</span>
          : <span className="my-picks-buttons">{buttons.map(option => {
            const picked = mine?.side === option.side;
            return <button key={option.side} type="button" aria-pressed={picked} disabled={busy}
              onClick={() => picked ? remove.mutate({ gameId: game.gameId, market: key }) : save.mutate({ gameId: game.gameId, market: key, data: { side: option.side } })}>
              {option.text}
            </button>;
          })}</span>}
        {!locked && mine && <small className="my-picks-taken">Taken at {lockedText(mine)}</small>}
      </div>;
    })}
    {error && <small role="alert" className="my-picks-error">{error.data?.error ?? 'Your pick wasn’t saved. Try again.'}</small>}
  </div>;
}

function line(record: ConsumerMyPickRecord) {
  return `${record.wins}-${record.losses}${record.pushes ? `-${record.pushes}` : ''}`;
}

const rate = (record: ConsumerMyPickRecord) => record.wins + record.losses
  ? `${Math.round((record.wins / (record.wins + record.losses)) * 100)}%` : '—';

/** Overall, by-market and week-by-week record for the signed-in user. */
export function MyPicksRecord({ data }: { data: ConsumerMyPicks }) {
  const { overall, byMarket, byWeek } = data.record;
  if (!data.picks.length) return <div className="my-record my-record-empty">
    <p className="sv-overline">Your record</p>
    <p>Make a moneyline, spread or over/under pick from any game page or on a saved game below. Each pick locks at kickoff at the sportsbook number you took, and your record fills in as games finish.</p>
  </div>;
  return <div className="my-record">
    <div className="my-record-top">
      <div><p className="sv-overline">Your record</p><strong>{line(overall)}</strong><span>{rate(overall)} · {units(overall.units)}{overall.pending ? ` · ${overall.pending} pending` : ''}</span></div>
      {MARKETS.map(({ key, label }) => <div key={key}><p className="sv-overline">{label}</p><strong>{line(byMarket[key])}</strong><span>{rate(byMarket[key])} · {units(byMarket[key].units)}</span></div>)}
    </div>
    <table className="my-record-weeks">
      <caption>Week by week</caption>
      <thead><tr><th scope="col">Week</th><th scope="col">Record</th><th scope="col">Win %</th><th scope="col">Units</th><th scope="col">Pending</th></tr></thead>
      <tbody>{byWeek.map(week => <tr key={`${week.season}-${week.week}`}>
        <th scope="row">{week.season} week {week.week}</th><td>{line(week)}</td><td>{rate(week)}</td><td>{units(week.units)}</td><td>{week.pending || '—'}</td>
      </tr>)}</tbody>
    </table>
    <p className="my-record-note">Units are profit for 1 unit per pick at the price you took (-110 when no price was saved). Pushes don&apos;t count toward win %.</p>
  </div>;
}


/** Pick buttons on a game page, or a sign-in prompt. */
export function GamePicks({ game }: { game: ConsumerGame }) {
  const { isLoaded, isSignedIn } = useAuth();
  const picks = useMyPicks();
  if (!isLoaded) return null;
  if (!isSignedIn) return <p className="my-picks-signin">
    <Link href="/sign-in">Sign in</Link> to make your own moneyline, spread and over/under picks and track your record.
  </p>;
  if (picks.isError) return null;
  const mine = (picks.data?.picks ?? []).filter(pick => pick.gameId === game.gameId);
  return <div className="my-picks-game my-scope">
    <PickControls game={game} picks={mine} />
    <Link href="/my-picks" className="my-picks-record-link">See your record</Link>
  </div>;
}

/** Every pick the user has made, newest week first, each linking to its game. */
export function MyPicksList({ picks }: { picks: ConsumerMyPick[] }) {
  if (!picks.length) return null;
  const sorted = [...picks].sort((a, b) => b.season - a.season || b.week - a.week
    || (Date.parse(b.kickoffTime ?? '') || 0) - (Date.parse(a.kickoffTime ?? '') || 0));
  return <section className="my-picks-list" aria-labelledby="my-picks-list-title">
    <h2 id="my-picks-list-title">All your picks</h2>
    <ul>{sorted.map(pick => <li key={`${pick.gameId}-${pick.market}`}>
      <span className="my-picks-list-week">Week {pick.week}</span>
      <Link href={`/games/${pick.gameId}`}>{pick.away.abbreviation} at {pick.home.abbreviation}</Link>
      <b>{lockedText(pick)}</b>
      {pick.result ? <span className={`gl-pill ${RESULT[pick.result][0]}`}>{RESULT[pick.result][1]}</span> : <span className="my-picks-list-pending">Pending</span>}
    </li>)}</ul>
  </section>;
}
