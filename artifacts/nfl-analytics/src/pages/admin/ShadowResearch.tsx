import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Database, Loader2, Microscope } from 'lucide-react';

type RecordMetric = { wins: number; losses: number; pushes: number };
type WindowSummary = {
  captured: number;
  available: number;
  unavailable: number;
  graded: number;
  minimumSample: number;
  sampleStatus: 'measured' | 'insufficient_sample';
  sampleMessage: string;
  metrics: {
    marginMae: number | null;
    totalMae: number | null;
    marginRmse: number | null;
    totalRmse: number | null;
    brierScore: number | null;
    logLoss: number | null;
    moneylineAccuracy: number | null;
    averageMarketDifference: { spread: number | null; total: number | null };
    calibration: Array<{
      bucket: string;
      predictions: number;
      predicted: number | null;
      actual: number | null;
    }>;
    ats: RecordMetric;
    overUnder: RecordMetric;
    moneyline: RecordMetric;
    qualifiedReturn: {
      spread: { samples: number; units: number; roi: number | null } | null;
      total: { samples: number; units: number; roi: number | null } | null;
      moneyline: { samples: number; units: number; roi: number | null } | null;
    };
  };
};
type Scoreboard = {
  season: number;
  generatedAt: string;
  productionBehavior: string;
  promotionStateChanged: boolean;
  baselineManifest: {
    reproducibilityStatus?: string;
    limitation?: string | null;
    manifestChecksum?: string;
  } | null;
  families: Array<{
    family: string;
    modelVersion: string | null;
    featureVersion: string | null;
    provenance: { artifactId: string | null; inputFingerprint: string; marketFingerprint: string } | null;
    windows: { season: WindowSummary; last20: WindowSummary; last50: WindowSummary };
  }>;
};
type Status = {
  nextEligibleSlate: {
    gameId: string;
    kickoffTime: string | null;
    cutoffAt: string | null;
    capturedFamilies: Array<{ family: string; version: string; status: string; reason: string | null }>;
  } | null;
  baselineManifest: { status: string; limitation: string | null; checksum: string | null };
  productionBehavior: string;
  consumerChallengerOutputs: boolean;
};

const labels: Record<string, string> = {
  phase61: 'Phase 6.1',
  advanced_football: 'Advanced Football',
  market_residual: 'Market-Residual',
  ensemble: 'Ensemble',
};
const windows = [
  { key: 'season' as const, label: 'Season to date' },
  { key: 'last20' as const, label: 'Last 20' },
  { key: 'last50' as const, label: 'Last 50' },
];

function number(value: number | null, digits = 3) {
  return value === null ? '—' : value.toFixed(digits);
}

function record(value: RecordMetric) {
  return `${value.wins}-${value.losses}-${value.pushes}`;
}

export default function ShadowResearch() {
  const { getToken } = useAuth();
  const request = async <T,>(path: string): Promise<T> => {
    const token = await getToken();
    const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? 'Research evidence unavailable');
    return response.json();
  };
  const scoreboard = useQuery({
    queryKey: ['shadow-research-scoreboard'],
    queryFn: () => request<Scoreboard>('/api/admin/research/shadow-scoreboard'),
    staleTime: 60_000,
  });
  const status = useQuery({
    queryKey: ['shadow-research-status'],
    queryFn: () => request<Status>('/api/admin/research/shadow-status'),
    staleTime: 60_000,
  });
  if (scoreboard.isLoading || status.isLoading) {
    return <div className="consumer-state"><Loader2 className="h-6 w-6 animate-spin" /><p>Loading immutable research evidence…</p></div>;
  }
  if (scoreboard.isError || status.isError || !scoreboard.data || !status.data) {
    return <div className="consumer-state"><AlertTriangle className="h-6 w-6" /><h2>Research scoreboard unavailable</h2><p>{String(scoreboard.error ?? status.error ?? '')}</p></div>;
  }
  const data = scoreboard.data;
  const ops = status.data;
  return (
    <div className="space-y-5" data-testid="shadow-research-page">
      <div>
        <p className="eyebrow">Models / Forward evaluation</p>
        <h1 className="page-title">Immutable shadow scoreboard</h1>
        <p className="page-detail">Phase 6.1 and research challengers evaluated at the same pregame cutoff. No result changes production recommendations or promotion state.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="metric-card">
          <span className="metric-label">Production isolation</span>
          <div className="mt-3 flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{data.productionBehavior}</div>
          <p className="mt-2 text-xs text-muted-foreground">Promotion changed: {data.promotionStateChanged ? 'yes' : 'no'} · consumer challenger output: {ops.consumerChallengerOutputs ? 'yes' : 'no'}</p>
        </section>
        <section className="metric-card">
          <span className="metric-label">Baseline manifest</span>
          <div className="mt-3 font-semibold">{ops.baselineManifest.status.replaceAll('_', ' ')}</div>
          <p className="mt-2 text-xs text-muted-foreground">{ops.baselineManifest.limitation ?? 'Exact source and identity manifest reproduced.'}</p>
        </section>
        <section className="metric-card">
          <span className="metric-label">Next cutoff</span>
          <div className="mt-3 font-semibold">{ops.nextEligibleSlate?.gameId ?? 'No upcoming game'}</div>
          <p className="mt-2 text-xs text-muted-foreground">{ops.nextEligibleSlate?.cutoffAt ? new Date(ops.nextEligibleSlate.cutoffAt).toLocaleString() : 'Schedule unavailable'}</p>
        </section>
      </div>

      {data.families.map((family) => (
        <section className="panel" key={family.family}>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow">{labels[family.family] ?? family.family}</p>
              <h2 className="section-title">{family.modelVersion ?? 'Version unavailable'}</h2>
              <p className="mt-1 text-xs text-muted-foreground">Feature version: {family.featureVersion ?? 'not captured yet'}</p>
            </div>
            {family.provenance && <code className="max-w-full truncate text-[10px] text-muted-foreground" title={family.provenance.inputFingerprint}>Input {family.provenance.inputFingerprint.slice(0, 12)}…</code>}
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {windows.map(({ key, label }) => {
              const item = family.windows[key];
              return (
                <div className="rounded-xl border border-border bg-background p-4" key={key}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{label}</h3>
                    <span className={item.sampleStatus === 'measured' ? 'status-pill status-current' : 'status-pill status-unavailable'}>
                      {item.sampleStatus === 'measured' ? 'Measured' : 'Insufficient'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{item.sampleMessage}</p>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div><dt className="text-muted-foreground">Captured</dt><dd className="font-semibold">{item.captured}</dd></div>
                    <div><dt className="text-muted-foreground">Graded / unavailable</dt><dd className="font-semibold">{item.graded} / {item.unavailable}</dd></div>
                    <div><dt className="text-muted-foreground">Margin / total MAE</dt><dd className="font-semibold">{number(item.metrics.marginMae)} / {number(item.metrics.totalMae)}</dd></div>
                    <div><dt className="text-muted-foreground">Margin / total RMSE</dt><dd className="font-semibold">{number(item.metrics.marginRmse)} / {number(item.metrics.totalRmse)}</dd></div>
                    <div><dt className="text-muted-foreground">Brier / log loss</dt><dd className="font-semibold">{number(item.metrics.brierScore)} / {number(item.metrics.logLoss)}</dd></div>
                    <div><dt className="text-muted-foreground">Moneyline accuracy</dt><dd className="font-semibold">{item.metrics.moneylineAccuracy === null ? '—' : `${(item.metrics.moneylineAccuracy * 100).toFixed(1)}%`}</dd></div>
                    <div><dt className="text-muted-foreground">ATS / O-U</dt><dd className="font-semibold">{record(item.metrics.ats)} / {record(item.metrics.overUnder)}</dd></div>
                    <div><dt className="text-muted-foreground">Qualified ROI S/T/ML</dt><dd className="font-semibold">{(['spread', 'total', 'moneyline'] as const).map(market => item.metrics.qualifiedReturn[market]?.roi == null ? '—' : `${(item.metrics.qualifiedReturn[market]!.roi! * 100).toFixed(1)}%`).join(' / ')}</dd></div>
                    <div><dt className="text-muted-foreground">Avg market diff S/T</dt><dd className="font-semibold">{number(item.metrics.averageMarketDifference.spread)} / {number(item.metrics.averageMarketDifference.total)}</dd></div>
                  </dl>
                  <div className="mt-4 border-t border-border pt-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Calibration</p>
                    <div className="mt-2 space-y-1">
                      {item.metrics.calibration.filter(bucket => bucket.predictions > 0).length ? (
                        item.metrics.calibration.filter(bucket => bucket.predictions > 0).map(bucket => (
                          <div className="grid grid-cols-[1fr_auto] gap-2 text-[10px]" key={bucket.bucket}>
                            <span className="text-muted-foreground">{bucket.bucket} · n={bucket.predictions}</span>
                            <span className="font-medium">{number(bucket.predicted, 2)} predicted / {number(bucket.actual, 2)} actual</span>
                          </div>
                        ))
                      ) : <p className="text-[10px] text-muted-foreground">No graded probability samples.</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="panel">
        <div className="flex gap-3"><Database className="h-5 w-5 text-accent" /><div><h2 className="section-title">Evidence boundary</h2><p className="mt-2 text-sm text-muted-foreground">Cutoff rows and grades are append-only. Unavailable challenger inference is retained with a stable reason and cannot be replaced by later evidence.</p></div></div>
      </section>
    </div>
  );
}