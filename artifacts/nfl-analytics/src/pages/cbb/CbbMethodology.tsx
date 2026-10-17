import { Link } from 'wouter';
import './cbb.css';

export default function CbbMethodology() {
  return <div className="gl-page cbb-prose">
    <header className="gl-hero">
      <div>
        <p className="gl-label">College basketball</p>
        <h1 className="gl-title">How it <span>works</span></h1>
        <p className="gl-lede">What goes into our college basketball lines, how we tested them, and what we can and can&apos;t claim yet.</p>
      </div>
    </header>

    <section className="gl-card">
      <h2>The ratings</h2>
      <p>Every Division I team gets three numbers from its box scores: points scored per 100 possessions, points allowed per 100 possessions, and possessions per game. They&apos;re adjusted for every opponent the team has played and for home court, with recent games counting more.</p>
      <p>Before a team has played much, its ratings lean on last season. How much depends on how much of last season&apos;s production is back, and on what transfers bring in from their old teams. A team that kept its starters keeps more of last year&apos;s rating than one that rebuilt through the portal.</p>
      <p>Our line for a game is each offense against the other&apos;s defense, times the possessions we expect, plus home court (about 3.8 points) unless the game is on a neutral floor.</p>
    </section>

    <section className="gl-card">
      <h2>How we tested it</h2>
      <p>We picked the model&apos;s settings on the 2020-21 to 2022-23 seasons, then tested it untouched on the next three: 17,290 games, each predicted using only games played before it.</p>
      <ul>
        <li>Our line missed the final margin by 9.1 points on average. The closing sportsbook line missed by 8.8.</li>
        <li>Against closing lines, our side won 50.2% of the time: no edge.</li>
        <li>Against 2025-26 opening lines, games where we disagreed by 2–4 points won 52.0% and 4–6 points won 54.3%. The line then moved our way about twice as often as against us.</li>
        <li>Disagreements of 6+ points against openers looked great (74%), but most were stale or mistaken openers that books fixed fast, so we don&apos;t count on them.</li>
      </ul>
      <p>Break-even at standard −110 pricing is 52.4%, so the honest summary is: a small edge, if any, and only if you bet before the line moves. Totals showed no edge at all, so we show our total but don&apos;t pick them.</p>
    </section>

    <section className="gl-card">
      <h2>Picks and the record</h2>
      <p>A pick is any game where our line disagrees with the current spread by 2 or more points. The board updates four times a day. Each pick is saved the first time it appears, before tip-off, at the line shown then, and graded at that line. Later updates can&apos;t change it, add it after the fact or remove it.</p>
      <p>Lines and scores come from ESPN (DraftKings or ESPN BET, whichever ESPN shows). Your sportsbook&apos;s number may differ, so check it before you bet.</p>
      <p><Link href="/cbb" className="gl-link">Today&apos;s games</Link> · <Link href="/cbb/ratings" className="gl-link">Power ratings</Link></p>
    </section>
  </div>;
}
