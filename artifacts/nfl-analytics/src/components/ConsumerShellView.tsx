import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Bookmark, CalendarDays, ChartNoAxesColumnIncreasing, CircleDot, FileSearch, Gauge, Home, Menu, ShieldCheck } from 'lucide-react';
import { ConsumerAccountAction, ConsumerWorkspaceLink } from './ConsumerAccountNavigation';
import type { consumerAccountState } from '@/lib/consumer-account-state';

const redZoneEnabled = import.meta.env.VITE_GRIDLINE_RED_ZONE_ENABLED === '1';
const consumerNav = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/games', label: 'Games', icon: CalendarDays },
  { href: '/saved-games', label: 'Saved games', icon: Bookmark },
  { href: '/methodology', label: 'Methodology', icon: FileSearch },
  { href: '/defense-vs-position', label: 'Defense vs Position', icon: ShieldCheck },
  { href: '/teams', label: 'Teams', icon: Gauge },
  { href: '/usage', label: 'Player Usage', icon: ChartNoAxesColumnIncreasing },
  ...(redZoneEnabled ? [{ href: '/red-zone', label: 'Red Zone', icon: CircleDot }] : []),
];

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
  return <div className="consumer-shell">
    <header className="consumer-topbar">
      <Link href="/" className="consumer-brand"><img src={`${import.meta.env.BASE_URL}logo-icon.png`} alt="Gridline" className="h-6 w-6" /><strong>Gridline</strong></Link>
      <nav aria-label="Primary navigation">{consumerNav.map(item => { const Icon = item.icon; const active = item.href === '/' ? location === '/' : location.startsWith(item.href); return <Link key={item.href} href={item.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}><Icon />{item.label}</Link>; })}<ConsumerWorkspaceLink verified={account.adminVerified} /></nav>
      <div className="consumer-account">
        {themeToggle}
        <ConsumerAccountAction state={account} mobile={false} accountControl={accountControl} />
        <button ref={menuButton} className="consumer-menu-toggle" type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-controls="consumer-mobile-navigation" aria-expanded={open} onClick={() => setOpen(!open)}><Menu aria-hidden="true" /></button>
      </div>
    </header>
    {open && <nav id="consumer-mobile-navigation" className="consumer-mobile-nav" aria-label="Mobile navigation" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); menuButton.current?.focus(); } }}>{consumerNav.map(item => { const Icon = item.icon; const active = item.href === '/' ? location === '/' : location.startsWith(item.href); return <Link key={item.href} href={item.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}><Icon />{item.label}</Link>; })}<ConsumerWorkspaceLink verified={account.adminVerified} onNavigate={() => setOpen(false)} /><ConsumerAccountAction state={account} mobile onNavigate={() => setOpen(false)} onManageAccount={() => { setOpen(false); onManageAccount(); }} />{themeToggle}</nav>}
    <main className="consumer-main">{children}</main>
  </div>;
}