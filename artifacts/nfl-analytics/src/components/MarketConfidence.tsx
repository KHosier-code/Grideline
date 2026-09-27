import { useEffect, useState } from 'react';
import { ChevronDown, CircleHelp } from 'lucide-react';

export type ConfidenceMarket = 'spread' | 'moneyline' | 'total';
type ConfidenceLabel = 'Low' | 'Moderate' | 'Strong' | 'Very Strong';

type ConfidenceComponent = {
  key: 'data' | 'model' | 'marketEdge';
  label: string;
  score: number | null;
  summary: string;
};

export type MarketConfidence = {
  market: ConfidenceMarket;
  score: number;
  label: ConfidenceLabel;
  explanation: string;
  components: ConfidenceComponent[];
  evidence: {
    marketFresh?: boolean;
    bookCount?: number;
    booksAgree?: boolean;
    agreementTolerance?: string | null;
    historical?: {
      status: string;
      bucket?: string | null;
      sampleSize?: number | null;
      confidenceInterval95?: { low: number | null; high: number | null } | null;
      note: string;
    };
  };
  downgradeReasons: string[];
  calculatedAt: string;
};

const markets: ConfidenceMarket[] = ['spread', 'moneyline', 'total'];
const marketLabels: Record<ConfidenceMarket, string> = {
  spread: 'Spread',
  moneyline: 'Moneyline',
  total: 'Total',
};

function isMarket(value: unknown): value is ConfidenceMarket {
  return typeof value === 'string' && markets.includes(value as ConfidenceMarket);
}

export function readMarketConfidence(value: unknown): MarketConfidence[] {
  if (!value || typeof value !== 'object') return [];
  const confidence = (value as { confidence?: unknown }).confidence;
  if (!confidence || typeof confidence !== 'object') return [];
  const rows = (confidence as { markets?: unknown }).markets;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is MarketConfidence => {
    if (!row || typeof row !== 'object') return false;
    const item = row as Partial<MarketConfidence>;
    return isMarket(item.market)
      && typeof item.score === 'number'
      && typeof item.label === 'string'
      && typeof item.explanation === 'string'
      && Array.isArray(item.components);
  });
}

function scoreLabel(label: ConfidenceLabel) {
  return label.toLowerCase().replace(' ', '-');
}

function formatHistorical(historical: MarketConfidence['evidence']['historical']) {
  if (!historical) return 'Historical evidence unavailable';
  const sample = historical.sampleSize === null || historical.sampleSize === undefined ? null : `n=${historical.sampleSize}`;
  const interval = historical.confidenceInterval95?.low !== null && historical.confidenceInterval95?.low !== undefined
    && historical.confidenceInterval95?.high !== null && historical.confidenceInterval95?.high !== undefined
    ? ` · 95% interval ${(historical.confidenceInterval95.low * 100).toFixed(0)}–${(historical.confidenceInterval95.high * 100).toFixed(0)}%`
    : '';
  return [historical.status, historical.bucket, sample].filter(Boolean).join(' · ') + interval;
}

// Quote freshness is measured at calculation time. It does not make a saved score live.
function calculationAge(calculatedAt: string, now: number) {
  const time = typeof calculatedAt === 'string' ? Date.parse(calculatedAt) : NaN;
  if (!Number.isFinite(time) || time > now) return { text: 'Calculation time unavailable', date: null };
  const minutes = Math.floor((now - time) / 60_000);
  const age = minutes < 1 ? 'less than 1 min' : minutes < 60 ? `${minutes} min`
    : minutes < 1440 ? `${Math.floor(minutes / 60)} hr` : `${Math.floor(minutes / 1440)} days`;
  return { text: `Calculated ${age} ago · ${minutes >= 30 ? 'Older calculation; quotes may have changed' : 'Calculation under 30 min old'}`, date: new Date(time).toISOString() };
}

function ConfidenceCard({ confidence, compact = false, now }: { confidence: MarketConfidence; compact?: boolean; now: number }) {
  const evidence = confidence.evidence ?? {};
  const detailId = `confidence-detail-${confidence.market}-${compact ? 'compact' : 'full'}`;
  const calculation = calculationAge(confidence.calculatedAt, now);
  return (
    <details className={`market-confidence-card confidence-${scoreLabel(confidence.label)}${compact ? ' is-compact' : ''}`}>
      <summary className="market-confidence-summary">
        <span className="confidence-market-name">{marketLabels[confidence.market]}</span>
        <span className="confidence-label">{confidence.label}</span>
        <span className="confidence-score">{Math.round(confidence.score)}/100 <span>evidence score</span></span>
        <span className="sr-only">Why this evidence-quality score?</span>
        <ChevronDown aria-hidden="true" className="confidence-chevron" />
        <span className="confidence-calculation-age">
          {calculation.date ? <time dateTime={calculation.date} title={new Date(calculation.date).toLocaleString()}>{calculation.text}</time> : calculation.text}
        </span>
      </summary>
      <div className="market-confidence-detail" id={detailId}>
        <p className="confidence-meaning">This evidence-quality score is not the chance a team wins or a proven betting edge. Win probability comes separately from the moneyline model.</p>
        <p className="confidence-explanation">{confidence.explanation}</p>
        <div className="confidence-components" aria-label={`${marketLabels[confidence.market]} confidence components`}>
          {confidence.components.slice(0, 3).map((component) => (
            <div className="confidence-component" key={component.key}>
              <span><strong>{component.key === 'marketEdge' ? 'Market difference evidence' : component.label}</strong><b>{component.score === null ? 'Unavailable' : `${Math.round(component.score)}/100`}</b></span>
              <small>{component.summary}</small>
            </div>
          ))}
        </div>
        {!compact && (
          <div className="confidence-evidence">
            <span><b>Market quotes at calculation</b>{evidence.marketFresh === undefined ? 'Unavailable' : evidence.marketFresh ? 'Fresh then (not necessarily now)' : 'Stale or unavailable then'}</span>
            <span><b>Books</b>{evidence.bookCount === undefined ? 'Unavailable' : `${evidence.bookCount} · ${evidence.booksAgree ? 'DK/FD agree' : 'DK/FD disagreement'}${evidence.agreementTolerance ? ` (${evidence.agreementTolerance})` : ''}`}</span>
            <span><b>Historical context</b>{formatHistorical(evidence.historical)}</span>
          </div>
        )}
        {confidence.downgradeReasons.length > 0 && (
          <div className="confidence-downgrades">
            <b>Why this is not higher</b>
            <ul>{confidence.downgradeReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
        )}
      </div>
    </details>
  );
}

export function MarketConfidenceSummary({ value, compact = false }: { value: unknown; compact?: boolean }) {
  const confidences = readMarketConfidence(value);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  if (!confidences.length) return null;
  return (
    <section className={`market-confidence ${compact ? 'market-confidence-compact' : ''}`} data-testid="market-confidence">
      <div className="market-confidence-heading">
        <span><CircleHelp aria-hidden="true" /> Evidence quality by market</span>
      </div>
      <p className="confidence-meaning">Scores measure evidence quality, not a team’s chance of winning or a proven betting edge. They include input quality, model evidence and absolute model–market difference.</p>
      <div className="market-confidence-grid">
        {confidences.map((confidence) => <ConfidenceCard key={confidence.market} confidence={confidence} compact={compact} now={now} />)}
      </div>
    </section>
  );
}