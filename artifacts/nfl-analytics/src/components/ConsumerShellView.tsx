import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  BarChart3, BookOpen, Bookmark, CalendarDays, Crosshair, Gauge, Grid3x3, Layers, ListOrdered, Menu, ShieldHalf, Star, Trophy, UserRound, Users, X,
} from 'lucide-react';
import { ConsumerAccountAction, ConsumerWorkspaceLink } from './ConsumerAccountNavigation';
import type { consumerAccountState } from '@/lib/consumer-account-state';

type NavItem = { href: string; label: string; icon: typeof Gauge; isNew?: boolean; signedInOnly?: boolean };
type NavGroup = { label: string; items: NavItem[] };

export const consumerNavGroups: NavGroup[] = [
  { label: 'Picks', items: [
    { href: '/', label: 'This week', icon: Star },
    { href: '/touchdowns', label: 'TD Picks', icon: Trophy, isNew: true },
    { href: '/pickem', label: 'Pick\'em Pool', icon: Grid3x3, isNew: true },
    { href: '/parlays', label: 'Parlay Builder', icon: Layers, isNew: true },
  ] },
  { label: 'Model', items: [
    { href: '/games', label: 'Games', icon: CalendarDays },
    { href: '/power-ratings', label: 'Power Ratings', icon: ListOrdered, isNew: true },
    { href: '/qb-rankings', label: 'QB Rankings', icon: UserRound, isNew: true },
    { href: '/performance', label: 'Model Performance', icon: BarChart3 },
  ] },
  { label: 'Teams & players', items: [
    { href: '/teams', label: 'Team Charts', icon: Gauge },
    { href: '/usage', label: 'Player Usage', icon: Users },
    { href: '/defense-vs-position', label: 'Defense vs Position', icon: ShieldHalf },
    { href: '/red-zone', label: 'Red Zone', icon: Crosshair, isNew: true },
  ] },
  { label: 'About', items: [
    { href: '/methodology', label: 'How it works', icon: BookOpen },
    { href: '/saved-games', label: 'Saved games', icon: Bookmark, signedInOnly: true },
  ] },
];
/** Flat list, kept for callers that only need the links. */
export const consumerNav = consumerNavGroups.flatMap(group => group.items);

function isActive(location: string, href: string) {
  return href === '/' ? location === '/' : location === href || location.startsWith(`${href}/`);
}

function crumbs(location: string) {
  for (const group of consumerNavGroups) {
    const item = group.items.find(entry => isActive(location, entry.href));
    if (item) return [group.label, item.label];
  }
  return [];
}

export function ConsumerShellView({
  children, account, accountControl, onManageAccount, themeToggle,
}: {
  children: ReactNode;
  account: ReturnType<typeof consumerAccountState>;
  accountControl: ReactNode;
  onManageAccount: () => void;
  themeToggle: ReactNode;
}) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [location]);
  const trail = crumbs(location);
  const nav = (onNavigate?: () => void) => consumerNavGroups.map(group => {
    const items = group.items.filter(item => !item.signedInOnly || account.signedIn);
    if (!items.length) return null;
    return <div key={group.label} className="gl-side-group">
      <p className="gl-side-label">{group.label}</p>
      {items.map(item => {
        const Icon = item.icon;
        const active = isActive(location, item.href);
        return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
          <Icon aria-hidden="true" />{item.label}{item.isNew && <span className="gl-new">NEW</span>}
        </Link>;
      })}
    </div>;
  });

  return <div className="consumer-shell gl-app">
    <aside className="gl-sidebar">
      <Link href="/" className="gl-brand"><img src={`${import.meta.env.BASE_URL}logo-icon.png`} alt="" />Gridline</Link>
      <nav className="gl-side-nav" aria-label="Primary navigation">
        {nav()}
        <div className="gl-side-group"><ConsumerWorkspaceLink verified={account.adminVerified} /></div>
      </nav>
      <div className="gl-side-foot">
        <ConsumerAccountAction state={account} mobile={false} accountControl={accountControl} />
        {themeToggle}
      </div>
    </aside>

    <div className="gl-main-col">
      <header className="gl-crumbbar">
        <button ref={menuButton} className="gl-icon-button gl-menu-toggle" type="button"
          aria-label={open ? 'Close navigation' : 'Open navigation'} aria-controls="consumer-mobile-navigation"
          aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}</button>
        <Link href="/" className="gl-brand gl-brand-mobile"><img src={`${import.meta.env.BASE_URL}logo-icon.png`} alt="" />Gridline</Link>
        <ol className="gl-crumbs" aria-label="Breadcrumb">
          <li><Link href="/">Gridline</Link></li>
          {trail.map((crumb, index) => <li key={crumb} aria-current={index === trail.length - 1 ? 'page' : undefined}>{crumb}</li>)}
        </ol>
      </header>
      {open && <nav id="consumer-mobile-navigation" className="gl-mobile-nav" aria-label="Mobile navigation"
        onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); menuButton.current?.focus(); } }}>
        {nav(() => setOpen(false))}
        <ConsumerWorkspaceLink verified={account.adminVerified} onNavigate={() => setOpen(false)} />
        <div className="gl-side-foot">
          <ConsumerAccountAction state={account} mobile onNavigate={() => setOpen(false)} onManageAccount={() => { setOpen(false); onManageAccount(); }} />
          {themeToggle}
        </div>
      </nav>}
      <main className="gl-shell-main">{children}</main>
      <footer className="gl-footer">
        <div className="gl-footer-inner">
          <p><b>Gridline</b>NFL power ratings, game projections and touchdown picks built from play-by-play data, updated through the week.</p>
          <p><b>Projections, not promises</b>Every number is a model estimate. Lines move, so check your sportsbook before betting. <Link href="/methodology">How the model works</Link>.</p>
          <p><b>Bet responsibly</b>21+ where sports betting is legal. If gambling stops being fun, call or text 1-800-GAMBLER.</p>
        </div>
      </footer>
    </div>
  </div>;
}
