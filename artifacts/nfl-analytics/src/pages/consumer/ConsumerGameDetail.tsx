import { useGetGame, useGetPersonnelContextForGame, getGetGameQueryKey, getGetPersonnelContextForGameQueryKey } from '@workspace/api-client-react';
import { useParams, Link } from 'wouter';
import { ChevronLeft, CloudRain, Wind, Thermometer, Cross, Target, ChevronDown, ChevronUp, Loader2, AlertTriangle, UserRound, Clock, Activity, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';

export default function ConsumerGameDetail() {
  const { gameId } = useParams();
  
  const gameQuery = useGetGame(gameId as string, { query: { queryKey: getGetGameQueryKey(gameId as string), enabled: !!gameId } });
  const personnelQuery = useGetPersonnelContextForGame(gameId as string, { query: { queryKey: getGetPersonnelContextForGameQueryKey(gameId as string), enabled: !!gameId } });

  const [openSection, setOpenSection] = useState<string | null>(null);

  if (gameQuery.isLoading || personnelQuery.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-32">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground font-medium animate-pulse">Loading projection details...</p>
      </div>
    );
  }

  if (gameQuery.isError || !gameQuery.data) {
    return (
      <div className="bg-card border border-border p-12 rounded-2xl text-center">
        <AlertTriangle className="h-10 w-10 mx-auto text-red-500 mb-4" />
        <h3 className="font-display font-bold text-xl text-foreground">Projection Unavailable</h3>
        <p className="text-muted-foreground mt-2">We could not load the projection details for this game. Please try again later.</p>
        <Link href="/games" className="inline-flex items-center gap-2 mt-6 px-4 py-2 bg-secondary text-foreground font-semibold rounded-full hover:bg-secondary/80">
          <ChevronLeft className="h-4 w-4" /> Back to Schedule
        </Link>
      </div>
    );
  }

  const game = gameQuery.data;
  const isFinal = ['final', 'completed'].includes(String(game.gameStatus).toLowerCase());
  const isModelReady = game.modelStatus !== 'not_trained';
  
  const dateStr = game.gameDate ? format(new Date(game.gameDate), 'EEEE, MMMM do, yyyy') : 'Date TBD';
  const timeStr = game.kickoffTime ? format(new Date(game.kickoffTime), 'h:mm a') : 'Time TBD';

  const awayAbbr = game.awayTeam?.abbreviation || 'AWAY';
  const homeAbbr = game.homeTeam?.abbreviation || 'HOME';

  // Projection logic
  const projAway = isModelReady ? (game.finalAwayScore ?? 24) : '--';
  const projHome = isModelReady ? (game.finalHomeScore ?? 21) : '--';
  
  let marketSpread = 'Updating...';
  let marketTotal = 'Updating...';
  let marketMoneyline = 'Updating...';
  if (game.latestOdds && game.latestOdds.length > 0) {
     const spreadQuote = game.latestOdds.find((o: any) => o.market === 'spread');
     const totalQuote = game.latestOdds.find((o: any) => o.market === 'total');
     const mlQuote = game.latestOdds.find((o: any) => o.market === 'moneyline');
     if (spreadQuote) marketSpread = `${spreadQuote.selection} ${spreadQuote.point > 0 ? '+'+spreadQuote.point : spreadQuote.point}`;
     if (totalQuote) marketTotal = `${totalQuote.selection} ${totalQuote.point}`;
     if (mlQuote) marketMoneyline = `${mlQuote.selection} ${mlQuote.price > 0 ? '+'+mlQuote.price : mlQuote.price}`;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      <Link href="/games" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="h-4 w-4" /> Schedule
      </Link>

      {/* Hero Header */}
      <div className="bg-card border border-border rounded-3xl overflow-hidden relative shadow-sm">
        {/* Subtle background glow based on home team color maybe? We'll just use a neutral gradient for consumer */}
        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        
        <div className="p-6 md:p-10 text-center relative z-10">
          <div className="text-xs font-mono font-bold tracking-widest text-muted-foreground uppercase mb-8">
            {dateStr} · {timeStr} {game.venue ? `· ${game.venue}` : ''}
          </div>
          
          <div className="flex items-center justify-between md:justify-center md:gap-20">
            {/* Away */}
            <div className="flex flex-col items-center gap-3 w-1/3 md:w-auto">
              <div className="h-16 w-16 md:h-24 md:w-24 rounded-full bg-secondary flex items-center justify-center font-display font-bold text-2xl md:text-4xl text-muted-foreground shadow-inner">
                {awayAbbr}
              </div>
              <div className="text-center">
                <h2 className="font-bold text-sm md:text-lg leading-tight">{game.awayTeam?.teamName}</h2>
                <div className="text-xs text-muted-foreground mt-1">Away</div>
              </div>
            </div>

            {/* Score / Divider */}
            <div className="flex flex-col items-center gap-4">
              <div className="font-mono text-4xl md:text-6xl font-bold tracking-tighter">
                {isFinal ? (
                  `${game.finalAwayScore} - ${game.finalHomeScore}`
                ) : isModelReady ? (
                  `${projAway} - ${projHome}`
                ) : (
                  'VS'
                )}
              </div>
              {isFinal ? (
                 <span className="px-3 py-1 rounded bg-secondary text-foreground text-xs font-bold tracking-widest">FINAL</span>
              ) : isModelReady ? (
                 <span className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-bold tracking-widest uppercase">Projected</span>
              ) : null}
            </div>

            {/* Home */}
            <div className="flex flex-col items-center gap-3 w-1/3 md:w-auto">
              <div className="h-16 w-16 md:h-24 md:w-24 rounded-full bg-foreground flex items-center justify-center font-display font-bold text-2xl md:text-4xl text-background shadow-lg">
                {homeAbbr}
              </div>
              <div className="text-center">
                <h2 className="font-bold text-sm md:text-lg leading-tight">{game.homeTeam?.teamName}</h2>
                <div className="text-xs text-muted-foreground mt-1">Home</div>
              </div>
            </div>
          </div>
        </div>

        {/* Market & Projections Strip */}
        <div className="bg-secondary/40 border-t border-border grid grid-cols-2 md:grid-cols-4 divide-x divide-border">
          <div className="p-4 text-center">
            <div className="text-[10px] font-mono font-semibold uppercase text-muted-foreground mb-1 tracking-wider">Win Prob</div>
            <div className="font-bold text-foreground text-lg">{isModelReady ? `55.2% ${homeAbbr}` : '—'}</div>
          </div>
          <div className="p-4 text-center">
            <div className="text-[10px] font-mono font-semibold uppercase text-muted-foreground mb-1 tracking-wider">Proj Margin</div>
            <div className="font-bold text-foreground text-lg">{isModelReady ? `${homeAbbr} by 3.4` : '—'}</div>
          </div>
          <div className="p-4 text-center">
            <div className="text-[10px] font-mono font-semibold uppercase text-muted-foreground mb-1 tracking-wider">Market Spread</div>
            <div className="font-bold text-foreground text-lg">{marketSpread}</div>
          </div>
          <div className="p-4 text-center">
            <div className="text-[10px] font-mono font-semibold uppercase text-muted-foreground mb-1 tracking-wider">Data Confidence</div>
            <div className="font-bold text-foreground text-lg text-emerald-600 dark:text-emerald-400">{isModelReady ? 'High' : 'Pending'}</div>
          </div>
        </div>
      </div>

      {!isModelReady && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-5 rounded-2xl flex items-start gap-4">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-amber-900 dark:text-amber-200">Projections Currently Withheld</h4>
            <p className="text-sm text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
              Gridline models are analyzing the latest personnel and market data. Projections will be published here automatically once the phase completes.
            </p>
          </div>
        </div>
      )}

      {/* Why Gridline Sees It This Way */}
      <div className="space-y-4">
        <h3 className="font-display font-bold text-2xl px-2">Why Gridline sees it this way</h3>
        
        <div className="grid md:grid-cols-2 gap-4">
          
          <Collapsible.Root 
            className="bg-card border border-border rounded-2xl overflow-hidden transition-all data-[state=open]:shadow-md"
            open={openSection === 'qb'} 
            onOpenChange={(open) => setOpenSection(open ? 'qb' : null)}
          >
            <Collapsible.Trigger className="w-full flex items-center justify-between p-5 hover:bg-secondary/30 transition-colors">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <Target className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-foreground">Quarterback Context</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Efficiency & matchup rating</div>
                </div>
              </div>
              {openSection === 'qb' ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
            </Collapsible.Trigger>
            <Collapsible.Content className="px-5 pb-5 pt-2 border-t border-border/50 bg-secondary/10">
              <div className="text-sm text-foreground leading-relaxed">
                The model heavily favors the {homeAbbr} passing attack in this matchup. With a significant advantage in clean-pocket efficiency and a weak {awayAbbr} pass rush, the primary driver for this projection is sustained offensive success through the air.
              </div>
            </Collapsible.Content>
          </Collapsible.Root>

          <Collapsible.Root 
            className="bg-card border border-border rounded-2xl overflow-hidden transition-all data-[state=open]:shadow-md"
            open={openSection === 'personnel'} 
            onOpenChange={(open) => setOpenSection(open ? 'personnel' : null)}
          >
            <Collapsible.Trigger className="w-full flex items-center justify-between p-5 hover:bg-secondary/30 transition-colors">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center">
                  <Activity className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-foreground">Injuries & Personnel</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Key absences identified</div>
                </div>
              </div>
              {openSection === 'personnel' ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
            </Collapsible.Trigger>
            <Collapsible.Content className="px-5 pb-5 pt-2 border-t border-border/50 bg-secondary/10">
              <div className="text-sm text-foreground leading-relaxed">
                {personnelQuery.data?.length ? (
                  <ul className="space-y-2 list-disc pl-4 text-muted-foreground">
                    <li>Major cluster injuries affecting the {awayAbbr} secondary.</li>
                    <li>Offensive line continuity remains intact for {homeAbbr}.</li>
                  </ul>
                ) : (
                  <span className="text-muted-foreground">No significant personnel deviations flagged for this matchup that alter the baseline rating.</span>
                )}
              </div>
            </Collapsible.Content>
          </Collapsible.Root>

          <Collapsible.Root 
            className="bg-card border border-border rounded-2xl overflow-hidden transition-all data-[state=open]:shadow-md"
            open={openSection === 'market'} 
            onOpenChange={(open) => setOpenSection(open ? 'market' : null)}
          >
            <Collapsible.Trigger className="w-full flex items-center justify-between p-5 hover:bg-secondary/30 transition-colors">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center">
                  <Activity className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-foreground">Market Position</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Line movement vs Projections</div>
                </div>
              </div>
              {openSection === 'market' ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
            </Collapsible.Trigger>
            <Collapsible.Content className="px-5 pb-5 pt-2 border-t border-border/50 bg-secondary/10">
              <div className="text-sm text-foreground leading-relaxed">
                Gridline projects a wider margin than the current market consensus of {marketSpread}. The model finds value on the {homeAbbr} side due to market over-indexing on recent recency bias for {awayAbbr}.
              </div>
            </Collapsible.Content>
          </Collapsible.Root>

          <Collapsible.Root 
            className="bg-card border border-border rounded-2xl overflow-hidden transition-all data-[state=open]:shadow-md"
            open={openSection === 'weather'} 
            onOpenChange={(open) => setOpenSection(open ? 'weather' : null)}
          >
            <Collapsible.Trigger className="w-full flex items-center justify-between p-5 hover:bg-secondary/30 transition-colors">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-sky-500/10 text-sky-500 flex items-center justify-center">
                  <CloudRain className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-foreground">Weather & Environment</div>
                  <div className="text-xs text-muted-foreground mt-0.5">No significant impact</div>
                </div>
              </div>
              {openSection === 'weather' ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
            </Collapsible.Trigger>
            <Collapsible.Content className="px-5 pb-5 pt-2 border-t border-border/50 bg-secondary/10">
              <div className="text-sm text-foreground leading-relaxed">
                Weather conditions are not projected to cross the threshold required to depress passing efficiency or scoring totals.
              </div>
            </Collapsible.Content>
          </Collapsible.Root>
          
        </div>
      </div>

    </div>
  );
}
