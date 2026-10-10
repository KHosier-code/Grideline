import { useEffect } from 'react';
import { Link, useParams } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import type { ConsumerTouchdownPick } from '@workspace/api-client-react';
import { TeamChip } from '@/components/GameBoard';
import { NewsletterSignup } from '@/components/NewsletterSignup';
import { formatPrice } from '@/lib/pick-sheet';
import { impliedProbability, tdFairProbability } from '@/lib/market';
import { setPublicMetadata } from '@/lib/public-metadata';
import { ConsumerLoading } from './consumer-ui';
import { LEVEL_TEXT, bookEdge, factors, kickoffText } from './TouchdownPicks';

/** Shape of GET /api/consumer/touchdowns/player/:slug. */
type PlayerPage = {
  status: 'available';
  slug: string; season: number; week: number; name: string; team: string; position: string;
  generatedAt: string | null;
  pick: ConsumerTouchdownPick | null;
  boardSize: number;
  history: Array<{ week: number; rank: number; probability: number; opponent: string; isHome: boolean; scored: boolean | null; bookPrice: number | null }>;
};

const pct = (value: number) => `${Math.round(value * 100)}%`;
const BOOK: Record<string, string> = { draftkings: 'DraftKings', fanduel: 'FanDuel' };

/**
 * "Will [player] score a touchdown this week?": one page per player, the
 * answer people search for, with the price, the reasons and the history.
 */
export default function PlayerTouchdown() {
  const { slug = '' } = useParams<{ slug: string }>();
  const query = useQuery({
    queryKey: ['td-player', slug],
    queryFn: async (): Promise<PlayerPage | null> => {
      const response = await fetch(`/api/consumer/touchdowns/player/${encodeURIComponent(slug)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    staleTime: 60_000,
  });
  const data = query.data;
  const pick = data?.pick ?? null;

  useEffect(() => {
    if (!data) return;
    const title = pick
      ? `Will ${data.name} Score a TD in Week ${data.week}? ${pct(pick.probability)} Chance | Probable`
      : `${data.name} Anytime TD Picks | Probable`;
    const description = pick
      ? `${data.name} (${data.position}, ${data.team}) has a ${pct(pick.probability)} chance to score an anytime touchdown ${pick.isHome ? 'vs' : 'at'} ${pick.opponent} in week ${data.week}, by our model. Fair odds ${formatPrice(pick.fairOdds)}${pick.bookOdds ? `; best book price ${formatPrice(pick.bookOdds.price)}` : ''}.`
      : `Every week ${data.name} has been on Probable's anytime touchdown board this season, with our chance and the result.`;
    setPublicMetadata(`/td/${data.slug}`, title, description);
  }, [data, pick]);

  if (query.isLoading) return <div className="gl-page"><ConsumerLoading label="Loading player…" /></div>;
  if (query.isError) return <div className="gl-page"><div className="gl-empty"><strong>We couldn&apos;t load this player.</strong>Refresh the page in a minute.</div></div>;
  if (!data) return <div className="gl-page"><div className="gl-empty"><strong>We don&apos;t have touchdown picks for this player.</strong>
    They may not be on this season&apos;s board. <Link href="/touchdowns" className="gl-link">See this week&apos;s TD picks</Link>.</div></div>;

  const edge = pick ? bookEdge(pick) : null;
  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{data.season} · Week {data.week} · Anytime touchdown</p>
        <h1 className="gl-title">Will {data.name} score a touchdown <span>this week?</span></h1>
        {pick
          ? <p className="gl-lede"><TeamChip team={data.team} /> {data.position} · {pick.isHome ? 'vs' : 'at'} {pick.opponent} · {kickoffText(pick.kickoff)}
            {pick.injuryStatus && <> · <span className={`gl-flag${/^out$/i.test(pick.injuryStatus) ? ' out' : ''}`}>{pick.injuryStatus}</span></>}</p>
          : <p className="gl-lede">{data.name} isn&apos;t on this week&apos;s touchdown board, usually because of a bye, an injury or a small role. Their earlier weeks are below.</p>}
      </div>
      {pick && <div className="gl-stats" aria-label="This week's chance">
        <div className="gl-stat">
          <b>{pct(pick.probability)}</b>
          <small>Chance to score a rushing or receiving TD · #{pick.rank} of {data.boardSize} players this week</small>
        </div>
        <div className="gl-stat">
          <b>{formatPrice(pick.fairOdds)}</b>
          <small>Fair odds: the price that matches our chance</small>
        </div>
        {pick.scored !== null && <div className="gl-stat">
          <b className={pick.scored ? 'gl-good' : ''}>{pick.scored ? 'Scored ✓' : 'No TD'}</b>
          <small>Result this week</small>
        </div>}
      </div>}
    </header>

    {pick && <section className="gl-card gl-player-book" aria-labelledby="book-heading">
      <h2 id="book-heading">Against the sportsbooks</h2>
      {pick.bookOdds && edge !== null ? <>
        <p className="gl-player-verdict">
          <b className={edge > 0 ? 'gl-good' : ''}>{edge > 0 ? `${Math.round(edge * 100)} points better than the book` : edge < 0 ? `${Math.round(-edge * 100)} points worse than the book` : 'Priced about right'}</b>
        </p>
        <p>Best price: <b>{formatPrice(pick.bookOdds.price)}</b> at {BOOK[pick.bookOdds.book] ?? pick.bookOdds.book}. That implies {pct(impliedProbability(pick.bookOdds.price))} with the book&apos;s cut,
          about {pct(tdFairProbability(pick.bookOdds.price))} without it. We say {pct(pick.probability)}.
          {edge > 0 ? ' If our number is right, this price pays more than it should.' : ' At this price the book is charging more than our number says it should.'}</p>
        <p className="gl-note">Prices captured {new Date(pick.bookOdds.capturedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. Lines move, so check your book.</p>
      </> : <p>No DraftKings or FanDuel price captured for {data.name} yet this week. Prices are checked Thursday and Saturday. Our fair price is {formatPrice(pick.fairOdds)}: a book paying more than that is value if our number is right.</p>}
    </section>}

    {pick && <section className="gl-section" aria-labelledby="why-heading">
      <div className="gl-section-head"><h2 id="why-heading">Why {pct(pick.probability)}</h2><p>What the model weighs, against every player on the board</p></div>
      <div className="gl-why gl-card">
        {factors(pick).map(item => <div key={item.title} className="gl-factor">
          <span className="gl-label">{item.title}</span>
          <span className={`gl-level ${item.level}`}>{LEVEL_TEXT[item.level]}</span>
          <b>{item.value}</b>
          <p>{item.unit}</p>
          <p>{item.detail}</p>
        </div>)}
      </div>
    </section>}

    {data.history.length > 0 && <section className="gl-section" aria-labelledby="history-heading">
      <div className="gl-section-head"><h2 id="history-heading">{data.name} this season</h2><p>Every week on our board, posted before kickoff</p></div>
      <div className="gl-card gl-table-wrap">
        <table className="gl-table">
          <thead><tr><th scope="col">Week</th><th scope="col">Game</th><th scope="col">Our chance</th><th scope="col">Rank</th><th scope="col">Best book price</th><th scope="col">Result</th></tr></thead>
          <tbody>{[...data.history].reverse().map(row => <tr key={row.week}>
            <td>Week {row.week}</td>
            <td>{row.isHome ? 'vs' : 'at'} {row.opponent}</td>
            <td><b>{pct(row.probability)}</b></td>
            <td>#{row.rank}</td>
            <td>{row.bookPrice !== null ? formatPrice(row.bookPrice) : '—'}</td>
            <td className={row.scored ? 'gl-good' : ''}>{row.scored === null ? 'Not graded yet' : row.scored ? 'Scored ✓' : 'No TD'}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>}

    <p className="gl-note">Our chance comes from the player&apos;s role, red-zone usage, the Vegas team total and the defense. <Link href="/touchdowns" className="gl-link">All of this week&apos;s TD picks</Link> · <Link href="/methodology" className="gl-link">How we pick</Link>. Model estimates, not guarantees. 21+ where legal; 1-800-GAMBLER.</p>

    <NewsletterSignup source="player" />
  </div>;
}
