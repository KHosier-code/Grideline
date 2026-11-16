import { useEffect, useMemo, useRef, useState } from 'react';
import { NewsletterSignup } from '@/components/NewsletterSignup';
import { ConsumerLoading } from '@/pages/consumer/consumer-ui';
import {
  crowdMistakes, pct, poolsLocked, POOL_TYPE_LABELS, SCORING_LABELS, sheetKey, sheetRows, sheetScore, sheetText, winPct,
  type BowlPoolType, type BowlScoring, type BowlsReport, type BowlTeam, type SheetRow,
} from '@/lib/bowls';
import { useBowls } from '@/lib/bowls-data';
import { countEvent } from '@/lib/visits';
import './pools.css';

const STORAGE_KEY = 'probable-bowl-pool';
type Choice = { scoring: BowlScoring; size: number; type: BowlPoolType };
const DEFAULT_CHOICE: Choice = { scoring: 'confidence', size: 25, type: 'mixed' };

function readChoice(): Choice {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Choice> | null;
    return { ...DEFAULT_CHOICE, ...(saved ?? {}) };
  } catch {
    return DEFAULT_CHOICE;
  }
}

const gameDate = (kickoff: string | null) => kickoff
  ? new Date(kickoff).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
  : 'Date TBA';

function TeamLogo({ team, size = 28 }: { team: BowlTeam; size?: number }) {
  if (!team.logo) return <span className="pools-logo-blank" style={{ width: size, height: size }} aria-hidden="true" />;
  return <img className="pools-logo" src={team.logo} alt="" width={size} height={size} loading="lazy" />;
}

const teamName = (team: BowlTeam) => `${team.rank ? `#${team.rank} ` : ''}${team.name}`;

function SheetLine({ row, scoring }: { row: SheetRow; scoring: BowlScoring }) {
  return <li className={`gl-card pools-row${scoring === 'straight' ? ' no-points' : ''}${row.result ? ` is-${row.result}` : ''}`}>
    {scoring === 'confidence' && <span className="pools-points" aria-label={`${row.points} points`}>{row.points}</span>}
    <div className="pools-row-main">
      <p className="pools-row-bowl">{row.game.bowl} <span>· {gameDate(row.game.kickoff)}</span></p>
      <p className="pools-row-pick">
        <TeamLogo team={row.pick} />
        <b>{teamName(row.pick)}</b>
        <span className="pools-row-over">over {row.opponent.name}</span>
      </p>
      <p className="pools-row-tags">
        {row.upset && <span className="gl-pill lean" title="The betting line has the other team favored. We picked this upset because it raises your chance of finishing first.">Upset pick</span>}
        {row.crowdMisses && <span className="gl-pill strong" title="Most ESPN Bowl Mania players picked the other team, but the betting line favors this one.">Your pool will likely miss this</span>}
        {row.result && <span className={`gl-pill ${row.result}`}>{row.result === 'win' ? 'Right' : 'Wrong'}</span>}
      </p>
    </div>
    <dl className="pools-row-nums">
      <div><dt>Wins</dt><dd>{pct(row.chance)}</dd></div>
      <div><dt>Picked by</dt><dd>{pct(row.crowd)}</dd></div>
    </dl>
  </li>;
}

function Choices({ report, choice, onChange }: { report: BowlsReport; choice: Choice; onChange: (next: Choice) => void }) {
  return <section className="gl-card pools-choices" aria-label="Your pool">
    <fieldset>
      <legend>How your pool scores</legend>
      <div className="gl-filters">
        {report.scorings.map(scoring => <button key={scoring} type="button" aria-pressed={choice.scoring === scoring}
          onClick={() => onChange({ ...choice, scoring })}>{SCORING_LABELS[scoring].label}</button>)}
      </div>
      <p className="pools-hint">{SCORING_LABELS[choice.scoring].hint}</p>
    </fieldset>
    <fieldset>
      <legend>How many people</legend>
      <div className="gl-filters">
        {report.poolSizes.map(size => <button key={size} type="button" aria-pressed={choice.size === size}
          onClick={() => onChange({ ...choice, size })}>{size === Math.max(...report.poolSizes) ? `${size}+` : size}</button>)}
      </div>
      <p className="pools-hint">Pick the closest. Bigger pools need a few more upsets to win.</p>
    </fieldset>
    <fieldset>
      <legend>What kind of pool</legend>
      <div className="gl-filters">
        {report.poolTypes.map(type => <button key={type} type="button" aria-pressed={choice.type === type}
          onClick={() => onChange({ ...choice, type })}>{POOL_TYPE_LABELS[type].label}</button>)}
      </div>
      <p className="pools-hint">{POOL_TYPE_LABELS[choice.type].hint}</p>
    </fieldset>
  </section>;
}

function CopyButton({ text, onCopied }: { text: string; onCopied: () => void }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      onCopied();
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 2500);
  }
  return <button type="button" className="pools-copy" onClick={copy}>
    {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed: select the list instead' : 'Copy my picks'}
  </button>;
}

const MarchSignup = () => <NewsletterSignup source="bowls" title="Get the March Madness version"
  copy="The same idea for your bracket pool: built from the betting market and how millions of brackets get filled out. One email when it opens, and you can unsubscribe in one click." />;

export default function BowlPools() {
  const { query, report } = useBowls();
  const [choice, setChoice] = useState<Choice>(() => (typeof window === 'undefined' ? DEFAULT_CHOICE : readChoice()));
  const counted = useRef(new Set<string>());

  // Snap a saved choice to what this report offers.
  const active = useMemo<Choice | null>(() => {
    if (!report) return null;
    const scoring = report.scorings.includes(choice.scoring) ? choice.scoring : report.scorings[0];
    const size = report.poolSizes.reduce((best, size) => Math.abs(size - choice.size) < Math.abs(best - choice.size) ? size : best, report.poolSizes[0]);
    const type = report.poolTypes.includes(choice.type) ? choice.type : report.poolTypes[0];
    return { scoring, size, type };
  }, [report, choice]);

  const key = active ? sheetKey(active.scoring, active.size, active.type) : null;
  useEffect(() => {
    if (!key || counted.current.has(key)) return;
    counted.current.add(key);
    countEvent('bowl_sheet_built', key);
  }, [key]);

  function change(next: Choice) {
    setChoice(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  const rows = report && active ? sheetRows(report, active.scoring, active.size, active.type) : [];
  const sheet = report && key ? report.sheets[key] : null;
  const mistakes = report && active ? crowdMistakes(report, active.scoring).slice(0, 5) : [];
  const score = sheetScore(rows);
  const crowd = report && active ? report.crowd[active.scoring] : null;

  return <div className="gl-page pools">
    <header className="gl-hero">
      <div>
        <p className="gl-label">College football bowl pools{report ? ` · ${report.season}–${String(report.season + 1).slice(2)}` : ''}</p>
        <h1 className="gl-title">Bowl pool picks, <span>built to win your pool.</span></h1>
        <p className="gl-lede">Most people in a bowl pool pick with their heart. This sheet picks with the betting market, then adds a few upsets only where they raise your chance of finishing first. Tell us how your pool works and we&apos;ll build the sheet.</p>
      </div>
    </header>

    {query.isLoading && <ConsumerLoading label="Loading bowl games…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load the bowl games.</strong>Refresh the page in a minute.</div>}
    {query.data?.status === 'unavailable' && <>
      <div className="gl-empty"><strong>Bowl matchups are set on Sunday, December 6.</strong>Your sheet appears here that evening and updates twice a day until the games start.</div>
      <MarchSignup />
    </>}

    {report && active && sheet && <>
      <Choices report={report} choice={active} onChange={change} />

      {poolsLocked(report) && <p className="gl-card pools-locked">Most pools locked at the first kickoff ({gameDate(report.firstKickoff)}). Results fill in as games finish.</p>}

      <section className="pools-summary" aria-label="How this sheet does">
        {sheet.win !== null ? <div className="gl-stats">
          <div className="gl-stat"><b>{winPct(sheet.win)}</b><small>this sheet finishes first</small></div>
          <div className="gl-stat"><b>{winPct(sheet.chalkWin)}</b><small>picking every favorite</small></div>
          <div className="gl-stat"><b>{winPct(sheet.fair)}</b><small>a random entry</small></div>
          <p className="gl-stats-note">Estimated from thousands of simulated {active.size}-person {POOL_TYPE_LABELS[active.type].label.toLowerCase()} pools whose players pick the way {crowd?.entries ? `${crowd.entries.toLocaleString('en-US')} ` : ''}ESPN Bowl Mania players did. Your pool will differ. <a className="gl-link" href="#how">How this works</a>.</p>
        </div> : <p className="gl-card pools-note">ESPN hasn&apos;t posted how players are picking yet, so for now this is the every-favorite sheet{active.scoring === 'confidence' ? ', with the most points on the surest games' : ''}. It updates twice a day and adds upsets once pick data is in.</p>}
        {score.games > 0 && <p className="pools-score">So far: <b>{score.wins} of {score.games}</b> right{active.scoring === 'confidence' ? <>, <b>{score.points} of {score.possible}</b> points</> : null}.</p>}
      </section>

      <section className="gl-section" aria-labelledby="pools-sheet-title">
        <div className="gl-section-head">
          <h2 id="pools-sheet-title">Your sheet <small>{rows.length} bowls</small></h2>
          <CopyButton text={sheetText(rows, active.scoring)} onCopied={() => countEvent('bowl_sheet_copied', key ?? undefined)} />
        </div>
        <p className="pools-muted">{active.scoring === 'confidence' ? 'Most points first.' : 'In date order.'} Win chances from the betting line ({report.games.find(game => game.lineSource)?.lineSource ?? 'ESPN'}), updated {new Date(report.generatedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET. &ldquo;Picked by&rdquo; is the share of ESPN Bowl Mania players who made the same pick.</p>
        <ol className="pools-sheet">{rows.map(row => <SheetLine key={row.game.id} row={row} scoring={active.scoring} />)}</ol>
      </section>

      {mistakes.length > 0 && <section className="gl-section" aria-labelledby="pools-mistakes-title">
        <div className="gl-section-head"><h2 id="pools-mistakes-title">Where your pool will likely go wrong</h2></div>
        <p className="pools-muted">Bowls where most ESPN players backed the betting underdog. Each one is a chance to gain on most of your pool without taking a risk.</p>
        <ul className="pools-mistakes">{mistakes.map(item => <li key={item.game.id} className="gl-card">
          <TeamLogo team={item.favorite} size={24} />
          <span><b>{item.favorite.name}</b> wins {pct(item.chance)} of the time, but only {pct(item.crowd)} of players picked them over {item.underdog.name}. <small>{item.game.bowl}</small></span>
        </li>)}</ul>
      </section>}

      <section className="gl-card pools-how" id="how" aria-labelledby="pools-how-title">
        <h2 id="pools-how-title">How this works</h2>
        <ul>
          <li><b>Who wins:</b> each team&apos;s chance comes from the betting line, with the sportsbook&apos;s cut removed. In 177 bowls from 2022 to 2025, those chances were well calibrated.</li>
          <li><b>Who your pool picks:</b> we simulate your pool thousands of times. The players pick the way ESPN Bowl Mania players actually did. Some lean toward favorites and some toward upsets, and in a sharp pool a few follow the betting odds.</li>
          <li><b>Your sheet:</b> we start from every favorite, with the most points on the surest games. Then we keep an upset or a points swap only when it raises your chance of finishing first.</li>
          <li><b>Tested:</b> on the 2022–2025 bowls, the every-favorite sheet won a simulated 25-person confidence pool 14–34% of the time, against 4% for a random entry. Adding upsets helped most in big pools, sharp pools and one-point-a-game pools.</li>
        </ul>
        <p className="pools-muted"><b>What we can&apos;t promise.</b> These are estimates from simulated pools, and your pool may pick differently from ESPN&apos;s players. Many bowls are close to coin flips, so even the best sheet loses most pools. Opt-outs move the lines, so check back before your pool locks.</p>
      </section>

      <MarchSignup />
    </>}
  </div>;
}
