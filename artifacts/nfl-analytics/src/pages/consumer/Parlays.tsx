import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  getGetConsumerDashboardQueryKey, getGetConsumerGameProjectionsQueryKey, getGetConsumerTouchdownsQueryKey,
  useGetConsumerDashboard, useGetConsumerGameProjections, useGetConsumerTouchdowns,
} from '@workspace/api-client-react';
import { HundredGrid, toPoolGame } from '@/components/GameSim';
import { TeamLogo } from '@/components/TeamLogo';
import { addLeg, fairAmerican, gameKeyFor, quoteParlay, simulateParlay, type ParlayLeg } from '@/lib/parlay';
import { devig } from '@/lib/market';
import { shareCardImage } from '@/lib/share-image';
import { buildGameView, currentWeek, formatPrice } from '@/lib/pick-sheet';
import { ConsumerLoading, useConsumerNow } from './consumer-ui';

const HIT = 'hsl(var(--primary))';
const MISS = 'hsl(var(--secondary))';
const pctText = (value: number) => (value >= 0.995 ? '99+' : value < 0.005 ? '<1' : String(Math.round(value * 100)));
const price = (value: number | null) => (value === null ? '—' : formatPrice(value));
const started = (kickoff: string | null, now: number) => kickoff !== null && Date.parse(kickoff) <= now;

function useParlayLegs(now: number) {
  const dashboard = useGetConsumerDashboard({ query: { queryKey: getGetConsumerDashboardQueryKey(), staleTime: 60_000 } });
  const week = useMemo(() => currentWeek(dashboard.data?.games ?? [], now), [dashboard.data, now]);
  const params = week ? { season: week.season } : undefined;
  const projections = useGetConsumerGameProjections(params, { query: { queryKey: getGetConsumerGameProjectionsQueryKey(params), enabled: week !== null } });
  const touchdowns = useGetConsumerTouchdowns(undefined, { query: { queryKey: getGetConsumerTouchdownsQueryKey() } });

  return useMemo(() => {
    const byGame = new Map((projections.data?.games ?? []).map(projection => [projection.gameId, projection]));
    const winners: ParlayLeg[] = [];
    for (const game of week?.games ?? []) {
      if (game.finalScore || started(game.kickoffTime, now)) continue;
      const pool = toPoolGame(buildGameView(game, byGame.get(game.gameId)));
      if (!pool) continue;
      const home = game.matchup.home.abbreviation;
      const away = game.matchup.away.abbreviation;
      const key = gameKeyFor(home, away);
      // The payout is a moneyline price, so the chance should come from the same
      // market: both moneyline sides with the vig removed. The spread is the fallback.
      const homePrice = game.market?.moneyline?.price ?? null;
      const awayPrice = game.market?.awayMoneyline?.price ?? null;
      const homeWin = homePrice !== null && awayPrice !== null ? devig(homePrice, awayPrice)[0] : pool.homeWin;
      winners.push(
        { id: `win-${home}-${key}`, kind: 'winner', team: home, gameKey: key, label: `${home} to win`, detail: `vs ${away}`, probability: homeWin,
          bookPrice: homePrice, kickoff: game.kickoffTime },
        { id: `win-${away}-${key}`, kind: 'winner', team: away, gameKey: key, label: `${away} to win`, detail: `at ${home}`, probability: 1 - homeWin,
          bookPrice: awayPrice, kickoff: game.kickoffTime },
      );
    }
    winners.sort((a, b) => b.probability - a.probability);
    const scorers: ParlayLeg[] = (touchdowns.data?.picks ?? [])
      .filter(pick => !started(pick.kickoff, now) && !/^out/i.test(pick.injuryStatus ?? ''))
      .map(pick => ({
        id: `td-${pick.playerId}`, kind: 'td' as const, team: pick.team, gameKey: gameKeyFor(pick.team, pick.opponent),
        label: `${pick.name} TD`, detail: `Anytime TD · ${pick.position} · ${pick.team} ${pick.isHome ? 'vs' : 'at'} ${pick.opponent}`,
        probability: pick.probability, bookPrice: pick.bookOdds?.price ?? null, kickoff: pick.kickoff,
      }));
    return {
      week, winners, scorers,
      loading: dashboard.isLoading || projections.isLoading || touchdowns.isLoading,
    };
  }, [week, projections.data, touchdowns.data, dashboard.isLoading, projections.isLoading, touchdowns.isLoading, now]);
}

/** Greedy pick of the most likely legs, one per game. */
function pickLegs(candidates: ParlayLeg[], count: number, taken = new Set<string>()) {
  const legs: ParlayLeg[] = [];
  for (const leg of candidates) {
    if (legs.length === count) break;
    if (taken.has(leg.gameKey) || legs.some(item => item.gameKey === leg.gameKey)) continue;
    legs.push(leg);
  }
  return legs.length === count ? legs : null;
}

function Suggested({ winners, scorers, onLoad }: { winners: ParlayLeg[]; scorers: ParlayLeg[]; onLoad: (legs: ParlayLeg[]) => void }) {
  const safest = pickLegs(winners, 2);
  const trio = pickLegs(scorers, 3);
  const mixWinners = pickLegs(winners, 2);
  const mix = mixWinners ? (() => {
    const scorer = pickLegs(scorers, 1, new Set(mixWinners.map(leg => leg.gameKey)));
    return scorer ? [...mixWinners, ...scorer] : null;
  })() : null;
  const cards = [
    { title: 'Safest pair', blurb: 'The two surest winners on the board', legs: safest },
    { title: 'TD trio', blurb: 'Our three likeliest scorers, from three games', legs: trio },
    { title: 'Favorites + a scorer', blurb: 'Two surest winners and our top scorer elsewhere', legs: mix },
  ].filter((card): card is { title: string; blurb: string; legs: ParlayLeg[] } => card.legs !== null);
  if (!cards.length) return null;
  return <section className="gl-section" aria-labelledby="suggested-heading">
    <div className="gl-section-head"><h2 id="suggested-heading">This week&apos;s parlays</h2><p>Built from our numbers, with their real chances</p></div>
    <div className="gl-parlay-suggest">
      {cards.map(card => {
        const quote = quoteParlay(card.legs);
        return <div key={card.title} className="gl-card">
          <span className="gl-label">{card.title}</span>
          <div className="gl-parlay-suggest-top">
            <HundredGrid wins={Math.round(quote.probability * 100)} winColor={HIT} lossColor={MISS} label={`Hits ${pctText(quote.probability)} of 100`} />
            <span><b>{pctText(quote.probability)}</b><small>of 100 hit · fair {price(quote.fairOdds)}</small></span>
          </div>
          <ul>{card.legs.map(leg => <li key={leg.id}>{leg.label}<span>{pctText(leg.probability)}%</span></li>)}</ul>
          <p>{card.blurb}</p>
          <button type="button" className="gl-button" onClick={() => onLoad(card.legs)}>Open in builder</button>
        </div>;
      })}
    </div>
  </section>;
}

function LegButton({ leg, selected, onToggle }: { leg: ParlayLeg; selected: boolean; onToggle: () => void }) {
  return <button type="button" className={`gl-leg${selected ? ' on' : ''}`} aria-pressed={selected} onClick={onToggle}>
    <TeamLogo team={leg.team} size={24} />
    <span className="gl-leg-text"><b>{leg.label}</b><small>{leg.detail}</small></span>
    <span className="gl-leg-odds"><b>{pctText(leg.probability)}%</b><small>{leg.bookPrice !== null ? `book ${price(leg.bookPrice)}` : `fair ${price(fairAmerican(leg.probability))}`}</small></span>
  </button>;
}

function Slip({ legs, onRemove, onClear }: { legs: ParlayLeg[]; onRemove: (id: string) => void; onClear: () => void }) {
  const [seed, setSeed] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const quote = quoteParlay(legs);
  const runs = useMemo(() => (seed === null || !legs.length ? null : simulateParlay(legs, seed)), [seed, legs]);
  const hits = runs?.filter(run => run.hit).length ?? 0;
  const oneAway = runs?.filter(run => run.misses === 1).length ?? 0;
  const hitCount = Math.round(quote.probability * 100);

  if (!legs.length) {
    return <aside id="parlay-slip" className="gl-card gl-slip" aria-label="Parlay slip">
      <span className="gl-label">Your parlay</span>
      <p className="gl-slip-empty">Add legs from the list: game winners and anytime touchdown scorers, one leg per game.</p>
    </aside>;
  }
  const text = [`My parlay (${legs.length} legs)`, ...legs.map(leg => `• ${leg.label} (${pctText(leg.probability)}%)`),
    `Gridline: hits ${pctText(quote.probability)} of 100, fair ${price(quote.fairOdds)}`, 'gridelineanalytics.com/parlays'].join('\n');
  return <aside id="parlay-slip" className="gl-card gl-slip" aria-label="Parlay slip">
    <div className="gl-slip-head"><span className="gl-label">Your parlay · {legs.length} {legs.length === 1 ? 'leg' : 'legs'}</span><button type="button" className="gl-link" onClick={onClear}>Clear</button></div>
    <ul className="gl-slip-legs">{legs.map(leg => <li key={leg.id}>
      <span><b>{leg.label}</b><small>{leg.detail}</small></span><span>{pctText(leg.probability)}%</span>
      <button type="button" aria-label={`Remove ${leg.label}`} onClick={() => onRemove(leg.id)}>×</button>
    </li>)}</ul>
    <div className="gl-slip-result">
      <HundredGrid key={seed ?? 'expected'} animate={runs !== null} wins={runs ? hits : hitCount} winColor={HIT} lossColor={MISS}
        cells={runs?.map(run => run.hit)} label={runs ? `Simulated: hit ${hits} of 100` : `Hits ${pctText(quote.probability)} of 100`} />
      <div>
        <b className="gl-slip-big">{pctText(quote.probability)}<small> of 100</small></b>
        <p>{quote.probability >= 0.5 ? 'Hits more often than not.' : `Misses about ${100 - hitCount} of every 100 times.`}</p>
      </div>
    </div>
    <dl className="gl-slip-odds">
      <div><dt>Fair payout</dt><dd>{price(quote.fairOdds)}</dd></div>
      <div><dt>Book payout</dt><dd>{quote.bookOdds !== null ? price(quote.bookOdds) : 'Not all legs priced'}</dd></div>
      {quote.expectedOnTen !== null && legs.every(leg => leg.kind === 'winner')
        && <div><dt>Book&apos;s cut per $10</dt><dd>{quote.expectedOnTen >= 0 ? '+' : '−'}${Math.abs(quote.expectedOnTen).toFixed(2)}</dd></div>}
    </dl>
    <div className="gl-run-foot">
      <button type="button" className="gl-button" onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>{runs ? 'Run again' : 'Simulate 100 weekends'}</button>
      <button type="button" className="gl-button ghost" onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
      }}>{copied ? 'Copied' : 'Copy'}</button>
      <button type="button" className="gl-button ghost" onClick={() => void shareCardImage({
        eyebrow: `${legs.length}-leg parlay`, title: 'My parlay',
        grid: { wins: hitCount, caption: `hits ${pctText(quote.probability)} of 100 · fair ${price(quote.fairOdds)}` },
        rows: legs.map(leg => ({ left: leg.label, right: `${pctText(leg.probability)}%` })),
        footer: 'gridelineanalytics.com/parlays',
      }, 'gridline-parlay.png')}>Share image</button>
    </div>
    {runs && <p className="gl-slip-run" aria-live="polite">Hit <b>{hits}</b> times. Missed by just one leg <b>{oneAway}</b> times.</p>}
  </aside>;
}

export default function Parlays() {
  const now = useConsumerNow();
  const { week, winners, scorers, loading } = useParlayLegs(now);
  const [legs, setLegs] = useState<ParlayLeg[]>([]);
  const [tab, setTab] = useState<'winners' | 'td'>('winners');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(24);
  const list = tab === 'winners' ? winners : scorers.filter(leg => leg.label.toLowerCase().includes(search.trim().toLowerCase()));
  const quote = quoteParlay(legs);

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{week ? `${week.season} season · Week ${week.week}` : 'Parlays'}</p>
        <h1 className="gl-title">Parlay <span>Builder</span></h1>
        <p className="gl-lede">Build a parlay from game winners and anytime touchdown scorers. We show how often it really hits, what it should pay, and what your sportsbook is charging for it.</p>
      </div>
    </header>

    {loading && <ConsumerLoading label="Loading this week's legs…" />}
    {!loading && !winners.length && !scorers.length && <div className="gl-empty"><strong>No legs available right now.</strong>Legs appear once the week&apos;s lines and TD picks are posted.</div>}

    {(winners.length > 0 || scorers.length > 0) && <>
      <Suggested winners={winners} scorers={scorers} onLoad={next => { setLegs(next); document.getElementById('builder-heading')?.scrollIntoView({ behavior: 'smooth' }); }} />

      <section className="gl-section" aria-labelledby="builder-heading">
        <div className="gl-section-head"><h2 id="builder-heading">Build your own</h2><p>One leg per game, from games that haven&apos;t started</p></div>
        <div className="gl-parlay">
          <div className="gl-parlay-pick">
            <div className="gl-parlay-tabs">
              <div className="gl-filters" role="group" aria-label="Leg type">
                <button type="button" aria-pressed={tab === 'winners'} onClick={() => { setTab('winners'); setShown(24); }}>Game winners <small>{winners.length}</small></button>
                <button type="button" aria-pressed={tab === 'td'} onClick={() => { setTab('td'); setShown(24); }}>TD scorers <small>{scorers.length}</small></button>
              </div>
              {tab === 'td' && <input className="gl-input" type="search" placeholder="Find a player" value={search} onChange={event => setSearch(event.target.value)} aria-label="Find a player" />}
            </div>
            <div className="gl-leg-list">
              {list.slice(0, shown).map(leg => <LegButton key={leg.id} leg={leg} selected={legs.some(item => item.id === leg.id)} onToggle={() => setLegs(current => addLeg(current, leg))} />)}
            </div>
            {list.length > shown && <button type="button" className="gl-button ghost gl-show-more" onClick={() => setShown(shown + 24)}>Show more ({list.length - shown} left)</button>}
          </div>
          <Slip legs={legs} onRemove={id => setLegs(current => current.filter(leg => leg.id !== id))} onClear={() => setLegs([])} />
        </div>
      </section>

      {legs.length > 0 && <a href="#parlay-slip" className="gl-slip-bar">
        <span>{legs.length} {legs.length === 1 ? 'leg' : 'legs'}</span><b>Hits {pctText(quote.probability)} of 100</b><span>Fair {price(quote.fairOdds)} ›</span>
      </a>}

      <p className="gl-note">Winner chances come from the sportsbook&apos;s moneyline with its cut removed (or the spread when no moneyline is saved). Touchdown chances come from our TD model, which was well calibrated on past seasons but hasn&apos;t been tested against sportsbook TD prices yet, so we don&apos;t show a value figure for TD legs. Parlays multiply each sportsbook&apos;s cut, so they usually pay less than they should; for winner-only parlays the per-$10 figure shows that cost. Same-game parlays aren&apos;t offered yet because legs in one game move together. 21+ where legal. If gambling stops being fun, call or text 1-800-GAMBLER. <Link href="/pickem" className="gl-link">Pick&apos;em Pool</Link> · <Link href="/touchdowns" className="gl-link">TD Picks</Link></p>
    </>}
  </div>;
}
