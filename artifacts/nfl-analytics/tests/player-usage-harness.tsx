// Mount the actual public page without Clerk or live provider data.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConsumerUsage from '../src/pages/consumer/ConsumerUsage';
import '../src/index.css';

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <main className="consumer-shell"><ConsumerUsage /></main>
  </QueryClientProvider>,
);