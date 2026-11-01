import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  BarChart3, BookOpen, Bookmark, CalendarDays, ChevronDown, Crosshair, Gauge, Grid3x3, ListOrdered, Menu, Receipt, ShieldHalf, Star, Swords, Trophy, UserRound, Users, X,
} from 'lucide-react';
import { ConsumerAccountAction, ConsumerWorkspaceLink } from './ConsumerAccountNavigation';
import type { consumerAccountState } from '@/lib/consumer-account-state';
import { SPORTS, cbbVisible, isCbbPath, type Sport } from '@/lib/sports';

export { isCbbPath };

type NavItem = { href: string; label: string; icon: typeof Gauge; signedInOnly?: boolean };
/** `collapsible` groups fold away until opened, or while you're on one of their pages. */
type NavGroup = { label: string; items: NavItem[]; collapsible?: boolean };

/**
 * Five things most visitors come for, then everything else under Research.
 * Breadcrumbs read the group labels below.
 */
export const consumerNavGroups: NavGroup[] = [
  { label: 'Picks', items: [
    { href: '/', label: 'This week', icon: Star },
    { href: '/touchdowns', label: 'TD Picks', icon: Trophy },
    { href: '/games', label: 'Game lines', icon: CalendarDays },
    { href: '/pickem', label: 'Pool Picks', icon: Grid3x3 },
    { href: '/performance', label: 'Record', icon: BarChart3 },
  ] },
  { label: 'Research', collapsible: true, items: [
    { href: '/power-ratings', label: 'Power Ratings', icon: ListOrdered },
    { href: '/qb-rankings', label: 'QB Rankings', icon: UserRound },
    { href: '/teams', label: 'Team Charts', icon: Gauge },
    { href: '/usage', label: 'Player Usage', icon: Users },
    { href: '/matchups', label: 'Matchups', icon: Swords },
    { href: '/defense-vs-position', label: 'Defense vs Position', icon: ShieldHalf },
    { href: '/red-zone', label: 'Red Zone', icon: Crosshair },
    { href: '/receipts', label: 'Receipts', icon: Receipt },
    { href: '/my-picks', label: 'My Picks', icon: Bookmark },
    { href: '/methodology', label: 'How it works', icon: BookOpen },
  ] },
];
/** College basketball lives under /cbb with its own menu and record. */
export const cbbNavGroups: NavGroup[] = [
  { label: 'College Basketball', items: [
    { href: '/cbb', label: 'Today\'s games', icon: CalendarDays },
    { href: '/cbb/ratings', label: 'Power Ratings', icon: ListOrdered },
    { href: '/cbb/record', label: 'Record', icon: BarChart3 },
    { href: '/cbb/how-it-works', label: 'How it works', icon: BookOpen },
  ] },
];
const navFor: Record<Sport, NavGroup[]> = { nfl: consumerNavGroups, cbb: cbbNavGroups };
/** Flat list, kept for callers that only need the links. */
export const consumerNav = consumerNavGroups.flatMap(group => group.items);

/** Each sport's home page matches only itself, not the pages under it. */
function isActive(location: string, href: string) {
  return href === '/' || href === '/cbb' ? location === href : location === href || location.startsWith(`${href}/`);
}

function crumbs(location: string, sport: Sport) {
  for (const group of navFor[sport]) {
    const item = group.items.find(entry => isActive(location, entry.href));
    if (item) return sport === 'cbb' ? [item.label] : [group.label, item.label];
  }
  return [];
}

/** NFL | College Basketball, across the top of every page once college is visible. */
function SportTabs({ sport }: { sport: Sport }) {
  return <nav className="gl-sport-tabs" aria-label="Sport">
    {(['nfl', 'cbb'] as const).map(key => <Link key={key} href={SPORTS[key].home} data-sport={key}
      aria-current={sport === key ? 'true' : undefined}>
      <span className="gl-sport-tab-long">{SPORTS[key].name}</span><span className="gl-sport-tab-short">{SPORTS[key].short}</span>
    </Link>)}
  </nav>;
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
  // College basketball is visible to administrators until launch, then to everyone.
  // Before then a customer at a /cbb address is sent home by CbbGate, so the
  // shell keeps showing the NFL menu.
  const showTabs = cbbVisible(account.adminVerified);
  const sport: Sport = isCbbPath(location) && showTabs ? 'cbb' : 'nfl';
  const trail = isCbbPath(location) && !showTabs ? [] : crumbs(location, sport);
  const info = SPORTS[sport];
  const nav = (onNavigate?: () => void) => navFor[sport].map(group => {
    const items = group.items.filter(item => !item.signedInOnly || account.signedIn);
    if (!items.length) return null;
    const links = items.map(item => {
      const Icon = item.icon;
      const active = isActive(location, item.href);
      return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
        <Icon aria-hidden="true" />{item.label}
      </Link>;
    });
    if (group.collapsible) {
      const holdsCurrent = items.some(item => isActive(location, item.href));
      return <details key={`${group.label}-${holdsCurrent}`} className="gl-side-group gl-side-fold" open={holdsCurrent}>
        <summary className="gl-side-label">{group.label}<ChevronDown aria-hidden="true" /></summary>
        {links}
      </details>;
    }
    return <div key={group.label} className="gl-side-group">
      <p className="gl-side-label">{group.label}</p>
      {links}
    </div>;
  });

  return <div className="consumer-shell gl-app" data-sport={sport}>
    <aside className="gl-sidebar">
      <Link href="/" className="gl-brand"><img src={`${import.meta.env.BASE_URL}logo-icon.svg`} alt="" />probable</Link>
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
        <Link href="/" className="gl-brand gl-brand-mobile"><img src={`${import.meta.env.BASE_URL}logo-icon.svg`} alt="" />probable</Link>
        {showTabs && <SportTabs sport={sport} />}
        <ol className="gl-crumbs" aria-label="Breadcrumb">
          <li><Link href={info.home}>{sport === 'cbb' ? info.name : 'Probable'}</Link></li>
          {trail.map((crumb, index) => <li key={crumb} aria-current={index === trail.length - 1 ? 'page' : undefined}>{crumb}</li>)}
        </ol>
      </header>
      {open && <div className="gl-mobile-nav-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />}
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
          <p><b>{sport === 'cbb' ? 'Probable College Basketball' : 'Probable'}</b>{info.footer.about}</p>
          <p><b>Projections, not promises</b>{info.footer.caution} <Link href={info.methodology}>How the model works</Link> · <Link href={info.record}>{info.name} record</Link>.</p>
          <p><b>Bet responsibly</b>21+ where sports betting is legal. If gambling stops being fun, call or text 1-800-GAMBLER.</p>
        </div>
      </footer>
    </div>
  </div>;
}
