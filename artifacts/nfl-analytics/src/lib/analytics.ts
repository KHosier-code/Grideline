export type AnalyticsData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void;
    };
  }
}

export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === 'undefined') return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never affect the user experience.
  }

  if (!name.startsWith('usage_')) return;
  const body = {
    eventName: name,
    ...(data ?? {}),
    ...(data && 'had_team' in data ? {
      hadTeam: data.had_team,
      hadPosition: data.had_position,
      hadGame: data.had_game,
    } : {}),
  };
  delete (body as AnalyticsData).had_team;
  delete (body as AnalyticsData).had_position;
  delete (body as AnalyticsData).had_game;
  void fetch('/api/analytics/usage-event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // First-party reporting must also remain non-blocking.
  });
}