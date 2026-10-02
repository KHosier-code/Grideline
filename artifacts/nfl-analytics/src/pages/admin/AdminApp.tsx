import { lazy, type ReactNode, useEffect, useMemo, useState } from 'react';
import { UserButton, useAuth } from '@clerk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, Bell, CalendarDays, Check, ChevronRight, Clock3, Database, FileSearch, ChartNoAxesColumnIncreasing, LayoutDashboard, LineChart, ListFilter, Loader2, LockKeyhole, Menu, RefreshCw, Save, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Target, TrendingUp, UserRound, X } from 'lucide-react';
import {
  getGetDashboardSummaryQueryKey,
  getGetDataHealthQueryKey,
  getGetScheduleStatusHealthQueryKey,
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
  useGetScheduleStatusHealth,
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
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import NotFound from '@/pages/not-found';
import { useAdminStatus } from '@/hooks/use-admin-status';


import { ConsumerLoadingFallback, ConsumerShell, ThemeToggle } from '@/components/ConsumerShell';

const UsageAnalytics = lazy(() => import('@/pages/admin/UsageAnalytics'));

const ImageryReview = lazy(() => import('@/pages/admin/ImageryReview'));
const AdminDepthChart = lazy(() => import('@/components/AdminDepthChart').then(module => ({ default: module.AdminDepthChart })));
const AdminPlayerStatsImport = lazy(() => import('@/components/AdminPlayerStatsImport').then(module => ({ default: module.AdminPlayerStatsImport })));


type IconType = typeof Activity;

const navGroups = [
  {
    label: 'Workspace',
    items: [
      { href: '/', label: 'Overview', icon: LayoutDashboard },
      { href: '/this-week', label: 'This week', icon: CalendarDays },
      { href: '/odds', label: 'Odds board', icon: SlidersHorizontal },
      { href: '/line-movement', label: 'Line movement', icon: LineChart },
    ],
  },
  {
    label: 'Signals',
    items: [
      { href: '/injuries', label: 'Injuries', icon: Activity },
      { href: '/depth-charts', label: 'Depth charts', icon: ListFilter },
    ],
  },
  {
    label: 'Review',
    items: [
      { href: '/data-health', label: 'Data health', icon: Database },
      { href: '/imagery-review', label: 'Image review', icon: UserRound },
      { href: '/feature-audit', label: 'Feature audit', icon: FileSearch },
      { href: '/personnel-context', label: 'Personnel & context', icon: UserRound },
      { href: '/usage-analytics', label: 'Usage analytics', icon: ChartNoAxesColumnIncreasing },
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
  if (status === 'current' || status === 'available' || status === 'healthy' || status === 'success' || status === 'on_time') return 'good';
  if (status === 'stale' || status === 'warning' || status === 'running' || status === 'partial' || status === 'pending') return 'warn';
  if (status === 'not_configured' || status === 'not_trained' || status === 'spread' || status === 'moneyline' || status === 'totals') return 'neutral';
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
  const cleanupState = (item.provider === 'usage-analytics-retention' || item.provider === 'player-recovery-receipt-cleanup')
    && (item.metadata?.cleanupState === 'pending' || item.metadata?.cleanupState === 'on_time' || item.metadata?.cleanupState === 'overdue')
    ? item.metadata.cleanupState
    : null;
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
            {cleanupState && <StatusPill status={cleanupState}>{cleanupState === 'on_time' ? 'On time' : cleanupState === 'overdue' ? 'Overdue' : 'Pending'}</StatusPill>}
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

function DatabaseCapacityNotice({ item }: { item?: DataHealth }) {
  if (!item) return null;

  const capacityStatus = item.metadata?.capacityStatus;
  const affectedHealthChecks = Array.isArray(item.metadata?.affectedHealthChecks)
    ? item.metadata.affectedHealthChecks.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  const isDegraded = capacityStatus === 'degraded';
  const isUnknown = capacityStatus === 'unknown';
  if (!isDegraded && !isUnknown) return null;

  return (
    <div
      className={cx(
        'callout',
        isDegraded ? 'callout-warn' : 'callout-neutral',
        'mb-5',
      )}
      data-testid={`database-capacity-${capacityStatus}`}
    >
      {isDegraded ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : (
        <Database className="h-4 w-4 shrink-0" />
      )}
      <div>
        <strong>
          {isDegraded
            ? 'Database capacity is degraded.'
            : 'Database capacity is unknown.'}
        </strong>
        <p>{item.detail}</p>
        {isDegraded && affectedHealthChecks.length > 0 && (
          <p className="mt-1">
            <strong>Affected checks:</strong>{' '}
            {affectedHealthChecks.join(', ')}.
          </p>
        )}
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
          <Link href="/admin" className="brand" data-testid="link-home">
            <span className="brand-wordmark-frame"><img src={`${import.meta.env.BASE_URL}logo-wordmark.png`} alt="Gridline NFL Analytics" /></span>
          </Link>
          <button type="button" className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation"><X className="h-5 w-5" /></button>
        </div>
        <div className="sidebar-scroll">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map((item) => {
                const href = item.href === '/' ? '/admin' : `/admin${item.href}`;
                const active = location === href || (href !== '/admin' && location.startsWith(href));
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={href} onClick={() => setMobileOpen(false)} className={cx('nav-item', active && 'nav-item-active')} data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}>
                    <Icon className="h-[17px] w-[17px]" /><span>{item.label}</span>{active && <ChevronRight className="ml-auto h-3.5 w-3.5" />}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <ThemeToggle className="sidebar-theme-toggle" />
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
          <Link href="/admin" className="brand brand-mobile" data-testid="link-mobile-home"><img src={`${import.meta.env.BASE_URL}logo-icon.png`} alt="Gridline" className="h-5 w-5" /><strong>Gridline</strong></Link>
          <span className="ml-auto"><ThemeToggle /></span>
        </div>
        <div className="topbar">
          <div className="topbar-context"><span className="live-kicker"><span className="live-pulse" />CONTROL ROOM</span><span className="topbar-divider" />{new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</div>
          <div className="topbar-actions"><ThemeToggle /><Link href="/" className="button button-subtle">Consumer view</Link><button type="button" className="icon-button" aria-label="Notifications" data-testid="button-notifications"><Bell className="h-4 w-4" /><span className="notification-dot" /></button>{isSignedIn ? <UserButton appearance={{ elements: { avatarBox: 'grayscale saturate-0' } }} /> : <Link href="/sign-in" className="button button-subtle" data-testid="link-sign-in">Sign in</Link>}<Link href="/admin/settings" className="avatar-link" aria-label="Open settings" data-testid="link-settings-quick"><span className="user-avatar user-avatar-small">A</span></Link></div>
        </div>
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const admin = useAdminStatus();
  if (admin.isLoading) return <ConsumerLoadingFallback />;
  if (admin.data !== true) return <ConsumerShell><div className="consumer-state"><LockKeyhole className="h-7 w-7" /><h2>Administrator access required</h2><p>This workspace is available only to authorized administrators.</p><Link className="button button-primary" href="/">Return home</Link></div></ConsumerShell>;
  return <Shell>{children}</Shell>;
}

function Dashboard() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 30000 } });
  const health = useGetDataHealth({ query: { queryKey: getGetDataHealthQueryKey(), staleTime: 30000, refetchInterval: 60000 } });
  const scheduleParams = {
    season: summary.data?.season ?? new Date().getFullYear(),
    week: summary.data?.currentWeek ?? 1,
  };
  const upcoming = useListGames(scheduleParams, {
    query: {
      enabled: Boolean(summary.data?.currentWeek),
      queryKey: getListGamesQueryKey(scheduleParams),
      staleTime: 30000,
    },
  });
  if (summary.isLoading) return <><PageHeader eyebrow="Overview" title="The weekly read" detail="A clear view of the current market before you make a decision." /><div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div><div className="mt-5"><LoadingPanel /></div></>;
  if (summary.isError || !summary.data) return <><PageHeader eyebrow="Overview" title="The weekly read" detail="A clear view of the current market before you make a decision." /><ErrorPanel /></>;
  const data = summary.data;
  return (
    <>
      <PageHeader eyebrow={`Season ${data.season} / Week ${data.currentWeek ?? '—'}`} title="The weekly read" detail="A clear view of the current market before you make a decision." actions={<Link href="/admin/this-week" className="button button-primary" data-testid="link-view-week"><CalendarDays className="h-4 w-4" /> View this week</Link>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Games this week" value={String(data.gamesThisWeek)} detail={`Week ${data.currentWeek ?? '—'} schedule`} icon={CalendarDays} accent />
      </div>
      <Panel eyebrow="Schedule" title="Upcoming matchups" className="mt-5" action={<Link href="/admin/this-week" className="text-xs font-semibold text-accent hover:underline" data-testid="link-full-schedule">View full schedule</Link>}>
        {upcoming.isLoading ? <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : upcoming.isError ? <ErrorPanel message="The current week schedule is temporarily unavailable." /> : upcoming.data?.length ? <div className="game-list">{upcoming.data.slice(0, 4).map((game) => <GameRow key={game.gameId} game={game} />)}</div> : <EmptyPanel title="No upcoming matchups available" detail="The schedule will appear here when current-week games are available from the data service." icon={CalendarDays} />}
      </Panel>
      <Panel eyebrow="Data observability" title="Freshness" className="mt-5" action={<Link href="/admin/data-health" className="text-xs font-semibold text-accent hover:underline" data-testid="link-data-health">View health</Link>}>
        {health.isLoading ? <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : health.isError ? <ErrorPanel message="Provider health is temporarily unavailable." /> : health.data?.length ? <div className="space-y-3">{health.data.slice(0, 4).map((item) => <FreshnessCard key={item.provider} item={item} />)}</div> : <EmptyPanel title="No provider checks yet" detail="Health records will appear when the first provider sync is captured." icon={Database} />}
      </Panel>
    </>
  );
}

function GameRow({ game }: { game: any }) {
  const isFinal = ['final', 'completed'].includes(String(game.gameStatus).toLowerCase());
  return (
    <Link href={`/admin/games/${game.gameId}`} className="game-row" data-testid={`link-game-${game.gameId}`}>
      <div className="game-date"><span>{formatDate(game.gameDate)}</span><small>{game.kickoffTime ? formatDate(game.kickoffTime, true) : 'Time TBD'}</small></div>
      <div className="matchup"><div className="team-side"><span className="team-abbr">{game.awayTeam.abbreviation}</span><span>{game.awayTeam.teamName}</span></div><span className="at-mark">@</span><div className="team-side team-home"><span className="team-abbr">{game.homeTeam.abbreviation}</span><span>{game.homeTeam.teamName}</span></div></div>
      <div className="hidden text-xs text-muted-foreground lg:block">{game.venue || 'Venue pending'}{game.broadcast ? <><br /><span className="font-mono text-[10px]">{game.broadcast}</span></> : null}</div>
      <div className="game-score">{isFinal ? <><span>{game.finalAwayScore ?? '—'} — {game.finalHomeScore ?? '—'}</span><small>FINAL</small></> : <><span>{game.latestOdds?.length ?? 0}</span><small>QUOTES</small></>}</div>
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
      <div className="signal-strip"><div><span className="strip-label">SCHEDULE COVERAGE</span><strong>{games.data?.length ?? '—'} games</strong></div><div><span className="strip-label">TEAM INDEX</span><strong>{teams.data?.length ?? '—'} teams</strong></div><div className="hidden md:block"><span className="strip-label">CAPTURE WINDOW</span><strong>Current quotes</strong></div></div>
      <Panel className="mt-5" title="Current-week slate" eyebrow="Market board" action={<span className="section-meta">Click a game for detail</span>}>
        {games.isLoading ? <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : games.isError ? <ErrorPanel /> : games.data?.length ? <div className="game-list">{games.data.map((game) => <GameRow key={game.gameId} game={game} />)}</div> : <EmptyPanel title="No games returned for this week" detail="The live schedule is empty for the current season and week. Check the API connection or return when the schedule is published." icon={CalendarDays} />}
      </Panel>
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
        {games.isLoading ? <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div> : games.isError ? <ErrorPanel /> : games.data?.length ? <div className="space-y-5">{games.data.map((game) => <div className="rounded-xl border border-border p-4" key={game.gameId}><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold text-ink">{game.awayTeam.abbreviation} at {game.homeTeam.abbreviation}</p><p className="mt-1 text-xs text-muted-foreground">{game.kickoffTime ? formatDate(String(game.kickoffTime), true) : 'Kickoff TBD'} · {game.latestOdds?.length ?? 0} current quotes</p></div><Link href={`/admin/games/${game.gameId}`} className="text-xs font-semibold text-accent hover:underline">History & detail <ChevronRight className="inline h-3 w-3" /></Link></div><OddsMarketTable quotes={(game.latestOdds ?? []) as any[]} /></div>)}</div> : <EmptyPanel title="No games returned for this week" detail="The live schedule is empty, so no sportsbook market can be safely matched." icon={CalendarDays} />}
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
  if (game.isLoading) return <><PageHeader eyebrow="Game detail" title="Loading game" detail="Resolving the latest game record." /><LoadingPanel /></>;
  if (game.isError || !game.data) return <><PageHeader eyebrow="Game detail" title="Game unavailable" detail={`Could not resolve ${gameId}.`} /><ErrorPanel /></>;
  const item = game.data;
  const odds = item.latestOdds ?? [];
  return (
    <>
      <PageHeader eyebrow={`Week ${item.week} / ${formatDate(item.gameDate)}`} title={`${item.awayTeam.abbreviation} at ${item.homeTeam.abbreviation}`} detail={`${item.awayTeam.teamName} at ${item.homeTeam.teamName}${item.venue ? ` · ${item.venue}` : ''}`} actions={<Link href="/admin/this-week" className="button button-subtle" data-testid="link-back-week"><ChevronRight className="h-4 w-4 rotate-180" /> Back to slate</Link>} />
      <div className="game-hero"><div className="hero-team"><span className="hero-abbr">{item.awayTeam.abbreviation}</span><span>{item.awayTeam.teamName}</span><small>AWAY</small></div><div className="hero-center"><span className="hero-at">@</span><StatusPill status={item.gameStatus}>{item.gameStatus}</StatusPill><span className="text-xs text-sidebar-foreground/55">{item.kickoffTime ? formatDate(item.kickoffTime, true) : 'Kickoff TBD'}</span></div><div className="hero-team hero-team-right"><span className="hero-abbr">{item.homeTeam.abbreviation}</span><span>{item.homeTeam.teamName}</span><small>HOME</small></div></div>
      <div className="mt-5">
        <Panel eyebrow="Current market" title="Latest odds" action={<span className="section-meta">{odds.length} quotes</span>}>
          {odds.length ? <div className="odds-table"><div className="odds-head"><span>Book</span><span>Market</span><span>Selection</span><span>Point</span><span>Price</span></div>{odds.map((quote, index) => <div className="odds-row" key={`${quote.sportsbook}-${quote.market}-${quote.selection}-${index}`}><span className="font-semibold text-ink">{quote.sportsbook}</span><span>{quote.market}</span><span>{quote.selection}</span><span>{quote.point ?? '—'}</span><span className="font-mono font-medium text-ink">{quote.price > 0 ? `+${quote.price}` : quote.price}</span></div>)}</div> : <EmptyPanel title="No odds captured yet" detail="This game has a schedule record, but no current sportsbook quotes are attached to it." icon={SlidersHorizontal} />}
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
  const scheduleStatuses = useGetScheduleStatusHealth({
    query: { queryKey: getGetScheduleStatusHealthQueryKey(), enabled: kind === 'data-health', staleTime: 30000, refetchInterval: kind === 'data-health' ? 60000 : false },
  });
  const focused = useMemo(() => preferred ? health.data?.filter((item) => `${item.provider} ${item.label}`.toLowerCase().includes(preferred)) : health.data, [health.data, preferred]);
  const databaseCapacity = health.data?.find((item) => item.provider === 'database-capacity');
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
      <PageHeader eyebrow={eyebrow} title={title} detail={detail} actions={<button type="button" className="button button-subtle" onClick={() => { void health.refetch(); if (kind === 'data-health') void scheduleStatuses.refetch(); }} data-testid={`button-refresh-${kind}`}><RefreshCw className={cx('h-4 w-4', (health.isFetching || scheduleStatuses.isFetching) && 'animate-spin')} /> Refresh</button>} />
      {kind === 'data-health' && <><DatabaseCapacityNotice item={databaseCapacity} /><AdminPlayerStatsImport /></>}
      {kind === 'data-health' && <Panel eyebrow="Schedule audit" title="Unfamiliar game statuses" className="mb-5" action={scheduleStatuses.data && <span className="section-meta">{scheduleStatuses.data.unknownCount} affected games</span>}>
        {scheduleStatuses.isLoading ? <Skeleton className="h-24" /> : scheduleStatuses.isError || !scheduleStatuses.data
          ? <ErrorPanel message="The schedule status audit could not be loaded. Try refreshing." />
          : <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">Supported categories: <strong className="text-ink">{scheduleStatuses.data.supportedCategories.join(' · ')}</strong>. Unfamiliar values are separate from these categories.</p>
              {scheduleStatuses.data.unknownCount === 0
                ? <p className="text-ink">No unfamiliar statuses in the persisted schedule.</p>
                : <>
                    <p className="font-semibold text-ink"><AlertTriangle className="mr-2 inline h-4 w-4 text-amber-500" />{scheduleStatuses.data.unknownCount} game{scheduleStatuses.data.unknownCount === 1 ? '' : 's'} need status review</p>
                    <div className="grid gap-5 md:grid-cols-2">
                      <div><h3 className="mb-2 font-semibold text-ink">Status examples (up to 5)</h3><ul className="space-y-2">{scheduleStatuses.data.examples.map((example, index) => <li key={index} className="rounded-md border p-3"><code className="break-all text-ink">{example.status}</code><span className="ml-2 text-muted-foreground">Unknown · {example.count} game{example.count === 1 ? '' : 's'} · latest {example.season} W{example.week}</span></li>)}</ul></div>
                      <div><h3 className="mb-2 font-semibold text-ink">Recent affected slates (up to 8)</h3><ul className="space-y-2">{scheduleStatuses.data.recentSlates.map((slate) => <li key={`${slate.season}-${slate.week}`} className="rounded-md border p-3 text-ink">{slate.season} · Week {slate.week}<span className="ml-2 text-muted-foreground">{slate.count} affected game{slate.count === 1 ? '' : 's'}</span></li>)}</ul></div>
                    </div>
                  </>}
              <p className="text-muted-foreground">{scheduleStatuses.data.guidance}</p>
            </div>}
      </Panel>}
      <div className="readiness-header">
        <div className="readiness-header-icon"><Database className="h-5 w-5" /></div>
        <div>
          <p className="eyebrow text-accent">OPERATING PRINCIPLE</p>
          <h2 className="text-lg font-semibold text-ink">Show the capture state. Never imply a signal.</h2>
          <p className="mt-1 text-sm text-muted-foreground">This surface is ready for live data and stays honest while the provider is not configured.</p>
          <p className="mt-2 text-xs font-medium text-accent">Scheduler timezone: America/New_York (DST-aware). Odds use one persisted adaptive job: low-frequency weekly slots more than six hours before the next kickoff, then every 12 minutes from six to one hour out and every 5 minutes in the final hour.</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Multiple planned near-kickoff captures require known remaining credits sufficient through kickoff; a single request can establish the balance when it is unknown. Quota checks may skip paid calls. With no unfinished upcoming game, no paid odds capture is scheduled. Check the provider record below for the next attempt and any skip reason. Saved quota headers reflect past responses, not a live balance or authorization for another paid request.</p>
        </div>
      </div>
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
      <PageHeader eyebrow="Model data / Feature audit" title="Feature audit" detail="Inspect the cutoff-safe pregame feature evidence recorded before each kickoff." />
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
                  <AdminDepthChart team={team} score={score} decimal={decimal} bool={bool} formatDate={formatDate} />
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

/** The administrator workspace, loaded only when an admin opens /admin. */
export default function AdminRoutes() {
  return <AdminOnly><Switch>
    <Route path="/admin" component={Dashboard} /><Route path="/admin/this-week" component={ThisWeek} /><Route path="/admin/games/:gameId" component={GameDetail} />
    <Route path="/admin/data-health"><HealthPage kind="data-health" eyebrow="System / Observability" title="Data health" detail="Freshness, configuration, and capture status for every provider." /></Route>
    <Route path="/admin/imagery-review" component={ImageryReview} />
    <Route path="/admin/feature-audit" component={FeatureAuditPage} /><Route path="/admin/personnel-context" component={PersonnelContextPage} /><Route path="/admin/usage-analytics" component={UsageAnalytics} /><Route path="/admin/odds" component={OddsBoard} />
    <Route path="/admin/line-movement"><HealthPage kind="line-movement" eyebrow="Workspace / Market data" title="Line movement" detail="Historical capture for open, current, and closing prices." preferred="odds" /></Route>
    <Route path="/admin/injuries"><HealthPage kind="injuries" eyebrow="Signals / Availability" title="Injuries" detail="Freshness and meaningful availability readiness for each slate." preferred="injur" /></Route>
    <Route path="/admin/depth-charts"><HealthPage kind="depth-charts" eyebrow="Signals / Availability" title="Depth charts" detail="Snapshot readiness for role and personnel context." preferred="depth" /></Route>
    <Route path="/admin/settings" component={SettingsPage} /><Route component={NotFound} />
  </Switch></AdminOnly>;
}

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
