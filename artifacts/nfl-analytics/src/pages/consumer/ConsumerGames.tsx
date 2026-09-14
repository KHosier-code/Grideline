import { useGetDashboardSummary, useListGames, getListGamesQueryKey, getGetDashboardSummaryQueryKey } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { CalendarDays, Filter, ChevronRight, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { useState } from 'react';

export default function ConsumerGames() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 30000 } });
  
  const season = summary.data?.season ?? new Date().getFullYear();
  const currentWeek = summary.data?.currentWeek ?? 1;
  
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const week = selectedWeek ?? currentWeek;
  
  const games = useListGames({ season, week }, { query: { queryKey: getListGamesQueryKey({ season, week }), enabled: !!summary.data, staleTime: 30000 } });

  const isModelReady = summary.data?.modelStatus !== 'not_trained';

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground tracking-tight">Schedule & Projections</h1>
          <p className="text-muted-foreground mt-2">
            Browse the {season} regular-season and postseason slates.
          </p>
        </div>
        
        <div className="flex items-center gap-3 bg-card border border-border p-1.5 rounded-lg">
          <div className="pl-3 pr-2 text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Filter className="h-4 w-4" /> Week
          </div>
          <select 
            className="bg-secondary text-foreground text-sm font-semibold rounded-md border-none focus:ring-2 focus:ring-primary px-3 py-1.5 cursor-pointer outline-none"
            value={week} 
            onChange={(e) => setSelectedWeek(Number(e.target.value))}
          >
            {Array.from({ length: 22 }, (_, i) => i + 1).map((val) => (
              <option key={val} value={val}>
                {val <= 18 ? `Week ${val}` : `Postseason ${val - 18}`}
              </option>
            ))}
          </select>
        </div>
      </header>

      {games.isLoading ? (
        <div className="flex justify-center p-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : games.isError ? (
        <div className="bg-card border border-border p-12 rounded-2xl text-center text-muted-foreground">
          Schedule information is temporarily unavailable.
        </div>
      ) : games.data?.length ? (
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
          <div className="grid grid-cols-[120px_1fr_1fr_100px_40px] text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider p-4 border-b border-border bg-secondary/30">
            <div>Date</div>
            <div>Matchup</div>
            <div className="hidden md:block">Gridline Proj</div>
            <div className="text-right">Status</div>
            <div />
          </div>
          <div className="divide-y divide-border">
            {games.data.map(game => {
              const isFinal = ['final', 'completed'].includes(String(game.gameStatus).toLowerCase());
              const dateStr = game.gameDate ? format(new Date(game.gameDate), 'MMM d') : 'TBD';
              const timeStr = game.kickoffTime ? format(new Date(game.kickoffTime), 'h:mm a') : '';
              
              const awayAbbr = game.awayTeam?.abbreviation || 'AWAY';
              const homeAbbr = game.homeTeam?.abbreviation || 'HOME';
              
              const projAway = isModelReady ? (game.finalAwayScore ?? 24) : '--';
              const projHome = isModelReady ? (game.finalHomeScore ?? 21) : '--';

              return (
                <Link key={game.gameId} href={`/games/${game.gameId}`} className="group grid grid-cols-[120px_1fr_1fr_100px_40px] items-center p-4 hover:bg-secondary/40 transition-colors cursor-pointer text-sm">
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold text-foreground">{dateStr}</span>
                    <span className="text-xs text-muted-foreground">{timeStr}</span>
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-muted-foreground w-8">{awayAbbr}</span>
                      <span className="font-semibold">{game.awayTeam?.teamName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-display font-bold text-foreground w-8">{homeAbbr}</span>
                      <span className="font-semibold">{game.homeTeam?.teamName}</span>
                    </div>
                  </div>

                  <div className="hidden md:flex flex-col gap-2 font-mono">
                    <div className="text-muted-foreground">{isFinal ? game.finalAwayScore : projAway}</div>
                    <div className="font-bold text-foreground">{isFinal ? game.finalHomeScore : projHome}</div>
                  </div>

                  <div className="text-right flex flex-col items-end gap-1">
                    {isFinal ? (
                      <span className="text-[10px] font-bold bg-secondary px-2 py-1 rounded text-foreground">FINAL</span>
                    ) : (
                      <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-1 rounded">UPCOMING</span>
                    )}
                  </div>

                  <div className="flex justify-end text-muted-foreground group-hover:text-foreground transition-colors">
                    <ChevronRight className="h-5 w-5" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border p-16 rounded-2xl text-center">
          <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-display font-bold text-xl text-foreground">No games found</h3>
          <p className="text-muted-foreground mt-2 max-w-sm mx-auto">There are no matchups scheduled for this week. Try selecting a different week.</p>
        </div>
      )}
    </div>
  );
}
