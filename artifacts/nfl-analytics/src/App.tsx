import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
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
  getGetSettingsQueryKey,
  getHealthCheckQueryKey,
  getListGamesQueryKey,
  getListTeamsQueryKey,
  useGetDashboardSummary,
  useGetDataHealth,
  useGetGame,
  useGetOddsHistory,
  useGetSettings,
  useHealthCheck,
  useListGames,
  useListTeams,
  useUpdateSettings,
  useCaptureOdds,
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
  if (status === 'current' || status === 'available' || status === 'healthy') return 'good';
  if (status === 'stale') return 'warn';
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

function FreshnessCard({ item }: { item: any }) {
  const status = item?.status;
  const metadataEntries = Object.entries(item?.metadata ?? {})
    .filter(([key, value]) => key !== 'failures' && value !== null && value !== undefined)
    .slice(0, 4);
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
          {metadataEntries.length > 0 && <div className="health-metadata">{metadataEntries.map(([key, value]) => <span key={key}><strong>{String(value)}</strong> {key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>)}</div>}
          {failures.length > 0 && <details className="health-failures"><summary>{failures.length} recorded failure{failures.length === 1 ? '' : 's'}</summary><ul>{failures.slice(0, 10).map((failure: string, index: number) => <li key={`${failure}-${index}`}>{failure}</li>)}</ul></details>}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <p>{item.lastUpdated ? `Updated ${formatDate(item.lastUpdated, true)}` : 'No capture yet'}</p>
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
          <div className="topbar-actions"><button type="button" className="icon-button" aria-label="Notifications" data-testid="button-notifications"><Bell className="h-4 w-4" /><span className="notification-dot" /></button><Link href="/settings" className="avatar-link" aria-label="Open settings" data-testid="link-settings-quick"><span className="user-avatar user-avatar-small">A</span></Link></div>
        </div>
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  );
}

function Dashboard() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 30000 } });
  const health = useGetDataHealth({ query: { queryKey: getGetDataHealthQueryKey(), staleTime: 30000 } });
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
        actions={<button type="button" className="button button-primary" onClick={runCapture} disabled={capture.isPending} data-testid="button-capture-odds">{capture.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Capture one snapshot</button>}
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
  if (game.isLoading) return <><PageHeader eyebrow="Game detail" title="Loading game" detail="Resolving the latest game record." /><LoadingPanel /></>;
  if (game.isError || !game.data) return <><PageHeader eyebrow="Game detail" title="Game unavailable" detail={`Could not resolve ${gameId}.`} /><ErrorPanel /></>;
  const item = game.data;
  const odds = item.latestOdds ?? [];
  return (
    <>
      <PageHeader eyebrow={`Week ${item.week} / ${formatDate(item.gameDate)}`} title={`${item.awayTeam.abbreviation} at ${item.homeTeam.abbreviation}`} detail={`${item.awayTeam.teamName} at ${item.homeTeam.teamName}${item.venue ? ` · ${item.venue}` : ''}`} actions={<Link href="/this-week" className="button button-subtle" data-testid="link-back-week"><ChevronRight className="h-4 w-4 rotate-180" /> Back to slate</Link>} />
      <div className="game-hero"><div className="hero-team"><span className="hero-abbr">{item.awayTeam.abbreviation}</span><span>{item.awayTeam.teamName}</span><small>AWAY</small></div><div className="hero-center"><span className="hero-at">@</span><StatusPill status={item.gameStatus}>{item.gameStatus}</StatusPill><span className="text-xs text-sidebar-foreground/55">{item.kickoffTime ? formatDate(item.kickoffTime, true) : 'Kickoff TBD'}</span></div><div className="hero-team hero-team-right"><span className="hero-abbr">{item.homeTeam.abbreviation}</span><span>{item.homeTeam.teamName}</span><small>HOME</small></div></div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Panel eyebrow="Current market" title="Latest odds" action={<span className="section-meta">{odds.length} quotes</span>}>
          {odds.length ? <div className="odds-table"><div className="odds-head"><span>Book</span><span>Market</span><span>Selection</span><span>Point</span><span>Price</span></div>{odds.map((quote, index) => <div className="odds-row" key={`${quote.sportsbook}-${quote.market}-${quote.selection}-${index}`}><span className="font-semibold text-ink">{quote.sportsbook}</span><span>{quote.market}</span><span>{quote.selection}</span><span>{quote.point ?? '—'}</span><span className="font-mono font-medium text-ink">{quote.price > 0 ? `+${quote.price}` : quote.price}</span></div>)}</div> : <EmptyPanel title="No odds captured yet" detail="This game has a schedule record, but no current sportsbook quotes are attached to it." icon={SlidersHorizontal} />}
        </Panel>
        <Panel eyebrow="Decision gate" title="Model read">
          <div className="readiness-block"><div className="readiness-icon"><ShieldCheck className="h-5 w-5" /></div><div><StatusPill status={item.modelStatus}>{item.modelStatus === 'not_trained' ? 'Model not yet trained' : 'Model available'}</StatusPill><p className="mt-3 text-sm leading-6 text-muted-foreground">{item.modelStatus === 'not_trained' ? 'Probability, edge, and recommended stake fields are withheld. The workspace will not manufacture a signal from market data alone.' : 'Model outputs are available for review against the current market.'}</p></div></div>
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
  const health = useGetDataHealth({ query: { queryKey: getGetDataHealthQueryKey(), staleTime: 30000 } });
  const focused = useMemo(() => preferred ? health.data?.filter((item) => `${item.provider} ${item.label}`.toLowerCase().includes(preferred)) : health.data, [health.data, preferred]);
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} detail={detail} actions={<button type="button" className="button button-subtle" onClick={() => health.refetch()} data-testid={`button-refresh-${kind}`}><RefreshCw className={cx('h-4 w-4', health.isFetching && 'animate-spin')} /> Refresh</button>} />
      <div className="readiness-header"><div className="readiness-header-icon"><Database className="h-5 w-5" /></div><div><p className="eyebrow text-accent">OPERATING PRINCIPLE</p><h2 className="text-lg font-semibold text-ink">Show the capture state. Never imply a signal.</h2><p className="mt-1 text-sm text-muted-foreground">This surface is ready for live data and stays honest while the provider is not configured.</p></div></div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <Panel eyebrow="Provider monitor" title="Data health" action={health.data && <span className="section-meta">{health.data.length} providers</span>}>{health.isLoading ? <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : health.isError ? <ErrorPanel /> : focused?.length ? <div className="space-y-3">{focused.map((item) => <FreshnessCard item={item} key={item.provider} />)}</div> : <EmptyPanel title="No provider record matches this surface" detail="Once the backend exposes a provider health record, it will be listed here with its last and next update." icon={Database} />}</Panel>
        <Panel eyebrow="Readiness" title={`${title} readiness`}><EmptyPanel title="Capture not populated" detail={kind === 'odds' ? 'Odds API configuration is required before sportsbook snapshots can be shown.' : `No ${title.toLowerCase()} records are available yet. This is an honest empty state, not a prediction.`} icon={kind === 'line-movement' ? LineChart : Activity} /></Panel>
      </div>
      <Panel eyebrow="What will appear here" title="Future-ready fields" className="mt-5"><div className="grid gap-3 md:grid-cols-3"><ReadinessTile icon={Clock3} title="Freshness timestamp" detail="Last successful capture and next scheduled update." /><ReadinessTile icon={ShieldCheck} title="Source status" detail="Provider configuration and request budget remain visible." /><ReadinessTile icon={TrendingUp} title="Decision context" detail="Only supported outputs will be promoted into the workspace." /></div></Panel>
    </>
  );
}

function Backtesting() {
  return <ReadinessPage eyebrow="Research" title="Backtesting" detail="Walk-forward evaluation without hindsight or invented results." icon={History} blocks={['Walk-forward windows', 'Out-of-sample record', 'Calibration by segment']} />;
}

function ModelLab() {
  return <ReadinessPage eyebrow="Research" title="Model lab" detail="Production and challenger models, with calibration as a first-class check." icon={Sparkles} blocks={['Production model', 'Challenger queue', 'Calibration readiness']} />;
}

function Performance() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 30000 } });
  const data = summary.data;
  const cards = [{ name: 'ATS', value: data?.ats, icon: Target }, { name: 'Moneyline', value: data?.moneyline, icon: TrendingUp }, { name: 'Totals', value: data?.totals, icon: Gauge }, { name: 'CLV', value: data?.averageClv, icon: LineChart }];
  return <><PageHeader eyebrow="Review" title="Performance" detail="Track the ledger by market. Empty means unmeasured, not zero." /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{cards.map(({ name, value, icon: Icon }) => <div className="performance-card" key={name}><div className="flex items-center justify-between"><span className="eyebrow">{name}</span><Icon className="h-4 w-4 text-accent" /></div>{name === 'CLV' ? <><div className="mt-5 font-display text-3xl font-semibold text-ink">{formatPercent(value as number | null | undefined)}</div><p className="mt-2 text-xs text-muted-foreground">Average closing line value</p></> : <><div className="mt-5 font-display text-3xl font-semibold text-ink">{summary.isLoading ? '—' : (value as any)?.record || '—'}</div><p className="mt-2 text-xs text-muted-foreground">{formatPercent((value as any)?.winRate)} win rate · {formatUnits((value as any)?.units)}</p></>}</div>)}</div><Panel eyebrow="Method" title="Performance ledger" className="mt-5"><EmptyPanel title="Historical evaluation is not populated" detail="Once settled picks and closing lines are captured, this page will show ATS, moneyline, totals, and CLV by season and market. It will not backfill synthetic results." icon={BarChart3} /></Panel></>;
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
  return <RoutedErrorBoundary><Shell><Switch><Route path="/" component={Dashboard} /><Route path="/this-week" component={ThisWeek} /><Route path="/games/:gameId" component={GameDetail} /><Route path="/data-health"><HealthPage kind="data-health" eyebrow="System / Observability" title="Data health" detail="Freshness, configuration, and capture status for every provider." /></Route><Route path="/odds" component={OddsBoard} /><Route path="/line-movement"><HealthPage kind="line-movement" eyebrow="Workspace / Market data" title="Line movement" detail="Historical capture for open, current, and closing prices. Open a game from the Odds board to inspect every preserved change." preferred="odds" /></Route><Route path="/injuries"><HealthPage kind="injuries" eyebrow="Signals / Availability" title="Injuries" detail="Freshness and meaningful availability readiness for each slate." preferred="injur" /></Route><Route path="/depth-charts"><HealthPage kind="depth-charts" eyebrow="Signals / Availability" title="Depth charts" detail="Snapshot readiness for role and personnel context." preferred="depth" /></Route><Route path="/backtesting" component={Backtesting} /><Route path="/model-lab" component={ModelLab} /><Route path="/performance" component={Performance} /><Route path="/settings" component={SettingsPage} /><Route component={NotFound} /></Switch></Shell></RoutedErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;