import { getGetConsumerMatchupReportQueryKey, useGetConsumerMatchupReport } from '@workspace/api-client-react';
import type { MatchupReport } from './matchup-edges';

export function useMatchupReport() {
  const query = useGetConsumerMatchupReport({ query: { queryKey: getGetConsumerMatchupReportQueryKey(), staleTime: 5 * 60_000 } });
  const report = query.data?.status === 'available' ? query.data.report as unknown as MatchupReport : null;
  return { query, report };
}
