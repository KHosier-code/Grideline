import { useMemo, useState } from 'react';
import { useGetUsageAnalyticsSummary } from '@workspace/api-client-react';
import {
  Activity,
  Calendar,
  MousePointerClick,
  RefreshCcw,
  AlertTriangle,
  Loader2,
  Database,
  ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

function formatDate(value?: string | null, includeTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(date);
}

function cx(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

interface UsageItem {
  label: string;
  count: number;
  choice?: string;
}

const REPORTING_PERIODS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
] as const;
type ReportingPeriod = (typeof REPORTING_PERIODS)[number]['value'];

function MetricCard({ label, value, detail, icon: Icon, accent = false }: { label: string; value: string; detail: string; icon: LucideIcon; accent?: boolean }) {
  return (
    <div className={cx('metric-card', accent && 'metric-card-accent')}>
      <div className="flex items-start justify-between">
        <span className="metric-label">{label}</span>
        <Icon className="h-4 w-4 text-accent" />
      </div>
      <div className="mt-4 metric-value">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function Panel({ title, eyebrow, action, children, className = '' }: { title?: string; eyebrow?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('panel', className)}>
      {(title || eyebrow || action) && (
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2 className="section-title">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function UsageList({ title, data, limit }: { title: string; data: UsageItem[]; limit?: number }) {
  const displayData = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.count - a.count);
    return limit ? sorted.slice(0, limit) : sorted;
  }, [data, limit]);

  if (displayData.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-background p-5 flex flex-col items-center justify-center text-center min-h-[120px]">
        <Database className="h-4 w-4 text-muted-foreground/50 mb-2" />
        <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{title}</h3>
        <p className="text-[10px] text-muted-foreground/70 mt-1">No records</p>
      </div>
    );
  }

  const maxCount = Math.max(...displayData.map(d => d.count));

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm flex flex-col">
      <div className="bg-secondary/40 px-4 py-3 flex items-center justify-between border-b border-border">
        <h3 className="text-[11px] font-bold text-ink uppercase tracking-wider">{title}</h3>
        <span className="text-[9px] font-mono text-muted-foreground uppercase">Count</span>
      </div>
      <div className="p-2 flex flex-col gap-1 flex-1 bg-card">
        {displayData.map((item, i) => {
          const percentage = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
          return (
            <div key={`${item.label}-${item.choice}-${i}`} className="relative flex items-center justify-between px-3 py-2.5 rounded-lg overflow-hidden bg-background border border-transparent transition-colors z-0">
               <div
                 className="absolute top-0 bottom-0 left-0 bg-secondary/80 pointer-events-none -z-10 transition-all duration-500 ease-out"
                 style={{ width: `${percentage}%` }}
               />
               <div className="flex items-center gap-2.5">
                 <span className="font-semibold text-xs text-ink">{item.label}</span>
                 {item.choice && (
                   <>
                     <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                     <span className="px-1.5 py-[2px] bg-card border border-border text-foreground rounded text-[9px] font-mono uppercase tracking-wider shadow-sm">
                       {item.choice}
                     </span>
                   </>
                 )}
               </div>
               <span className="font-mono text-xs text-ink relative font-medium">{item.count.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDayLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(year, month - 1, day));
}

function DailyTrend({ data }: { data: { date: string; eventCount: number; rowExpansionCount: number }[] }) {
  const maxEvents = Math.max(1, ...data.map((row) => row.eventCount));
  const maxExpansions = Math.max(1, ...data.map((row) => row.rowExpansionCount));

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="bg-secondary/40 px-4 py-3 flex items-center justify-between border-b border-border">
        <div>
          <h3 className="text-[11px] font-bold text-ink uppercase tracking-wider">Daily activity</h3>
          <p className="mt-1 text-[10px] text-muted-foreground">All interactions and expanded evidence rows by UTC day</p>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-mono uppercase text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent" /> events</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-ink/40" /> expansions</span>
        </div>
      </div>
      <div className="p-4 space-y-3">
        {data.map((row) => (
          <div key={row.date} className="grid grid-cols-[52px_1fr_70px] items-center gap-3">
            <span className="text-[10px] font-mono text-muted-foreground">{formatDayLabel(row.date)}</span>
            <div className="space-y-1.5">
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(row.eventCount / maxEvents) * 100}%` }} />
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full bg-ink/40 transition-all" style={{ width: `${(row.rowExpansionCount / maxExpansions) * 100}%` }} />
              </div>
            </div>
            <div className="text-right text-[10px] font-mono text-ink">
              <div>{row.eventCount.toLocaleString()}</div>
              <div className="text-muted-foreground">{row.rowExpansionCount.toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function UsageAnalytics() {
  const [period, setPeriod] = useState<ReportingPeriod>('7d');
  const { data, isLoading, isError } = useGetUsageAnalyticsSummary({ period });

  if (isLoading) {
    return (
      <div>
        <header className="page-header">
          <div>
            <p className="eyebrow">PLAYER USAGE LAB</p>
            <h1 className="page-title">Usage Analytics</h1>
            <p className="page-detail">Administrator-only summary of how analysts inspect player usage evidence.</p>
          </div>
        </header>
        <div className="panel flex min-h-[400px] items-center justify-center">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            Loading usage activity...
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <header className="page-header">
          <div>
            <p className="eyebrow">PLAYER USAGE LAB</p>
            <h1 className="page-title">Usage Analytics</h1>
            <p className="page-detail">Administrator-only summary of how analysts inspect player usage evidence.</p>
          </div>
        </header>
        <div className="panel flex min-h-[400px] flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold text-ink">Could not load analytics</p>
            <p className="mt-1 text-sm text-muted-foreground">The analytics service did not respond.</p>
          </div>
          <button type="button" className="button button-subtle" onClick={() => window.location.reload()}>
            <RefreshCcw className="h-4 w-4 mr-2" /> Try again
          </button>
        </div>
      </div>
    );
  }

  const hasActivity = data.totalEvents > 0;

  return (
    <div>
      <header className="page-header">
        <div>
          <p className="eyebrow">PLAYER USAGE LAB</p>
          <h1 className="page-title">Usage Analytics</h1>
          <p className="page-detail">Administrator-only summary of how analysts inspect player usage evidence.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="sr-only">Reporting period</span>
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as ReportingPeriod)}
            className="input h-9 min-w-[140px] text-xs"
          >
            {REPORTING_PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </header>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Events" value={data.totalEvents.toLocaleString()} detail="Captured interactions" icon={MousePointerClick} accent />
        <MetricCard label="Filter Resets" value={data.resets.toLocaleString()} detail="Cleared all filters" icon={RefreshCcw} />
        <MetricCard label="Reporting Period" value={`${data.periodDays} days`} detail="Selected UTC window" icon={Calendar} />
        <MetricCard label="Date Range" value={`${formatDate(data.periodStart)}`} detail={`Until ${formatDate(data.periodEnd)}`} icon={Activity} />
      </div>

      <div className="mt-5 panel">
        <div className={cx(
          'flex items-start gap-3 rounded-xl border px-4 py-3',
          data.collectionStatus === 'complete' ? 'border-accent/30 bg-accent/5' : 'border-border bg-secondary/30',
        )}>
          <Activity className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div>
            <p className="text-sm font-semibold text-ink">
              {data.collectionStatus === 'empty'
                ? 'No activity collected'
                : data.collectionStatus === 'partial'
                  ? 'Partial collection'
                  : 'Complete daily coverage'}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {data.collectionStatus === 'empty'
                ? `No Usage Lab events were recorded in the selected ${data.periodDays}-day period.`
                : `${data.daysWithActivity} of ${data.periodDays} days contain recorded activity. Days without events may be quiet or may reflect an incomplete collection window.`}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <DailyTrend data={data.dailyTrends} />
      </div>

      {!hasActivity ? (
        <div className="mt-5 panel">
          <div className="empty-panel">
            <div className="empty-icon"><Database className="h-5 w-5" /></div>
            <div>
              <p className="font-semibold text-ink">No recorded activity</p>
              <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
                There are no usage lab interactions recorded in the current reporting period.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.5fr]">
          <Panel eyebrow="Discovery" title="Filter & Sort Usage">
             <div className="flex flex-col gap-6">
                <UsageList title="Filter Changes" data={data.filterChanges} limit={20} />
                <UsageList title="Sort Choices" data={data.sortChoices} limit={20} />
             </div>
          </Panel>
          <Panel eyebrow="Engagement" title="Row Expansions">
             <div className="grid gap-6 sm:grid-cols-2">
                <UsageList title="By Position" data={data.expansionsByPosition} limit={15} />
                <UsageList title="By Trend" data={data.expansionsByTrend} limit={15} />
                <UsageList title="By Coverage" data={data.expansionsByCoverage} limit={15} />
                <UsageList title="By Window" data={data.expansionsByWindow} limit={15} />
             </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
