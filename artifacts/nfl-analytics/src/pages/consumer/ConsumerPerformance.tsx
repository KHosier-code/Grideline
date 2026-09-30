import { Link } from 'wouter';
import {
  getGetConsumerGameProjectionsQueryKey, useGetConsumerGameProjections, useGetConsumerTouchdowns,
} from '@workspace/api-client-react';
import { ConsumerLoading } from './consumer-ui';

const pct = (value: number) => `${Math.round(value * 100)}%`;

export default function ConsumerPerformance() {
  const touchdowns = useGetConsumerTouchdowns();
  const games = useGetConsumerGameProjections(undefined, { query: { queryKey: getGetConsumerGameProjectionsQueryKey() } });
  const td = touchdowns.data;
  const tdRecord = td?.record;
  const game = games.data;
  const winners = game?.record;
  const decided = winners ? winners.wins + winners.losses : 0;
  const season = td?.season ?? game?.season;

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{season ? `${season} season` : 'Record'}</p>
        <h1 className="gl-title">Our <span>record</span></h1>
        <p className="gl-lede">Every pick is graded against what happened, using the last projection we published before kickoff. Here&apos;s how we&apos;re doing this season, and how the models did when tested on past seasons.</p>
      </div>
    </header>

    {(touchdowns.isLoading || games.isLoading) && <ConsumerLoading label="Loading the record…" />}

    <section className="gl-section" aria-labelledby="td-record">
      <div className="gl-section-head"><h2 id="td-record">Touchdown picks</h2><p>Did each week&apos;s top 10 score?</p></div>
      <div className="gl-record-grid">
        <div className="gl-card gl-record-card">
          <span className="gl-label">This season</span>
          {tdRecord && tdRecord.weeksGraded > 0
            ? <><b>{tdRecord.topTenHits}/{tdRecord.topTenPicks}</b><p>{pct(tdRecord.topTenHits / tdRecord.topTenPicks)} of top-10 picks scored over {tdRecord.weeksGraded} {tdRecord.weeksGraded === 1 ? 'week' : 'weeks'}.</p></>
            : <><b>—</b><p>The first graded week appears after this week&apos;s games.</p></>}
        </div>
        <div className="gl-card gl-record-card">
          <span className="gl-label">In testing</span>
          <b>{td?.evaluation.topTenHitRate != null ? pct(td.evaluation.topTenHitRate) : '—'}</b>
          <p>of top-10 picks scored{td?.evaluation.testedOn ? `, across ${td.evaluation.testedOn}` : ''}.</p>
        </div>
      </div>
      {tdRecord && tdRecord.weeks.length > 0 && <div className="gl-card gl-table-wrap">
        <table className="gl-table">
          <thead><tr><th scope="col">Week</th><th scope="col">Top-10 picks that scored</th><th scope="col">Hit rate</th></tr></thead>
          <tbody>{tdRecord.weeks.map(week => <tr key={week.week}><td>Week {week.week}</td><td>{week.hits} of {week.picks}</td><td>{pct(week.hits / week.picks)}</td></tr>)}</tbody>
        </table>
      </div>}
    </section>

    <section className="gl-section" aria-labelledby="game-record">
      <div className="gl-section-head"><h2 id="game-record">Game winners</h2><p>Did the team we projected to win, win?</p></div>
      <div className="gl-record-grid">
        <div className="gl-card gl-record-card">
          <span className="gl-label">This season</span>
          {decided > 0
            ? <><b>{winners!.wins}–{winners!.losses}{winners!.pushes ? `–${winners!.pushes}` : ''}</b><p>{pct(winners!.wins / decided)} of winners picked.</p></>
            : <><b>—</b><p>The first graded games appear after this week&apos;s games.</p></>}
        </div>
        <div className="gl-card gl-record-card">
          <span className="gl-label">In testing, 2021–2025</span>
          <b>{typeof game?.evaluation.winnersModel === 'number' ? pct(game.evaluation.winnersModel) : '—'}</b>
          <p>of winners picked{typeof game?.evaluation.winnersFavorite === 'number' ? `. Always taking the Vegas favorite picked ${pct(game.evaluation.winnersFavorite)}.` : '.'}</p>
        </div>
      </div>
      {game && game.weeks.length > 0 && <div className="gl-card gl-table-wrap">
        <table className="gl-table">
          <thead><tr><th scope="col">Week</th><th scope="col">Winners right</th><th scope="col">Wrong</th><th scope="col">Ties</th></tr></thead>
          <tbody>{game.weeks.map(week => <tr key={week.week}><td>Week {week.week}</td><td>{week.wins}</td><td>{week.losses}</td><td>{week.pushes}</td></tr>)}</tbody>
        </table>
      </div>}
    </section>

    <p className="gl-note">We don&apos;t make spread or over/under picks, because our models didn&apos;t beat Vegas closing lines in testing. <Link href="/methodology" className="gl-link">Read how we test</Link>.</p>
  </div>;
}
