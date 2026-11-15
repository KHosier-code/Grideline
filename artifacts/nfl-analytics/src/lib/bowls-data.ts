import { useQuery } from '@tanstack/react-query';
import type { BowlsReport } from './bowls';

type BowlsResponse = { status: 'available' | 'unavailable'; season: number | null; generatedAt: string | null; report: BowlsReport | null };

/** The latest bowl pool sheets (GET /api/consumer/bowls). */
export function useBowls({ enabled = true }: { enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: ['consumer-bowls'],
    queryFn: async (): Promise<BowlsResponse> => {
      const response = await fetch('/api/consumer/bowls', { credentials: 'include' });
      if (!response.ok) throw new Error(`Bowl sheets unavailable (${response.status})`);
      return response.json() as Promise<BowlsResponse>;
    },
    staleTime: 5 * 60_000,
    enabled,
  });
  return { query, report: query.data?.status === 'available' ? query.data.report : null };
}
