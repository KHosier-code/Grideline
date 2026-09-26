// Build-only, non-authenticating entry. Render the exact weekly Home component
// used by the signed-in "/" route, with its real consumer API calls. There is
// no Clerk provider, session, token, or privileged API access in this fixture.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Router } from 'wouter';
import { useState } from 'react';
import ConsumerHome from '../src/pages/consumer/ConsumerHome';
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

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <QueryClientProvider client={new QueryClient()}>
      <Router base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <WeeklyHomeFixture />
      </Router>
    </QueryClientProvider>
  </ThemeProvider>,
);