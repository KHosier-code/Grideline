import { Link } from 'wouter';
import { CircleCheck, Crosshair, Target, Trophy } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  getGetConsumerGameProjectionsQueryKey, getGetConsumerReplayQueryKey, getGetConsumerWatchAlertsQueryKey, useGetConsumerGameProjections,
  useGetConsumerReplay, useGetConsumerTouchdowns, useGetConsumerWatchAlerts,
  type ConsumerTouchdownBookComparison, type ConsumerWatchList,
} from '@workspace/api-client-react';
import { TeamLogo } from '@/components/TeamLogo';
import { bookShort } from '@/lib/line-shopping';
import { lineText, vegasLineText } from '@/lib/pick-sheet';
import { ConsumerLoading } from './consumer-ui';

const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

function SummaryCard({ title, icon, value, caption, rows }: {
  title: string; icon: ReactNode; value: string; caption: string; rows: Array<[string, ReactNode]>;
}) {
  return <div className="gl-card gl-summary-card">
    <div className="gl-summary-top"><span>{title}</span><span className="gl-summary-icon" aria-hidden="true">{icon}</span></div>
    <b>{value}</b>
    <p>{caption}</p>
    <dl>{rows.map(([label, content]) => <div key={label}><dt>{label}</dt><dd>{content}</dd></div>)}</dl>
  </div>;
}

function Delta({ value, unit, betterWhenLower = false }: { value: number | null; unit: string; betterWhenLower?: boolean }) {
  if (value === null) return <>—</>;
  const good = betterWhenLower ? value < 0 : value > 0;
  return <span className={good ? 'gl-good' : 'gl-bad'}>{value > 0 ? '+' : ''}{unit === '%' ? pct(value) : value.toFixed(2)}{unit === '%' ? '' : ` ${unit}`}</span>;
}

type ReplayWeek = {
  week: number;
  touchdowns: { hits: number; picks: Array<{ name: string; position: string; team: string; opponent: string; probability: number; scored: boolean }> };
  games: Array<{ home: string; away: string; homeScore: number; awayScore: number; pick: string; pickProbability: number; vegasFavorite: string | null; correct: boolean | null; favoriteCorrect: boolean | null }>;
  winners: { wins: number; losses: number };
  favorite: { wins: number; losses: number };
};
type Replay = { season: number; generatedAt: string; weeks: ReplayWeek[] };

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="gl-muted">Tie</span>;
  return <span className={ok ? 'gl-good' : 'gl-bad'} aria-label={ok ? 'Correct' : 'Wrong'}>{ok ? '✓' : '✗'}</span>;
}

function ReplaySection({ replay }: { replay: Replay }) {
  const hits = replay.weeks.reduce((sum, week) => sum + week.touchdowns.hits, 0);
  const picks = replay.weeks.reduce((sum, week) => sum + week.touchdowns.picks.length, 0);
  const wins = replay.weeks.reduce((sum, week) => sum + week.winners.wins, 0);
  const losses = replay.weeks.reduce((sum, week) => sum + week.winners.losses, 0);
  const favWins = replay.weeks.reduce((sum, week) => sum + week.favorite.wins, 0);
  const favLosses = replay.weeks.reduce((sum, week) => sum + week.favorite.losses, 0);
  const first = replay.weeks[0]?.week; const last = replay.weeks.at(-1)?.week;
  return <section className="gl-section" aria-labelledby="replayed">
    <div className="gl-section-head"><h2 id="replayed">{replay.season} weeks {first}–{last}, replayed</h2><p>Recreated after the games, not picks we posted at the time</p></div>
    <div className="gl-replay-banner">
      <b>Replayed, not live.</b> We launched these models after week {last}. To show how they would have done, we re-ran each earlier week using a model trained only on games played before that week. Replayed TD picks only include players who ended up playing, which flatters them a little. The live record above counts only picks posted before kickoff.
    </div>
    <div className="gl-record-grid">
      <div className="gl-card gl-record-card">
        <span className="gl-label">Touchdown top 10, replayed</span>
        <b>{hits}/{picks}</b><p>{pct(hits / Math.max(1, picks), 0)} scored. In back-testing the weekly top 10 averaged about 60%.</p>
      </div>
      <div className="gl-card gl-record-card">
        <span className="gl-label">Game winners, replayed</span>
        <b>{wins}–{losses}</b><p>Taking every Vegas favorite went {favWins}–{favLosses} over the same games.</p>
      </div>
    </div>
    {replay.weeks.map(week => <details key={week.week} className="gl-card gl-replay-week">
      <summary>
        <b>Week {week.week}</b>
        <span>TD top 10: <strong>{week.touchdowns.hits}/10</strong></span>
        <span>Winners: <strong>{week.winners.wins}–{week.winners.losses}</strong> <small>(favorites {week.favorite.wins}–{week.favorite.losses})</small></span>
      </summary>
      <div className="gl-replay-grid">
        <table className="gl-table">
          <caption className="gl-table-caption">Touchdown top 10</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Chance</th><th scope="col">Scored</th></tr></thead>
          <tbody>{week.touchdowns.picks.map((pick, index) => <tr key={pick.name + pick.team}>
            <td>{index + 1}</td>
            <td><b>{pick.name}</b> <small className="gl-muted">{pick.position} · {pick.team} vs {pick.opponent}</small></td>
            <td>{pct(pick.probability, 0)}</td><td><Mark ok={pick.scored} /></td>
          </tr>)}</tbody>
        </table>
        <table className="gl-table">
          <caption className="gl-table-caption">Game winners</caption>
          <thead><tr><th scope="col">Game</th><th scope="col">Final</th><th scope="col">Our pick</th><th scope="col">Vegas favorite</th></tr></thead>
          <tbody>{week.games.map(game => <tr key={game.away + game.home}>
            <td>{game.away} at {game.home}</td>
            <td>{game.awayScore}–{game.homeScore}</td>
            <td><span className="gl-inline-team"><TeamLogo team={game.pick} size={18} />{game.pick} <small className="gl-muted">{pct(game.pickProbability, 0)}</small> <Mark ok={game.correct} /></span></td>
            <td>{game.vegasFavorite ? <span className="gl-inline-team">{game.vegasFavorite} <Mark ok={game.favoriteCorrect} /></span> : '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>)}
  </section>;
}

type Ats = 'win' | 'loss' | 'push' | null;
const recordText = (line: { wins: number; losses: number; pushes: number }) =>
  line.wins + line.losses ? `${line.wins}-${line.losses}${line.pushes ? `-${line.pushes}` : ''}` : '—';
const coverRate = (line: { wins: number; losses: number }) => (line.wins + line.losses ? pct(line.wins / (line.wins + line.losses)) : 'No games graded yet');

function Cover({ value }: { value: Ats }) {
  if (value === null) return <span className="gl-muted">—</span>;
  if (value === 'push') return <span className="gl-muted">Push</span>;
  return <Mark ok={value === 'win'} />;
}

/** The 4+ point opener gap, tracked live: the one rule that held up in back-testing, graded at three numbers. */
function WatchListSection({ watch, topic }: { watch: ConsumerWatchList; topic: string | null }) {
  const moved = watch.movedToward + watch.movedAway;
  const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return <section className="gl-section" id="watch-list" aria-labelledby="watch-list-head">
    <div className="gl-section-head"><h2 id="watch-list-head">Watch list</h2><p>Games where our line is {watch.threshold}+ points off the opening line</p></div>
    <div className="gl-replay-banner">
      <b>Tracked, not a pick.</b> From 2021 through week 3 of 2026, our side of these games covered the opening line 58.8% of the time,
      but only 53.7% against the closing line, and 2022 was a losing season (46%). So we list them as they happen and grade each one at three
      numbers: the opener, the line when our projection went up (the one you could actually bet), and the close.
    </div>
    <div className="gl-record-grid gl-four">
      <div className="gl-card gl-record-card"><span className="gl-label">At the opener</span><b>{recordText(watch.atsOpen)}</b><p>{coverRate(watch.atsOpen)}</p></div>
      <div className="gl-card gl-record-card"><span className="gl-label">When we posted</span><b>{recordText(watch.atsPublished)}</b><p>{coverRate(watch.atsPublished)}. The honest record: the line you could bet when the game joined the list.</p></div>
      <div className="gl-card gl-record-card"><span className="gl-label">At the close</span><b>{recordText(watch.atsClose)}</b><p>{coverRate(watch.atsClose)}. Break-even at -110 is 52.4%.</p></div>
      <div className="gl-card gl-record-card"><span className="gl-label">Line moved our way</span><b>{moved ? `${watch.movedToward}/${moved}` : '—'}</b><p>Of {watch.flagged} {watch.flagged === 1 ? 'game' : 'games'} flagged, how often the line moved toward our side by kickoff, the earliest sign of a real edge.</p></div>
    </div>
    {watch.games.length > 0 ? <div className="gl-card gl-table-wrap">
      <table className="gl-table gl-watch-table">
        <thead><tr>
          <th scope="col">Game</th><th scope="col">Gridline</th><th scope="col">Our side</th><th scope="col">Opener</th>
          <th scope="col">Posted<small>line when we flagged it</small></th><th scope="col">Now<small>or the close</small></th>
          <th scope="col">Moved<small>toward us</small></th><th scope="col">Covered<small>open · posted · close</small></th>
        </tr></thead>
        <tbody>{watch.games.map(game => {
          const side = game.side === 'home' ? game.homeTeam : game.awayTeam;
          return <tr key={game.gameId}>
            <td>{game.awayTeam} at {game.homeTeam} <small className="gl-muted">{date(game.kickoff)}</small></td>
            <td><b>{lineText(game.gridlineMargin, game.homeTeam, game.awayTeam)}</b></td>
            <td><span className="gl-inline-team"><TeamLogo team={side} size={18} />{side}</span></td>
            <td>{vegasLineText(game.openLine, game.homeTeam, game.awayTeam)} <small className="gl-muted">{bookShort(game.sportsbook)}</small></td>
            <td>{vegasLineText(game.publishedLine, game.homeTeam, game.awayTeam)}</td>
            <td>{vegasLineText(game.currentLine, game.homeTeam, game.awayTeam)}</td>
            <td><span className={game.movedToward > 0 ? 'gl-good' : game.movedToward < 0 ? 'gl-bad' : 'gl-muted'}>{game.movedToward > 0 ? '+' : ''}{game.movedToward}</span></td>
            <td>{game.started ? <><Cover value={game.atsOpen} /> · <Cover value={game.atsPublished} /> · <Cover value={game.atsClose} /></> : <span className="gl-muted">Upcoming</span>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <div className="gl-empty"><strong>No games on the list yet this season.</strong>Games join once the opening line and our projection are both in.</div>}
    <p className="gl-note">
      Get an alert when a game joins the list or its line moves a point or more:{' '}
      {topic && <>install the free <a href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy</a> app and subscribe to <a href={`https://ntfy.sh/${topic}`} target="_blank" rel="noreferrer"><b>{topic}</b></a>, or </>}
      add the <a href="/api/feeds/watch-list.xml">watch-list RSS feed</a> to any feed reader. Games usually join on Monday evening, once Sunday&apos;s results are in and next week&apos;s projections post.
    </p>
  </section>;
}

function BookComparisonCard({ comparison }: { comparison: ConsumerTouchdownBookComparison | undefined }) {
  const ready = comparison && comparison.players > 0 && comparison.modelBrier !== null && comparison.bookBrier !== null;
  return <div className="gl-card gl-record-card">
    <span className="gl-label">Touchdown model vs the books</span>
    {ready ? <>
      <b>{comparison.modelBrier! < comparison.bookBrier! ? 'Ahead' : comparison.modelBrier! > comparison.bookBrier! ? 'Behind' : 'Even'}</b>
      <p>On {comparison.players} graded players with a DraftKings or FanDuel price ({comparison.weeks} {comparison.weeks === 1 ? 'week' : 'weeks'}),
        we gave them {pct(comparison.modelAverage ?? 0, 0)} on average, the books&apos; prices (with their roughly {Math.round(comparison.hold * 100)}% cut removed)
        implied {pct(comparison.bookAverage ?? 0, 0)}, and {pct(comparison.scored / comparison.players, 0)} scored.
        Prediction error, lower is better: ours {comparison.modelBrier!.toFixed(3)}, the books {comparison.bookBrier!.toFixed(3)}.</p>
    </> : <><b>—</b><p>Appears once a week with saved DraftKings or FanDuel touchdown prices has been graded.</p></>}
  </div>;
}

export default function ConsumerPerformance() {
  const replayQuery = useGetConsumerReplay({ query: { queryKey: getGetConsumerReplayQueryKey(), staleTime: 5 * 60_000 } });
  const replay = replayQuery.data?.status === 'available' ? replayQuery.data.report as unknown as Replay : null;
  const touchdowns = useGetConsumerTouchdowns();
  const games = useGetConsumerGameProjections(undefined, { query: { queryKey: getGetConsumerGameProjectionsQueryKey() } });
  const alerts = useGetConsumerWatchAlerts(undefined, { query: { queryKey: getGetConsumerWatchAlertsQueryKey(), staleTime: 10 * 60_000 } });
  const td = touchdowns.data;
  const game = games.data;
  const e = game?.evaluation ?? {};
  const seasons = (e.seasons ?? []).filter(row => num(row.games) !== null);
  const winners = num(e.winnersModel);
  const favorite = num(e.winnersFavorite);
  const ats = num(e.atsRating);
  const miss = num(e.marginMissRating);
  const missLine = num(e.marginMissLine);
  const tdRecord = td?.record;
  const seasonWinners = game?.record;
  const decided = seasonWinners ? seasonWinners.wins + seasonWinners.losses : 0;
  const seasonFavorite = game?.favoriteRecord;
  const favoriteDecided = seasonFavorite ? seasonFavorite.wins + seasonFavorite.losses : 0;
  const clv = game?.lineValue;
  const moved = clv ? clv.movedToward + clv.movedAway : 0;
  const record = (line: { wins: number; losses: number; pushes: number }) =>
    line.wins + line.losses ? `${line.wins}-${line.losses}${line.pushes ? `-${line.pushes}` : ''} (${pct(line.wins / (line.wins + line.losses))})` : '—';

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">Model performance</p>
        <h1 className="gl-title">How the models <span>perform</span></h1>
        <p className="gl-lede">Every season below was predicted by a model trained only on earlier seasons, then graded against what happened and against the Vegas closing line. This season&apos;s picks are graded as games finish.</p>
      </div>
    </header>

    {(games.isLoading || touchdowns.isLoading) && <ConsumerLoading label="Loading performance…" />}

    <div className="gl-summary-grid">
      <SummaryCard title="Winners picked" icon={<CircleCheck />} value={winners !== null ? pct(winners) : '—'}
        caption={`Straight-up winners, ${typeof e.testedOn === 'string' ? '2021–2025' : 'in testing'}`}
        rows={[
          ['Always taking the Vegas favorite', favorite !== null ? pct(favorite) : '—'],
          ['Difference', <Delta key="d" value={winners !== null && favorite !== null ? winners - favorite : null} unit="%" />],
        ]} />
      <SummaryCard title="Against the spread" icon={<Target />} value={ats !== null ? pct(ats) : '—'}
        caption="Taking our side of the Vegas closing line"
        rows={[['Break-even at -110', '52.4%'], ['Spread picks on the site', 'Off until we beat the line']]} />
      <SummaryCard title="Prediction error" icon={<Crosshair />} value={miss !== null ? miss.toFixed(2) : '—'}
        caption="Average miss on the final margin, in points"
        rows={[['Vegas closing line', missLine !== null ? missLine.toFixed(2) : '—'],
          ['Difference', <Delta key="m" value={miss !== null && missLine !== null ? miss - missLine : null} unit="pts" betterWhenLower />]]} />
      <SummaryCard title="Touchdown picks" icon={<Trophy />} value={td?.evaluation.topTenHitRate != null ? pct(td.evaluation.topTenHitRate) : '—'}
        caption="Each week's top 10 who scored, in testing"
        rows={[['This season', tdRecord && tdRecord.weeksGraded > 0 ? `${tdRecord.topTenHits}/${tdRecord.topTenPicks}` : 'After the first graded week'],
          ['Ranking accuracy (AUC)', td?.evaluation.auc != null ? td.evaluation.auc.toFixed(3) : '—']]} />
    </div>

    <section className="gl-section" aria-labelledby="season-detail">
      <div className="gl-section-head"><h2 id="season-detail">Season detail</h2><p>Game model, each season predicted before it was played</p></div>
      {seasons.length > 0 ? <div className="gl-card gl-table-wrap">
        <table className="gl-table gl-season-table">
          <thead><tr>
            <th scope="col">Season</th><th scope="col">Games</th><th scope="col">Winners</th><th scope="col">vs favorite</th>
            <th scope="col">Margin miss</th><th scope="col">vs Vegas</th><th scope="col">ATS vs close</th><th scope="col">Total miss</th><th scope="col">vs Vegas</th>
          </tr></thead>
          <tbody>{seasons.map(row => {
            const w = num(row.winners_model); const f = num(row.winners_favorite);
            const m = num(row.mae_rating); const ml = num(row.mae_line);
            const tm = num(row.total_miss_rating); const tl = num(row.total_miss_line);
            const aw = num(row.ats_wins) ?? 0; const al = num(row.ats_losses) ?? 0;
            return <tr key={String(row.season)}>
              <th scope="row">{String(row.season)}{(num(row.games) ?? 0) < 200 ? ' (so far)' : ''}</th>
              <td>{String(row.games)}</td>
              <td>{w !== null ? pct(w) : '—'}</td>
              <td><Delta value={w !== null && f !== null ? w - f : null} unit="%" /></td>
              <td>{m !== null ? m.toFixed(2) : '—'}</td>
              <td><Delta value={m !== null && ml !== null ? m - ml : null} unit="pts" betterWhenLower /></td>
              <td>{aw + al ? `${aw}-${al} (${pct(aw / (aw + al))})` : '—'}</td>
              <td>{tm !== null ? tm.toFixed(2) : '—'}</td>
              <td><Delta value={tm !== null && tl !== null ? tm - tl : null} unit="pts" betterWhenLower /></td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <div className="gl-empty"><strong>Season results appear after the next model run.</strong></div>}
    </section>

    <section className="gl-section" aria-labelledby="this-season">
      <div className="gl-section-head"><h2 id="this-season">This season</h2><p>Graded from the last projection published before each kickoff</p></div>
      <div className="gl-record-grid">
        <div className="gl-card gl-record-card">
          <span className="gl-label">Game winners</span>
          {decided > 0 ? <><b>{seasonWinners!.wins}–{seasonWinners!.losses}</b><p>{pct(seasonWinners!.wins / decided)} of winners picked.{favoriteDecided > 0
            ? ` The Vegas favorite went ${seasonFavorite!.wins}–${seasonFavorite!.losses} (${pct(seasonFavorite!.wins / favoriteDecided)}) on the same games.` : ''}</p></>
            : <><b>—</b><p>The first graded games appear after this week&apos;s games.</p></>}
        </div>
        <div className="gl-card gl-record-card">
          <span className="gl-label">Closing line value</span>
          {clv && clv.leans > 0 ? <>
            <b>{moved ? `${clv.movedToward}/${moved}` : '—'}</b>
            <p>Times the line moved toward our side after the opener, when we disagreed with it by {clv.threshold}+ points
              ({clv.leans} {clv.leans === 1 ? 'game' : 'games'}, {clv.unchanged} unchanged{clv.averageMove !== null ? `, average ${clv.averageMove > 0 ? '+' : ''}${clv.averageMove.toFixed(2)} pts` : ''}).
              Against the spread: {record(clv.atsOpen)} at the opener, {record(clv.atsClose)} at the close.</p>
          </> : <><b>—</b><p>Appears once we have an opening and closing line for games where we disagreed with the opener.</p></>}
        </div>
        <div className="gl-card gl-record-card">
          <span className="gl-label">Touchdown top 10</span>
          {tdRecord && tdRecord.weeksGraded > 0 ? <><b>{tdRecord.topTenHits}/{tdRecord.topTenPicks}</b><p>{pct(tdRecord.topTenHits / tdRecord.topTenPicks)} scored over {tdRecord.weeksGraded} {tdRecord.weeksGraded === 1 ? 'week' : 'weeks'}.</p></>
            : <><b>—</b><p>The first graded week appears after this week&apos;s games.</p></>}
        </div>
      </div>
      <BookComparisonCard comparison={td?.bookComparison} />
      {(tdRecord?.weeks?.length ?? 0) > 0 && <div className="gl-card gl-table-wrap">
        <table className="gl-table">
          <thead><tr><th scope="col">Week</th><th scope="col">Top-10 TD picks that scored</th><th scope="col">Game winners right</th></tr></thead>
          <tbody>{tdRecord!.weeks.map(week => {
            const games = game?.weeks.find(item => item.week === week.week);
            return <tr key={week.week}><td>Week {week.week}</td><td>{week.hits} of {week.picks}</td><td>{games ? `${games.wins}-${games.losses}` : '—'}</td></tr>;
          })}</tbody>
        </table>
      </div>}
    </section>

    <p className="gl-note">Every pick counted here was locked in before kickoff. <Link href="/receipts" className="gl-link">See the receipts</Link>, with the time each one was posted.</p>

    {game?.watch && <WatchListSection watch={game.watch} topic={alerts.data?.ntfyTopic ?? null} />}

    {replay && replay.weeks.length > 0 && <ReplaySection replay={replay} />}

    <p className="gl-note">Against the opening line instead of the close, the same game model went about 53–54% when it disagreed by more than a point (2021–2025), which beats break-even but isn&apos;t yet enough evidence to call it an edge. We&apos;re now tracking opening and closing lines to test it on live games: if the line keeps moving toward our number after it opens, that is the earliest sign of a real edge, well before a win-loss record can show one. <Link href="/methodology" className="gl-link">How we test</Link>.</p>
  </div>;
}
