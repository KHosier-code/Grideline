import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Menu, X } from 'lucide-react';
import { ConsumerAccountAction, ConsumerWorkspaceLink } from './ConsumerAccountNavigation';
import type { consumerAccountState } from '@/lib/consumer-account-state';

const redZoneEnabled = import.meta.env.VITE_GRIDLINE_RED_ZONE_ENABLED === '1';

type NavItem = { href: string; label: string; isNew?: boolean; signedInOnly?: boolean };
export const consumerNav: NavItem[] = [
  { href: '/', label: 'Picks' },
  { href: '/touchdowns', label: 'TD Picks', isNew: true },
  { href: '/games', label: 'Games' },
  { href: '/teams', label: 'Teams' },
  { href: '/usage', label: 'Players' },
  { href: '/defense-vs-position', label: 'Matchups' },
  ...(redZoneEnabled ? [{ href: '/red-zone', label: 'Red Zone' }] : []),
  { href: '/performance', label: 'Record' },
  { href: '/methodology', label: 'How it works' },
  { href: '/saved-games', label: 'Saved', signedInOnly: true },
];

function isActive(location: string, href: string) {
  return href === '/' ? location === '/' : location === href || location.startsWith(`${href}/`);
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
  const items = consumerNav.filter(item => !item.signedInOnly || account.signedIn);
  const links = (onNavigate?: () => void) => items.map(item => {
    const active = isActive(location, item.href);
    return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
      {item.label}{item.isNew && <span className="gl-new">NEW</span>}
    </Link>;
  });
  return <div className="consumer-shell">
    <header className="gl-topbar">
      <div className="gl-topbar-inner">
        <Link href="/" className="gl-brand"><img src={`${import.meta.env.BASE_URL}logo-icon.png`} alt="" />Gridline</Link>
        <nav className="gl-nav" aria-label="Primary navigation">{links()}<ConsumerWorkspaceLink verified={account.adminVerified} /></nav>
        <div className="gl-account">
          {themeToggle}
          <ConsumerAccountAction state={account} mobile={false} accountControl={accountControl} />
          <button ref={menuButton} className="gl-icon-button gl-menu-toggle" type="button"
            aria-label={open ? 'Close navigation' : 'Open navigation'} aria-controls="consumer-mobile-navigation"
            aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}</button>
        </div>
      </div>
      {open && <nav id="consumer-mobile-navigation" className="gl-mobile-nav" aria-label="Mobile navigation"
        onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); menuButton.current?.focus(); } }}>
        {links(() => setOpen(false))}
        <ConsumerWorkspaceLink verified={account.adminVerified} onNavigate={() => setOpen(false)} />
        <ConsumerAccountAction state={account} mobile onNavigate={() => setOpen(false)} onManageAccount={() => { setOpen(false); onManageAccount(); }} />
      </nav>}
    </header>
    <main className="gl-shell-main">{children}</main>
    <footer className="gl-footer">
      <div className="gl-footer-inner">
        <p><b>Gridline</b>NFL projections and touchdown picks built from play-by-play data, updated through the week.</p>
        <p><b>Projections, not promises</b>Every pick is a model estimate. Lines move, so check your sportsbook before betting. <Link href="/methodology">How the model works</Link>.</p>
        <p><b>Bet responsibly</b>21+ where sports betting is legal. If gambling stops being fun, call or text 1-800-GAMBLER.</p>
      </div>
    </footer>
  </div>;
}
