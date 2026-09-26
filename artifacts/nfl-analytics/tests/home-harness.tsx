// Dev-only entry: mount the same weekly Home and Game Detail components as the
// signed-in router without depending on a real Clerk account or live API data.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router, Switch } from 'wouter';
import { ThemeProvider, useTheme } from '../src/lib/theme';
import ConsumerHome from '../src/pages/consumer/ConsumerHome';
import ConsumerGameDetail from '../src/pages/consumer/ConsumerGameDetail';
import '../src/index.css';

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
      <Route path="/games/:gameId" component={ConsumerGameDetail} />
    </Switch>
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Router><Harness /></Router>
    </QueryClientProvider>
  </ThemeProvider>,
);