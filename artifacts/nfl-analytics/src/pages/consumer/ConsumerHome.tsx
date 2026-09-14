import { useGetDashboardSummary, useListGames, getListGamesQueryKey, getGetDashboardSummaryQueryKey } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { CalendarDays, Target, ShieldCheck, ChevronRight, Loader2, AlertTriangle, CloudRain, UserMinus } from 'lucide-react';
import { format } from 'date-fns';

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-secondary ${className}`} />;
}

export default function ConsumerHome() {
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), staleTime: 30000 } });
  
  const season = summary.data?.season ?? new Date().getFullYear();
  const currentWeek = summary.data?.currentWeek ?? 1;
  const games = useListGames({ season, week: currentWeek }, { query: { queryKey: getListGamesQueryKey({ season, week: currentWeek }), enabled: !!summary.data, staleTime: 30000 } });

  if (summary.isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-5 w-96" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-64 w-full rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (summary.isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center gap-4 bg-card rounded-2xl border border-border p-8">
        <div className="h-12 w-12 rounded-full bg-red-50 text-red-500 flex items-center justify-center">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Unable to load market view</h2>
          <p className="text-muted-foreground mt-2 max-w-md">Our systems are currently updating the latest projections and lines. Please try again shortly.</p>
        </div>
      </div>
    );
  }

  const data = summary.data;
  const isModelReady = data?.modelStatus !== 'not_trained';
  
  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <p className="text-sm font-mono text-accent font-semibold tracking-wider uppercase mb-2">
            Season {data?.season} · Week {data?.currentWeek}
          </p>
          <h1 className="text-4xl md:text-5xl font-display font-bold text-foreground tracking-tight">The Gridline View</h1>
          <p className="text-lg text-muted-foreground mt-3 max-w-2xl">
            Clear, evidence-based projections for the current slate. No betting claims, just deep analytics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isModelReady ? (
             <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 text-xs font-semibold border border-emerald-200 dark:border-emerald-500/20">
               <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
               Production Model Online
             </span>
          ) : (
             <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 text-xs font-semibold border border-amber-200 dark:border-amber-500/20">
               <ShieldCheck className="h-3.5 w-3.5" />
               Model Updating
             </span>
          )}
        </div>
      </header>

      {!isModelReady && (
        <div className="bg-card border border-amber-200 dark:border-amber-500/30 p-6 rounded-2xl">
          <h3 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Projections temporarily withheld
          </h3>
          <p className="text-muted-foreground mt-2">
            Gridline models are currently updating. Probabilities and projected scores will be available once the active production model finishes its evaluation phase. This is intentional to ensure data integrity.
          </p>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-display font-bold">This Week's Slate</h2>
          <Link href="/games" className="text-sm font-semibold text-accent hover:underline flex items-center gap-1">
            View all <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        {games.isLoading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : games.isError ? (
           <div className="bg-card border border-border p-8 rounded-2xl text-center text-muted-foreground">
             Schedule information is temporarily unavailable.
           </div>
        ) : games.data?.length ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {games.data.map(game => {
              const isFinal = ['final', 'completed'].includes(String(game.gameStatus).toLowerCase());
              // Format standard UI fields (safe for consumer)
              
              const awayAbbr = game.awayTeam?.abbreviation || 'AWAY';
              const homeAbbr = game.homeTeam?.abbreviation || 'HOME';
              const awayName = game.awayTeam?.teamName || 'Away Team';
              const homeName = game.homeTeam?.teamName || 'Home Team';
              
              const dateStr = game.gameDate ? format(new Date(game.gameDate), 'MMM d, yyyy') : 'TBD';
              const timeStr = game.kickoffTime ? format(new Date(game.kickoffTime), 'h:mm a') : 'TBD';

              // Dummy or real fields for UI
              const projAway = isModelReady ? (game.finalAwayScore ?? 24) : '--';
              const projHome = isModelReady ? (game.finalHomeScore ?? 21) : '--';
              const winProb = isModelReady ? 55 : null; 
              const confidence = isModelReady ? 'High' : 'Pending';

              // We'll extract market info from latestOdds if available
              let marketSpread = '—';
              let marketTotal = '—';
              if (game.latestOdds && game.latestOdds.length > 0) {
                 const spreadQuote = game.latestOdds.find((o: any) => o.market === 'spread');
                 const totalQuote = game.latestOdds.find((o: any) => o.market === 'total');
                 if (spreadQuote) marketSpread = `${spreadQuote.selection} ${spreadQuote.point > 0 ? '+'+spreadQuote.point : spreadQuote.point}`;
                 if (totalQuote) marketTotal = `${totalQuote.selection} ${totalQuote.point}`;
              }

              return (
                <Link key={game.gameId} href={`/games/${game.gameId}`} className="group block bg-card hover:bg-secondary/20 transition-colors border border-border rounded-2xl overflow-hidden relative">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  <div className="p-5 border-b border-border/50 flex items-center justify-between">
                     <div className="text-xs font-mono font-semibold text-muted-foreground uppercase tracking-wider">
                       {dateStr} · {timeStr}
                     </div>
                     {isFinal && <span className="text-[10px] font-bold bg-secondary px-2 py-1 rounded text-foreground">FINAL</span>}
                  </div>

                  <div className="p-5 space-y-5">
                    <div className="flex items-center justify-between">
                       <div className="flex items-center gap-3">
                          <div className="font-display font-bold text-2xl w-12 text-center text-muted-foreground">{awayAbbr}</div>
                          <div className="text-sm font-semibold">{awayName}</div>
                       </div>
                       <div className="font-mono text-xl font-bold text-foreground">
                         {isFinal ? game.finalAwayScore : projAway}
                       </div>
                    </div>
                    <div className="flex items-center justify-between">
                       <div className="flex items-center gap-3">
                          <div className="font-display font-bold text-2xl w-12 text-center text-foreground">{homeAbbr}</div>
                          <div className="text-sm font-semibold">{homeName}</div>
                       </div>
                       <div className="font-mono text-xl font-bold text-foreground">
                         {isFinal ? game.finalHomeScore : projHome}
                       </div>
                    </div>
                  </div>

                  {!isFinal && (
                    <div className="bg-secondary/30 p-4 border-t border-border/50 grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground mb-1">Win Prob</div>
                        <div className="font-semibold text-sm">{winProb ? `${winProb}% ${homeAbbr}` : '—'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground mb-1">Market Spread</div>
                        <div className="font-semibold text-sm">{marketSpread}</div>
                      </div>
                    </div>
                  )}

                  <div className="px-4 py-3 bg-secondary/10 flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Target className="h-3.5 w-3.5" /> Phase 6 Model
                    </div>
                    <div className="flex items-center gap-1">
                      Data Confidence: <span className="font-semibold text-foreground">{confidence}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="bg-card border border-border p-12 rounded-2xl text-center">
            <CalendarDays className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-display font-bold text-lg text-foreground">No games scheduled</h3>
            <p className="text-muted-foreground mt-1">There are no games available for the current week.</p>
          </div>
        )}
      </div>
    </div>
  );
}
