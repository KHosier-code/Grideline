// Build-only, non-authenticating entry. Render the exact weekly Home component
// used by the signed-in "/" route, with its real consumer API calls. There is
// no Clerk provider, session, token, or privileged API access in this fixture.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Router } from 'wouter';
import { useState } from 'react';
import ConsumerHome from '../src/pages/consumer/ConsumerHome';
import { ConsumerShellView } from '../src/components/ConsumerShellView';
import { consumerAccountState } from '../src/lib/consumer-account-state';
import { ThemeProvider } from '../src/lib/theme';
import '../src/index.css';

function WeeklyHomeFixture() {
  const [open, setOpen] = useState(false);
  return <div className="consumer-shell">
    <header className="consumer-topbar">
      <Link href="/" className="consumer-brand">Gridline</Link>
      <nav aria-label="Primary navigation"><Link href="/games">Games</Link></nav>
      <button type="button" className="consumer-menu-toggle" aria-label="Open navigation"
        aria-expanded={open} aria-controls="consumer-mobile-navigation" onClick={() => setOpen(!open)}>Menu</button>
    </header>
    {open && <nav id="consumer-mobile-navigation" className="consumer-mobile-nav" aria-label="Mobile navigation">
      <Link href="/games">Games</Link>
    </nav>}
    <main className="consumer-main"><ConsumerHome /></main>
  </div>;
}

// This is a rendering/interaction fixture, not a signed-in session. No Clerk
// provider, user ID, token, admin grant, or account API is available here.
function AccountShellFixture() {
  const [panel, setPanel] = useState(false);
  const [dark, setDark] = useState(false);
  const account = consumerAccountState(true, true, { isSuccess: false, isFetching: false });
  const openPanel = () => setPanel(true);
  return <ConsumerShellView
    account={account}
    accountControl={<button type="button" aria-label="Fixture account control" onClick={openPanel}>Account</button>}
    onManageAccount={openPanel}
    themeToggle={<button type="button" className="theme-toggle" onClick={() => setDark(!dark)} aria-label="Fixture theme toggle">{dark ? 'Light mode' : 'Dark mode'}</button>}
  >
    {panel && <div role="status" data-testid="fixture-account-panel">Fixture-only account control; no profile or session.</div>}
    <ConsumerHome />
  </ConsumerShellView>;
}

const accountShell = new URLSearchParams(window.location.search).get('shell') === 'account';
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <QueryClientProvider client={new QueryClient()}>
      <Router base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        {accountShell ? <AccountShellFixture /> : <WeeklyHomeFixture />}
      </Router>
    </QueryClientProvider>
  </ThemeProvider>,
);