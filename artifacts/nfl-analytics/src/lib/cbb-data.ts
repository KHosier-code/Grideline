import { getGetConsumerCbbQueryKey, useGetConsumerCbb } from '@workspace/api-client-react';
import type { CbbRecord, CbbReport } from './cbb';

/** The latest college basketball run and the season's graded record. */
export function useCbb() {
  const query = useGetConsumerCbb({ query: { queryKey: getGetConsumerCbbQueryKey(), staleTime: 2 * 60_000 } });
  const available = query.data?.status === 'available';
  return {
    query,
    report: available ? query.data!.report as unknown as CbbReport : null,
    record: available ? query.data!.record as unknown as CbbRecord : null,
  };
}
