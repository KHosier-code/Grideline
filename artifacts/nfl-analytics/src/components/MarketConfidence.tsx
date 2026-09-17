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

function ConfidenceCard({ confidence, compact = false }: { confidence: MarketConfidence; compact?: boolean }) {
  const evidence = confidence.evidence ?? {};
  const detailId = `confidence-detail-${confidence.market}-${compact ? 'compact' : 'full'}`;
  return (
    <details className={`market-confidence-card confidence-${scoreLabel(confidence.label)}${compact ? ' is-compact' : ''}`}>
      <summary className="market-confidence-summary">
        <span className="confidence-market-name">{marketLabels[confidence.market]}</span>
        <span className="confidence-label">{confidence.label}</span>
        <span className="confidence-score">{Math.round(confidence.score)}/100</span>
        <span className="sr-only">Why this confidence?</span>
        <ChevronDown aria-hidden="true" className="confidence-chevron" />
      </summary>
      <div className="market-confidence-detail" id={detailId}>
        <p className="confidence-explanation">{confidence.explanation}</p>
        <div className="confidence-components" aria-label={`${marketLabels[confidence.market]} confidence components`}>
          {confidence.components.slice(0, 3).map((component) => (
            <div className="confidence-component" key={component.key}>
              <span><strong>{component.label}</strong><b>{component.score === null ? 'Unavailable' : `${Math.round(component.score)}/100`}</b></span>
              <small>{component.summary}</small>
            </div>
          ))}
        </div>
        {!compact && (
          <div className="confidence-evidence">
            <span><b>Freshness</b>{evidence.marketFresh === undefined ? 'Unavailable' : evidence.marketFresh ? 'Current' : 'Stale or unavailable'}</span>
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
  if (!confidences.length) return null;
  return (
    <section className={`market-confidence ${compact ? 'market-confidence-compact' : ''}`} data-testid="market-confidence">
      <div className="market-confidence-heading">
        <span><CircleHelp aria-hidden="true" /> Confidence by market</span>
        {!compact && <small>Evidence-based, not a certainty claim</small>}
      </div>
      <div className="market-confidence-grid">
        {confidences.map((confidence) => <ConfidenceCard key={confidence.market} confidence={confidence} compact={compact} />)}
      </div>
    </section>
  );
}