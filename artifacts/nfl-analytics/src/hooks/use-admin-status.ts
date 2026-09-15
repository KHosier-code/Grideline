import { useAuth } from '@clerk/react';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

let lastAuthIdentity: string | null | undefined;

export function useAdminStatus() {
  const { getToken, isLoaded, isSignedIn, sessionId, userId } = useAuth();
  const queryClient = useQueryClient();
  const authIdentity = isSignedIn && userId ? `${userId}:${sessionId ?? 'active-session'}` : null;

  useEffect(() => {
    if (!isLoaded) return;
    if (lastAuthIdentity !== undefined && lastAuthIdentity !== authIdentity) {
      void queryClient.resetQueries();
      queryClient.removeQueries({ type: 'inactive' });
    }
    lastAuthIdentity = authIdentity;
  }, [authIdentity, isLoaded, queryClient]);

  return useQuery({
    queryKey: ['admin-status', authIdentity],
    queryFn: async () => {
      if (!authIdentity) return false;
      const token = await getToken();
      const res = await fetch('/api/auth/admin-status', {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) return false;
        throw new Error('Administrator access could not be checked');
      }
      const data = await res.json();
      return data.isAdmin === true;
    },
    enabled: isLoaded && Boolean(authIdentity),
    staleTime: 5 * 60 * 1000,
  });
}
