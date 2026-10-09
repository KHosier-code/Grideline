import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getGetConsumerTouchdownsQueryKey, useGetConsumerTouchdowns, type ConsumerTouchdownPick } from '@workspace/api-client-react';
import { formatPrice } from '@/lib/pick-sheet';
import { ConsumerLoading } from './consumer-ui';

const SITE = 'gridelineanalytics.com';
const pct = (value: number) => `${Math.round(value * 100)}%`;

function reason(pick: ConsumerTouchdownPick) {
  const f = pick.factors;
  const parts: string[] = [];
  if ((f.carryShare ?? 0) >= (f.targetShare ?? 0)) {
    if (f.carryShare !== null) parts.push(`${pct(f.carryShare)} of carries`);
  } else if (f.targetShare !== null) parts.push(`${pct(f.targetShare)} of targets`);
  if (f.redZoneTouchesPerGame !== null) parts.push(`${f.redZoneTouchesPerGame.toFixed(1)} red-zone touches a game`);
  if (f.teamImpliedPoints !== null) parts.push(`team total ${f.teamImpliedPoints.toFixed(1)}`);
  return parts.join(', ');
}

/** The animated picks (share_clip.py), shown once a clip exists for this week. */
function ClipBox({ week }: { week: number | null | undefined }) {
  const clip = useQuery({
    queryKey: ['share-clip', week],
    enabled: typeof week === 'number',
    queryFn: async () => (await fetch(`/api/share/td-clip.mp4?week=${week}`, { method: 'HEAD' })).ok,
    staleTime: 5 * 60_000,
  });
  if (!clip.data) return null;
  return <section className="gl-card gl-share-box">
    <div className="gl-share-head">
      <h2>Video clip</h2>
      <a className="gl-button" href={`/api/share/td-clip.mp4?week=${week}&download=1`} download={`gridline-week-${week}-td-picks.mp4`}>Download</a>
    </div>
    <video className="gl-share-clip" src={`/api/share/td-clip.mp4?week=${week}`} controls muted playsInline loop preload="metadata"
      aria-label={`Week ${week} anytime touchdown picks, animated`} />
    <p className="gl-note">A 9-second vertical video for Reels, TikTok, Shorts and X. Made with each Tuesday&apos;s picks.</p>
  </section>;
}

function CopyBox({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return <section className="gl-card gl-share-box">
    <div className="gl-share-head">
      <h2>{label}</h2>
      <button type="button" className="gl-button" onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
      }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
    <textarea readOnly value={text} rows={Math.min(24, text.split('\n').length + 1)} aria-label={label} />
  </section>;
}

/** Ready-made weekly posts: the picks card, a video clip, an X post and an email. Not linked from the menu. */
export default function SharePicks() {
  const query = useGetConsumerTouchdowns(undefined, { query: { queryKey: getGetConsumerTouchdownsQueryKey() } });
  const data = query.data;
  const top = (data?.picks ?? []).slice(0, 10);
  const lastWeek = data?.record.weeks.filter(item => data.week !== null && item.week < data.week).at(-1);
  const record = lastWeek ? `Last week ${lastWeek.hits} of our top ${lastWeek.picks} scored.` : '';
  const post = top.length ? [
    `Week ${data?.week} anytime TD picks (our model's chance to score):`,
    '',
    ...top.slice(0, 5).map((pick, index) => `${index + 1}. ${pick.name} (${pick.team}) ${pct(pick.probability)}`),
    '',
    record,
    `All 10 plus the why: ${SITE}/touchdowns`,
  ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n') : '';
  const email = top.length ? [
    `Subject: Week ${data?.week}: our top 10 anytime touchdown picks`,
    '',
    `Here are this week's 10 players most likely to score a touchdown, by our model.${record ? ` ${record}` : ''}`,
    '',
    ...top.map((pick, index) => `${index + 1}. ${pick.name}, ${pick.position}, ${pick.team} ${pick.isHome ? 'vs' : 'at'} ${pick.opponent}: ${pct(pick.probability)} (fair odds ${formatPrice(pick.fairOdds)})\n   ${reason(pick)}`),
    '',
    `Every player, every game, and how the model works: https://${SITE}/touchdowns`,
    '',
    'These are model estimates, not guarantees. Lines move, so check your sportsbook. 21+ where legal. If gambling stops being fun, call or text 1-800-GAMBLER.',
  ].join('\n') : '';

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{data?.season ? `${data.season} · week ${data.week}` : 'Share'}</p>
        <h1 className="gl-title">Share this <span>week</span></h1>
        <p className="gl-lede">The picks card, a video clip, a post and an email, filled in from this week&apos;s TD picks. Copy, paste, send.</p>
      </div>
    </header>
    {query.isLoading && <ConsumerLoading label="Loading this week…" />}
    {!query.isLoading && !top.length && <div className="gl-empty"><strong>No picks posted yet.</strong>They appear after Tuesday&apos;s model run.</div>}
    {top.length > 0 && <>
      <section className="gl-card gl-share-box">
        <div className="gl-share-head">
          <h2>Picks card</h2>
          <a className="gl-button" href="/api/share/td-card.png" download={`gridline-week-${data?.week}-td-picks.png`}>Download</a>
        </div>
        <img className="gl-share-card" src={`/api/share/td-card.png?week=${data?.week}`} alt={`Week ${data?.week} anytime touchdown picks card`} />
        <p className="gl-note">This image is also the preview when someone shares a link to TD Picks.</p>
      </section>
      <ClipBox week={data?.week} />
      <CopyBox label="Post for X or Threads" text={post} />
      <CopyBox label="Weekly email" text={email} />
    </>}
  </div>;
}
