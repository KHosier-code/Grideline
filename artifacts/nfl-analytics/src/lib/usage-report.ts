import { getGetConsumerUsageReportQueryKey, useGetConsumerUsageReport } from '@workspace/api-client-react';

/** Shapes written by research/td-model/weekly_report.py. */
export type UsageWindow = {
  games: number;
  targetsPerGame: number | null;
  targetShare: number | null;
  airYardsShare: number | null;
  receptionsPerGame: number | null;
  receivingYardsPerGame: number | null;
  carriesPerGame: number | null;
  carryShare: number | null;
  rushingYardsPerGame: number | null;
  passingYardsPerGame: number | null;
  redZoneOppsPerGame: number | null;
  redZoneShare: number | null;
  inside10OppsPerGame: number | null;
  touchdowns: number;
  pprPerGame: number | null;
};

export type UsageWeek = {
  week: number; opponent: string; targets: number; carries: number; redZoneOpps: number;
  targetShare: number | null; carryShare: number | null; touchdowns: number; ppr: number | null;
};

export type UsagePlayer = {
  playerId: string; name: string; position: 'QB' | 'RB' | 'WR' | 'TE'; team: string;
  headshot: string | null; lastWeek: number; season: UsageWindow; last3: UsageWindow; weekly: UsageWeek[];
};

export type DefenseLine = {
  games: number; pprPerGame: number | null; pprRank: number; vsAverage: number | null;
  yardsPerGame: number | null; yardsRank: number; tdsPerGame: number | null; tdsRank: number;
  receptionsPerGame: number | null; receptionsRank: number; targetsPerGame: number | null; targetsRank: number;
  redZoneOppsPerGame: number | null; redZoneOppsRank: number;
};

export type DefenseRow = { team: string; season: Record<string, DefenseLine>; last4: Record<string, DefenseLine> };

export type RedZoneTeam = {
  team: string; games: number; trips: number; touchdowns: number;
  tripsPerGame: number | null; tripsPerGameRank: number | null;
  tdRate: number | null; tdRateRank: number | null; passRate: number | null;
  allowedTripsPerGame: number | null; allowedTripsPerGameRank: number | null;
  allowedTdRate: number | null; allowedTdRateRank: number | null;
};

export type UsageReport = {
  season: number; throughWeek: number; weeks: number[]; generatedAt: string; source: string;
  players: UsagePlayer[]; defenses: DefenseRow[]; redZoneTeams: RedZoneTeam[];
};

export function useUsageReport() {
  const query = useGetConsumerUsageReport({ query: { queryKey: getGetConsumerUsageReportQueryKey(), staleTime: 5 * 60_000 } });
  const report = query.data?.status === 'available' ? query.data.report as unknown as UsageReport : null;
  return { query, report };
}

export const pct = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined ? '—' : `${(value * 100).toFixed(digits)}%`;
export const fixed = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? '—' : value.toFixed(digits);

/** Rank 1..n for a list of values (largest first unless ascending), ties share a rank. */
export function ranks<T>(rows: T[], value: (row: T) => number | null, ascending = false) {
  const sorted = rows.map(value).filter((v): v is number => v !== null).sort((a, b) => ascending ? a - b : b - a);
  return (row: T) => {
    const v = value(row);
    return v === null ? null : sorted.indexOf(v) + 1;
  };
}
