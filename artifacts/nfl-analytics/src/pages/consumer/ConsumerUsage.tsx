import {
  getGetConsumerPlayerUsageQueryKey,
  useGetConsumerPlayerUsage,
  type ConsumerUsageMetric,
  type ConsumerUsagePlayer,
  type GetConsumerPlayerUsageParams,
} from '@workspace/api-client-react';
import { useState } from 'react';
import { ConsumerLoading, ConsumerMessage, metric } from './consumer-ui';
import { ResponsiveContainer, LineChart, Line, XAxis, Tooltip } from 'recharts';
import { AlertTriangle, Info } from 'lucide-react';
import { trendLabel, usageChartData } from '../../lib/consumer-usage';

export default function ConsumerUsage() {
  const [team, setTeam] = useState('');
  const [position, setPosition] = useState('');
  const [windowFilter, setWindowFilter] = useState('last5');
  const [game, setGame] = useState('');

  const params: GetConsumerPlayerUsageParams = {
    ...(team ? { team } : {}),
    ...(position ? { position: position as GetConsumerPlayerUsageParams['position'] } : {}),
    ...(game ? { game } : {}),
    ...(windowFilter ? { window: windowFilter as GetConsumerPlayerUsageParams['window'] } : {}),
  };

  const query = useGetConsumerPlayerUsage(params, {
    query: {
      queryKey: getGetConsumerPlayerUsageQueryKey(params),
      staleTime: 60_000
    }
  });

  return (
    <div className="consumer-page">
      <header className="consumer-page-header">
        <div>
          <p className="consumer-eyebrow">Player Lab</p>
          <h1>Recent Usage & Production</h1>
          <p>Review persisted offensive roles, recent volume, and production efficiency without projections or recommendations.</p>
        </div>
        <div className="consumer-filters">
          <label>Team
            <input type="text" placeholder="e.g. KC" value={team} onChange={e => setTeam(e.target.value.toUpperCase())} maxLength={3} />
          </label>
          <label>Position
            <select value={position} onChange={e => setPosition(e.target.value)}>
              <option value="">All</option>
              <option value="QB">QB</option>
              <option value="RB">RB</option>
              <option value="WR">WR</option>
              <option value="TE">TE</option>
            </select>
          </label>
          <label>Game ID
            <input type="text" placeholder="Optional" value={game} onChange={e => setGame(e.target.value)} />
          </label>
          <label>Window
            <select value={windowFilter} onChange={e => setWindowFilter(e.target.value)}>
              <option value="last3">Last 3 games</option>
              <option value="last5">Last 5 games</option>
              <option value="last8">Last 8 games</option>
              <option value="season">Season to date</option>
            </select>
          </label>
        </div>
      </header>

      {query.isLoading ? (
        <ConsumerLoading label="Loading usage lab data..." />
      ) : query.isError ? (
        <ConsumerMessage error title="Usage data unavailable" detail="Could not load player usage for the requested filters." />
      ) : !query.data?.players.length ? (
        <ConsumerMessage
          title="No players found"
          detail={query.data?.sourceCoverage.partialReasons.join(' · ') || 'No persisted player-game records match the current filters.'}
        />
      ) : (
        <div className="usage-lab-results space-y-8">
          <div className="usage-meta flex gap-4 text-sm text-muted-foreground bg-card border border-border p-4 rounded-xl">
             <Info className="h-5 w-5 text-accent shrink-0" />
             <div>
               <p className="font-semibold text-foreground">Data status: {query.data.status}</p>
               <p>Included {query.data.sourceCoverage?.includedGames ?? 0} of {query.data.sourceCoverage?.requestedGames ?? 0} requested games.</p>
               {query.data.sourceCoverage?.partialReasons?.length > 0 && (
                 <ul className="mt-1 list-disc list-inside ml-4 text-xs">
                   {query.data.sourceCoverage.partialReasons.map((r: string) => <li key={r}>{r}</li>)}
                 </ul>
               )}
             </div>
          </div>
          
          <div className="grid gap-6">
            {query.data.players.map((player) => (
              <PlayerUsageCard key={player.playerId} player={player} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerUsageCard({ player }: { player: ConsumerUsagePlayer }) {
  const trend = player.trend;
  const trendTone = trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-rose-600' : 'text-muted-foreground';
  
  return (
    <div className="border border-border rounded-2xl bg-card overflow-hidden">
      <div className="flex items-center justify-between p-4 bg-sidebar text-sidebar-foreground">
         <div className="flex items-center gap-3">
           <div className="font-serif text-2xl font-bold">{player.playerName}</div>
           <div className="font-mono text-[10px] bg-sidebar-accent text-sidebar-accent-foreground px-2 py-1 rounded-full uppercase tracking-wider">
             {player.teamId} • {player.position}
           </div>
         </div>
         <div className={`font-mono text-xs uppercase tracking-wider flex items-center gap-2 ${trendTone}`}>
             {trendLabel(trend)}
         </div>
      </div>
      
      <div className="p-5 grid gap-6 md:grid-cols-[1fr_300px]">
        <div>
           <h4 className="text-xs uppercase tracking-widest text-accent font-mono font-semibold mb-4">Volume & Efficiency</h4>
           <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <MetricItem label="Snap Share" metric={player.aggregate?.snapShare} percent />
              <MetricItem label="Targets" metric={player.aggregate?.targets} />
              <MetricItem label="Target Share" metric={player.aggregate?.targetShare} percent />
              <MetricItem label="Receptions" metric={player.aggregate?.receptions} />
              <MetricItem label="Rec Yards" metric={player.aggregate?.receivingYards} />
              <MetricItem label="Yards/Target" metric={player.aggregate?.yardsPerTarget} />
              <MetricItem label="Carries" metric={player.aggregate?.carries} />
              <MetricItem label="Rush Yards" metric={player.aggregate?.rushingYards} />
              <MetricItem label="Yards/Carry" metric={player.aggregate?.yardsPerCarry} />
              <MetricItem label="Total TD" metric={player.aggregate?.totalTd} />
           </div>
           
           <div className="mt-6 pt-4 border-t border-border">
             <h4 className="text-xs uppercase tracking-widest text-muted-foreground font-mono font-semibold mb-3">Situational Context</h4>
             <div className="flex flex-wrap gap-3">
                <SituationalMetric label="Red Zone Touches" available={player.metricAvailability?.redZoneTouches} metricItem={player.aggregate?.redZoneTouches} />
                <SituationalMetric label="Red Zone Targets" available={player.metricAvailability?.redZoneTargets} metricItem={player.aggregate?.redZoneTargets} />
                <SituationalMetric label="Explosive Rate" available={player.metricAvailability?.explosiveRate} metricItem={player.aggregate?.explosiveRate} percent />
             </div>
           </div>
        </div>
        
        <div className="border-l border-border pl-6">
           <h4 className="text-xs uppercase tracking-widest text-accent font-mono font-semibold mb-4">Game-by-Game Targets & Carries</h4>
           <div className="h-40 w-full">
              <UsageChart games={player.games} />
           </div>
        </div>
      </div>
    </div>
  );
}

function MetricItem({ label, metric: m, percent = false }: { label: string, metric?: ConsumerUsageMetric, percent?: boolean }) {
  const isAvail = m?.available;
  const val = isAvail ? metric(m?.value, percent) : '—';
  
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1 font-medium">{label}</div>
      <div className="text-lg font-mono font-semibold text-foreground">
         {val}
      </div>
      {!isAvail && m?.reason && (
         <div className="text-[9px] text-muted-foreground/60 leading-tight mt-1">{m.reason}</div>
      )}
    </div>
  );
}

function SituationalMetric({ label, available, metricItem, percent = false }: { label: string, available?: boolean, metricItem?: ConsumerUsageMetric, percent?: boolean }) {
  if (available === false || !metricItem?.available) {
    return (
      <div className="inline-flex items-center gap-1.5 bg-secondary/50 text-muted-foreground px-2.5 py-1 rounded-md text-[10px] uppercase font-mono tracking-wider border border-border">
        <AlertTriangle className="h-3 w-3" />
        {label} N/A
      </div>
    );
  }
  
  if (!metricItem || metricItem.value === null) return null;

  return (
    <div className="inline-flex items-center gap-1.5 bg-secondary px-2.5 py-1 rounded-md text-[10px] uppercase font-mono tracking-wider border border-border text-foreground">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-semibold">{metric(metricItem.value, percent)}</span>
    </div>
  );
}

function UsageChart({ games }: { games: ConsumerUsagePlayer['games'] }) {
  if (!games?.length) return <div className="text-xs text-muted-foreground flex h-full items-center justify-center">No game history</div>;
  
  const data = usageChartData(games);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
        <Tooltip 
          contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', fontSize: '11px', borderRadius: '8px' }} 
          itemStyle={{ color: 'hsl(var(--foreground))' }}
        />
        <Line type="monotone" dataKey="targets" stroke="hsl(var(--accent))" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        <Line type="monotone" dataKey="carries" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}