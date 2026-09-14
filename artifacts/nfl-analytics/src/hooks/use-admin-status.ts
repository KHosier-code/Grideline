import { useQuery } from '@tanstack/react-query';

export function useAdminStatus() {
  return useQuery({
    queryKey: ['admin-status'],
    queryFn: async () => {
      // Return true if admin for now, or fetch from API
      // Since backend contract says /api/auth/admin-status
      const res = await fetch('/api/auth/admin-status');
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) return false;
        // if API doesn't exist yet, we can gracefully fail to true in development or just return false
        return true; 
      }
      const data = await res.json();
      return data.isAdmin === true;
    },
    staleTime: 5 * 60 * 1000, // 5 mins
  });
}
