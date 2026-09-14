import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { SignIn, SignUp, UserButton, useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  Gauge,
  FileSearch,
  History,
  LayoutDashboard,
  LineChart,
  ListFilter,
  Loader2,
  LockKeyhole,
  Menu,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  UserRound,
  X,
} from 'lucide-react';
import {
  getGetDashboardSummaryQueryKey,
  getGetDataHealthQueryKey,
  getGetGameQueryKey,
  getGetOddsHistoryQueryKey,
  getGetPersonnelContextForGameQueryKey,
  getGetSettingsQueryKey,
  getHealthCheckQueryKey,
  getListGamesQueryKey,
  getListTeamsQueryKey,
  type DataHealth,
  type ScheduledDataHealthRun,
  useGetDashboardSummary,
  useGetDataHealth,
  useGetGame,
  useGetPersonnelContextForGame,
  useGetPersonnelContextCoverage,
  getGetPersonnelContextCoverageQueryKey,
  useGetOddsHistory,
  useGetSettings,
  useHealthCheck,
  useListGames,
  useListTeams,
  useUpdateSettings,
  useCaptureOdds,
  useGetChallengerReadinessReport,
  getGetChallengerReadinessReportQueryKey,
} from '@workspace/api-client-react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import './index.css';

const queryClient = new QueryClient();

type IconType = typeof Activity;

const navGroups = [
  {
    label: 'Workspace',
    items: [
      { href: '/', label: 'Overview', icon: LayoutDashboard },
      { href: '/this-week', label: 'This week', icon: CalendarDays },
      { href: '/live-predictions', label: 'Live predictions', icon: Target },
      { href: '/odds', label: 'Odds board', icon: SlidersHorizontal },
      { href: '/line-movement', label: 'Line movement', icon: LineChart },
    ],
  },
  {
    label: 'Signals',
    items: [
      { href: '/injuries', label: 'Injuries', icon: Activity },
      { href: '/depth-charts', label: 'Depth charts', icon: ListFilter },
      { href: '/backtesting', label: 'Backtesting', icon: History },
      { href: '/model-lab', label: 'Model lab', icon: Sparkles },
    ],
  },
  {
    label: 'Review',
    items: [
      { href: '/data-health', label: 'Data health', icon: Database },
      { href: '/feature-audit', label: 'Feature audit', icon: FileSearch },
      { href: '/personnel-context', label: 'Personnel & context', icon: UserRound },
      { href: '/performance', label: 'Performance', icon: BarChart3 },
      { href: '/settings', label: 'Settings', icon: Settings2 },
    ],
  },
];

function cx(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatDate(value?: string | null, includeTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(date);
}

function formatPercent(value?: number | null) {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

function formatUnits(value?: number | null) {
  return value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}u`;
}

function formatPrice(price?: number | null) {
  if (price === null || price === undefined) return '—';
  return price > 0 ? `+${price}` : String(price);
}

function formatPoint(point?: number | null) {
  if (point === null || point === undefined) return '—';
  return point > 0 ? `+${point}` : String(point);
}

function quoteDisplay(quote: any) {
  if (!quote) return '—';
  return `${quote.point === null || quote.point === undefined ? '' : `${formatPoint(quote.point)} `}${formatPrice(quote.price)}`.trim();
}

function quoteFreshness(quote: any) {
  if (!quote?.capturedAt) return 'Capture time unavailable';
  const capturedAt = new Date(String(quote.capturedAt));
  if (Number.isNaN(capturedAt.getTime())) return 'Capture time unavailable';
  const ageMinutes = Math.max(0, Math.floor((Date.now() - capturedAt.getTime()) / 60000));
  if (ageMinutes >= 360) return 'Stale local capture';
  if (ageMinutes < 1) return 'Captured just now';
  if (ageMinutes < 60) return `Captured ${ageMinutes}m ago`;
  return `Captured ${Math.floor(ageMinutes / 60)}h ago`;
}

function quoteIsBetter(candidate: any, incumbent: any) {
  if (!candidate) return false;
  if (!incumbent) return true;
  const market = candidate.market;
  const candidatePoint = candidate.point as number | null;
  const incumbentPoint = incumbent.point as number | null;
  if (market !== 'moneyline' && candidatePoint !== incumbentPoint) {
    if (candidatePoint === null || candidatePoint === undefined) return false;
    if (incumbentPoint === null || incumbentPoint === undefined) return true;
    // A larger spread is bettor-favorable for either side (+3 beats +2.5;
    // -2.5 beats -3). For totals the side determines the favorable direction.
    const candidateScore = market === 'total' && String(candidate.selection ?? '').toLowerCase() === 'over'
      ? -(candidatePoint ?? Number.POSITIVE_INFINITY)
      : candidatePoint ?? Number.NEGATIVE_INFINITY;
    const incumbentScore = market === 'total' && String(incumbent.selection ?? '').toLowerCase() === 'over'
      ? -(incumbentPoint ?? Number.POSITIVE_INFINITY)
      : incumbentPoint ?? Number.NEGATIVE_INFINITY;
    if (candidateScore !== incumbentScore) return candidateScore > incumbentScore;
  }
  return candidate.price > incumbent.price;
}

function marketLabel(market: string) {
  if (market === 'moneyline') return 'Moneyline';
  if (market === 'spread') return 'Spread';
  if (market === 'total') return 'Total';
  return market;
}

function statusTone(status?: string | null) {
  if (status === 'current' || status === 'available' || status === 'healthy' || status === 'success') return 'good';
  if (status === 'stale' || status === 'warning' || status === 'running' || status === 'partial') return 'warn';
  if (status === 'not_configured' || status === 'not_trained') return 'neutral';
  return 'bad';
}

function StatusPill({ status, children }: { status?: string | null; children: ReactNode }) {
  const tone = statusTone(status);
  return (
    <span data-testid={`status-${String(status ?? children).replace(/\s+/g, '-').toLowerCase()}`} className={cx('status-pill', `status-${tone}`)}>
      <span className="status-dot" />
      {children}
    </span>
  );
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={cx('skeleton', className)} />;
}

function LoadingPanel({ label = 'Loading workspace data' }: { label?: string }) {
  return (
    <div className="panel flex min-h-[180px] items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-accent" />
        {label}
      </div>
    </div>
  );
}

function ErrorPanel({ message = 'The data service did not respond.' }: { message?: string }) {
  return (
    <div data-testid="status-data-error" className="panel flex min-h-[180px] flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600"><AlertTriangle className="h-5 w-5" /></div>
      <div>
        <p className="font-semibold text-ink">Could not load this view</p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
      <button type="button" className="button button-subtle" onClick={() => window.location.reload()} data-testid="button-retry-data">
        <RefreshCw className="h-4 w-4" /> Try again
      </button>
    </div>
  );
}

function EmptyPanel({ title, detail, icon: Icon = Database }: { title: string; detail: string; icon?: IconType }) {
  return (
    <div data-testid="empty-state" className="empty-panel">
      <div className="empty-icon"><Icon className="h-5 w-5" /></div>
      <div>
        <p className="font-semibold text-ink">{title}</p>
        <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function Panel({ title, eyebrow, action, children, className = '' }: { title?: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
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

function PageHeader({ eyebrow, title, detail, actions }: { eyebrow: string; title: string; detail: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 data-testid="text-page-title" className="page-title">{title}</h1>
        <p className="page-detail">{detail}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

function MetricCard({ label, value, detail, icon: Icon, accent = false }: { label: string; value: string; detail: string; icon: IconType; accent?: boolean }) {
  return (
    <div data-testid={`metric-${label.toLowerCase().replace(/\s+/g, '-')}`} className={cx('metric-card', accent && 'metric-card-accent')}>
      <div className="flex items-start justify-between">
        <span className="metric-label">{label}</span>
        <Icon className="h-4 w-4 text-accent" />
      </div>
      <div className="mt-4 metric-value">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function formatStatusLabel(status?: string | null) {
  return status ? status.replace(/[_-]/g, ' ') : 'unknown';
}
function FreshnessCard({ item }: { item: DataHealth }) {
  const status = item?.status;
  const metadataEntries = Object.entries(item?.metadata ?? {})
    .filter(([key, value]) => key !== 'failures' && value !== null && value !== undefined && typeof value !== 'object')
    .slice(0, 4);
  const detailedMetadata = Object.entries(item?.metadata ?? {})
    .filter(([key, value]) => key !== 'failures' && value !== null && value !== undefined && typeof value === 'object')
    .filter(([_, value]) => Array.isArray(value) ? value.length > 0 : Object.keys(value as object).length > 0);
  const failures = Array.isArray(item?.metadata?.failures) ? item.metadata.failures : [];
  return (
    <div data-testid={`health-card-${item.provider}`} className="health-row">
      <div className="flex min-w-0 items-start gap-3">
        <div className={cx('provider-mark', `provider-${statusTone(status)}`)}><Database className="h-4 w-4" /></div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-ink">{item.label}</p>
            <StatusPill status={status}>{status === 'not_configured' ? 'Not configured' : status}</StatusPill>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
           {item.schedule && <p className="health-schedule"><strong>Cadence:</strong> {item.schedule}</p>}
           {item.retryPolicy && <p className="health-schedule"><strong>Retries:</strong> {item.retryPolicy}</p>}
           {item.schedule && <p className="health-schedule"><strong>Next attempt:</strong> {item.nextUpdate ? formatDate(item.nextUpdate, true) : 'In progress'}</p>}
          {metadataEntries.length > 0 && <div className="health-metadata">{metadataEntries.map(([key, value]) => <span key={key}><strong>{String(value)}</strong> {key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>)}</div>}
           {detailedMetadata.length > 0 && <div className="mt-2 space-y-1">{detailedMetadata.map(([key, value]) => <details className="health-failures" key={key}><summary>{key.replace(/([A-Z])/g, ' $1')} ({Array.isArray(value) ? value.length : 'detail'})</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[10px] leading-4">{JSON.stringify(value, null, 2)}</pre></details>)}</div>}
          {failures.length > 0 && <details className="health-failures"><summary>{failures.length} recorded failure{failures.length === 1 ? '' : 's'}</summary><ul>{failures.slice(0, 10).map((failure: string, index: number) => <li key={`${failure}-${index}`}>{failure}</li>)}</ul></details>}
           <ScheduledRuns runs={item.scheduledRuns} />
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <p>{item.lastUpdated ? `Updated ${formatDate(item.lastUpdated, true)}` : 'No capture yet'}</p>
         {item.nextUpdate && <p className="mt-1">Next {formatDate(item.nextUpdate, true)}</p>}
        {item.remainingQuota && <p className="mt-1 font-mono text-[10px]">{item.remainingQuota} remaining</p>}
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 60000 } });
  const isHealthy = health.data?.status === 'ok' || health.data?.status === 'healthy';
  const { isSignedIn } = useAuth();

  return (
    <div className="app-shell">
      <aside className={cx('sidebar', mobileOpen && 'sidebar-open')}>
        <div className="sidebar-top">
          <Link href="/" className="brand" data-testid="link-home">
            <span className="brand-mark"><Target className="h-4 w-4" /></span>
            <span><strong>Gridline</strong><small>NFL ANALYTICS</small></span>
          </Link>
          <button type="button" className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation"><X className="h-5 w-5" /></button>
        </div>
        <div className="sidebar-scroll">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map((item) => {
                const active = item.href === '/' ? location === '/' : location.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={cx('nav-item', active && 'nav-item-active')} data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}>
                    <Icon className="h-[17px] w-[17px]" /><span>{item.label}</span>{active && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="connection-row">
            <span className={cx('connection-dot', isHealthy ? 'connection-live' : 'connection-muted')} />
            <span>{health.isLoading ? 'Checking API…' : isHealthy ? 'API connected' : 'API needs attention'}</span>
            <span className="ml-auto font-mono text-[10px] text-sidebar-foreground/50">v0.1</span>
          </div>
          <div className="user-card"><div className="user-avatar"><UserRound className="h-4 w-4" /></div><div><p className="text-xs font-semibold text-white">Analyst workspace</p><p className="text-[10px] text-sidebar-foreground/55">Local configuration</p></div><Settings2 className="ml-auto h-4 w-4 text-sidebar-foreground/45" /></div>
        </div>
      </aside>
      {mobileOpen && <button className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" data-testid="button-overlay-navigation" />}
      <main className="main-shell">
        <div className="mobile-topbar">
          <button type="button" className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu className="h-5 w-5" /></button>
          <Link href="/" className="brand brand-mobile" data-testid="link-mobile-home"><span className="brand-mark"><Target className="h-4 w-4" /></span><strong>Gridline</strong></Link>
          <span className="ml-auto"><StatusPill status={isHealthy ? 'current' : 'unavailable'}>{isHealthy ? 'Live' : 'Offline'}</StatusPill></span>
        </div>
        <div className="topbar">
          <div className="topbar-context"><span className="live-kicker"><span className="live-pulse" />CONTROL ROOM</span><span className="topbar-divider" />{new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</div>
          <div className="topbar-actions"><button type="button" className="icon-button" aria-label="Notifications" data-testid="button-notifications"><Bell className="h-4 w-4" /><span className="notification-dot" /></button>{isSignedIn ? <UserButton /> : <Link href="/sign-in" className="button button-subtle" data-testid="link-sign-in">Sign in</Link>}<Link href="/settings" className="avatar-link" aria-label="Open settings" data-testid="link-settings-quick"><span className="user-avatar user-avatar-small">A</span></Link></div>
        </div>
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  );
}

function Dashboard() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 30000 } });
  const health = useGetDataHealth({ query: { queryKey: getGetDataHealthQueryKey(), staleTime: 30000, refetchInterval: 60000 } });
  if (summary.isLoading) return <><PageHeader eyebrow="Overview" title="The weekly read" detail="A clear view of the current market before you make a decision." /><div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div><div className="mt-5"><LoadingPanel /></div></>;
  if (summary.isError || !summary.data) return <><PageHeader eyebrow="Overview" title="The weekly read" detail="A clear view of the current market before you make a decision." /><ErrorPanel /></>;
  const data = summary.data;
  const topEdges = data.topEdges ?? [];
  const ledger = [{ label: 'ATS', metric: data.ats, icon: Target }, { label: 'Moneyline', metric: data.moneyline, icon: TrendingUp }, { label: 'Totals', metric: data.totals, icon: Gauge }];
  return (
    <>
      <PageHeader eyebrow={`Season ${data.season} / Week ${data.currentWeek ?? '—'}`} title="The weekly read" detail="A clear view of the current market before you make a decision." actions={<Link href="/this-week" className="button button-primary" data-testid="link-view-week"><CalendarDays className="h-4 w-4" /> View this week</Link>} />
      <div className="overview-banner">
        <div><p className="eyebrow text-accent">MODEL OPERATING STATUS</p><h2 className="banner-title">{data.modelStatus === 'not_trained' ? 'Model not yet trained' : 'Production model online'}</h2><p className="banner-copy">{data.modelStatus === 'not_trained' ? 'No probabilities or edges will be shown until a trained model is promoted. This is intentional.' : 'Current production signals are available for review.'}</p></div>
        <div className="banner-side"><StatusPill status={data.modelStatus}>{data.modelStatus === 'not_trained' ? 'Not trained' : 'Available'}</StatusPill><span className="font-mono text-[10px] text-white/45">LAST CHECK {formatDate(new Date().toISOString(), true).toUpperCase()}</span></div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Games this week" value={String(data.gamesThisWeek)} detail={`Week ${data.currentWeek ?? '—'} schedule`} icon={CalendarDays} accent />
        <MetricCard label="ATS record" value={data.ats.record || '—'} detail={`${formatPercent(data.ats.winRate)} win rate · ${formatUnits(data.ats.units)}`} icon={Target} />
        <MetricCard label="Average CLV" value={formatPercent(data.averageClv)} detail="Closing line value" icon={TrendingUp} />
        <MetricCard label="Model gate" value={data.modelStatus === 'not_trained' ? 'Locked' : 'Open'} detail="No fabricated probabilities" icon={ShieldCheck} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <Panel eyebrow="Signal queue" title="Top edges" action={<span className="section-meta">{topEdges.length} surfaced</span>}>
          {topEdges.length > 0 ? <div className="divide-y divide-border">{topEdges.map((edge, index) => <Link href={`/games/${edge.gameId}`} key={edge.gameId} className="edge-row" data-testid={`link-edge-${edge.gameId}`}><div className="edge-index">0{index + 1}</div><div className="min-w-0 flex-1"><p className="font-semibold text-ink">{edge.label}</p><p className="mt-1 truncate text-xs text-muted-foreground">{edge.detail}</p></div><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>)}</div> : <EmptyPanel title="No edges are being surfaced" detail="The model gate is closed. Once training completes, qualifying edges will appear here with a direct path to the game." icon={Target} />}
        </Panel>
        <Panel eyebrow="Data observability" title="Freshness" action={<Link href="/data-health" className="text-xs font-semibold text-accent hover:underline" data-testid="link-data-health">View health</Link>}>
          {health.isLoading ? <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : health.isError ? <ErrorPanel message="Provider health is temporarily unavailable." /> : health.data?.length ? <div className="space-y-3">{health.data.slice(0, 4).map((item) => <FreshnessCard key={item.provider} item={item} />)}</div> : <EmptyPanel title="No provider checks yet" detail="Health records will appear when the first provider sync is captured." icon={Database} />}
        </Panel>
      </div>
      <Panel eyebrow="Season ledger" title="Performance snapshot" className="mt-5">
        <div className="grid gap-3 md:grid-cols-3">
          {ledger.map(({ label, metric, icon: Icon }) => <div className="ledger-card" key={label}><div className="flex items-center justify-between"><span className="metric-label">{label}</span><Icon className="h-4 w-4 text-muted-foreground" /></div><div className="mt-3 flex items-end justify-between"><span className="font-display text-2xl font-semibold text-ink">{metric.record || '—'}</span><span className="font-mono text-xs text-muted-foreground">{formatUnits(metric.units)}</span></div><div className="mt-3 h-1 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, metric.winRate ?? 0))}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">{formatPercent(metric.winRate)} win rate · {formatPercent(metric.roi)} ROI</p></div>)}
        </div>
      </Panel>
    </>
  );
}

function GameRow({ game }: { game: any }) {
  const isFinal = ['final', 'completed'].includes(String(game.gameStatus).toLowerCase());
  return (
    <Link href={`/games/${game.gameId}`} className="game-row" data-testid={`link-game-${game.gameId}`}>
      <div className="game-date"><span>{formatDate(game.gameDate)}</span><small>{game.kickoffTime ? formatDate(game.kickoffTime, true) : 'Time TBD'}</small></div>
      <div className="matchup"><div className="team-side"><span className="team-abbr">{game.awayTeam.abbreviation}</span><span>{game.awayTeam.teamName}</span></div><span className="at-mark">@</span><div className="team-side team-home"><span className="team-abbr">{game.homeTeam.abbreviation}</span><span>{game.homeTeam.teamName}</span></div></div>
      <div className="hidden text-xs text-muted-foreground lg:block">{game.venue || 'Venue pending'}{game.broadcast ? <><br /><span className="font-mono text-[10px]">{game.broadcast}</span></> : null}</div>
      <div className="game-score">{isFinal ? <><span>{game.finalAwayScore ?? '—'} — {game.finalHomeScore ?? '—'}</span><small>FINAL</small></> : <><StatusPill status={game.modelStatus}>{game.modelStatus === 'not_trained' ? 'Model not trained' : 'Ready'}</StatusPill><small>{game.latestOdds?.length ?? 0} quotes</small></>}</div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}

function ThisWeek() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 30000 } });
  const season = summary.data?.season ?? new Date().getFullYear();
  const currentWeek = summary.data?.currentWeek ?? 1;
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const week = selectedWeek ?? currentWeek;
  const games = useListGames({ season, week }, { query: { queryKey: getListGamesQueryKey({ season, week }), staleTime: 30000 } });
  const teams = useListTeams({ query: { queryKey: getListTeamsQueryKey(), staleTime: 300000 } });
  return (
    <>
      <PageHeader eyebrow={`Season ${season} / Week ${week}`} title="This week" detail="Browse preserved regular-season and postseason slates. The current week follows ESPN automatically after the Monday game window closes." actions={<><select className="week-select" aria-label="Select NFL week" value={week} onChange={(event) => setSelectedWeek(Number(event.target.value))} data-testid="select-week">{Array.from({ length: 22 }, (_, index) => index + 1).map((value) => <option value={value} key={value}>{value <= 18 ? `Week ${value}` : `Postseason ${value - 18}`}</option>)}</select><button type="button" className="button button-subtle" onClick={() => games.refetch()} data-testid="button-refresh-games"><RefreshCw className={cx('h-4 w-4', games.isFetching && 'animate-spin')} /> Refresh</button></>} />
      <div className="signal-strip"><div><span className="strip-label">SCHEDULE COVERAGE</span><strong>{games.data?.length ?? '—'} games</strong></div><div><span className="strip-label">TEAM INDEX</span><strong>{teams.data?.length ?? '—'} teams</strong></div><div><span className="strip-label">MODEL STATE</span><StatusPill status={summary.data?.modelStatus}>{summary.data?.modelStatus === 'not_trained' ? 'Not trained' : summary.data?.modelStatus ?? 'Checking'}</StatusPill></div><div className="hidden md:block"><span className="strip-label">CAPTURE WINDOW</span><strong>Current quotes</strong></div></div>
      <Panel className="mt-5" title="Current-week slate" eyebrow="Market board" action={<span className="section-meta">Click a game for detail</span>}>
        {games.isLoading ? <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : games.isError ? <ErrorPanel /> : games.data?.length ? <div className="game-list">{games.data.map((game) => <GameRow key={game.gameId} game={game} />)}</div> : <EmptyPanel title="No games returned for this week" detail="The live schedule is empty for the current season and week. Check the API connection or return when the schedule is published." icon={CalendarDays} />}
      </Panel>
      {summary.data?.modelStatus === 'not_trained' && <div className="callout callout-warn mt-5"><AlertTriangle className="h-4 w-4 shrink-0" /><div><strong>Model outputs are intentionally withheld.</strong><p>Odds and schedule data can be reviewed now. No probability, pick, or edge is inferred until a trained model is available.</p></div></div>}
    </>
  );
}

function OddsMarketTable({ quotes }: { quotes: any[] }) {
  const grouped = new Map<string, { market: string; selection: string; books: Record<string, any> }>();
  for (const quote of quotes) {
    const key = `${quote.market}|${quote.selection}`;
    const current: { market: string; selection: string; books: Record<string, any> } = grouped.get(key) ?? { market: quote.market, selection: quote.selection, books: {} };
    current.books[quote.sportsbook] = quote;
    grouped.set(key, current);
  }
  const rows = [...grouped.values()].sort((left, right) =>
    `${left.market}-${left.selection}`.localeCompare(`${right.market}-${right.selection}`),
  );
  if (!rows.length) {
    return <EmptyPanel title="No captured markets for this game" detail="The schedule exists, but no DraftKings or FanDuel snapshot was matched to it. A missing market is not treated as a zero or a prediction." icon={SlidersHorizontal} />;
  }
  return (
    <div className="odds-table">
      <div className="odds-head"><span>Market</span><span>Selection</span><span>DraftKings</span><span>FanDuel</span><span>Best now</span></div>
      {rows.map((row) => {
        const draftKings = row.books.DraftKings;
        const fanDuel = row.books.FanDuel;
        const best = quoteIsBetter(fanDuel, draftKings) ? fanDuel : draftKings;
        const equalPoint = draftKings && fanDuel && draftKings.point === fanDuel.point;
        const pointTradeoff = draftKings && fanDuel && draftKings.point !== fanDuel.point && draftKings.price !== fanDuel.price;
        return (
          <div className="odds-row" key={`${row.market}-${row.selection}`}>
            <span className="font-semibold text-ink">{marketLabel(row.market)}</span>
            <span>{row.selection}</span>
            <span className="font-mono">{quoteDisplay(draftKings)}</span>
            <span className="font-mono">{quoteDisplay(fanDuel)}</span>
            <span className="font-mono font-semibold text-accent">
              {best ? `${best.sportsbook} · ${quoteDisplay(best)}` : '—'}
              {best && <small className={cx('block font-sans text-[10px] font-normal', quoteFreshness(best) === 'Stale local capture' ? 'text-amber-700' : 'text-muted-foreground')}>{quoteFreshness(best)}</small>}
              {pointTradeoff && <small className="block font-sans text-[10px] font-normal text-muted-foreground">Points ranked before price</small>}
              {equalPoint && <small className="block font-sans text-[10px] font-normal text-muted-foreground">Equal point; price ranked</small>}
            </span>
          </div>
        );
      })}
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
        Best means bettor-favorable point first, then the higher American price only when points match. A price tradeoff is disclosed rather than hidden.
      </p>
    </div>
  );
}

function OddsBoard() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 30000 } });
  const season = summary.data?.season ?? new Date().getFullYear();
  const week = summary.data?.currentWeek ?? 1;
  const games = useListGames({ season, week }, { query: { queryKey: getListGamesQueryKey({ season, week }), staleTime: 30000 } });
  const health = useGetDataHealth({ query: { queryKey: getGetDataHealthQueryKey(), staleTime: 30000 } });
  const capture = useCaptureOdds();
  const { isSignedIn } = useAuth();
  const client = useQueryClient();
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const runCapture = () => {
    setCaptureMessage(null);
    capture.mutate(undefined, {
      onSuccess: (result) => {
        const marketWarning = result.missingMarkets?.length
          ? ` Missing markets: ${result.missingMarkets.slice(0, 3).join(', ')}${result.missingMarkets.length > 3 ? ` (+${result.missingMarkets.length - 3} more)` : ''}.`
          : '';
        const sportsbookWarning = result.failedSportsbooks?.length
          ? ` Failed sportsbooks: ${result.failedSportsbooks.join(', ')}.`
          : '';
        const quota = result.creditsRemaining === null || result.creditsRemaining === undefined
          ? ''
          : ` ${result.creditsRemaining} credits remaining.`;
        setCaptureMessage(
          result.status === 'success'
            ? `One live request completed: ${result.snapshotsCreated} new snapshots; ${result.duplicateSnapshots} exact current-state duplicates skipped.${marketWarning}${sportsbookWarning}${quota}`
            : result.error ?? 'No snapshot was captured.',
        );
        client.invalidateQueries({ queryKey: getListGamesQueryKey({ season, week }) });
        client.invalidateQueries({ queryKey: getGetDataHealthQueryKey() });
      },
      onError: () => setCaptureMessage('The live capture failed. Check Data Health for the recorded failure; no automatic retry was attempted.'),
    });
  };
  const oddsHealth = health.data?.find((item) => item.provider === 'odds-api');
  return (
    <>
      <PageHeader
        eyebrow={`Market data / Season ${season} / Week ${week}`}
        title="Odds board"
        detail="DraftKings and FanDuel snapshots, compared without manufacturing a signal."
        actions={isSignedIn ? <button type="button" className="button button-primary" onClick={runCapture} disabled={capture.isPending} data-testid="button-capture-odds">{capture.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Capture one snapshot</button> : <Link href="/sign-in" className="button button-primary" data-testid="link-sign-in-to-capture"><LockKeyhole className="h-4 w-4" /> Sign in to capture</Link>}
      />
      <div className="signal-strip">
        <div><span className="strip-label">SOURCE</span><strong>DraftKings · FanDuel</strong></div>
        <div><span className="strip-label">CAPTURE MODE</span><strong>Explicit one-shot</strong></div>
        <div><span className="strip-label">API STATE</span><StatusPill status={oddsHealth?.status}>{oddsHealth?.status === 'not_configured' ? 'Not configured' : oddsHealth?.status ?? 'Checking'}</StatusPill></div>
        <div><span className="strip-label">LAST CAPTURE</span><strong>{oddsHealth?.lastUpdated ? formatDate(String(oddsHealth.lastUpdated), true) : 'None'}</strong></div>
      </div>
      {captureMessage && <div className="callout callout-neutral mt-5"><ShieldCheck className="h-4 w-4 shrink-0 text-accent" /><p>{captureMessage}</p></div>}
      <Panel className="mt-5" title="Current market comparison" eyebrow="Side-by-side board" action={<span className="section-meta">{games.data?.length ?? 0} games</span>}>
        {games.isLoading ? <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div> : games.isError ? <ErrorPanel /> : games.data?.length ? <div className="space-y-5">{games.data.map((game) => <div className="rounded-xl border border-border p-4" key={game.gameId}><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold text-ink">{game.awayTeam.abbreviation} at {game.homeTeam.abbreviation}</p><p className="mt-1 text-xs text-muted-foreground">{game.kickoffTime ? formatDate(String(game.kickoffTime), true) : 'Kickoff TBD'} · {game.latestOdds?.length ?? 0} current quotes</p></div><Link href={`/games/${game.gameId}`} className="text-xs font-semibold text-accent hover:underline">History & detail <ChevronRight className="inline h-3 w-3" /></Link></div><OddsMarketTable quotes={(game.latestOdds ?? []) as any[]} /></div>)}</div> : <EmptyPanel title="No games returned for this week" detail="The live schedule is empty, so no sportsbook market can be safely matched." icon={CalendarDays} />}
      </Panel>
      <div className="callout callout-warn mt-5"><AlertTriangle className="h-4 w-4 shrink-0" /><p>Missing or stale markets remain visibly missing. The board does not infer a line, fill a bookmaker gap, or turn market differences into prediction logic.</p></div>
    </>
  );
}

function LineHistory({ gameId }: { gameId: string }) {
  const history = useGetOddsHistory(gameId, { query: { queryKey: getGetOddsHistoryQueryKey(gameId), staleTime: 30000 } });
  if (history.isLoading) return <LoadingPanel label="Loading immutable line history" />;
  if (history.isError || !history.data) return <ErrorPanel message="Line history is temporarily unavailable." />;
  const data = history.data;
  return (
    <Panel eyebrow="Immutable history" title="Line movement" action={<span className="section-meta">{data.changes.length} changes</span>}>
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><strong className="text-ink">First observed:</strong> {data.firstObservedAt ? formatDate(String(data.firstObservedAt), true) : 'Not observed'}</span>
        <span>{data.firstObservedLabel ?? 'No first observation'}</span>
        <span><strong className="text-ink">Closing eligibility:</strong> {data.closingFrozen ? 'Frozen at last pre-kickoff state' : 'Open until kickoff'}</span>
      </div>
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {([
          ['First observed', data.firstObserved],
          ['Current', data.current],
          ['Final pre-kickoff', data.closing],
        ] as Array<[string, any[]]>).map(([label, quotes]) => (
          <div className="rounded-xl border border-border bg-secondary/30 p-3" key={String(label)}>
            <p className="eyebrow">{label}</p>
            {Array.isArray(quotes) && quotes.length ? <div className="mt-2 space-y-1">{quotes.slice(0, 6).map((quote: any, index: number) => <p className="text-xs text-muted-foreground" key={`${quote.sportsbook}-${quote.market}-${quote.selection}-${index}`}><span className="font-semibold text-ink">{quote.sportsbook}</span> · {marketLabel(quote.market)} {quote.selection} <span className="font-mono text-ink">{quoteDisplay(quote)}</span></p>)}</div> : <p className="mt-2 text-xs text-muted-foreground">Not captured</p>}
          </div>
        ))}
      </div>
      {data.changes.length ? <div className="odds-table"><div className="odds-head"><span>When</span><span>Book / market</span><span>Selection</span><span>Change</span><span>Source time</span></div>{data.changes.map((change, index) => <div className="odds-row" key={`${change.sportsbook}-${change.market}-${change.selection}-${change.capturedAt}-${index}`}><span>{formatDate(String(change.capturedAt), true)}</span><span>{change.sportsbook} · {marketLabel(change.market)}</span><span>{change.selection}</span><span className="font-mono">{change.previousPoint ?? '—'} {formatPrice(change.previousPrice)} → {change.point ?? '—'} {formatPrice(change.price)}</span><span>{change.sourceTimestamp ? formatDate(String(change.sourceTimestamp), true) : 'Not provided'}</span></div>)}</div> : <EmptyPanel title="No line changes captured" detail="Only the first observed state is available so far. Repeated identical captures are intentionally not added." icon={LineChart} />}
      <p className="mt-4 text-[11px] leading-5 text-muted-foreground">“First observed by Gridline” is not an official sportsbook opening line. The closing set is the last immutable pre-kickoff state and cannot be replaced after kickoff.</p>
    </Panel>
  );
}

function GameDetail() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const game = useGetGame(gameId, { query: { queryKey: getGetGameQueryKey(gameId), staleTime: 30000 } });
  const predictionDetail = useQuery({
    queryKey: ['game-prediction', gameId],
    queryFn: async () => {
      const response = await fetch(`/api/predictions/games/${encodeURIComponent(gameId)}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Game prediction unavailable');
      return response.json() as Promise<any>;
    },
    staleTime: 30000,
  });
  if (game.isLoading) return <><PageHeader eyebrow="Game detail" title="Loading game" detail="Resolving the latest game record." /><LoadingPanel /></>;
  if (game.isError || !game.data) return <><PageHeader eyebrow="Game detail" title="Game unavailable" detail={`Could not resolve ${gameId}.`} /><ErrorPanel /></>;
  const item = game.data;
  const odds = item.latestOdds ?? [];
  const detail = predictionDetail.data;
  const prediction = detail?.prediction;
  const model = detail?.model;
  const market = detail?.market;
  const modelAvailable = Boolean(prediction && model);
  const number = (value: unknown, digits = 1) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'Unavailable';
  const probability = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'Unavailable';
  const marketLine = (quote: any) => quote && typeof quote.point === 'number' ? `${quote.point > 0 ? '+' : ''}${quote.point} (${quote.sportsbook})` : 'Unavailable';
  return (
    <>
      <PageHeader eyebrow={`Week ${item.week} / ${formatDate(item.gameDate)}`} title={`${item.awayTeam.abbreviation} at ${item.homeTeam.abbreviation}`} detail={`${item.awayTeam.teamName} at ${item.homeTeam.teamName}${item.venue ? ` · ${item.venue}` : ''}`} actions={<Link href="/this-week" className="button button-subtle" data-testid="link-back-week"><ChevronRight className="h-4 w-4 rotate-180" /> Back to slate</Link>} />
      <div className="game-hero"><div className="hero-team"><span className="hero-abbr">{item.awayTeam.abbreviation}</span><span>{item.awayTeam.teamName}</span><small>AWAY</small></div><div className="hero-center"><span className="hero-at">@</span><StatusPill status={item.gameStatus}>{item.gameStatus}</StatusPill><span className="text-xs text-sidebar-foreground/55">{item.kickoffTime ? formatDate(item.kickoffTime, true) : 'Kickoff TBD'}</span></div><div className="hero-team hero-team-right"><span className="hero-abbr">{item.homeTeam.abbreviation}</span><span>{item.homeTeam.teamName}</span><small>HOME</small></div></div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Panel eyebrow="Current market" title="Latest odds" action={<span className="section-meta">{odds.length} quotes</span>}>
          {odds.length ? <div className="odds-table"><div className="odds-head"><span>Book</span><span>Market</span><span>Selection</span><span>Point</span><span>Price</span></div>{odds.map((quote, index) => <div className="odds-row" key={`${quote.sportsbook}-${quote.market}-${quote.selection}-${index}`}><span className="font-semibold text-ink">{quote.sportsbook}</span><span>{quote.market}</span><span>{quote.selection}</span><span>{quote.point ?? '—'}</span><span className="font-mono font-medium text-ink">{quote.price > 0 ? `+${quote.price}` : quote.price}</span></div>)}</div> : <EmptyPanel title="No odds captured yet" detail="This game has a schedule record, but no current sportsbook quotes are attached to it." icon={SlidersHorizontal} />}
        </Panel>
        <Panel eyebrow="Production snapshot" title="Model read">
          {predictionDetail.isLoading ? <LoadingPanel label="Loading production prediction" /> : predictionDetail.isError ? <ErrorPanel message="The production prediction could not be loaded." /> : modelAvailable ? <div className="space-y-4">
            <div className="readiness-block"><div className="readiness-icon"><ShieldCheck className="h-5 w-5" /></div><div><StatusPill status="available">Phase 6 prediction available</StatusPill><p className="mt-3 text-sm leading-6 text-muted-foreground">Football-model outputs remain valid even when an individual sportsbook market is unavailable.</p></div></div>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label={`${item.homeTeam.abbreviation} projected`} value={number(prediction.projectedHomeScore)} detail={`${probability(prediction.homeWinProbability)} win probability`} icon={TrendingUp} />
              <MetricCard label={`${item.awayTeam.abbreviation} projected`} value={number(prediction.projectedAwayScore)} detail={`${probability(prediction.awayWinProbability)} win probability`} icon={TrendingUp} />
              <MetricCard label="Projected margin" value={number(prediction.projectedMargin)} detail={`${item.homeTeam.abbreviation} minus ${item.awayTeam.abbreviation}`} icon={Target} />
              <MetricCard label="Projected total" value={number(prediction.projectedTotal)} detail="Combined points" icon={Gauge} />
            </div>
            <div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
              <p><strong className="text-ink">Spread:</strong> {marketLine(market?.spread)}</p>
              <p className="mt-1"><strong className="text-ink">Total:</strong> {marketLine(market?.total)}</p>
              <p className="mt-1"><strong className="text-ink">Moneyline:</strong> {market?.moneyline ? `${market.moneyline.price > 0 ? '+' : ''}${market.moneyline.price} (${market.moneyline.sportsbook})` : 'Unavailable'}</p>
            </div>
            <dl className="space-y-2 break-all text-xs text-muted-foreground">
              <div><dt className="font-semibold text-ink">Spread model</dt><dd className="font-mono">{model.spreadModelVersion}</dd></div>
              <div><dt className="font-semibold text-ink">Moneyline model</dt><dd className="font-mono">{model.moneylineModelVersion}</dd></div>
              <div><dt className="font-semibold text-ink">Totals model</dt><dd className="font-mono">{model.totalsModelVersion}</dd></div>
              <div><dt className="font-semibold text-ink">Feature version</dt><dd className="font-mono">{model.featureVersion}</dd></div>
              <div><dt className="font-semibold text-ink">Prediction revision</dt><dd className="font-mono">#{model.snapshotId} · {model.snapshotLabel}</dd></div>
              <div><dt className="font-semibold text-ink">Prediction timestamp</dt><dd>{formatDate(model.predictionTimestamp, true)}</dd></div>
              <div><dt className="font-semibold text-ink">Sportsbook timestamp</dt><dd>{model.sportsbookSnapshotTimestamp ? formatDate(model.sportsbookSnapshotTimestamp, true) : 'Unavailable'}</dd></div>
              <div><dt className="font-semibold text-ink">QB confidence</dt><dd>{probability(prediction.qbConfidence)}</dd></div>
              <div><dt className="font-semibold text-ink">Sample quality</dt><dd>{prediction.lowSample ? 'Low sample' : 'Standard sample'}</dd></div>
            </dl>
          </div> : <div className="readiness-block"><div className="readiness-icon"><ShieldCheck className="h-5 w-5" /></div><div><StatusPill status="not_trained">Prediction unavailable</StatusPill><p className="mt-3 text-sm leading-6 text-muted-foreground">No valid production prediction snapshot exists for this game. Sportsbook availability does not change this football-model status.</p></div></div>}
        </Panel>
      </div>
      <div className="mt-5"><LineHistory gameId={gameId} /></div>
      <div className="mt-5 grid gap-5 md:grid-cols-3">
        <ReadinessTile icon={Activity} title="Injury impact" detail="Meaningful availability data will appear here when the injury feed is connected." />
        <ReadinessTile icon={LineChart} title="Closing line eligibility" detail="The line-history panel records the last pre-kickoff snapshot without replacing it after kickoff." />
        <ReadinessTile icon={Sparkles} title="Model context" detail="Feature contributions and calibration details are future-ready, not fabricated." />
      </div>
    </>
  );
}

function ReadinessTile({ icon: Icon, title, detail }: { icon: IconType; title: string; detail: string }) {
  return <div className="readiness-tile"><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-accent" /><h3 className="font-semibold text-ink">{title}</h3></div><div className="mt-4"><StatusPill status="not_configured">Not populated</StatusPill></div><p className="mt-3 text-xs leading-5 text-muted-foreground">{detail}</p></div>;
}

function HealthPage({ kind, title, detail, eyebrow, preferred }: { kind: string; title: string; detail: string; eyebrow: string; preferred?: string }) {
  const health = useGetDataHealth({ query: { queryKey: getGetDataHealthQueryKey(), staleTime: 30000, refetchInterval: 60000 } });
  const focused = useMemo(() => preferred ? health.data?.filter((item) => `${item.provider} ${item.label}`.toLowerCase().includes(preferred)) : health.data, [health.data, preferred]);
  const readinessStatus = focused?.some((item) => item.status === 'stale')
    ? 'stale'
    : focused?.some((item) => item.status === 'unavailable' || item.status === 'not_configured')
      ? 'unavailable'
      : 'current';
  const readinessSummary = focused?.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} detail={detail} actions={<button type="button" className="button button-subtle" onClick={() => health.refetch()} data-testid={`button-refresh-${kind}`}><RefreshCw className={cx('h-4 w-4', health.isFetching && 'animate-spin')} /> Refresh</button>} />
      <div className="readiness-header"><div className="readiness-header-icon"><Database className="h-5 w-5" /></div><div><p className="eyebrow text-accent">OPERATING PRINCIPLE</p><h2 className="text-lg font-semibold text-ink">Show the capture state. Never imply a signal.</h2><p className="mt-1 text-sm text-muted-foreground">This surface is ready for live data and stays honest while the provider is not configured.</p><p className="mt-2 text-xs font-medium text-accent">Scheduler timezone: America/New_York (DST-aware). Odds are seven scheduled weekly slots, not continuous polling.</p></div></div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <Panel eyebrow="Provider monitor" title="Data health" action={health.data && <span className="section-meta">{health.data.length} providers</span>}>{health.isLoading ? <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : health.isError ? <ErrorPanel /> : focused?.length ? <div className="space-y-3">{focused.map((item) => <FreshnessCard item={item} key={item.provider} />)}</div> : <EmptyPanel title="No provider record matches this surface" detail="Once the backend exposes a provider health record, it will be listed here with its last and next update." icon={Database} />}</Panel>
        <Panel eyebrow="Readiness" title={`${title} readiness`}>
          {health.isLoading
            ? <Skeleton className="h-28" />
            : focused?.length
              ? <div className="readiness-block"><div className="readiness-icon"><Activity className="h-5 w-5" /></div><div><StatusPill status={readinessStatus}>{readinessStatus === 'current' ? 'Evidence current' : 'Review required'}</StatusPill><p className="mt-3 text-sm leading-6 text-muted-foreground">{focused.length} provider record{focused.length === 1 ? '' : 's'} loaded. {Object.entries(readinessSummary ?? {}).map(([status, count]) => `${count} ${status.replace('_', ' ')}`).join(' · ')}. Stale and unavailable sources remain visible and are not treated as successful captures.</p></div></div>
              : <EmptyPanel title="Capture not populated" detail={kind === 'odds' ? 'No Odds API health record is available yet.' : `No ${title.toLowerCase()} provider records are available yet. This is an honest empty state, not a prediction.`} icon={kind === 'line-movement' ? LineChart : Activity} />}
        </Panel>
      </div>
      <Panel eyebrow="What will appear here" title="Future-ready fields" className="mt-5"><div className="grid gap-3 md:grid-cols-3"><ReadinessTile icon={Clock3} title="Freshness timestamp" detail="Last successful capture and next scheduled update." /><ReadinessTile icon={ShieldCheck} title="Source status" detail="Provider configuration and request budget remain visible." /><ReadinessTile icon={TrendingUp} title="Decision context" detail="Only supported outputs will be promoted into the workspace." /></div></Panel>
    </>
  );
}

function FeatureAuditPage() {
  const [season, setSeason] = useState('');
  const [week, setWeek] = useState('');
  const [gameId, setGameId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [featureVersion, setFeatureVersion] = useState('pregame-v3');
  const query = new URLSearchParams();
  if (season) query.set('season', season);
  if (week) query.set('week', week);
  if (gameId) query.set('gameId', gameId);
  if (teamId) query.set('teamId', teamId);
  if (featureVersion) query.set('featureVersion', featureVersion);
  query.set('limit', '1200');
  const audit = useQuery({
    queryKey: ['feature-audit', season, week, gameId, teamId, featureVersion],
    queryFn: async () => {
      const response = await fetch(`/api/features/audit?${query.toString()}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Feature audit unavailable');
      return response.json() as Promise<Array<Record<string, unknown>>>;
    },
    staleTime: 30000,
  });
  const rows = audit.data ?? [];
  return (
    <>
      <PageHeader eyebrow="Model data / Feature audit" title="Feature audit" detail="Inspect exactly what Gridline had available before a historical kickoff. Unavailable inputs stay visibly unavailable." />
      <Panel eyebrow="Historical point-in-time filters" title="Choose an observation" className="mb-5">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="field-label">Season<input className="field-input mt-2" inputMode="numeric" placeholder="2021" value={season} onChange={(event) => setSeason(event.target.value)} /></label>
          <label className="field-label">Week<input className="field-input mt-2" inputMode="numeric" placeholder="1" value={week} onChange={(event) => setWeek(event.target.value)} /></label>
          <label className="field-label">Game ID<input className="field-input mt-2" placeholder="2021_01_DAL_TB" value={gameId} onChange={(event) => setGameId(event.target.value)} /></label>
          <label className="field-label">Team<input className="field-input mt-2" placeholder="DAL" value={teamId} onChange={(event) => setTeamId(event.target.value.toUpperCase())} /></label>
          <label className="field-label">Feature-set version<input className="field-input mt-2" value={featureVersion} onChange={(event) => setFeatureVersion(event.target.value)} /></label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Showing up to 1,200 feature records. Filter by game ID to inspect one historical matchup in full.</p>
      </Panel>
      {audit.isLoading ? <LoadingPanel label="Loading point-in-time features" /> : audit.isError ? <ErrorPanel message="The feature audit could not be loaded." /> : (
        <Panel eyebrow={`${rows.length} records`} title="Known inputs before kickoff">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><th className="px-3 py-3">Feature</th><th className="px-3 py-3">Value</th><th className="px-3 py-3">Source</th><th className="px-3 py-3">Window</th><th className="px-3 py-3">Games</th><th className="px-3 py-3">Last source</th><th className="px-3 py-3">Sample</th><th className="px-3 py-3">Quality</th><th className="px-3 py-3">Unavailable reason</th></tr></thead>
              <tbody>{rows.map((row, index) => <tr className="border-b border-border/70 align-top" key={`${String(row.gameId)}-${String(row.teamId)}-${String(row.featureName)}-${index}`}><td className="px-3 py-3 font-semibold text-ink">{String(row.featureName)}</td><td className="px-3 py-3 font-mono">{row.value === null ? '—' : Number(row.value).toFixed(4)}</td><td className="px-3 py-3">{String(row.sourceDataset)}</td><td className="px-3 py-3">{String(row.lookbackWindow)}</td><td className="px-3 py-3">{String(row.gamesIncluded)}</td><td className="px-3 py-3">{String(row.lastSourceGame ?? '—')}<br /><span className="text-muted-foreground">{String(row.lastSourceDate ?? '—')}</span></td><td className="px-3 py-3">{String(row.sampleSize)}</td><td className="px-3 py-3"><StatusPill status={row.quality === 'high' ? 'current' : row.quality === 'unavailable' ? 'not_configured' : 'stale'}>{String(row.quality)}</StatusPill></td><td className="max-w-xs px-3 py-3 text-muted-foreground">{String(row.unavailableReason ?? '—')}</td></tr>)}</tbody>
            </table>
          </div>
          {!rows.length && <EmptyPanel title="No feature records match" detail="Try a different season, week, team, game ID, or feature-set version." icon={FileSearch} />}
        </Panel>
      )}
    </>
  );
}

function ChallengerReadinessPanel() {
  const readiness = useGetChallengerReadinessReport({ query: { queryKey: getGetChallengerReadinessReportQueryKey(), staleTime: 30000 } });

  if (readiness.isLoading) return <Panel eyebrow="Model Audit" title="Challenger Readiness"><LoadingPanel label="Loading challenger readiness report" /></Panel>;
  if (readiness.isError || !readiness.data) return <Panel eyebrow="Model Audit" title="Challenger Readiness"><ErrorPanel message="Challenger readiness report could not be loaded." /></Panel>;

  const data = readiness.data;
  const decimal = (value: unknown, digits = 1) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';

  return (
    <Panel eyebrow="Model Audit" title="Challenger Readiness" className="mb-5">
      <div className="overview-banner">
        <div>
          <p className="eyebrow text-accent">EVALUATION ONLY</p>
          <h2 className="banner-title">
            {data.eligible ? 'Ready for Evaluation' : 'Not Ready for Evaluation'}
          </h2>
          <p className="banner-copy">
            This evaluation-only check verifies that accumulated pregame evidence is sufficient to begin a separate challenger evaluation. It is <strong>not a performance guarantee</strong>, <strong>not betting confidence</strong>, and <strong>does not start training</strong>.
          </p>
        </div>
        <div className="banner-side">
          <StatusPill status={data.eligible ? 'success' : 'bad'}>
            {data.eligible ? 'Eligible' : 'Not Eligible'}
          </StatusPill>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-secondary/20 p-4">
          <h3 className="font-semibold text-ink text-sm mb-3">Thresholds</h3>
          <div className="space-y-3">
            {data.thresholds.map((t, idx) => (
              <div key={idx} className="text-xs">
                <div className="flex justify-between items-center font-medium text-ink">
                  <span>{t.metric.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</span>
                  <StatusPill status={t.pass ? 'success' : 'bad'}>{t.pass ? 'Pass' : 'Fail'}</StatusPill>
                </div>
                <div className="flex justify-between mt-1 text-muted-foreground text-[10px]">
                  <span>Observed: {typeof t.observed === 'boolean' ? (t.observed ? 'Yes' : 'No') : decimal(t.observed)}</span>
                  <span>Target: {typeof t.threshold === 'boolean' ? (t.threshold ? 'Yes' : 'No') : decimal(t.threshold)}</span>
                </div>
                <div className="text-muted-foreground mt-1 text-[10px] leading-4">{t.interpretation}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-secondary/20 p-4 flex flex-col gap-5">
          <div>
            <h3 className="font-semibold text-ink text-sm mb-3">Systematic Source Failures</h3>
            {data.systematicSourceFailures.length > 0 ? (
              <div className="space-y-3">
                {data.systematicSourceFailures.map((f, idx) => (
                  <div key={idx} className="text-xs">
                    <div className="flex justify-between items-center font-medium text-ink">
                      <span>{f.family.charAt(0).toUpperCase() + f.family.slice(1)}</span>
                      <StatusPill status={f.failed ? 'bad' : 'success'}>{f.status}</StatusPill>
                    </div>
                    {f.reason && <div className="text-muted-foreground mt-1 text-[10px] leading-4">{f.reason}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No systematic source failures.</p>
            )}
          </div>
          <div>
            <h3 className="font-semibold text-ink text-sm mb-1">Failure Rule</h3>
            <p className="text-xs text-muted-foreground">{data.failureRule}</p>
          </div>
          <div>
            <h3 className="font-semibold text-ink text-sm mb-2">Production Controls</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <span>Replit-managed schema</span>
                <StatusPill status="success">{data.productionSchema.status}</StatusPill>
              </div>
              <div className="flex justify-between gap-3">
                <span>Application weather immutability</span>
                <StatusPill status="success">{data.applicationWeatherImmutability.persistenceMode}</StatusPill>
              </div>
              <div className="flex justify-between gap-3">
                <span>Point-in-time leakage protection</span>
                <StatusPill status="success">{data.pointInTimeLeakageProtection.status}</StatusPill>
              </div>
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-ink text-sm mb-2">Unsupported Database Controls</h3>
            {data.unsupportedControlLimitations.map((control) => (
              <div key={control.control} className="text-xs text-muted-foreground">
                <div className="font-medium text-ink">{control.control.replaceAll('_', ' ')}</div>
                <div className="mt-1">{control.status}. This defense-in-depth limitation does not affect Phase 8 eligibility.</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-border bg-secondary/20 p-4 overflow-x-auto">
        <h3 className="font-semibold text-ink text-sm mb-3">Weekly Coverage Trends</h3>
        <table className="w-full text-left text-xs whitespace-nowrap">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr>
              <th className="pb-2 pr-4 font-medium">Wk</th>
              <th className="pb-2 pr-4 font-medium">Pers Cov</th>
              <th className="pb-2 pr-4 font-medium">Pers Comp</th>
              <th className="pb-2 pr-4 font-medium">QB Cert</th>
              <th className="pb-2 pr-4 font-medium">Inj Cov</th>
              <th className="pb-2 pr-4 font-medium">SB Fresh</th>
              <th className="pb-2 pr-4 font-medium">Wx Cov</th>
              <th className="pb-2 pr-4 font-medium">Med Conf</th>
              <th className="pb-2 pr-4 font-medium">&lt;50</th>
              <th className="pb-2 font-medium">&gt;70</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.weeklyTrend.map((t, idx) => (
              <tr key={idx} className="text-ink">
                <td className="py-2 pr-4 font-mono">{t.season}-{t.week}</td>
                <td className="py-2 pr-4 font-mono">{decimal(t.personnelCoverage)}%</td>
                <td className="py-2 pr-4 font-mono">{decimal(t.personnelCompleteness)}%</td>
                <td className="py-2 pr-4 font-mono">{decimal(t.medianQbCertainty)}%</td>
                <td className="py-2 pr-4 font-mono">{decimal(t.injuryCoverage)}%</td>
                <td className="py-2 pr-4 font-mono">{decimal(t.sportsbookFreshness)}%</td>
                <td className="py-2 pr-4 font-mono">{decimal(t.weatherCoverage)}%</td>
                <td className="py-2 pr-4 font-mono">{decimal(t.medianDataConfidence)}</td>
                <td className="py-2 pr-4 font-mono">{t.gamesBelow50}</td>
                <td className="py-2 font-mono">{t.gamesAbove70}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.games.length > 0 && (
        <div className="mt-5 rounded-xl border border-border bg-secondary/20 p-4 overflow-x-auto">
          <h3 className="font-semibold text-ink text-sm mb-3">Current-Game Component Metrics</h3>
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <th className="pb-2 pr-4 font-medium">Game</th>
                <th className="pb-2 pr-4 font-medium">Pub Starter</th>
                <th className="pb-2 pr-4 font-medium">Inf Starter</th>
                <th className="pb-2 pr-4 font-medium">Pers Comp</th>
                <th className="pb-2 pr-4 font-medium">QB Cert</th>
                <th className="pb-2 pr-4 font-medium">Inj Fresh</th>
                <th className="pb-2 pr-4 font-medium">SB Fresh</th>
                <th className="pb-2 pr-4 font-medium">Wx Elig</th>
                <th className="pb-2 pr-4 font-medium">Samp Qual</th>
                <th className="pb-2 font-medium">Data Conf</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.games.map((g) => (
                <tr key={g.gameId} className="text-ink">
                  <td className="py-2 pr-4 font-mono">{g.gameId}</td>
                  <td className="py-2 pr-4 font-mono">{decimal(g.publishedStarterCoverage)}%</td>
                  <td className="py-2 pr-4 font-mono">{decimal(g.inferredStarterCoverage)}%</td>
                  <td className="py-2 pr-4 font-mono">{decimal(g.personnelCompleteness)}%</td>
                  <td className="py-2 pr-4 font-mono">{decimal(g.qbCertainty)}%</td>
                  <td className="py-2 pr-4 font-mono">{decimal(g.injuryFreshness)}%</td>
                  <td className="py-2 pr-4 font-mono">{decimal(g.sportsbookFreshness)}%</td>
                  <td className="py-2 pr-4 font-mono"><StatusPill status={g.weatherEligible ? 'success' : 'neutral'}>{g.weatherEligible ? 'Y' : 'N'}</StatusPill></td>
                  <td className="py-2 pr-4 font-mono">{decimal(g.sampleQuality)}</td>
                  <td className="py-2 font-mono">{decimal(g.overallDataConfidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}


function PersonnelContextCoveragePanel() {
  const coverage = useGetPersonnelContextCoverage({ query: { queryKey: getGetPersonnelContextCoverageQueryKey(), staleTime: 30000 } });

  if (coverage.isLoading) return <LoadingPanel label="Loading coverage data" />;
  if (coverage.isError || !coverage.data) return <ErrorPanel message="Coverage data could not be loaded." />;

  const data = coverage.data;
  const decimal = (value: unknown, digits = 1) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';

  return (
    <Panel eyebrow="Slate overview" title={`Season ${data.season ?? '—'} / Week ${data.week ?? '—'} Coverage`} className="mb-5">
       <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
         <MetricCard label="Games" value={String(data.games)} detail="Total scheduled" icon={CalendarDays} />
         <MetricCard label="Median Confidence" value={`${decimal(data.medianConfidence)}/100`} detail="Not betting confidence" icon={Target} />
         <MetricCard label="Published Depth" value={`${decimal(data.teamPublishedDepthPercent)}%`} detail="Official depth charts" icon={ListFilter} />
         <MetricCard label="Inferred Starters" value={`${decimal(data.starterInferredPercent)}%`} detail="Projected via snap share" icon={UserRound} />
       </div>
       <div className="mt-5 grid gap-5 lg:grid-cols-3">
         <div className="rounded-xl border border-border bg-secondary/20 p-4">
           <h3 className="font-semibold text-ink text-sm">Data Availability</h3>
           <div className="mt-3 space-y-2 text-xs text-muted-foreground">
             <div className="flex justify-between"><span>Weather</span> <span className="font-mono text-ink">{decimal(data.gameWeatherPercent)}%</span></div>
             <div className="flex justify-between"><span>Injuries</span> <span className="font-mono text-ink">{decimal(data.currentInjuryPercent)}%</span></div>
             <div className="flex justify-between"><span>Sportsbook</span> <span className="font-mono text-ink">{decimal(data.currentSportsbookPercent)}%</span></div>
             <div className="flex justify-between"><span>Published Starters</span> <span className="font-mono text-ink">{decimal(data.starterPublishedPercent)}%</span></div>
           </div>
         </div>

         <div className="rounded-xl border border-border bg-secondary/20 p-4">
           <h3 className="font-semibold text-ink text-sm">Lowest Confidence Games</h3>
           <div className="mt-3 space-y-3">
             {data.lowestConfidenceGames?.length ? data.lowestConfidenceGames.map((g: any) => (
               <div key={g.gameId} className="text-xs">
                 <div className="flex justify-between font-medium text-ink"><span>{g.gameId}</span> <span className="font-mono">{decimal(g.confidence)}</span></div>
                 <div className="text-muted-foreground mt-1 text-[10px] leading-4">{g.reasons?.join(', ')}</div>
               </div>
             )) : <p className="text-xs text-muted-foreground">No low confidence outliers.</p>}
           </div>
         </div>

         <div className="rounded-xl border border-border bg-secondary/20 p-4">
           <h3 className="font-semibold text-ink text-sm">Weather Provider</h3>
           <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              {Object.entries(data.weather ?? {}).map(([key, value]) => (
                <div key={key} className="flex justify-between"><span>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span> <span className="font-mono text-ink">{String(value)}</span></div>
              ))}
           </div>
         </div>
       </div>

       {data.sourceAssessments && data.sourceAssessments.length > 0 && (
          <div className="mt-5 rounded-xl border border-border bg-secondary/20 p-4 overflow-x-auto">
             <h3 className="font-semibold text-ink text-sm mb-3">Source Assessments</h3>
             <table className="w-full text-left text-xs whitespace-nowrap">
               <thead>
                 <tr className="border-b border-border text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                   <th className="px-2 py-2">Source</th>
                   <th className="px-2 py-2">Coverage</th>
                   <th className="px-2 py-2">Quality</th>
                 </tr>
               </thead>
               <tbody>
                 {data.sourceAssessments.map((sa: any, i: number) => (
                   <tr key={i} className="border-b border-border/50 last:border-0">
                     <td className="px-2 py-2 font-medium text-ink">{sa.source ?? 'Unknown'}</td>
                     <td className="px-2 py-2 font-mono">{sa.coverage ?? '—'}</td>
                     <td className="px-2 py-2">{sa.quality ?? '—'}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
          </div>
       )}
    </Panel>
  );
}

function PersonnelContextPage() {
  const games = useListGames(undefined, { query: { queryKey: ['personnel-context-games'], staleTime: 30000 } });
  const [selectedGameId, setSelectedGameId] = useState('');
  useEffect(() => {
    if (!selectedGameId && games.data?.length) setSelectedGameId(games.data[0].gameId);
  }, [games.data, selectedGameId]);
  const context = useGetPersonnelContextForGame(selectedGameId, {
    query: { queryKey: getGetPersonnelContextForGameQueryKey(selectedGameId), enabled: Boolean(selectedGameId), staleTime: 30000 },
  });
  const data = context.data as any;
  const teams = data?.teams ? Object.values(data.teams) as any[] : [];
  const score = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
  const decimal = (value: unknown, digits = 2) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'Unavailable';
  const bool = (value: unknown) => value === null || value === undefined ? 'Unavailable' : value ? 'Yes' : 'No';
  const selectedGame = games.data?.find((game) => game.gameId === selectedGameId);
  return (
    <>
      <PageHeader
        eyebrow="Review / Phase 7"
        title="Personnel & Context Audit"
        detail="Inspect the timestamped evidence available before kickoff. Inferred roles remain clearly separated from official source records."
        actions={<button type="button" className="button button-subtle" onClick={() => context.refetch()} disabled={!selectedGameId || context.isFetching}><RefreshCw className={cx('h-4 w-4', context.isFetching && 'animate-spin')} /> Refresh</button>}
      />
      <ChallengerReadinessPanel />
      <PersonnelContextCoveragePanel />
      <Panel eyebrow="Point-in-time game record" title="Choose a matchup" className="mb-5">
        {games.isLoading ? <Skeleton className="h-10" /> : games.isError ? <ErrorPanel message="The current schedule could not be loaded." /> : games.data?.length ? (
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <label className="field-label min-w-0 flex-1">Game
              <select className="field-input mt-2 w-full" value={selectedGameId} onChange={(event) => setSelectedGameId(event.target.value)}>
                {games.data.map((game) => <option key={game.gameId} value={game.gameId}>{game.awayTeam.abbreviation} at {game.homeTeam.abbreviation} · Week {game.week} · {formatDate(game.kickoffTime ?? game.gameDate, true)}</option>)}
              </select>
            </label>
            <div className="text-xs leading-5 text-muted-foreground md:max-w-md">
              <p><strong className="text-ink">Feature version:</strong> pregame-v4-personnel-context</p>
              <p><strong className="text-ink">Production status:</strong> Phase 6 models remain active and unchanged.</p>
            </div>
          </div>
        ) : <EmptyPanel title="No games available" detail="A schedule record is required before personnel context can be derived." icon={CalendarDays} />}
      </Panel>
      {!selectedGameId || context.isLoading ? <LoadingPanel label="Building the point-in-time personnel record" /> : context.isError || !data ? <ErrorPanel message="The personnel and context audit could not be loaded for this game." /> : (
        <>
          <div className="signal-strip">
            <div><span className="strip-label">MATCHUP</span><strong>{selectedGame ? `${selectedGame.awayTeam.abbreviation} at ${selectedGame.homeTeam.abbreviation}` : data.gameId}</strong></div>
            <div><span className="strip-label">SOURCE CUTOFF</span><strong>{formatDate(data.sourceCutoff, true)}</strong></div>
            <div><span className="strip-label">DATA CONFIDENCE</span><strong>{score(data.dataConfidence?.overall) ?? 'Unavailable'} / 100</strong></div>
            <div><span className="strip-label">INTERPRETATION</span><strong>Not betting confidence</strong></div>
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
            <Panel eyebrow="Completeness and freshness" title={data.dataConfidence?.label ?? 'Data Confidence'}>
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(data.dataConfidence?.components ?? {}).map(([name, value]) => (
                  <div className="rounded-xl border border-border bg-secondary/25 p-3" key={name}>
                    <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-ink">{name.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())}</span><span className="font-mono text-sm font-semibold text-ink">{score(value) ?? '—'}</span></div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${score(value) ?? 0}%` }} /></div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">This score measures source completeness, freshness, and sample support. It does not estimate win probability, edge, or recommendation quality.</p>
            </Panel>
            <Panel eyebrow="Environmental context" title="Weather and schedule">
              <div className="callout callout-warn"><AlertTriangle className="h-4 w-4 shrink-0" /><p>{data.weather?.available ? 'A verified weather source is available.' : data.weather?.unavailableReason ?? 'Weather is unavailable.'}</p></div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div><p className="eyebrow">Temperature</p><p className="mt-1 text-ink">{decimal(data.weather?.temperature, 0)}</p></div>
                <div><p className="eyebrow">Wind</p><p className="mt-1 text-ink">{decimal(data.weather?.windSpeed, 0)}</p></div>
                <div><p className="eyebrow">Roof</p><p className="mt-1 text-ink">{data.weather?.roofStatus ?? 'Unavailable'}</p></div>
                <div><p className="eyebrow">Precipitation</p><p className="mt-1 text-ink">{data.weather?.precipitationType ?? 'Unavailable'}</p></div>
              </div>
            </Panel>
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            {teams.map((team) => (
              <Panel key={team.teamId} eyebrow={`${team.abbreviation ?? team.teamId} / Point-in-time personnel`} title={team.teamName ?? team.teamId} action={<StatusPill status={team.starters?.length ? 'current' : 'not_configured'}>{team.starters?.length ?? 0} probable starters</StatusPill>}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricCard label="Personnel completeness" value={`${score(team.personnelCompleteness) ?? 0}/100`} detail="Available source coverage" icon={UserRound} />
                  <MetricCard label="QB certainty" value={`${score(team.qb?.starterCertainty) ?? 0}/100`} detail={team.qb?.projectedStarter?.playerName ?? team.qb?.projectedStarter?.playerId ?? 'No supported starter'} icon={Target} />
                  <MetricCard label="OL continuity" value={decimal(team.olContinuity?.olSnapContinuity)} detail={`${team.olContinuity?.lineupChanges ?? '—'} lineup changes`} icon={ShieldCheck} />
                </div>
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between"><p className="eyebrow">Probable starters</p><span className="section-meta">Official and inferred kept separate</span></div>
                  {team.starters?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead><tr className="border-b border-border text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><th className="px-2 py-2">Player</th><th className="px-2 py-2">Position</th><th className="px-2 py-2">Source status</th><th className="px-2 py-2">Confidence</th><th className="px-2 py-2">Recent participation</th><th className="px-2 py-2">Injury</th><th className="px-2 py-2">Evidence</th><th className="px-2 py-2">Source timestamp</th></tr></thead><tbody>{team.starters.map((starter: any) => <tr className="border-b border-border/60 align-top" key={`${team.teamId}-${starter.playerId}-${starter.position}`}><td className="px-2 py-2 font-semibold text-ink">{starter.playerName ?? starter.playerId}</td><td className="px-2 py-2">{starter.position ?? '—'}</td><td className="px-2 py-2"><StatusPill status={starter.classification === 'official' ? 'current' : 'stale'}>{starter.classification === 'official' ? 'Official' : starter.classification === 'published_secondary' ? 'Published secondary' : 'Inferred — not official'}</StatusPill><p className="mt-1 text-[10px] text-muted-foreground">{starter.source}</p></td><td className="px-2 py-2 font-mono">{score(starter.confidence) ?? '—'}/100</td><td className="px-2 py-2"><p>Snap share: {decimal(starter.recentSnapShare, 2)}</p><p className="mt-1 text-[10px] text-muted-foreground">{starter.priorWeekParticipation?.played === null || starter.priorWeekParticipation?.played === undefined ? 'Prior week unavailable' : starter.priorWeekParticipation.played ? 'Played prior week' : 'No prior-week participation'}</p></td><td className="px-2 py-2">{starter.injuryStatus?.gameStatus ?? starter.injuryStatus?.practiceStatus ?? 'No current row'} </td><td className="max-w-[240px] px-2 py-2 text-[10px] leading-4 text-muted-foreground">{starter.recentStarterEvidence?.length ? starter.recentStarterEvidence.join(' ') : starter.evidence?.join(' ') || starter.unavailableReason || 'No additional evidence.'}</td><td className="px-2 py-2">{starter.snapshotTimestamp ? formatDate(starter.snapshotTimestamp, true) : 'Unavailable'}<p className="mt-1 text-[10px] text-muted-foreground">{starter.dataFreshness ?? 'unknown freshness'}</p></td></tr>)}</tbody></table></div> : <EmptyPanel title="No supported starter evidence" detail={team.unavailableReasons?.join(' ') || 'No depth-chart or prior participation record is available before the source cutoff.'} icon={UserRound} />}
                </div>
                {team.sourceConflicts?.length > 0 && (
                  <div className="mt-4 callout callout-warn text-xs">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="eyebrow !mb-1 text-inherit">Source conflicts</p>
                      <ul className="list-inside list-disc opacity-90 space-y-1">
                        {team.sourceConflicts.map((conflict: any, idx: number) => <li key={`${conflict.position ?? 'unknown'}-${idx}`}><strong>{conflict.position ?? 'Unknown position'}:</strong> {conflict.reason ?? 'Sources disagree.'} {conflict.players?.length ? `Players: ${conflict.players.join(', ')}.` : ''} {conflict.sources?.length ? `Sources: ${conflict.sources.join(', ')}.` : ''}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
                {team.missingRequiredPositions?.length > 0 && (
                  <div className="mt-4 callout border-destructive/30 bg-destructive/10 text-destructive text-xs">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="eyebrow !mb-1 text-inherit">Missing positions</p>
                      <p className="opacity-90 mt-1">The following positions lack sufficient starter evidence: <strong>{team.missingRequiredPositions.join(', ')}</strong></p>
                    </div>
                  </div>
                )}
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-border bg-secondary/20 p-3 text-xs"><p className="eyebrow">Quarterback context</p><dl className="mt-2 space-y-1 text-muted-foreground"><div className="flex justify-between gap-3"><dt>Recent dropbacks</dt><dd className="font-mono text-ink">{team.qb?.recentDropbacks ?? '—'}</dd></div><div className="flex justify-between gap-3"><dt>EPA / dropback</dt><dd className="font-mono text-ink">{decimal(team.qb?.recentEpaPerDropback, 3)}</dd></div><div className="flex justify-between gap-3"><dt>Success rate</dt><dd className="font-mono text-ink">{decimal(team.qb?.recentSuccessRate, 3)}</dd></div><div className="flex justify-between gap-3"><dt>Starter change</dt><dd className="font-mono text-ink">{bool(team.qb?.starterChange)}</dd></div></dl></div>
                  <div className="rounded-xl border border-border bg-secondary/20 p-3 text-xs"><p className="eyebrow">Rest and travel</p><dl className="mt-2 space-y-1 text-muted-foreground"><div className="flex justify-between gap-3"><dt>Days rest</dt><dd className="font-mono text-ink">{decimal(team.rest?.daysRest, 1)}</dd></div><div className="flex justify-between gap-3"><dt>Short week</dt><dd className="font-mono text-ink">{bool(team.rest?.shortWeek)}</dd></div><div className="flex justify-between gap-3"><dt>Bye return</dt><dd className="font-mono text-ink">{bool(team.rest?.byeWeekReturn)}</dd></div><div className="flex justify-between gap-3"><dt>Road-game run</dt><dd className="font-mono text-ink">{team.rest?.consecutiveRoadGames ?? '—'}</dd></div></dl></div>
                </div>
                <div className="mt-5"><p className="eyebrow">Player-level injury impact</p>{team.injuryPlayers?.length ? <div className="mt-2 space-y-2">{team.injuryPlayers.map((injury: any) => <div className="rounded-lg border border-border p-3 text-xs" key={`${team.teamId}-${injury.playerId}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-ink">{injury.playerName ?? injury.playerId} · {injury.position ?? 'Unknown position'}</p><span className="font-mono text-ink">Impact {decimal(injury.impactScore)}</span></div><p className="mt-1 text-muted-foreground">{injury.gameStatus ?? injury.designation ?? 'Status unavailable'} · snap share {decimal(injury.recentSnapShare)} · starter likelihood {decimal(injury.starterLikelihood)}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{injury.derivation}</p></div>)}</div> : <p className="mt-2 text-xs text-muted-foreground">No injury snapshot was available for this team before the cutoff.</p>}</div>
              </Panel>
            ))}
          </div>
          <Panel eyebrow="Unit interactions" title="Matchup context" className="mt-5">
            <div className="grid gap-4 xl:grid-cols-2">{(data.matchup ?? []).map((item: any) => <div className="rounded-xl border border-border bg-secondary/20 p-4" key={`${item.offenseTeamId}-${item.defenseTeamId}`}><p className="font-semibold text-ink">{item.offenseTeamId} offense vs {item.defenseTeamId} defense</p><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sidebar p-3 text-[11px] leading-5 text-sidebar-foreground">{JSON.stringify(item.unitContext, null, 2)}</pre>{item.unavailableReasons?.map((reason: string) => <p className="mt-2 text-xs text-muted-foreground" key={reason}>{reason}</p>)}</div>)}</div>
          </Panel>
          <Panel eyebrow="Immutable sportsbook observations" title="Market movement" className="mt-5" action={<span className="section-meta">{data.market?.observations ?? 0} observations</span>}>
            {data.market?.current?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left text-xs"><thead><tr className="border-b border-border text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><th className="px-3 py-3">Book / market</th><th className="px-3 py-3">Selection</th><th className="px-3 py-3">First observed</th><th className="px-3 py-3">Current</th><th className="px-3 py-3">Movement</th><th className="px-3 py-3">Last capture</th></tr></thead><tbody>{data.market.current.map((line: any) => <tr className="border-b border-border/70" key={line.key}><td className="px-3 py-3 font-semibold text-ink">{line.sportsbook} · {line.market}</td><td className="px-3 py-3">{line.selection}</td><td className="px-3 py-3 font-mono">{line.firstObserved?.point ?? 'ML'} {formatPrice(line.firstObserved?.price)}</td><td className="px-3 py-3 font-mono">{line.current?.point ?? 'ML'} {formatPrice(line.current?.price)}</td><td className="px-3 py-3 font-mono">{line.pointMovement ?? '—'} pts · {line.priceMovement ?? '—'} price</td><td className="px-3 py-3">{formatDate(line.current?.capturedAt, true)}</td></tr>)}</tbody></table></div> : <EmptyPanel title="No market observations before cutoff" detail={data.market?.unavailableReason ?? 'No immutable sportsbook history is available.'} icon={LineChart} />}
            <p className="mt-4 text-[11px] leading-5 text-muted-foreground">“First observed by Gridline” is not an official sportsbook opener. Missing markets stay unavailable and do not invalidate football-model predictions.</p>
          </Panel>
          <Panel eyebrow="Audit boundary" title="Sources and limitations" className="mt-5">
            <div className="grid gap-5 lg:grid-cols-2"><div><p className="eyebrow">Source tables</p><div className="mt-2 flex flex-wrap gap-2">{(data.sources ?? []).map((source: string) => <span className="rounded-full border border-border bg-secondary/30 px-2.5 py-1 text-xs font-medium text-ink" key={source}>{source}</span>)}</div></div><div><p className="eyebrow">Explicit limitations</p><ul className="mt-2 space-y-2 text-xs leading-5 text-muted-foreground">{(data.limitations ?? []).map((item: string) => <li className="flex gap-2" key={item}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />{item}</li>)}</ul></div></div>
          </Panel>
        </>
      )}
    </>
  );
}

function Backtesting() {
  return <ReadinessPage eyebrow="Research" title="Backtesting" detail="Walk-forward evaluation without hindsight or invented results." icon={History} blocks={['Walk-forward windows', 'Out-of-sample record', 'Calibration by segment']} />;
}

function ModelLab() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  const lab = useQuery({
    queryKey: ['model-lab'],
    queryFn: async () => {
      const response = await fetch('/api/models/lab', { credentials: 'include' });
      if (!response.ok) throw new Error('Model Lab unavailable');
      return response.json() as Promise<any>;
    },
    staleTime: 30000,
  });
  const runs = (lab.data?.runs ?? []) as any[];
  const promotions = useQuery({
    queryKey: ['model-promotions'],
    queryFn: async () => {
      const response = await fetch('/api/models/promotions', { credentials: 'include', headers: await authHeaders() });
      if (!response.ok) throw new Error('Promotion history unavailable');
      return response.json() as Promise<any>;
    },
    staleTime: 30000,
  });
  const adminStatus = useQuery({
    queryKey: ['admin-status', isSignedIn ? 'signed-in' : 'signed-out'],
    queryFn: async () => {
      const response = await fetch('/api/auth/admin-status', { credentials: 'include', headers: await authHeaders() });
      if (!response.ok) throw new Error('Admin status unavailable');
      return response.json() as Promise<any>;
    },
    staleTime: 30000,
    enabled: isLoaded,
  });
  const drift = useQuery({
    queryKey: ['model-drift'],
    queryFn: async () => {
      const response = await fetch('/api/models/drift', { credentials: 'include' });
      if (!response.ok) throw new Error('Model drift unavailable');
      return response.json() as Promise<any>;
    },
    staleTime: 30000,
  });
  const validationAudit = useQuery({
    queryKey: ['prediction-validation-failures'],
    queryFn: async () => {
      const response = await fetch('/api/predictions/validation-failures?limit=25', { credentials: 'include' });
      if (!response.ok) throw new Error('Prediction validation audit unavailable');
      return response.json() as Promise<any>;
    },
    staleTime: 30000,
  });
  const [promoting, setPromoting] = useState<string | null>(null);
  const [promotionMessage, setPromotionMessage] = useState<string | null>(null);
  const [promotionSafetyResult, setPromotionSafetyResult] = useState<any>(null);
  const [refitting, setRefitting] = useState(false);
  const refit = async () => {
    setRefitting(true);
    setPromotionMessage(null);
    try {
      const response = await fetch('/api/models/refit-production', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Production refit was rejected');
      setPromotionMessage(`Phase 6 refit created ${body.runsCreated ?? 0} administrator-review candidates using ${body.trainingSeasons?.join(', ') ?? '2021–2025'} only. 2026 was excluded.`);
      await lab.refetch();
    } catch (error) {
      setPromotionMessage(error instanceof Error ? error.message : 'Production refit was rejected');
    } finally {
      setRefitting(false);
    }
  };
  const promote = async (run: any) => {
    setPromoting(run.modelVersion);
    setPromotionMessage(null);
    setPromotionSafetyResult({
      status: 'running',
      checkedAt: null,
      candidateModelVersion: run.modelVersion,
      predictionValidation: { passed: 0, total: 0 },
      leakage: { passed: 0, total: 0 },
      failureDetails: [],
    });
    try {
      const response = await fetch('/api/models/promote', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ modelVersion: run.modelVersion, notes: 'Explicit administrator review from Model Lab.' }),
      });
      const body = await response.json().catch(() => ({}));
      if (body.safetyGate && typeof body.safetyGate === 'object') setPromotionSafetyResult(body.safetyGate);
      if (!response.ok) {
        setPromotionMessage(body.error ?? 'Promotion was rejected');
        return;
      }
      setPromotionMessage(`${run.family} production model promoted. New live snapshots will use this version.`);
      await Promise.all([promotions.refetch(), lab.refetch()]);
    } catch (error) {
      setPromotionMessage(error instanceof Error ? error.message : 'Promotion was rejected');
    } finally {
      setPromoting(null);
    }
  };
  const families = [
    { key: 'spread', label: 'Spread / ATS', description: 'Projected home margin. Cover probability remains unavailable without a legitimate historical sportsbook spread.', primary: 'mae', secondary: 'rmse' },
    { key: 'moneyline', label: 'Moneyline', description: 'Home-win probability evaluated with accuracy, log loss, Brier score, and calibration.', primary: 'logLoss', secondary: 'brierScore' },
    { key: 'totals', label: 'Game totals', description: 'Projected combined score. Over/Under probability is derived only when a pre-prediction market total exists.', primary: 'mae', secondary: 'rmse' },
  ];
  const metric = (run: any, key: string) => typeof run?.metrics?.[key] === 'number' ? Number(run.metrics[key]).toFixed(3) : '—';
  const percentMetric = (run: any, key: string) => typeof run?.metrics?.[key] === 'number' ? `${(Number(run.metrics[key]) * 100).toFixed(1)}%` : '—';
  const topFeatures = (run: any) => Object.entries(run?.featureImportance ?? {}).sort((left: any, right: any) => Number(right[1]) - Number(left[1])).slice(0, 6);
  return (
    <>
       <PageHeader eyebrow="Research / Phase 6" title="Model lab" detail="Chronological validation plus an explicit, administrator-controlled production refit through 2025." actions={<div className="flex gap-2"><button type="button" className="button button-subtle" onClick={() => lab.refetch()}><RefreshCw className={cx('h-4 w-4', lab.isFetching && 'animate-spin')} /> Refresh results</button><button type="button" className="button button-primary" disabled={refitting || !adminStatus.data?.isAdmin} onClick={refit}>{refitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refit through 2025</button></div>} />
       <div className="readiness-header">
        <div className="readiness-header-icon"><ShieldCheck className="h-5 w-5" /></div>
        <div>
          <p className="eyebrow text-accent">PHASE 5 / CONTROLLED PROMOTION</p>
          <h2 className="text-lg font-semibold text-ink">{Object.keys(promotions.data?.current ?? {}).length ? 'Production models are explicitly selected.' : 'No production model is active.'}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Feature version <span className="font-mono text-ink">{lab.data?.featureVersion ?? 'pregame-v3'}</span>. Phase 4 validation and prior promotions are append-only. {promotionMessage ?? 'No automatic promotion occurs.'}</p>
        </div>
       <Panel eyebrow="Phase 6 / Production refit" title="Candidates trained through 2025" className="mt-5">
         <p className="text-xs leading-5 text-muted-foreground">These are the unchanged selected algorithms refit on legitimate 2021–2025 data. They remain challengers until an administrator promotes each family explicitly. Promotion creates a new future-game prediction revision; prior snapshots remain preserved.</p>
         {lab.data?.refitCandidates?.length ? <div className="mt-4 grid gap-3 md:grid-cols-3">{lab.data.refitCandidates.map((candidate: any) => { const isActive = promotions.data?.current?.[candidate.family]?.modelVersion === candidate.modelVersion; return <div className="rounded-lg border border-border bg-secondary/30 p-3" key={candidate.modelVersion}><div className="flex items-center justify-between gap-2"><p className="eyebrow">{candidate.family} · Phase 6</p><StatusPill status={isActive ? 'success' : 'not_configured'}>{isActive ? 'Active' : 'Awaiting promotion'}</StatusPill></div><p className="mt-2 font-semibold capitalize text-ink">{String(candidate.algorithm).replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-muted-foreground">Training cutoff {candidate.trainingCutoff} · {candidate.sampleSize} rows</p><p className="mt-2 truncate font-mono text-[10px] text-muted-foreground" title={candidate.modelVersion}>{candidate.modelVersion}</p><button type="button" className="button button-subtle mt-3 w-full" disabled={isActive || promoting === candidate.modelVersion} onClick={() => promote(candidate)}>{isActive ? 'Phase 6 is active' : promoting === candidate.modelVersion ? 'Promoting…' : `Promote ${candidate.family} Phase 6`}</button></div>; })}</div> : <EmptyPanel title="No Phase 6 candidates yet" detail="An administrator can create the refit candidates with the button above. No production model is replaced automatically." icon={History} />}
       </Panel>
        <Panel eyebrow="Promotion safety gate" title={promotionSafetyResult?.status === 'passed' ? 'PASS' : promotionSafetyResult?.status === 'failed' ? 'FAIL' : promotionSafetyResult?.status === 'running' ? 'Running checks' : 'No promotion attempt in this session'} className="mt-5" action={promotionSafetyResult ? <StatusPill status={promotionSafetyResult.status === 'passed' ? 'success' : promotionSafetyResult.status === 'failed' ? 'warning' : 'not_configured'}>{String(promotionSafetyResult.status).toUpperCase()}</StatusPill> : null}>
          {promotionSafetyResult ? <div className="grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border bg-secondary/30 p-3"><p className="eyebrow">Prediction validation</p><p className="mt-2 font-semibold text-ink">{promotionSafetyResult.status === 'running' ? 'Running…' : `${promotionSafetyResult.predictionValidation?.passed ?? 0} / ${promotionSafetyResult.predictionValidation?.total ?? 0} passed`}</p></div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3"><p className="eyebrow">Pregame leakage</p><p className="mt-2 font-semibold text-ink">{promotionSafetyResult.status === 'running' ? 'Waiting…' : `${promotionSafetyResult.leakage?.passed ?? 0} / ${promotionSafetyResult.leakage?.total ?? 0} passed`}</p></div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3"><p className="eyebrow">Checked</p><p className="mt-2 text-ink">{promotionSafetyResult.checkedAt ? formatDate(promotionSafetyResult.checkedAt, true) : 'In progress'}</p></div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3"><p className="eyebrow">Candidate model</p><p className="mt-2 truncate font-mono text-[10px] text-ink" title={promotionSafetyResult.candidateModelVersion}>{promotionSafetyResult.candidateModelVersion}</p></div>
            {promotionSafetyResult.failureDetails?.length ? <div className="rounded-lg border border-border bg-secondary/30 p-3 md:col-span-2 xl:col-span-4"><p className="eyebrow">Failure details</p><ul className="mt-2 space-y-1 text-muted-foreground">{promotionSafetyResult.failureDetails.map((detail: string, index: number) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul></div> : null}
          </div> : <p className="text-sm text-muted-foreground">The prediction-validation and pregame-leakage suites run before every administrator promotion. Results appear here without exposing command output or secrets.</p>}
        </Panel>
      </div>
       <Panel eyebrow="Authorization audit" title={adminStatus.data?.isAdmin ? 'Administrator recognized' : 'Administrator access not recognized'} className="mt-5">
         {!isLoaded || adminStatus.isLoading ? <LoadingPanel label="Checking Clerk session" /> : adminStatus.isError ? <ErrorPanel message="The current Clerk authorization could not be checked." /> : <div className="grid gap-3 text-xs md:grid-cols-3"><div><p className="eyebrow">Clerk user ID</p><p className="mt-1 break-all font-mono text-ink">{adminStatus.data?.userId ?? 'Not signed in'}</p></div><div><p className="eyebrow">Session role</p><p className="mt-1 font-mono text-ink">{adminStatus.data?.sessionRole ?? 'Not present'}{adminStatus.data?.clerkRoleAdmin ? ' · admin' : ''}</p></div><div><p className="eyebrow">ADMIN_USER_IDS</p><p className="mt-1 text-ink">{adminStatus.data?.adminUserIdsConfigured ? 'Configured' : 'Not configured'}</p></div><div className="md:col-span-3"><p className="text-muted-foreground">{adminStatus.data?.isAdmin ? 'This session may use the protected promotion endpoint.' : adminStatus.data?.requiredAdminUserId ? `Add this exact Clerk user ID to ADMIN_USER_IDS: ${adminStatus.data.requiredAdminUserId}` : isSignedIn ? 'Clerk shows you as signed in, but the API did not receive a usable session. Sign out and back in from this preview.' : 'Sign in with Clerk before attempting promotion.'}</p></div></div>}
       </Panel>
      {Object.keys(promotions.data?.current ?? {}).length ? <Panel eyebrow="Current production" title="Active model by market" className="mt-5"><div className="grid gap-3 md:grid-cols-3">{families.map((family) => { const active = promotions.data?.current?.[family.key]; const phase = active?.modelVersion?.startsWith('phase6-refit-') ? 'Phase 6' : active?.modelVersion?.startsWith('phase4-') ? 'Phase 4' : 'No active phase'; return <div className="rounded-lg border border-border bg-secondary/30 p-3" key={family.key}><div className="flex items-center justify-between gap-2"><p className="eyebrow">{family.label}</p><StatusPill status={phase === 'Phase 6' ? 'success' : 'not_configured'}>{phase}</StatusPill></div><p className="mt-2 font-semibold text-ink">{active?.algorithm?.replaceAll('_', ' ') ?? 'Not configured'}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={active?.modelVersion}>{active?.modelVersion ?? '—'}</p><p className="mt-2 text-[11px] text-muted-foreground">Promoted {active ? formatDate(active.promotedAt, true) : '—'}</p></div>; })}</div></Panel> : null}
       <Panel eyebrow="Monitoring" title="Model drift" className="mt-5" action={<span className="section-meta">No automatic promotion</span>}>{drift.data?.results?.length ? <div className="grid gap-3 md:grid-cols-3">{drift.data.results.map((item: any) => <div className="rounded-lg border border-border bg-secondary/30 p-3" key={`${item.family}-${item.modelVersion}`}><div className="flex items-center justify-between gap-3"><p className="eyebrow">{item.family}</p><StatusPill status={item.status === 'elevated' ? 'warning' : item.status === 'stable' ? 'success' : 'not_configured'}>{item.status.replaceAll('_', ' ')}</StatusPill></div><p className="mt-2 truncate font-mono text-[10px] text-ink" title={item.modelVersion}>{item.modelVersion}</p><p className="mt-2 text-xs text-muted-foreground">Recent {item.recentMetric === null ? '—' : item.recentMetric.toFixed(3)} vs baseline {item.baselineMetric === null ? '—' : item.baselineMetric.toFixed(3)} · {item.completedPredictions} completed</p></div>)}</div> : <p className="text-sm text-muted-foreground">Drift monitoring becomes measurable after official production predictions are graded across more than one chronological window.</p>}</Panel>
       <Panel eyebrow="Validation audit" title="Rejected prediction outputs" className="mt-5" action={<span className="section-meta">{validationAudit.data?.failures?.length ?? 0} recent</span>}>{validationAudit.isLoading ? <LoadingPanel label="Loading validation audit" /> : validationAudit.isError ? <ErrorPanel message="The validation audit could not be loaded." /> : validationAudit.data?.failures?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead><tr className="border-b border-border text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><th className="px-3 py-3">Time</th><th className="px-3 py-3">Game</th><th className="px-3 py-3">Field</th><th className="px-3 py-3">Value / type</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3">Model versions</th></tr></thead><tbody>{validationAudit.data.failures.map((failure: any) => <tr className="border-b border-border/70 align-top" key={failure.id}><td className="px-3 py-3">{formatDate(failure.predictionTimestamp, true)}</td><td className="px-3 py-3 font-mono">{failure.gameId}</td><td className="px-3 py-3 font-semibold text-ink">{failure.failedField}</td><td className="px-3 py-3 font-mono">{failure.invalidValue ?? '—'} / {failure.invalidType ?? '—'}</td><td className="px-3 py-3 text-muted-foreground">{failure.failureReason}</td><td className="max-w-[280px] px-3 py-3 font-mono text-[10px] text-muted-foreground">{failure.spreadModelVersion ?? '—'}<br />{failure.moneylineModelVersion ?? '—'}<br />{failure.totalsModelVersion ?? '—'}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">{validationAudit.data?.note ?? 'No rejected prediction outputs have been recorded.'}</p>}</Panel>
      {lab.isLoading ? <LoadingPanel label="Loading walk-forward results" /> : lab.isError ? <ErrorPanel message="The model comparison could not be loaded." /> : (
        <>
          <div className="mt-5 grid gap-5 xl:grid-cols-3">
            {families.map((family) => {
              const recommendation = lab.data?.recommendations?.[family.key];
              const active = promotions.data?.current?.[family.key]?.modelVersion === recommendation?.modelVersion;
              return (
                <Panel key={family.key} eyebrow={family.label} title={recommendation ? `${recommendation.algorithm.replaceAll('_', ' ')} candidate` : 'No candidate'} action={<StatusPill status={active ? 'success' : 'not_configured'}>{active ? 'Production' : 'Challenger'}</StatusPill>}>
                  <p className="text-xs leading-5 text-muted-foreground">{family.description}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border bg-secondary/30 p-3"><p className="eyebrow">{family.primary}</p><p className="mt-2 font-display text-2xl font-semibold text-ink">{recommendation ? metric(recommendation, family.primary) : '—'}</p></div>
                    <div className="rounded-lg border border-border bg-secondary/30 p-3"><p className="eyebrow">{family.secondary}</p><p className="mt-2 font-display text-2xl font-semibold text-ink">{recommendation ? metric(recommendation, family.secondary) : '—'}</p></div>
                  </div>
                  <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{recommendation ? `Selected for review by lowest ${family.primary}; this is not an activation decision.` : 'No evaluated candidate is available.'}</p>
                  {recommendation && <div className="mt-4">{active ? <span className="text-xs font-semibold text-accent">Active production model</span> : <button type="button" className="button button-subtle w-full" disabled={promoting === recommendation.modelVersion} onClick={() => promote(recommendation)}>{promoting === recommendation.modelVersion ? 'Promoting…' : 'Promote this candidate'}</button>}</div>}
                </Panel>
              );
            })}
          </div>
          {families.map((family) => {
            const familyRuns = runs.filter((run) => run.family === family.key);
            return (
                   <Panel key={family.key} eyebrow={family.label} title="Candidate comparison" className="mt-5" action={<span className="section-meta">{familyRuns.length} walk-forward records</span>}>
                <div className="overflow-x-auto">
                   <table className="w-full min-w-[1600px] text-left text-xs">
                     <thead><tr className="border-b border-border text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><th className="px-3 py-3">Algorithm</th><th className="px-3 py-3">Sample policy</th><th className="px-3 py-3">Train → test</th><th className="px-3 py-3">Feature version</th><th className="px-3 py-3">Sample</th><th className="px-3 py-3">{family.primary}</th><th className="px-3 py-3">{family.secondary}</th><th className="px-3 py-3">Calibration</th><th className="px-3 py-3">Model version / trained</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Action</th></tr></thead>
                     <tbody>{familyRuns.map((run) => { const active = promotions.data?.current?.[family.key]?.modelVersion === run.modelVersion; return <tr className="border-b border-border/70 align-top" key={run.modelVersion}><td className="px-3 py-3 font-semibold capitalize text-ink">{String(run.algorithm).replaceAll('_', ' ')}</td><td className="px-3 py-3">{String(run.samplePolicy).replaceAll('_', ' ')}</td><td className="px-3 py-3">{(run.trainingSeasons ?? []).join(', ')} <span className="text-muted-foreground">→ {run.testSeason}</span></td><td className="px-3 py-3 font-mono">{run.featureVersion}</td><td className="px-3 py-3">{run.sampleSize}</td><td className="px-3 py-3 font-mono">{family.key === 'moneyline' ? percentMetric(run, family.primary) : metric(run, family.primary)}</td><td className="px-3 py-3 font-mono">{family.key === 'moneyline' ? metric(run, family.secondary) : metric(run, family.secondary)}</td><td className="px-3 py-3">{Array.isArray(run.calibration) ? `${run.calibration.filter((bucket: any) => bucket.predictions > 0).length} populated buckets` : 'Not applicable'}</td><td className="max-w-[240px] px-3 py-3"><span className="block truncate font-mono text-[10px] text-ink" title={run.modelVersion}>{run.modelVersion}</span><span className="text-muted-foreground">{formatDate(String(run.trainedAt), true)}</span></td><td className="px-3 py-3">{active ? <StatusPill status="success">Production</StatusPill> : <StatusPill status="not_configured">Challenger</StatusPill>}</td><td className="px-3 py-3">{active ? <span className="text-[11px] text-muted-foreground">Active</span> : <button type="button" className="button button-subtle whitespace-nowrap" disabled={promoting === run.modelVersion} onClick={() => promote(run)}>{promoting === run.modelVersion ? 'Promoting…' : 'Promote model'}</button>}</td></tr>; })}</tbody>
                  </table>
                </div>
              </Panel>
            );
          })}
          <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
            <Panel eyebrow="Probability quality" title="Moneyline calibration">
              {(() => {
                const run = lab.data?.recommendations?.moneyline;
                const buckets = Array.isArray(run?.calibration) ? run.calibration.filter((bucket: any) => bucket.predictions > 0) : [];
                return buckets.length ? <div className="odds-table"><div className="odds-head"><span>Bucket</span><span>Predicted</span><span>Actual</span><span>Predictions</span><span>Gap</span></div>{buckets.map((bucket: any) => <div className="odds-row" key={bucket.bucket}><span>{bucket.bucket}</span><span>{formatPercent(bucket.predictedProbability * 100)}</span><span>{formatPercent(bucket.actualRate * 100)}</span><span>{bucket.predictions}</span><span>{formatPercent(Math.abs(bucket.predictedProbability - bucket.actualRate) * 100)}</span></div>)}</div> : <EmptyPanel title="No populated calibration buckets" detail="Calibration is calculated out of sample and remains empty when no candidate has test predictions in a bucket." icon={BarChart3} />;
              })()}
            </Panel>
            <Panel eyebrow="Research notes" title="Market and promotion gates">
              <div className="space-y-3 text-xs leading-5 text-muted-foreground">
                <p><strong className="text-ink">Sportsbook evaluation:</strong> {lab.data?.marketEvaluation?.reason ?? 'Unavailable.'}</p>
                <p><strong className="text-ink">Low-sample comparison:</strong> Each family is evaluated with low-sample games included and with low-sample games restricted. Early-season rows are not silently dropped.</p>
                <p><strong className="text-ink">QB uncertainty:</strong> QB confidence, continuity, and starter-change inputs remain in the feature vector. Low-confidence rows are measured separately in the stored metrics.</p>
                <p><strong className="text-ink">Not added:</strong> No subjective AI override, confidence score, bet sizing, Kelly staking, player props, or automated wagering.</p>
              </div>
            </Panel>
          </div>
          <Panel eyebrow="Interpretability" title="Most influential features" className="mt-5">
            <div className="grid gap-5 md:grid-cols-3">{families.map((family) => {
              const run = lab.data?.recommendations?.[family.key];
              return <div key={family.key}><p className="text-sm font-semibold text-ink">{family.label}</p><div className="mt-3 space-y-2">{topFeatures(run).map(([name, value]: any) => <div key={name} className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-muted-foreground">{name}</span><span className="font-mono text-ink">{(Number(value) * 100).toFixed(1)}%</span></div>)}{!run && <p className="text-xs text-muted-foreground">No feature importance available.</p>}</div></div>;
            })}</div>
          </Panel>
        </>
      )}
    </>
  );
}

function CurrentWeekReport() {
  const report = useQuery({ queryKey: ['current-week-validation'], queryFn: async () => { const response = await fetch('/api/predictions/current-week', { credentials: 'include' }); if (!response.ok) throw new Error('Current-week report unavailable'); return response.json() as Promise<any>; }, staleTime: 30000 });
  const data = report.data;
  const formatDiff = (value: number | null | undefined, percent = false) => value === null || value === undefined ? 'Unavailable' : percent ? formatPercent(value * 100) : value.toFixed(2);
  const rankingGroups = [{ key: 'spread', label: 'Absolute spread differential', value: (row: any) => row.difference?.spread, suffix: 'pts' }, { key: 'moneyline', label: 'Moneyline probability differential', value: (row: any) => row.difference?.moneyline, suffix: '%' }, { key: 'totals', label: 'Absolute totals differential', value: (row: any) => row.difference?.total, suffix: 'pts' }];
  const reportStatus = data?.status === 'measured' ? 'Football model valid' : 'No valid football model';
  return <Panel eyebrow="Current week / Analysis only" title={data?.season && data?.week ? `${data.season} · Week ${data.week}` : 'Current NFL week'} className="mt-5" action={<span className="section-meta">{reportStatus}</span>}>{report.isLoading ? <LoadingPanel label="Loading current-week rankings" /> : report.isError ? <ErrorPanel message="The current-week report could not be loaded." /> : <><p className="text-xs leading-5 text-muted-foreground">{data?.note ?? 'Independent rankings only. Missing values are never imputed.'}</p><div className="mt-4 grid gap-4 xl:grid-cols-3">{rankingGroups.map((group) => <div className="rounded-lg border border-border bg-secondary/20 p-3" key={group.key}><p className="eyebrow">{group.label}</p><div className="mt-2 space-y-2">{(data?.rankings?.[group.key === 'total' ? 'totals' : group.key] ?? []).map((row: any) => <div className="flex items-center justify-between gap-3 text-xs" key={row.gameId}><span className="truncate text-ink">{row.awayTeam} @ {row.homeTeam}</span><span className="shrink-0 font-mono text-ink">{group.value(row) === null || group.value(row) === undefined ? 'Unavailable' : `${formatDiff(group.value(row), group.key === 'moneyline')} ${group.suffix}`}</span></div>)}{!(data?.rankings?.[group.key === 'total' ? 'totals' : group.key] ?? []).length && <p className="text-xs text-muted-foreground">No upcoming games.</p>}</div></div>)}</div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[1200px] text-left text-xs"><thead><tr className="border-b border-border text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><th className="px-3 py-3">Game</th><th className="px-3 py-3">Projected score / margin / total</th><th className="px-3 py-3">Market spread / total</th><th className="px-3 py-3">Win probability / no-vig</th><th className="px-3 py-3">Differences</th><th className="px-3 py-3">Previous vs current</th></tr></thead><tbody>{(data?.games ?? []).map((row: any) => <tr className="border-b border-border/70 align-top" key={row.gameId}><td className="px-3 py-3"><p className="font-semibold text-ink">{row.awayTeam} @ {row.homeTeam}</p><p className="mt-1 text-muted-foreground">{formatDate(row.kickoffTime, true)} · {row.status === 'measured' ? 'Measured' : row.status === 'partial_market_data' ? 'Football model valid; market comparisons partial' : `Missing: ${row.missing.join(', ')}`}</p><p className="mt-1 text-[10px] text-muted-foreground">Model: {row.componentStatus?.modelData ?? 'unknown'} · spread {row.componentStatus?.spreadComparison ?? 'unknown'} · ML {row.componentStatus?.moneylineComparison ?? 'unknown'} · total {row.componentStatus?.totalsComparison ?? 'unknown'}</p></td><td className="px-3 py-3 font-mono">{row.prediction ? `${row.prediction.projectedHomeScore?.toFixed(1)}–${row.prediction.projectedAwayScore?.toFixed(1)} / ${row.prediction.projectedMargin?.toFixed(1)} / ${row.prediction.projectedTotal?.toFixed(1)}` : 'Unavailable'}</td><td className="px-3 py-3 font-mono">{row.market ? `${row.market.spread?.point ?? '—'} / ${row.market.total?.point ?? '—'}` : 'Unavailable'}</td><td className="px-3 py-3 font-mono">{row.prediction ? `${formatPercent(row.prediction.homeWinProbability * 100)} / ${formatPercent(row.prediction.awayWinProbability * 100)} · ${row.market?.noVigHomeProbability === null || row.market?.noVigHomeProbability === undefined ? '—' : formatPercent(row.market.noVigHomeProbability * 100)} / ${row.market?.noVigAwayProbability === null || row.market?.noVigAwayProbability === undefined ? '—' : formatPercent(row.market.noVigAwayProbability * 100)}` : 'Unavailable'}</td><td className="px-3 py-3 font-mono">{row.difference ? `${formatDiff(row.difference.spread)} / ${formatDiff(row.difference.moneyline, true)} / ${formatDiff(row.difference.total)}` : 'Unavailable'}</td><td className="px-3 py-3 font-mono">{row.previousPrediction ? <span>Prior {formatDate(row.previousPrediction.predictionTimestamp, true)}: {row.previousPrediction.projectedMargin?.toFixed(1)} margin / {row.previousPrediction.projectedTotal?.toFixed(1)} total / {formatPercent(row.previousPrediction.homeWinProbability * 100)} home</span> : 'No prior revision'}</td></tr>)}</tbody></table></div></>}</Panel>;
}

function LivePredictions() {
  const { getToken } = useAuth();
  const board = useQuery({ queryKey: ['live-predictions'], queryFn: async () => { const response = await fetch('/api/predictions/live', { credentials: 'include' }); if (!response.ok) throw new Error('Live predictions unavailable'); return response.json() as Promise<any>; }, staleTime: 30000 });
  const predictions = board.data?.predictions ?? [];
  const [generating, setGenerating] = useState(false);
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);
  const generate = async () => {
    setGenerating(true);
    setGenerationMessage(null);
    try {
      const token = await getToken();
      const response = await fetch('/api/predictions/generate', { method: 'POST', credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Official snapshot generation was rejected');
      const skipped = (body.skippedNoVector ?? 0) + (body.skippedNoHomeTeam ?? 0) + (body.skippedNonFinite ?? 0);
      const diagnostic = body.firstNonFinite ? ` Diagnostic: ${JSON.stringify(body.firstNonFinite)}` : '';
      setGenerationMessage(`${body.snapshotsCreated ?? 0} immutable snapshot${body.snapshotsCreated === 1 ? '' : 's'} created across ${body.gamesConsidered ?? 0} upcoming games.${skipped ? ` ${skipped} game${skipped === 1 ? '' : 's'} skipped.${diagnostic}` : ''}`);
      await board.refetch();
    } catch (error) {
      setGenerationMessage(error instanceof Error ? error.message : 'Official snapshot generation failed');
    } finally {
      setGenerating(false);
    }
  };
  return <><PageHeader eyebrow="Production / Phase 5" title="Live predictions" detail="Immutable pre-kickoff snapshots generated only from explicitly promoted production models." actions={<div className="flex flex-wrap gap-2"><button type="button" className="button button-subtle" onClick={() => board.refetch()}><RefreshCw className={cx('h-4 w-4', board.isFetching && 'animate-spin')} /> Refresh</button><button type="button" className="button button-primary" onClick={generate} disabled={generating}>{generating ? 'Generating…' : 'Generate official snapshots'}</button></div>} /><div className="readiness-header"><div className="readiness-header-icon"><ShieldCheck className="h-5 w-5" /></div><div><p className="eyebrow text-accent">AUDIT RULES</p><h2 className="text-lg font-semibold text-ink">No recommendation layer is attached.</h2><p className="mt-1 text-sm text-muted-foreground">Model-versus-market edges, no-vig probabilities, and CLV are displayed as measured fields. Gridline does not choose a side, size a wager, or automate wagering.</p>{generationMessage && <p className="mt-2 text-xs font-semibold text-accent">{generationMessage}</p>}</div></div><CurrentWeekReport />{board.isLoading ? <LoadingPanel label="Loading production snapshots" /> : board.isError ? <ErrorPanel message="The production prediction board could not be loaded." /> : predictions.length ? <div className="mt-5 grid gap-4 xl:grid-cols-2">{predictions.map((prediction: any) => { const comparison = prediction.marketComparison ?? {}; const market = prediction.marketSnapshot?.markets ?? {}; const quoteLabel = (quote: any) => quote ? `${quote.point ?? 'ML'} ${quote.price > 0 ? `+${quote.price}` : quote.price}` : '—'; return <Panel key={prediction.id} eyebrow={prediction.snapshotLabel} title={prediction.gameId} action={<StatusPill status="success">Pre-kickoff</StatusPill>}><div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4"><div><p className="eyebrow">Kickoff</p><p className="mt-1 text-ink">{formatDate(prediction.kickoffTime, true)}</p></div><div><p className="eyebrow">Projected score</p><p className="mt-1 font-mono text-ink">{prediction.projectedHomeScore?.toFixed(1)}–{prediction.projectedAwayScore?.toFixed(1)}</p></div><div><p className="eyebrow">Margin / total</p><p className="mt-1 font-mono text-ink">{prediction.projectedMargin?.toFixed(1)} / {prediction.projectedTotal?.toFixed(1)}</p></div><div><p className="eyebrow">Home win probability</p><p className="mt-1 font-mono text-ink">{formatPercent((prediction.homeWinProbability ?? 0) * 100)}</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-3"><div className="rounded-lg border border-border bg-secondary/30 p-3"><p className="eyebrow">Spread edge</p><p className="mt-1 font-mono text-ink">{comparison.spread?.pointEdge === null || comparison.spread?.pointEdge === undefined ? 'Unavailable' : `${comparison.spread.pointEdge.toFixed(2)} pts`}</p></div><div className="rounded-lg border border-border bg-secondary/30 p-3"><p className="eyebrow">Moneyline edge</p><p className="mt-1 font-mono text-ink">{comparison.moneyline?.homeProbabilityEdge === null || comparison.moneyline?.homeProbabilityEdge === undefined ? 'Unavailable' : formatPercent(comparison.moneyline.homeProbabilityEdge * 100)}</p></div><div className="rounded-lg border border-border bg-secondary/30 p-3"><p className="eyebrow">Total edge</p><p className="mt-1 font-mono text-ink">{comparison.totals?.pointEdge === null || comparison.totals?.pointEdge === undefined ? 'Unavailable' : `${comparison.totals.pointEdge.toFixed(2)} pts`}</p></div></div><div className="mt-4 rounded-lg border border-border bg-secondary/20 p-3"><p className="eyebrow">DraftKings / FanDuel comparison</p><div className="mt-2 grid grid-cols-3 gap-2 text-[11px]"><div><span className="text-muted-foreground">Spread</span><p className="font-mono text-ink">{quoteLabel(market.spread?.draftKings)} / {quoteLabel(market.spread?.fanDuel)}</p></div><div><span className="text-muted-foreground">Moneyline</span><p className="font-mono text-ink">{quoteLabel(market.moneyline?.draftKings)} / {quoteLabel(market.moneyline?.fanDuel)}</p></div><div><span className="text-muted-foreground">Total</span><p className="font-mono text-ink">{quoteLabel(market.total?.draftKings)} / {quoteLabel(market.total?.fanDuel)}</p></div></div><p className="mt-2 text-[11px] text-muted-foreground">No-vig home probability: {typeof market.moneyline?.noVigHomeProbability === 'number' ? formatPercent(market.moneyline.noVigHomeProbability * 100) : 'Unavailable'}</p></div><p className="mt-4 text-[11px] text-muted-foreground">Feature {prediction.featureVersion} · training {prediction.trainingCutoff} · {prediction.lowSample ? 'low-sample feature row' : 'standard sample row'} · QB confidence {prediction.qbConfidence === null ? 'unavailable' : prediction.qbConfidence.toFixed(2)}</p></Panel>; })}</div> : <Panel eyebrow="Production / Phase 5" title="No live snapshots yet"><EmptyPanel title="No official production snapshots are available" detail="Promote one spread, moneyline, and totals model in Model Lab, then run the worker or the protected generation endpoint. Challenger results never appear here." icon={Target} /></Panel>}</>;
}

function Performance() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 30000 } });
  const phase5 = useQuery({ queryKey: ['prediction-performance'], queryFn: async () => { const response = await fetch('/api/predictions/performance', { credentials: 'include' }); if (!response.ok) throw new Error('Prediction performance unavailable'); return response.json() as Promise<any>; }, staleTime: 30000 });
  const data = summary.data;
  const cards = [{ name: 'ATS', value: data?.ats, icon: Target }, { name: 'Moneyline', value: data?.moneyline, icon: TrendingUp }, { name: 'Totals', value: data?.totals, icon: Gauge }, { name: 'CLV', value: data?.averageClv, icon: LineChart }];
  const phase5Family = phase5.data?.byFamily ?? {};
  const breakdown = phase5.data?.breakdowns?.season ?? [];
  const phase5Breakdowns = phase5.data?.breakdowns ?? {};
  return <><PageHeader eyebrow="Review" title="Performance" detail="Track official prediction snapshots by market. Empty means unmeasured, not zero." /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{cards.map(({ name, value, icon: Icon }) => <div className="performance-card" key={name}><div className="flex items-center justify-between"><span className="eyebrow">{name}</span><Icon className="h-4 w-4 text-accent" /></div>{name === 'CLV' ? <><div className="mt-5 font-display text-3xl font-semibold text-ink">{formatPercent(value as number | null | undefined)}</div><p className="mt-2 text-xs text-muted-foreground">Legacy ledger field</p></> : <><div className="mt-5 font-display text-3xl font-semibold text-ink">{summary.isLoading ? '—' : (value as any)?.record || '—'}</div><p className="mt-2 text-xs text-muted-foreground">{formatPercent((value as any)?.winRate)} win rate</p></>}</div>)}</div><Panel eyebrow="Phase 5 / Official snapshots" title="Model performance" className="mt-5"><div className="grid gap-4 md:grid-cols-3">{[{ key: 'spread', label: 'Spread', metric: phase5Family.spread?.mae, suffix: 'MAE pts' }, { key: 'moneyline', label: 'Moneyline', metric: typeof phase5Family.moneyline?.accuracy === 'number' ? phase5Family.moneyline.accuracy * 100 : null, suffix: 'accuracy' }, { key: 'totals', label: 'Totals', metric: phase5Family.totals?.mae, suffix: 'MAE pts' }].map((item) => <div className="rounded-lg border border-border bg-secondary/30 p-4" key={item.key}><p className="eyebrow">{item.label}</p><p className="mt-2 font-display text-2xl font-semibold text-ink">{item.metric === null || item.metric === undefined ? '—' : item.metric.toFixed(2)}</p><p className="mt-1 text-xs text-muted-foreground">{item.suffix} · {phase5Family[item.key]?.predictions ?? 0} graded</p></div>)}</div><p className="mt-4 text-xs leading-5 text-muted-foreground">{phase5.data?.note ?? 'Market metrics are only measured when legitimate pre-prediction and closing Gridline quotes exist. No synthetic lines or betting units are added.'}</p></Panel><Panel eyebrow="Breakdowns" title="By season" className="mt-5"><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead><tr className="border-b border-border text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><th className="px-3 py-3">Season</th><th className="px-3 py-3">Predictions</th><th className="px-3 py-3">Spread MAE</th><th className="px-3 py-3">Totals MAE</th><th className="px-3 py-3">Moneyline accuracy</th><th className="px-3 py-3">Avg CLV</th></tr></thead><tbody>{breakdown.map((row: any) => <tr className="border-b border-border/70" key={row.group}><td className="px-3 py-3 font-semibold text-ink">{row.group}</td><td className="px-3 py-3">{row.predictions}</td><td className="px-3 py-3 font-mono">{row.spreadMae === null ? '—' : row.spreadMae.toFixed(2)}</td><td className="px-3 py-3 font-mono">{row.totalsMae === null ? '—' : row.totalsMae.toFixed(2)}</td><td className="px-3 py-3 font-mono">{typeof row.moneylineAccuracy === 'number' ? formatPercent(row.moneylineAccuracy * 100) : '—'}</td><td className="px-3 py-3 font-mono">{row.avgClv === null ? '—' : row.avgClv.toFixed(2)}</td></tr>)}</tbody></table>{!breakdown.length && <EmptyPanel title="No graded production snapshots" detail="Official final predictions are frozen at kickoff and graded only after a persisted final score is available." icon={BarChart3} />}</div></Panel><div className="mt-5 grid gap-5 xl:grid-cols-2">{[['Home / away', 'homeAway'], ['Favorite / underdog', 'favoriteUnderdog'], ['Edge bucket', 'edge'], ['Sample quality', 'sampleQuality'], ['QB confidence', 'qbConfidence'], ['Model version', 'model']].map(([label, key]) => <Panel key={key} eyebrow="Coverage" title={label}><div className="space-y-2">{(phase5Breakdowns[key] ?? []).map((row: any) => <div className="flex items-center justify-between gap-3 border-b border-border/70 py-2 text-xs last:border-0"><span className="font-semibold text-ink">{row.group}</span><span className="text-muted-foreground">{row.predictions} graded · {row.spreadMae === null ? '—' : `${row.spreadMae.toFixed(2)} spread MAE`}</span></div>)}{!(phase5Breakdowns[key] ?? []).length && <p className="text-xs text-muted-foreground">No graded snapshots yet.</p>}</div></Panel>)}</div></>;
}

function ReadinessPage({ eyebrow, title, detail, icon: Icon, blocks }: { eyebrow: string; title: string; detail: string; icon: IconType; blocks: string[] }) {
  return <><PageHeader eyebrow={eyebrow} title={title} detail={detail} /><div className="feature-intro"><div className="feature-intro-icon"><Icon className="h-6 w-6" /></div><div><p className="eyebrow text-accent">STATUS / NOT TRAINED</p><h2 className="text-xl font-semibold text-ink">The workspace is ready. The evidence is not here yet.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">No records are invented while the pipeline is being wired. This page reserves the workflow and makes the missing capture visible.</p></div></div><div className="mt-5 grid gap-4 md:grid-cols-3">{blocks.map((block, index) => <div className="feature-block" key={block}><span className="feature-number">0{index + 1}</span><h3>{block}</h3><StatusPill status="not_configured">Not populated</StatusPill><p>Awaiting the corresponding API surface and a verified capture.</p></div>)}</div><Panel eyebrow="Next checkpoint" title="What unlocks this page" className="mt-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><LockKeyhole className="h-5 w-5" /></div><p className="text-sm leading-6 text-muted-foreground">A trained model and historical records must exist before this view can publish an interpretation. The empty state is deliberate so a bettor can distinguish a missing feed from a weak signal.</p></div></Panel></>;
}

function SettingsPage() {
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), staleTime: 60000 } });
  const update = useUpdateSettings();
  const client = useQueryClient();
  const [sportsbooks, setSportsbooks] = useState<string[]>([]);
  const [minimumEdge, setMinimumEdge] = useState('0');
  const [minimumConfidence, setMinimumConfidence] = useState('0');
  const [unitSize, setUnitSize] = useState('1');
  const [kellyEnabled, setKellyEnabled] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!settings.data) return;
    setSportsbooks(settings.data.sportsbooks ?? []);
    setMinimumEdge(String(settings.data.minimumEdge ?? 0));
    setMinimumConfidence(String(settings.data.minimumConfidence ?? 0));
    setUnitSize(String(settings.data.unitSize ?? 1));
    setKellyEnabled(Boolean(settings.data.kellyEnabled));
  }, [settings.data]);
  const toggleBook = (book: string) => setSportsbooks((current) => current.includes(book) ? current.filter((item) => item !== book) : [...current, book]);
  const save = () => {
    update.mutate({ data: { sportsbooks: sportsbooks as any, minimumEdge: Number(minimumEdge), minimumConfidence: Number(minimumConfidence), unitSize: Number(unitSize), kellyEnabled } }, { onSuccess: (next) => { client.setQueryData(getGetSettingsQueryKey(), next); setSaved(true); window.setTimeout(() => setSaved(false), 2400); } });
  };
  if (settings.isLoading) return <><PageHeader eyebrow="Configuration" title="Settings" detail="Control what the workspace considers actionable." /><LoadingPanel /></>;
  if (settings.isError || !settings.data) return <><PageHeader eyebrow="Configuration" title="Settings" detail="Control what the workspace considers actionable." /><ErrorPanel /></>;
  return <><PageHeader eyebrow="Configuration" title="Settings" detail="Control what the workspace considers actionable." actions={<button type="button" className="button button-primary" onClick={save} disabled={update.isPending} data-testid="button-save-settings">{update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}{saved ? 'Saved' : 'Save settings'}</button>} /><div className="settings-layout"><Panel eyebrow="Market inputs" title="Sportsbooks" action={<span className="section-meta">{sportsbooks.length} selected</span>}><p className="mb-4 text-sm leading-6 text-muted-foreground">Select the books that should be considered when a market snapshot is assembled.</p><div className="book-grid">{['DraftKings', 'FanDuel'].map((book) => <button type="button" key={book} onClick={() => toggleBook(book)} className={cx('book-toggle', sportsbooks.includes(book) && 'book-toggle-active')} data-testid={`button-toggle-${book.toLowerCase()}`}><span className="book-logo">{book === 'DraftKings' ? 'DK' : 'FD'}</span><span>{book}</span>{sportsbooks.includes(book) ? <Check className="ml-auto h-4 w-4 text-accent" /> : <span className="ml-auto h-4 w-4 rounded-full border border-border" />}</button>)}</div><div className="settings-divider" /><div className="flex items-start gap-3"><div className="provider-mark provider-neutral"><LockKeyhole className="h-4 w-4" /></div><div><p className="text-sm font-semibold text-ink">Odds API connection</p><p className="mt-1 text-xs text-muted-foreground">Secrets stay server-side. Configuration status is the only value exposed here.</p></div><StatusPill status={settings.data.oddsApiConfigured ? 'current' : 'not_configured'}>{settings.data.oddsApiConfigured ? 'Configured' : 'Not configured'}</StatusPill></div></Panel><Panel eyebrow="Decision rules" title="Thresholds"><div className="settings-form"><label className="field-label" htmlFor="minimum-edge">Minimum edge<span>percentage points</span></label><input id="minimum-edge" data-testid="input-minimum-edge" className="field-input" type="number" min="0" step="0.1" value={minimumEdge} onChange={(event) => setMinimumEdge(event.target.value)} /><p className="field-help">Only edges at or above this threshold can be surfaced.</p><label className="field-label" htmlFor="minimum-confidence">Minimum confidence<span>0–100</span></label><input id="minimum-confidence" data-testid="input-minimum-confidence" className="field-input" type="number" min="0" max="100" step="1" value={minimumConfidence} onChange={(event) => setMinimumConfidence(event.target.value)} /><p className="field-help">Sets the minimum confidence gate for any future model output.</p><label className="field-label" htmlFor="unit-size">Unit size<span>accounting unit</span></label><input id="unit-size" data-testid="input-unit-size" className="field-input" type="number" min="0.1" step="0.1" value={unitSize} onChange={(event) => setUnitSize(event.target.value)} /><p className="field-help">Used for ledger display, never treated as bankroll advice.</p><div className="toggle-line"><div><p className="text-sm font-semibold text-ink">Kelly sizing</p><p className="mt-1 text-xs text-muted-foreground">Keep disabled until model calibration and bankroll policy are verified.</p></div><button type="button" role="switch" aria-checked={kellyEnabled} onClick={() => setKellyEnabled((value) => !value)} className={cx('switch', kellyEnabled && 'switch-on')} data-testid="button-toggle-kelly"><span /></button></div></div></Panel></div><div className="callout callout-neutral mt-5"><ShieldCheck className="h-4 w-4 shrink-0 text-accent" /><p><strong>Configuration is not a prediction.</strong> These values shape future model gates and market selection; they do not create an edge while the model is untrained.</p></div></>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/sign-in/*?" component={() => <div className="flex min-h-screen items-center justify-center bg-[#f4f1ea] p-4"><SignIn routing="path" path={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/sign-in`} signUpUrl={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/sign-up`} /></div>} /><Route path="/sign-up/*?" component={() => <div className="flex min-h-screen items-center justify-center bg-[#f4f1ea] p-4"><SignUp routing="path" path={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/sign-up`} signInUrl={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/sign-in`} /></div>} /><Route><Shell><Switch><Route path="/" component={Dashboard} /><Route path="/this-week" component={ThisWeek} /><Route path="/games/:gameId" component={GameDetail} /><Route path="/live-predictions" component={LivePredictions} /><Route path="/data-health"><HealthPage kind="data-health" eyebrow="System / Observability" title="Data health" detail="Freshness, configuration, and capture status for every provider." /></Route><Route path="/feature-audit" component={FeatureAuditPage} /><Route path="/personnel-context" component={PersonnelContextPage} /><Route path="/odds" component={OddsBoard} /><Route path="/line-movement"><HealthPage kind="line-movement" eyebrow="Workspace / Market data" title="Line movement" detail="Historical capture for open, current, and closing prices. Open a game from the Odds board to inspect every preserved change." preferred="odds" /></Route><Route path="/injuries"><HealthPage kind="injuries" eyebrow="Signals / Availability" title="Injuries" detail="Freshness and meaningful availability readiness for each slate." preferred="injur" /></Route><Route path="/depth-charts"><HealthPage kind="depth-charts" eyebrow="Signals / Availability" title="Depth charts" detail="Snapshot readiness for role and personnel context." preferred="depth" /></Route><Route path="/backtesting" component={Backtesting} /><Route path="/model-lab" component={ModelLab} /><Route path="/performance" component={Performance} /><Route path="/settings" component={SettingsPage} /><Route component={NotFound} /></Switch></Shell></Route></Switch></RoutedErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;

function ScheduledRuns({ runs }: { runs?: ScheduledDataHealthRun[] }) {
  if (!runs?.length) return null;
  const visibleRuns = runs.slice(0, 4);
  return (
    <div className="scheduled-runs">
      <div className="scheduled-runs-heading">
        <span>Scheduled feed attempts</span>
        <strong>{runs.length} recent</strong>
      </div>
      <div className="scheduled-run-list">{visibleRuns.map((run) => <ScheduledRunRow key={run.id} run={run} />)}</div>
      {runs.length > visibleRuns.length && (
        <details className="scheduled-runs-more">
          <summary>Show {runs.length - visibleRuns.length} older attempts</summary>
          <div className="scheduled-run-list">{runs.slice(visibleRuns.length).map((run) => <ScheduledRunRow key={run.id} run={run} />)}</div>
        </details>
      )}
    </div>
  );
}

function ScheduledRunRow({ run }: { run: ScheduledDataHealthRun }) {
  return (
    <div className="scheduled-run-row">
      <div className="min-w-0">
        <StatusPill status={run.status}>{formatStatusLabel(run.status)}</StatusPill>
        {run.error && <p className="scheduled-run-error">{run.error}</p>}
      </div>
      <div className="scheduled-run-time"><span>Started</span><strong>{formatDate(run.startedAt, true)}</strong></div>
      <div className="scheduled-run-time"><span>Completed</span><strong>{run.completedAt ? formatDate(run.completedAt, true) : 'In progress'}</strong></div>
    </div>
  );
}
