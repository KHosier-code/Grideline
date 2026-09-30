import { useState } from 'react';
import { TeamLogo } from './TeamLogo';
import { teamName } from '@/lib/team-colors';
import { pct } from '@/lib/usage-report';

/** Segmented control in the site's pill style. */
export function Seg<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<[NoInfer<T>, string]>; onChange: (value: NoInfer<T>) => void;
}) {
  return <div className="gl-seg" role="group" aria-label={label}>
    <span className="gl-seg-label">{label}</span>
    <div className="gl-filters">
      {options.map(([key, text]) => <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>)}
    </div>
  </div>;
}

function Headshot({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(' ').map(part => part[0]).slice(0, 2).join('');
  if (!src || failed) return <span className="gl-headshot gl-headshot-fallback" aria-hidden="true">{initials}</span>;
  return <img className="gl-headshot" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function PlayerCell({ name, position, team, headshot, showTeam = true }: {
  name: string; position: string; team: string; headshot: string | null; showTeam?: boolean;
}) {
  return <div className="gl-player-cell">
    <Headshot src={headshot} name={name} />
    <span>
      <b>{name}</b>
      <small><span className={`gl-pos gl-pos-${position.toLowerCase()}`}>{position}</span>{showTeam && <><TeamLogo team={team} size={16} />{teamName(team)}</>}</small>
    </span>
  </div>;
}

/** Share of the team (0-1) with a bar scaled to `max`. */
export function ShareBar({ value, max = 0.5 }: { value: number | null; max?: number }) {
  const width = value === null ? 0 : Math.min(100, (value / max) * 100);
  return <span className="gl-share">
    <b>{pct(value)}</b>
    <i aria-hidden="true"><em style={{ width: `${width}%` }} /></i>
  </span>;
}

/** Tiny week-by-week line; values are 0-1 shares. */
export function Sparkline({ values, label }: { values: Array<number | null>; label: string }) {
  const points = values.map((value, index) => [index, value ?? 0] as const);
  if (points.length < 2) return <span className="gl-muted">—</span>;
  const w = 72, h = 22, max = Math.max(0.3, ...points.map(([, v]) => v));
  const x = (i: number) => (i / (points.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 2 - (v / max) * (h - 4);
  const d = points.map(([i, v], n) => `${n ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const [lastI, lastV] = points[points.length - 1];
  return <svg className="gl-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    <circle cx={x(lastI)} cy={y(lastV)} r="2.4" fill="currentColor" />
  </svg>;
}

export function ReportMeta({ season, throughWeek, generatedAt }: { season: number; throughWeek: number; generatedAt: string }) {
  const updated = new Date(generatedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return <p className="gl-label">{season} regular season · through week {throughWeek} · updated {updated}</p>;
}
