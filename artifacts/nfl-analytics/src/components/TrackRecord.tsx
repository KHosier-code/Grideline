import { Link } from 'wouter';
import type { ConsumerLineValue, ConsumerTouchdownRecord } from '@workspace/api-client-react';
import { CountUp } from '@/components/CountUp';

/**
 * The two numbers Gridline leads with. Both are what a bettor could have
 * actually done with the picks:
 *  - TD picks: profit from 1 unit on each top-10 pick at the best captured
 *    DraftKings/FanDuel price (hit rate alone ignores price).
 *  - Games: how often the Vegas line moved toward our number after we
 *    disagreed with it (closing line value), with the record against the
 *    closing spread beside it. Straight-up winners live on the Pool page,
 *    where odds don't matter.
 * Every number carries its sample size, so one hot or cold week isn't read as proof.
 */
export const units = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)} units`;
/** Compact form for tight cards and tables: +1.9u. */
export const unitsShort = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}u`;
export const weeksText = (count: number) => `${count} ${count === 1 ? 'week' : 'weeks'}`;
const pct = (value: number) => `${Math.round(value * 100)}%`;
/** Win rate needed to break even against the spread at the standard -110. */
export const ATS_BREAK_EVEN = 110 / 210;

export function TouchdownStat({ record, testingHitRate }: { record: ConsumerTouchdownRecord | undefined; testingHitRate?: number | null }) {
  if (record && record.priced.picks > 0) {
    return <div className="gl-stat">
      <b className={record.priced.units >= 0 ? 'gl-good' : 'gl-bad'}><CountUp text={units(record.priced.units)} /></b>
      <small>Top-10 TD picks, 1 unit each at the best book price · {record.priced.hits}/{record.priced.picks} scored · {weeksText(record.weeksGraded)}</small>
    </div>;
  }
  if (record && record.weeksGraded > 0) {
    return <div className="gl-stat">
      <b><CountUp text={`${record.topTenHits}/${record.topTenPicks}`} /></b>
      <small>Top-10 TD picks scored ({record.expectedHits.toFixed(1)} expected) · {weeksText(record.weeksGraded)} · profit at book prices starts once prices are captured</small>
    </div>;
  }
  if (typeof testingHitRate === 'number') {
    return <div className="gl-stat"><b><CountUp text={pct(testingHitRate)} /></b><small>of top-10 TD picks scored in testing</small></div>;
  }
  return null;
}

export function LineValueStat({ lineValue }: { lineValue: ConsumerLineValue | undefined }) {
  const moved = lineValue ? lineValue.movedToward + lineValue.movedAway : 0;
  if (!lineValue || moved === 0) {
    return <div className="gl-stat">
      <b>—</b>
      <small>Line value: how often Vegas moves toward our number. Appears once we have opening and closing lines for games where we disagreed.</small>
    </div>;
  }
  const ats = lineValue.atsClose;
  const decided = ats.wins + ats.losses;
  return <div className="gl-stat">
    <b><CountUp text={`${lineValue.movedToward}/${moved}`} /></b>
    <small>
      Times the Vegas line moved toward our number after we disagreed by {lineValue.threshold}+ points
      {decided > 0 ? ` · ${ats.wins}–${ats.losses}${ats.pushes ? `–${ats.pushes}` : ''} against the closing spread (${(ATS_BREAK_EVEN * 100).toFixed(1)}% breaks even)` : ''}
      {' '}· {lineValue.leans} {lineValue.leans === 1 ? 'game' : 'games'}
    </small>
  </div>;
}

export function TrackRecordNote() {
  return <p className="gl-stats-note">Graded from picks posted before kickoff. Small samples swing a lot. <Link href="/performance" className="gl-link">Full record</Link></p>;
}
