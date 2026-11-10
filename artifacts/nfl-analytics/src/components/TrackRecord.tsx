import { Link } from 'wouter';
import type { ConsumerEarlyLinePicks, ConsumerTouchdownRecord } from '@workspace/api-client-react';
import { CountUp } from '@/components/CountUp';
import { TD_TEST, pctText } from '@/lib/td-testing';

/**
 * The two numbers Probable leads with. Both are what a bettor could have
 * actually done with the picks:
 *  - TD picks: profit from 1 unit on each top-10 pick at the best captured
 *    DraftKings/FanDuel price (hit rate alone ignores price). The top 5 is a
 *    subset of it and never the headline.
 *  - Games: how often the line moved toward an early-line pick after we
 *    posted it (closing line value), with its record at the posted line. Straight-up winners live on the Pool page,
 *    where odds don't matter.
 * Every number carries its sample size, so one hot or cold week isn't read as proof.
 */
export const units = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)} units`;
/** Compact form for tight cards and tables: +1.9u. */
export const unitsShort = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}u`;
export const weeksText = (count: number) => `${count} ${count === 1 ? 'week' : 'weeks'}`;
/** Win rate needed to break even against the spread at the standard -110. */
export const ATS_BREAK_EVEN = 110 / 210;

export function TouchdownStat({ record }: { record: ConsumerTouchdownRecord | undefined }) {
  // The whole top 10 leads, at the prices a bettor could have taken; the top 5
  // inside it stays beside it in the small print so nothing is hidden.
  const five = record?.topFive;
  if (record && record.priced.picks > 0) {
    return <div className="gl-stat">
      <b className={record.priced.units >= 0 ? 'gl-good' : 'gl-bad'}><CountUp text={units(record.priced.units)} /></b>
      <small>Top-10 TD picks, 1 unit each at the best book price · {record.priced.hits}/{record.priced.picks} scored
        {five && five.priced.picks > 0 ? ` · top 5: ${units(five.priced.units)}` : ''} · {weeksText(record.weeksGraded)}, too few to judge</small>
    </div>;
  }
  if (record && record.weeksGraded > 0) {
    return <div className="gl-stat">
      <b><CountUp text={`${record.topTenHits}/${record.topTenPicks}`} /></b>
      <small>Top-10 TD picks scored ({record.expectedHits.toFixed(1)} expected){five ? ` · top 5: ${five.hits}/${five.picks}` : ''} · {weeksText(record.weeksGraded)}</small>
    </div>;
  }
  return <div className="gl-stat">
    <b><CountUp text={pctText(TD_TEST.topTen.rate)} /></b>
    <small>of top-10 TD picks scored in testing, {TD_TEST.short} · {pctText(TD_TEST.topTenBreakEven)} needed to profit at their usual price</small>
  </div>;
}

/**
 * Closing line value counted from when we posted, not from the opener. Our
 * number posts days after the line opens and knows things the opener didn't
 * (who starts at quarterback), so opener-based movement flatters us.
 */
export function LineValueStat({ early }: { early: ConsumerEarlyLinePicks | undefined }) {
  const graded = early ? early.beatClose + early.lostClose + early.sameClose : 0;
  if (!early || graded === 0) {
    return <div className="gl-stat">
      <b>—</b>
      <small>Line value: how often the line moves toward our early-line pick after we post it. Appears after the first pick closes.</small>
    </div>;
  }
  const record = early.record;
  const decided = record.wins + record.losses;
  return <div className="gl-stat">
    <b><CountUp text={`${early.beatClose}/${graded}`} /></b>
    <small>
      Early-line picks where the line moved toward us after we posted
      {early.sameClose ? ` (${early.sameClose} closed where we took it)` : ''}
      {decided > 0 ? ` · ${record.wins}–${record.losses}${record.pushes ? `–${record.pushes}` : ''} at the posted line (${(ATS_BREAK_EVEN * 100).toFixed(1)}% breaks even)` : ''}
      {' '}· {graded} {graded === 1 ? 'pick' : 'picks'}, too few to judge
    </small>
  </div>;
}

export function TrackRecordNote() {
  return <p className="gl-stats-note">Graded from picks posted before kickoff. Small samples swing a lot. <Link href="/performance" className="gl-link">Full record</Link></p>;
}
