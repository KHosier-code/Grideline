// Dev-only entry: mount the same weekly Home and Game Detail components as the
// signed-in router without depending on a real Clerk account or live API data.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router, Switch } from 'wouter';
import { ClerkProvider } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { lazy, Suspense } from 'react';
import { ThemeProvider, useTheme } from '../src/lib/theme';
import ConsumerHome from '../src/pages/consumer/ConsumerHome';
import ConsumerGames from '../src/pages/consumer/ConsumerGames';
import '../src/index.css';

const ConsumerGameDetail = lazy(() => import('../src/pages/consumer/ConsumerGameDetail'));

function Harness() {
  const { theme, toggle } = useTheme();
  return <main className="consumer-shell">
    <div className="consumer-account">
      <button type="button" className="theme-toggle" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>
    </div>
    <Switch>
      <Route path="/tests/home.html" component={ConsumerHome} />
      <Route path="/games" component={ConsumerGames} />
      <Route path="/games/:gameId">{() => <Suspense fallback={null}><ConsumerGameDetail /></Suspense>}</Route>
      <Route path="/games" component={ConsumerGames} />
    </Switch>
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <ClerkProvider publishableKey={publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)}
      proxyUrl={import.meta.env.VITE_CLERK_PROXY_URL}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Router><Harness /></Router>
      </QueryClientProvider>
    </ClerkProvider>
  </ThemeProvider>,
);
