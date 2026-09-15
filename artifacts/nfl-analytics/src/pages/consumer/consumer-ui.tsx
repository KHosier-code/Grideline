import type { ConsumerGame, ConsumerMarketQuote } from '@workspace/api-client-react';
import { AlertTriangle, CalendarDays, ChevronRight, Loader2 } from 'lucide-react';
import { Link } from 'wouter';

export function ConsumerLoading({ label = 'Loading the latest view…' }: { label?: string }) {
  return <div className="consumer-state"><Loader2 className="h-6 w-6 animate-spin" /><p>{label}</p></div>;
}

export function ConsumerMessage({ title, detail, error = false }: { title: string; detail: string; error?: boolean }) {
  return <div className="consumer-state">{error ? <AlertTriangle className="h-7 w-7 text-amber-600" /> : <CalendarDays className="h-7 w-7" />}<h2>{title}</h2><p>{detail}</p></div>;
}

export function formatKickoff(value: string | null) {
  if (!value) return 'Kickoff time to be announced';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Kickoff time to be announced';
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export function formatQuote(quote: ConsumerMarketQuote | null, kind: 'spread' | 'moneyline' | 'total') {
  if (!quote) return 'Updating';
  const price = quote.price > 0 ? `+${quote.price}` : String(quote.price);
  if (kind === 'moneyline') return `${price} · ${quote.sportsbook}`;
  const point = quote.point === null ? '—' : `${quote.point > 0 ? '+' : ''}${quote.point}`;
  return `${point} (${price}) · ${quote.sportsbook}`;
}

const score = (value?: number | null) => value === null || value === undefined ? '—' : value.toFixed(1);

export function ConsumerGameCard({ game, compact = false }: { game: ConsumerGame; compact?: boolean }) {
  const final = game.finalScore;
  const prediction = game.prediction;
  return (
    <Link href={`/games/${game.gameId}`} className="consumer-game-card">
      <div className="consumer-game-card-head"><span>{formatKickoff(game.kickoffTime)}</span><span>{final ? 'Final' : game.dataConfidence.label}</span></div>
      <div className="consumer-matchup">
        <div><strong>{game.matchup.away.abbreviation}</strong><span>{game.matchup.away.name}</span></div><b>{final ? final.away : score(prediction?.projectedAwayScore)}</b>
        <div><strong>{game.matchup.home.abbreviation}</strong><span>{game.matchup.home.name}</span></div><b>{final ? final.home : score(prediction?.projectedHomeScore)}</b>
      </div>
      {!compact && <div className="consumer-card-metrics">
        <span><small>Projection</small>{prediction ? `${score(prediction.projectedMargin)} margin` : game.availability.prediction ?? 'Updating'}</span>
        <span><small>Market spread</small>{formatQuote(game.market.spread, 'spread')}</span>
      </div>}
      <div className="consumer-game-card-foot"><span>{game.dataConfidence.reason ?? `${game.dataConfidence.label} data confidence`}</span><ChevronRight className="h-4 w-4" /></div>
    </Link>
  );
}

export function recordRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

export function metric(value: unknown, percent = false) {
  return typeof value === 'number' && Number.isFinite(value) ? `${(percent ? value * 100 : value).toFixed(1)}${percent ? '%' : ''}` : 'Unavailable';
}