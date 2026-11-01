import { getGetConsumerCbbQueryKey, useGetConsumerCbb } from '@workspace/api-client-react';
import type { CbbRecord, CbbReport } from './cbb';

/**
 * The latest college basketball run and the season's graded record. Pass
 * enabled: false where college may not be visible yet (before launch the API
 * answers only administrators).
 */
export function useCbb({ enabled = true }: { enabled?: boolean } = {}) {
  const query = useGetConsumerCbb({ query: { queryKey: getGetConsumerCbbQueryKey(), staleTime: 2 * 60_000, enabled } });
  const available = query.data?.status === 'available';
  return {
    query,
    report: available ? query.data!.report as unknown as CbbReport : null,
    record: available ? query.data!.record as unknown as CbbRecord : null,
  };
}
