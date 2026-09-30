import { Link } from 'wouter';
import { CircleCheck, Crosshair, Target, Trophy } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  getGetConsumerGameProjectionsQueryKey, useGetConsumerGameProjections, useGetConsumerTouchdowns,
} from '@workspace/api-client-react';
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

export default function ConsumerPerformance() {
  const touchdowns = useGetConsumerTouchdowns();
  const games = useGetConsumerGameProjections(undefined, { query: { queryKey: getGetConsumerGameProjectionsQueryKey() } });
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
          {decided > 0 ? <><b>{seasonWinners!.wins}–{seasonWinners!.losses}</b><p>{pct(seasonWinners!.wins / decided)} of winners picked.</p></>
            : <><b>—</b><p>The first graded games appear after this week&apos;s games.</p></>}
        </div>
        <div className="gl-card gl-record-card">
          <span className="gl-label">Touchdown top 10</span>
          {tdRecord && tdRecord.weeksGraded > 0 ? <><b>{tdRecord.topTenHits}/{tdRecord.topTenPicks}</b><p>{pct(tdRecord.topTenHits / tdRecord.topTenPicks)} scored over {tdRecord.weeksGraded} {tdRecord.weeksGraded === 1 ? 'week' : 'weeks'}.</p></>
            : <><b>—</b><p>The first graded week appears after this week&apos;s games.</p></>}
        </div>
      </div>
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

    <p className="gl-note">Against the opening line instead of the close, the same game model went about 53–54% when it disagreed by more than a point (2021–2025), which beats break-even but isn&apos;t yet enough evidence to call it an edge. We&apos;re now tracking opening lines to test it on live games. <Link href="/methodology" className="gl-link">How we test</Link>.</p>
  </div>;
}
