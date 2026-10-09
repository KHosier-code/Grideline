import { Link } from 'wouter';
import { useGetConsumerGameProjections, useGetConsumerTouchdowns, getGetConsumerGameProjectionsQueryKey } from '@workspace/api-client-react';

const pct = (value: unknown, fallback: string) => typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : fallback;
const pts = (value: unknown, fallback: string) => typeof value === 'number' ? value.toFixed(2) : fallback;

export default function ConsumerMethodology() {
  const touchdowns = useGetConsumerTouchdowns();
  const games = useGetConsumerGameProjections(undefined, { query: { queryKey: getGetConsumerGameProjectionsQueryKey() } });
  const td = touchdowns.data?.evaluation;
  const game = games.data?.evaluation ?? {};

  const sections = [
    {
      title: 'Where the data comes from',
      body: <>
        <p>Every number starts with public NFL play-by-play data from the nflverse project: every snap since 2019, who got the ball, where on the field, and what it was worth. We add weekly rosters, the official injury report and each game&apos;s scheduled starting quarterback. Sportsbook lines come from DraftKings and FanDuel.</p>
        <p>The models re-run Tuesday, Thursday, Friday after the final injury report, Saturday and Sunday morning.</p>
      </>,
    },
    {
      title: 'Touchdown picks',
      body: <>
        <p>For every quarterback, running back, receiver and tight end, we estimate the chance they score a rushing or receiving touchdown. Passing touchdowns don&apos;t count. The model looks at:</p>
        <ul>
          <li><b>Volume:</b> targets and carries per game, and their share of the team&apos;s.</li>
          <li><b>Red zone:</b> touches inside the 20, 10 and 5, and their share of goal-line carries.</li>
          <li><b>Team scoring:</b> how many points Vegas expects the team to score.</li>
          <li><b>Matchup:</b> touchdowns the defense has allowed to that position recently.</li>
          <li><b>Track record:</b> how often the player has scored, adjusted for small samples.</li>
        </ul>
        <p>Players ruled out on the injury report are removed. In testing on {td?.testedOn ?? 'games the model never trained on'}, <b>{pct(td?.topTenHitRate, '59.5%')}</b> of each week&apos;s top 10 scored. The percentages are realistic: players we gave about a 30% chance scored about 30% of the time. Most volume and red-zone value is already priced in by sportsbooks, and we haven&apos;t yet tested the model against sportsbook TD prices, so treat our fair odds as a reference, not a signal to bet. Books keep a cut of roughly 20% on anytime-TD bets.</p>
      </>,
    },
    {
      title: 'Game projections',
      body: <>
        <p>Each game&apos;s projected score comes from team offense and defense efficiency (EPA per play and success rate, split into passing and running) from every play this season and last, weighted toward recent games. We then adjust for:</p>
        <ul>
          <li><b>Starting quarterback:</b> his recent value per dropback, with backups and rookies starting near backup level. A team starting someone other than its usual quarterback is flagged.</li>
          <li><b>Rest, home field and division games.</b></li>
          <li><b>Weather and roof</b> for the projected total.</li>
        </ul>
        <p>Tested on {typeof game.testedOn === 'string' ? game.testedOn : '2021–2025, each season predicted by a model trained only on earlier seasons'}: our projected margin missed the final by <b>{pts(game.marginMissRating, '10.14')}</b> points on average, against <b>{pts(game.marginMissLine, '9.76')}</b> for the Vegas closing line. We picked <b>{pct(game.winnersModel, '64.4%')}</b> of winners; taking the Vegas favorite every time picked {pct(game.winnersFavorite, '66.5%')}.</p>
      </>,
    },
    {
      title: 'Why we don’t make spread or over/under picks',
      body: <>
        <p>Against the spread, our projections went <b>{pct(game.atsRating, '49.4%')}</b> in testing. You need about 52.4% to break even at standard -110 odds. Betting only the games where we disagreed with Vegas the most didn&apos;t help either. Closing lines already reflect quarterback news, so public data rarely beats them.</p>
        <p>We&apos;d rather tell you that than dress up a coin flip as a lock. Our line is shown next to Vegas&apos;s as a second opinion, and spread picks will only return if a model beats closing lines in testing.</p>
      </>,
    },
    {
      title: 'Where our line helps: before the market moves',
      body: <>
        <p>Closing lines are hard to beat, but opening lines are softer. From 2021 to 2026, when our projection disagreed with the opening spread, the line moved toward our number by kickoff about two times in three (65–72%, depending on the size of the gap), and this held in games with no quarterback news. That is called closing line value, and it is the earliest sign that a number has real information in it.</p>
        <p>We now save each game&apos;s opening and closing line from DraftKings and FanDuel and grade this live on the <Link href="/performance" className="gl-link">Model Performance</Link> page. The home page lists the games where we disagree with Vegas most, with how far the line has moved since it opened. Until the live record backs it up, these are second opinions, not picks.</p>
      </>,
    },
    {
      title: 'How picks are graded',
      body: <>
        <p>Each game and player uses the last projection we published <b>before kickoff</b>. Updates made after a game starts never count. Touchdown picks are graded on whether each of the week&apos;s top 10 scored. Game projections are graded on whether the projected winner won.</p>
        <p>The <Link href="/performance" className="gl-link">Record</Link> page shows every graded week.</p>
      </>,
    },
    {
      title: 'What we don’t claim',
      body: <p>A projection isn&apos;t a guarantee, and a model that tested well can still have a bad week. Nothing here is betting advice. If you bet, bet what you can afford to lose. If gambling stops being fun, call or text 1-800-GAMBLER.</p>,
    },
  ];

  return <div className="gl-page gl-prose-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">How it works</p>
        <h1 className="gl-title">How Probable <span>picks</span></h1>
        <p className="gl-lede">What goes into our touchdown picks and game projections, how we test them, and what the tests say.</p>
      </div>
    </header>
    <div className="gl-prose">
      {sections.map(section => <section key={section.title} className="gl-card">
        <h2>{section.title}</h2>
        {section.body}
      </section>)}
    </div>
  </div>;
}
