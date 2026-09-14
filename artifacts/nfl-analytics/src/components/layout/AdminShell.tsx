import { type ReactNode, useState } from 'react';
import { useAuth, UserButton } from '@clerk/react';
import { useLocation, Link } from 'wouter';
import { Target, X, LayoutDashboard, CalendarDays, SlidersHorizontal, LineChart, Activity, ListFilter, History, Sparkles, Database, FileSearch, Microscope, UserRound, BarChart3, Settings2, Menu, Bell, ChevronRight } from 'lucide-react';
import { useHealthCheck, getHealthCheckQueryKey } from '@workspace/api-client-react';

function cx(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function StatusPill({ status, children }: { status?: string | null; children: ReactNode }) {
  let tone = 'bad';
  if (status === 'current' || status === 'available' || status === 'healthy' || status === 'success' || status === 'ok') tone = 'good';
  else if (status === 'stale' || status === 'warning' || status === 'running' || status === 'partial') tone = 'warn';
  else if (status === 'not_configured' || status === 'not_trained' || status === 'spread' || status === 'moneyline' || status === 'totals') tone = 'neutral';
  
  return (
    <span data-testid={`status-${String(status ?? children).replace(/\s+/g, '-').toLowerCase()}`} className={cx('status-pill', `status-${tone}`)}>
      <span className="status-dot" />
      {children}
    </span>
  );
}

const navGroups = [
  {
    label: 'Workspace',
    items: [
      { href: '/admin', label: 'Overview', icon: LayoutDashboard },
      { href: '/admin/this-week', label: 'This week', icon: CalendarDays },
      { href: '/admin/live-predictions', label: 'Live predictions', icon: Target },
      { href: '/admin/odds', label: 'Odds board', icon: SlidersHorizontal },
      { href: '/admin/line-movement', label: 'Line movement', icon: LineChart },
    ],
  },
  {
    label: 'Signals',
    items: [
      { href: '/admin/injuries', label: 'Injuries', icon: Activity },
      { href: '/admin/depth-charts', label: 'Depth charts', icon: ListFilter },
      { href: '/admin/backtesting', label: 'Backtesting', icon: History },
      { href: '/admin/model-lab', label: 'Model lab', icon: Sparkles },
    ],
  },
  {
    label: 'Review',
    items: [
      { href: '/admin/data-health', label: 'Data health', icon: Database },
      { href: '/admin/feature-audit', label: 'Feature audit', icon: FileSearch },
      { href: '/admin/evaluation-audit', label: 'Evaluation audit', icon: Microscope },
      { href: '/admin/personnel-context', label: 'Personnel & context', icon: UserRound },
      { href: '/admin/performance', label: 'Performance', icon: BarChart3 },
      { href: '/admin/settings', label: 'Settings', icon: Settings2 },
    ],
  },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 60000 } });
  const isHealthy = health.data?.status === 'ok' || health.data?.status === 'healthy';
  const { isSignedIn } = useAuth();

  return (
    <div className="app-shell flex bg-sidebar text-sidebar-foreground">
      <aside className={cx('sidebar border-r border-sidebar-border', mobileOpen && 'sidebar-open')}>
        <div className="sidebar-top">
          <Link href="/admin" className="brand" data-testid="link-home">
            <span className="brand-mark"><Target className="h-4 w-4" /></span>
            <span><strong>Gridline</strong><small>ADMIN WORKSPACE</small></span>
          </Link>
          <button type="button" className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="h-5 w-5" /></button>
        </div>
        <div className="sidebar-scroll">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map((item) => {
                const active = item.href === '/admin' ? location === '/admin' : location.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={cx('nav-item', active && 'nav-item-active')}>
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
      {mobileOpen && <button className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}
      <main className="main-shell flex-1 bg-background text-foreground ml-[252px]">
        <div className="mobile-topbar hidden lg:hidden">
          <button type="button" className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu className="h-5 w-5" /></button>
          <Link href="/admin" className="brand brand-mobile"><span className="brand-mark"><Target className="h-4 w-4" /></span><strong>Gridline</strong></Link>
        </div>
        <div className="topbar">
          <div className="topbar-context"><span className="live-kicker"><span className="live-pulse" />CONTROL ROOM</span><span className="topbar-divider" />{new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</div>
          <div className="topbar-actions"><button type="button" className="icon-button"><Bell className="h-4 w-4" /><span className="notification-dot" /></button>{isSignedIn ? <UserButton /> : <Link href="/sign-in" className="button button-subtle">Sign in</Link>}<Link href="/admin/settings" className="avatar-link"><span className="user-avatar user-avatar-small">A</span></Link></div>
        </div>
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  );
}
