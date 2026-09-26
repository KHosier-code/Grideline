// Mount the production page without an account or live provider data.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConsumerTeams from '../src/pages/consumer/ConsumerTeams';
import '../src/index.css';

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <main className="consumer-shell"><ConsumerTeams /></main>
  </QueryClientProvider>,
);