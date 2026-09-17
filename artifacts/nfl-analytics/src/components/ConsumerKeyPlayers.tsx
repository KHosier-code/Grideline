import type { ConsumerKeyPlayer, ConsumerTeam } from '@workspace/api-client-react';
import { AlertTriangle } from 'lucide-react';

export function ConsumerKeyPlayers({ players, away, home }: { players: ConsumerKeyPlayer[], away: ConsumerTeam, home: ConsumerTeam }) {
  const awayPlayers = (players ?? []).filter(p => p.teamId === away.abbreviation);
  const homePlayers = (players ?? []).filter(p => p.teamId === home.abbreviation);

  return (
    <section className="consumer-key-players mt-12">
      <div className="consumer-section-heading mb-6">
        <div>
          <p className="consumer-eyebrow">Personnel</p>
          <h2>Key Players</h2>
        </div>
      </div>
      
      <div className="grid gap-8 lg:grid-cols-2">
        <TeamKeyPlayers team={away} players={awayPlayers} />
        <TeamKeyPlayers team={home} players={homePlayers} />
      </div>
    </section>
  );
}

function TeamKeyPlayers({ team, players }: { team: ConsumerTeam, players: ConsumerKeyPlayer[] }) {
  if (!players.length) return (
    <div className="border border-border rounded-2xl bg-card p-6 flex flex-col items-center justify-center text-center text-muted-foreground h-full">
      <AlertTriangle className="h-6 w-6 mb-3 text-border" />
      <p>No key player data available for {team.name}.</p>
    </div>
  );

  return (
    <div className="border border-border rounded-2xl bg-card overflow-hidden">
      <header className="bg-sidebar text-sidebar-foreground px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="font-serif text-xl font-bold">{team.name}</span>
        </div>
      </header>
      
      <div className="divide-y divide-border">
        {players.map(player => (
          <div key={player.playerId} className="p-5 flex flex-col gap-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-foreground text-lg">{player.name}</div>
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mt-1">
                  {player.position}
                </div>
              </div>
              
              <div className="text-right">
                <div className="text-xs font-semibold">
                  {player.currentPersonnel?.depthRank ? `Depth Rank ${player.currentPersonnel.depthRank}` : 'Depth Rank Unavailable'}
                </div>
                {player.currentPersonnel?.injuryStatus && player.currentPersonnel.injuryStatus !== 'None' && (
                  <div className="text-[10px] text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded uppercase tracking-wider font-mono inline-block mt-1">
                    {player.currentPersonnel.injuryStatus}
                  </div>
                )}
                <div className="text-[9px] text-muted-foreground/60 mt-1 uppercase tracking-widest">{player.currentPersonnel?.source || 'Source Unspecified'}</div>
              </div>
            </div>
            
            <div className="bg-secondary/40 rounded-xl p-4">
               <h4 className="text-[10px] uppercase font-mono tracking-widest text-accent mb-3 font-semibold">Recent Production</h4>
               {Object.keys(player.recentUsage || {}).length > 0 ? (
                 <div className="grid grid-cols-3 gap-3">
                   {Object.entries(player.recentUsage).map(([key, value]) => (
                     <div key={key}>
                       <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={key.replace(/([A-Z])/g, ' $1').trim()}>{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                       <div className="text-sm font-mono font-semibold text-foreground mt-0.5">{value !== null ? value : <span className="text-[10px] text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded border border-border inline-flex items-center gap-1"><AlertTriangle className="h-2.5 w-2.5" /> N/A</span>}</div>
                     </div>
                   ))}
                 </div>
               ) : (
                 <div className="text-xs text-muted-foreground italic flex items-center gap-1.5"><AlertTriangle className="h-3 w-3" /> Production unavailable</div>
               )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}