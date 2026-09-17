import { useState } from 'react';
import { AlertTriangle, UserRound } from 'lucide-react';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

type AdminDepthChartProps = {
  team: any;
  score: (val: any) => any;
  decimal: (val: any, digits?: number) => any;
  bool: (val: any) => string;
  formatDate: (val: any, inclTime?: boolean) => string;
};

export function AdminDepthChart({ team, score, decimal, bool, formatDate }: AdminDepthChartProps) {
  const [filter, setFilter] = useState<'all' | 'offense' | 'defense'>('all');

  const offensePositions = ['QB', 'RB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'OL'];
  
  const isOffense = (starter: any) => 
    offensePositions.includes(starter.position) || 
    starter.unit === 'quarterback' || 
    starter.unit === 'running_back' || 
    starter.unit === 'wide_receiver' || 
    starter.unit === 'tight_end' || 
    starter.unit === 'offensive_line';

  const starters = team.starters || [];
  
  const filteredStarters = starters.filter((s: any) => {
    if (filter === 'all') return true;
    if (filter === 'offense') return isOffense(s);
    return !isOffense(s); // defense
  });

  return (
    <div className="mt-4">
      {/* Conflicts and Issues remain unchanged but styled better */}
      {team.sourceConflicts?.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs text-warning-foreground shadow-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold !mb-1 text-inherit">Source conflicts detected</p>
              <ul className="list-inside list-disc opacity-90 space-y-1">
                {team.sourceConflicts.map((conflict: any, idx: number) => (
                  <li key={`${conflict.position ?? 'unknown'}-${idx}`}>
                    <strong>{conflict.position ?? 'Unknown position'}:</strong> {conflict.reason ?? 'Sources disagree.'}{' '}
                    {conflict.players?.length ? `Players: ${conflict.players.join(', ')}.` : ''}{' '}
                    {conflict.sources?.length ? `Sources: ${conflict.sources.join(', ')}.` : ''}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {team.missingRequiredPositions?.length > 0 && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive shadow-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold !mb-1 text-inherit">Missing positions</p>
              <p className="opacity-90 mt-1">
                The following positions lack sufficient starter evidence:{' '}
                <strong>{team.missingRequiredPositions.join(', ')}</strong>
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <div className="flex bg-secondary/50 rounded-md p-1 shadow-inner">
          {(['all', 'offense', 'defense'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cx(
                "px-3 py-1 text-xs font-semibold rounded-sm capitalize transition-colors",
                filter === f ? "bg-card text-ink shadow-sm" : "text-muted-foreground hover:text-ink"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-auto">
          {filteredStarters.length} players shown
        </span>
      </div>

      {!filteredStarters.length ? (
        <div className="py-8 text-center border border-dashed border-border rounded-xl">
          <UserRound className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm font-semibold text-ink">No personnel records found</p>
          <p className="text-xs text-muted-foreground mt-1">Check source data availability.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredStarters.map((starter: any) => (
            <AdminPlayerCard 
              key={`${team.teamId}-${starter.playerId}-${starter.position}`}
              starter={starter}
              score={score}
              decimal={decimal}
              formatDate={formatDate}
            />
          ))}
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm text-xs">
          <p className="font-mono font-bold tracking-widest text-muted-foreground uppercase mb-3">Quarterback context</p>
          <dl className="space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
              <dt className="text-muted-foreground">Recent dropbacks</dt>
              <dd className="font-mono font-bold text-ink">{team.qb?.recentDropbacks ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
              <dt className="text-muted-foreground">EPA / dropback</dt>
              <dd className="font-mono font-bold text-ink">{decimal(team.qb?.recentEpaPerDropback, 3)}</dd>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
              <dt className="text-muted-foreground">Success rate</dt>
              <dd className="font-mono font-bold text-ink">{decimal(team.qb?.recentSuccessRate, 3)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Starter change</dt>
              <dd className="font-mono font-bold text-ink">{bool(team.qb?.starterChange)}</dd>
            </div>
          </dl>
        </div>
        
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm text-xs">
          <p className="font-mono font-bold tracking-widest text-muted-foreground uppercase mb-3">Rest & Travel</p>
          <dl className="space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
              <dt className="text-muted-foreground">Days rest</dt>
              <dd className="font-mono font-bold text-ink">{decimal(team.rest?.daysRest, 1)}</dd>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
              <dt className="text-muted-foreground">Short week</dt>
              <dd className="font-mono font-bold text-ink">{bool(team.rest?.shortWeek)}</dd>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-border/50">
              <dt className="text-muted-foreground">Bye return</dt>
              <dd className="font-mono font-bold text-ink">{bool(team.rest?.byeWeekReturn)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Road-game run</dt>
              <dd className="font-mono font-bold text-ink">{team.rest?.consecutiveRoadGames ?? '—'}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-5">
        <p className="font-mono font-bold tracking-widest text-muted-foreground uppercase text-xs mb-3">Player-level injury impact</p>
        {team.injuryPlayers?.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {team.injuryPlayers.map((injury: any) => (
              <div className="rounded-xl border border-border bg-card p-3 shadow-sm text-xs transition-shadow hover:shadow-md" key={`${team.teamId}-${injury.playerId}`}>
                <div className="flex justify-between items-start gap-2 mb-2">
                  <p className="font-bold text-ink truncate">{injury.playerName ?? injury.playerId}</p>
                  <span className="font-mono font-bold shrink-0 bg-destructive/10 text-destructive px-1.5 rounded">{decimal(injury.impactScore, 1)} imp</span>
                </div>
                <div className="flex items-center gap-1 mb-2 text-[10px] uppercase font-mono text-muted-foreground">
                  <span>{injury.position ?? 'Unknown'}</span>
                  <span>•</span>
                  <span className="truncate">{injury.gameStatus ?? injury.designation ?? 'Status unknown'}</span>
                </div>
                
                <div className="grid grid-cols-2 gap-2 mb-2 border-t border-border/50 pt-2">
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Snap Share</p>
                    <p className="font-mono font-semibold text-ink">{decimal(injury.recentSnapShare)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Starter Likelh.</p>
                    <p className="font-mono font-semibold text-ink">{decimal(injury.starterLikelihood)}</p>
                  </div>
                </div>
                <p className="text-[10px] leading-4 text-muted-foreground line-clamp-2" title={injury.derivation}>
                  {injury.derivation}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 border border-dashed border-border rounded-xl text-center">
            <p className="text-xs text-muted-foreground">No injury snapshot was available for this team before the cutoff.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminPlayerCard({ starter, score, decimal, formatDate }: { starter: any, score: any, decimal: any, formatDate: any }) {
  const isOfficial = starter.classification === 'official';
  const isSecondary = starter.classification === 'published_secondary';
  
  const statusColor = isOfficial ? 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' 
    : isSecondary ? 'text-amber-600 bg-amber-500/10 border-amber-500/20' 
    : 'text-muted-foreground bg-secondary border-border';

  const mappingState = starter.mappingState || starter.mappingStatus;

  return (
    <div className="group rounded-xl border border-border bg-card p-3 shadow-sm transition-all hover:shadow-md hover:border-border/80 flex flex-col h-full">
      <div className="flex justify-between items-start mb-2">
        <div className="min-w-0 flex-1 pr-2">
          <p className="font-bold text-ink truncate text-sm" title={starter.playerName ?? starter.playerId}>
            {starter.playerName ?? starter.playerId}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="font-mono font-bold text-xs bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">
              {starter.position ?? '—'}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">
              Depth: {starter.estimatedDepthPosition || '?'}
            </span>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <span className={cx("text-[9px] uppercase font-mono font-bold px-1.5 py-0.5 rounded-sm border", statusColor)}>
            {starter.classification?.replace('_', ' ') || 'Unknown'}
          </span>
          <span className="text-[10px] font-mono font-bold bg-secondary/40 px-1.5 py-0.5 rounded text-ink/70" title="Starter Confidence">
            {score(starter.confidence) ?? '—'}/100
          </span>
        </div>
      </div>

      <div className="flex-1 text-[10px] text-muted-foreground mb-3 space-y-1">
        <p className="line-clamp-2 leading-4" title={starter.recentStarterEvidence?.length ? starter.recentStarterEvidence.join(' ') : starter.evidence?.join(' ') || starter.unavailableReason}>
          <span className="font-semibold text-ink/60">Evid:</span> {starter.recentStarterEvidence?.length ? starter.recentStarterEvidence.join(' ') : starter.evidence?.join(' ') || starter.unavailableReason || 'None'}
        </p>
        <p className="truncate"><span className="font-semibold text-ink/60">Source:</span> {starter.source}</p>
        <p className="truncate"><span className="font-semibold text-ink/60">Timestamp:</span> {starter.snapshotTimestamp ? formatDate(starter.snapshotTimestamp, true) : 'Unavailable'} ({starter.dataFreshness})</p>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
        <div>
          <p className="text-[9px] font-mono uppercase text-muted-foreground mb-0.5">Participation</p>
          <p className="text-xs font-semibold text-ink leading-tight">
            {decimal(starter.recentSnapShare, 2)} snap
          </p>
          <p className="text-[9px] text-muted-foreground truncate" title={starter.priorWeekParticipation?.participated === null || starter.priorWeekParticipation?.participated === undefined ? 'Prior week unavailable' : starter.priorWeekParticipation.participated ? 'Played prior week' : 'No prior week'}>
            {starter.priorWeekParticipation?.participated === null || starter.priorWeekParticipation?.participated === undefined ? 'Prior N/A' : starter.priorWeekParticipation.participated ? 'Played prior' : 'No prior'}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-mono uppercase text-muted-foreground mb-0.5">Injury / Status</p>
          <p className="text-xs font-semibold text-ink leading-tight truncate">
            {starter.injuryStatus?.gameStatus ?? starter.injuryStatus?.practiceStatus ?? 'Active'}
          </p>
          <p className="text-[9px] text-muted-foreground truncate">
             {mappingState ? `Mapped: ${mappingState}` : 'Mapping status unavailable'}
          </p>
        </div>
      </div>
    </div>
  );
}
