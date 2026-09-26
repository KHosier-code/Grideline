import { getGetConsumerDashboardQueryKey, useGetConsumerDashboard } from '@workspace/api-client-react';
import { useConsumerNow } from './consumer-ui';
import { VisitorHomeContent } from './VisitorHomeContent';
import './VisitorHome.css';

export default function VisitorHome() {
  const query = useGetConsumerDashboard({ query: {
    queryKey: getGetConsumerDashboardQueryKey(), staleTime: 0,
    refetchInterval: 15_000, refetchOnWindowFocus: true,
  } });
  const now = useConsumerNow();
  return <VisitorHomeContent
    now={now}
    initialWeeklyPick={query.data?.initialWeeklyPick}
    state={query.isLoading ? 'loading' : query.isError || !query.data ? 'error' : 'ready'}
  />;
}