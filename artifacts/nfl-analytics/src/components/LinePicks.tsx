import { useState } from 'react';
import { TeamLogo } from './TeamLogo';
import { BIG_GAP, linePickLabel, linePickRecord, rankLinePicks, spreadPick, totalPick, type LineMarket, type LinePick } from '@/lib/line-picks';
import type { GameView } from '@/lib/pick-sheet';
import { shareCardImage } from '@/lib/share-image';
import { vegasLineText } from '@/lib/pick-sheet';

const RESULT_TEXT = { win: 'Right', loss: 'Wrong', push: 'Push' } as const;

function Row({ pick, points, now }: { pick: LinePick; points: number; now: number }) {
  const { game } = pick.view;
  const home = game.matchup.home.abbreviation;
  const away = game.matchup.away.abbreviation;
  const started = game.kickoffTime ? Date.parse(game.kickoffTime) <= now : false;
  const kickoff = game.kickoffTime
    ? new Date(game.kickoffTime).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'TBD';
  const book = pick.market === 'spread'
    ? `Book: ${vegasLineText(pick.view.vegas.homeLine!, home, away)}`
    : `Book total: ${pick.view.vegas.total}`;
  const ours = pick.market === 'spread'
    ? `Gridline: ${pick.view.projection!.margin >= 0 ? home : away} by ${Math.abs(pick.view.projection!.margin).toFixed(1)}`
    : `Gridline: ${pick.view.projection!.total.toFixed(1)}`;
  const team = pick.market === 'spread' ? game.matchup[pick.side].abbreviation : null;
  return <div className={`gl-card gl-line-row${started ? ' locked' : ''}`}>
    <span className="gl-pool-points" title="Confidence points">{points}</span>
    <span className="gl-line-matchup"><TeamLogo team={away} size={26} /><b>{away}</b><span className="gl-pool-at">@</span><TeamLogo team={home} size={26} /><b>{home}</b></span>
    <span className="gl-line-pick">
      {team && <TeamLogo team={team} size={22} />}<b>{linePickLabel(pick)}</b>
      <small>{book} · {ours}</small>
    </span>
    <span className="gl-line-edge"><b>{pick.edge.toFixed(1)}</b><small>pts gap</small>{pick.market === 'spread' && pick.edge >= BIG_GAP && <span className="gl-pill strong" title="Our number is 4+ points off the book's">4+ pts</span>}</span>
    <span className="gl-pool-meta">
      <span>{game.finalScore ? `Final ${game.finalScore.away}-${game.finalScore.home}` : started ? 'Live' : kickoff}</span>
      {pick.result && <span className={`gl-pill ${pick.result === 'win' ? 'win' : pick.result === 'loss' ? 'loss' : 'small'}`}>{RESULT_TEXT[pick.result]}</span>}
    </span>
  </div>;
}

/** Spread or over/under pool picks for the week's games, biggest gap first. */
/** Confidence points come from the whole week's ranking, so `visible` (a slate) only hides rows. */
export function LinePicks({ market, views, visible, now, label, season }: { market: LineMarket; views: GameView[]; visible?: Set<string>; now: number; label: string; season: number | undefined }) {
  const [copied, setCopied] = useState(false);
  const picks = views.map(view => market === 'spread' ? spreadPick(view) : totalPick(view)).filter((pick): pick is LinePick => pick !== null);
  const ranked = rankLinePicks(picks).filter(({ pick }) => !visible || visible.has(pick.view.game.gameId));
  const missing = views.filter(view => !visible || visible.has(view.game.gameId)).length - ranked.length;
  const record = linePickRecord(ranked.map(({ pick }) => pick));
  const graded = record.wins + record.losses;
  const title = market === 'spread' ? 'Spread picks' : 'Over/under picks';
  if (!ranked.length) return <div className="gl-empty"><strong>No {market === 'spread' ? 'spread' : 'over/under'} picks yet.</strong>They appear once our projections and the sportsbook lines are both posted.</div>;
  const copyText = [`Gridline ${label} ${title.toLowerCase()}`, ...ranked.map(({ pick, points }) => `${points}  ${linePickLabel(pick)} (${pick.edge.toFixed(1)} pt gap)`), 'gridelineanalytics.com/pickem'].join('\n');
  return <>
    <div className="gl-pool-controls">
      <p className="gl-line-record">{graded ? <><b>{record.wins}-{record.losses}{record.pushes ? `-${record.pushes}` : ''}</b> so far this week</> : 'Ranked by how far our number is from the sportsbook\'s.'}</p>
      <div className="gl-pool-actions">
        <button type="button" className="gl-button" onClick={() => {
          void navigator.clipboard?.writeText(copyText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
        }}>{copied ? 'Copied' : `Copy ${ranked.length} picks`}</button>
        <button type="button" className="gl-button ghost" onClick={() => void shareCardImage({
          eyebrow: `${season ?? ''} ${label}`.trim(), title,
          rows: ranked.map(({ pick, points }) => ({ left: `${points}  ${linePickLabel(pick)}`, right: `${pick.edge.toFixed(1)} pts` })),
          footer: 'gridelineanalytics.com/pickem',
        }, `gridline-${market}.png`)}>Share image</button>
      </div>
    </div>
    <div className="gl-pool-head gl-line-head" aria-hidden="true"><span>Pts</span><span>Game</span><span>Pick</span><span>Gap</span><span /></div>
    <div className="gl-pool-list">{ranked.map(({ pick, points }) => <Row key={pick.view.game.gameId} pick={pick} points={points} now={now} />)}</div>
    {missing > 0 && <p className="gl-note">{missing} {missing === 1 ? 'game has' : 'games have'} no pick yet because the line or our projection isn&apos;t posted.</p>}
    <p className="gl-note">{market === 'spread'
      ? 'Each pick is the side of the sportsbook spread our projection likes, ranked by the gap in points. Picking every game this way hit about 51-53% against closing lines in our tests, so treat small gaps as coin flips. Gaps of 4+ points against the opening line were the one rule that held up (about 59% at the opener, 54% at the close, 2021-2026).'
      : 'Each pick is over or under the sportsbook total by where our projected total lands, ranked by the gap in points. Our totals have not beaten closing totals in testing, so treat these as a second opinion.'} Lines are the latest DraftKings or FanDuel number we captured, and finished games are graded against that number.</p>
  </>;
}
