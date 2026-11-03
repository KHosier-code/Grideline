import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  BarChart3, BookOpen, Bookmark, CalendarDays, ChevronDown, Crosshair, Gauge, Grid3x3, ListOrdered, Menu, Receipt, ShieldHalf, Star, Swords, Trophy, UserRound, Users, X,
} from 'lucide-react';
import { ConsumerAccountAction, ConsumerWorkspaceLink } from './ConsumerAccountNavigation';
import type { consumerAccountState } from '@/lib/consumer-account-state';
import { cbbAccess, isCbbPath, sportForPath, type Sport } from '@/lib/sports';

type NavItem = { href: string; label: string; icon: typeof Gauge; signedInOnly?: boolean };
/** `collapsible` groups fold away until opened, or while you're on one of their pages. */
type NavGroup = { label: string; items: NavItem[]; collapsible?: boolean };

/**
 * NFL: five things most visitors come for, then everything else under Research.
 * Breadcrumbs read the group labels below.
 */
export const consumerNavGroups: NavGroup[] = [
  { label: 'NFL picks', items: [
    { href: '/nfl', label: 'This week', icon: Star },
    { href: '/touchdowns', label: 'TD Picks', icon: Trophy },
    { href: '/games', label: 'Game lines', icon: CalendarDays },
    { href: '/pickem', label: 'Pool Picks', icon: Grid3x3 },
    { href: '/performance', label: 'NFL Record', icon: BarChart3 },
  ] },
  { label: 'NFL research', collapsible: true, items: [
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
/** College basketball lives under /cbb with its own menu and its own record. */
export const cbbNavGroups: NavGroup[] = [
  { label: 'College picks', items: [
    { href: '/cbb', label: "Today's games", icon: CalendarDays },
    { href: '/cbb/ratings', label: 'Power Ratings', icon: ListOrdered },
    { href: '/cbb/record', label: 'College Record', icon: BarChart3 },
    { href: '/cbb/how-it-works', label: 'How it works', icon: BookOpen },
  ] },
];
/** Flat list, kept for callers that only need the links. */
export const consumerNav = consumerNavGroups.flatMap(group => group.items);

export { isCbbPath };

const tabs: Array<{ sport: Sport; href: string; label: string; short: string }> = [
  { sport: 'home', href: '/', label: 'Home', short: 'Home' },
  { sport: 'nfl', href: '/nfl', label: 'NFL', short: 'NFL' },
  { sport: 'cbb', href: '/cbb', label: 'College Basketball', short: 'College' },
];

/** Footer wording per section. */
function FooterCopy({ sport }: { sport: Sport }) {
  if (sport === 'cbb') return <>
    <p><b>Probable College Basketball</b>Our line for every Division I game next to the sportsbook&apos;s, from tempo-free team ratings updated four times a day. Its record is kept apart from the NFL&apos;s.</p>
    <p><b>Projections, not promises</b>Every number is a model estimate. Lines move, so check your sportsbook before betting. <Link href="/cbb/how-it-works">How the college model works</Link>.</p>
  </>;
  if (sport === 'home') return <>
    <p><b>Probable</b>NFL and college basketball picks priced against the books. Each sport has its own model and its own public record, and every pick is timestamped before it starts.</p>
    <p><b>Projections, not promises</b>Every number is a model estimate. Lines move, so check your sportsbook before betting. <Link href="/methodology">How the NFL model works</Link>.</p>
  </>;
  return <>
    <p><b>Probable NFL</b>Anytime TD picks priced against the books, game projections and power ratings, built from play-by-play data and updated through the week.</p>
    <p><b>Projections, not promises</b>Every number is a model estimate. Lines move, so check your sportsbook before betting. <Link href="/methodology">How the model works</Link>.</p>
  </>;
}

/** Each sport's home page matches only itself, not the pages under it. */
function isActive(location: string, href: string) {
  return href === '/' || href === '/cbb' || href === '/nfl' ? location === href : location === href || location.startsWith(`${href}/`);
}

function crumbs(location: string, groups: NavGroup[]) {
  for (const group of groups) {
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
  // College basketball is admin-only until its launch date; then everyone gets the tabs.
  const cbbOpen = cbbAccess(account.adminVerified).visible;
  const sport: Sport = cbbOpen ? sportForPath(location) : location === '/' ? 'home' : 'nfl';
  const groups = sport === 'cbb' ? cbbNavGroups
    : sport === 'home' && cbbOpen ? [consumerNavGroups[0], ...cbbNavGroups, consumerNavGroups[1]]
    : consumerNavGroups;
  const trail = crumbs(location, sport === 'cbb' ? cbbNavGroups : consumerNavGroups);
  const sportTabs = cbbOpen && <nav className="gl-sport-tabs" aria-label="Sport">
    {tabs.map(tab => <Link key={tab.sport} href={tab.href} data-tab={tab.sport} aria-current={sport === tab.sport ? 'page' : undefined}>
      <span className="gl-tab-long">{tab.label}</span><span className="gl-tab-short">{tab.short}</span>
    </Link>)}
  </nav>;
  const nav = (onNavigate?: () => void) => groups.map(group => {
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

  return <div className={`consumer-shell gl-app${cbbOpen ? ' has-sport-tabs' : ''}`} data-sport={sport}>
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
        <ol className="gl-crumbs" aria-label="Breadcrumb">
          <li><Link href="/">Probable</Link></li>
          {sport === 'cbb' && <li><Link href="/cbb">College Basketball</Link></li>}
          {sport === 'nfl' && cbbOpen && <li><Link href="/nfl">NFL</Link></li>}
          {trail.map((crumb, index) => <li key={crumb} aria-current={index === trail.length - 1 ? 'page' : undefined}>{crumb}</li>)}
        </ol>
        {sportTabs}
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
          <FooterCopy sport={sport === 'home' && !cbbOpen ? 'nfl' : sport} />
          <p><b>Bet responsibly</b>21+ where sports betting is legal. If gambling stops being fun, call or text 1-800-GAMBLER.</p>
        </div>
      </footer>
    </div>
  </div>;
}
