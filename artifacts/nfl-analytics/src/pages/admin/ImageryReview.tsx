import { useEffect, useState } from 'react';

type Candidate = {
  playerId: string;
  playerName: string | null;
  sourceEspnId: string | null;
  imageUrl: string;
  sourceHash: string | null;
  provider: string;
  rightsEvidence: { status: string; review: string; termsUrl: string; approvedHosts: string[] };
  review: null | { decision: string; previousDecision: string; reason: string; reviewerId: string;
    reviewedAt: string; imageHash: string; sourceHash: string; imageUrl: string };
};
type Queue = { candidates: Candidate[]; sources: { roster: { stale?: boolean; fetchedAt: string } | null } };
type PastReview = { id: number; decision: string; imageHash: string; sourceHash: string; imageUrl: string;
  rightsEvidence: string; reason: string; reviewerId: string; reviewedAt: string };

export default function ImageryReview() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [preview, setPreview] = useState<{ url: string; hash: string } | null>(null);
  const [history, setHistory] = useState<PastReview[]>([]);
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function reload() {
    const response = await fetch('/api/admin/verified-imagery/report', { credentials: 'include' });
    if (!response.ok) throw new Error(`Review queue unavailable (${response.status})`);
    setQueue(await response.json() as Queue);
  }
  useEffect(() => { void reload().catch(e => setError(String(e))); }, []);
  useEffect(() => {
    setPreview(null);
    if (!selected?.sourceHash) return;
    let cancelled = false;
    const id = encodeURIComponent(selected.playerId);
    void fetch(`/api/admin/verified-imagery/candidates/${id}/image?sourceHash=${encodeURIComponent(selected.sourceHash)}`, {
      credentials: 'include',
    }).then(async response => {
      if (!response.ok) throw new Error(`Image preview unavailable (${response.status})`);
      const hash = response.headers.get('X-Image-SHA256');
      if (!hash) throw new Error('Image fingerprint unavailable');
      const blob = await response.blob();
      if (!cancelled) setPreview({ url: URL.createObjectURL(blob), hash });
    }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [selected?.playerId, selected?.sourceHash, selected?.imageUrl]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    setHistory([]);
    if (!selected) return;
    let cancelled = false;
    void fetch(`/api/admin/verified-imagery/candidates/${encodeURIComponent(selected.playerId)}/history`, { credentials: 'include' })
      .then(async response => {
        if (!response.ok) throw new Error('Review history unavailable');
        if (!cancelled) setHistory(await response.json() as PastReview[]);
      }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [selected?.playerId]);

  async function decide(decision: 'approved' | 'rejected') {
    if (!selected?.sourceHash || !preview || !reason.trim()) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/admin/verified-imagery/candidates/${encodeURIComponent(selected.playerId)}/review`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceHash: selected.sourceHash, imageHash: preview.hash, decision, reason }),
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? `Review failed (${response.status})`);
      await reload();
      setSelected(null); setReason('');
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const candidates = queue?.candidates.filter(c =>
    `${c.playerId} ${c.playerName ?? ''} ${c.sourceEspnId ?? ''}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const allowed = selected?.rightsEvidence.approvedHosts.includes(new URL(selected.imageUrl).hostname);
  return <main className="mx-auto max-w-6xl px-6 py-8 text-foreground">
    <h1 className="text-2xl font-bold">Player image review</h1>
    <p className="mt-2 text-sm text-muted-foreground">Compare the actual image with the source player identity before deciding. A decision applies only to this source version and these exact image bytes. No batch is published automatically.</p>
    {error && <p role="alert" className="my-4 rounded border border-red-500 p-3 text-red-500">{error}</p>}
    <div className="my-5 flex gap-3">
      <input aria-label="Search player identity" className="rounded border bg-background p-2" placeholder="Search name or ID" value={search} onChange={e => setSearch(e.target.value)} />
      <button className="button button-subtle" onClick={() => void reload().catch(e => setError(String(e)))}>Refresh queue</button>
    </div>
    {!queue ? <p>Loading candidates…</p> : !candidates.length ? <p>No matching reconciled candidates. Ambiguous IDs are excluded.</p> :
      <div className="grid gap-5 md:grid-cols-[minmax(240px,1fr)_minmax(320px,2fr)]">
        <div className="max-h-[65vh] overflow-y-auto rounded border p-2" aria-label="Image candidates">
          {candidates.map(c => <button type="button" key={c.playerId} onClick={() => { setSelected(c); setError(''); }}
            className="mb-1 block w-full rounded border p-3 text-left hover:bg-muted" aria-current={selected?.playerId === c.playerId}>
            <strong>{c.playerName ?? 'Name unavailable'}</strong> <span className="text-xs">{c.playerId}</span>
            <small className="block">{c.review?.decision ?? 'needs_review'}</small>
          </button>)}
        </div>
        {selected && <section className="rounded border p-5">
          <h2 className="text-xl font-semibold">{selected.playerName ?? 'Unverified name'} · {selected.playerId}</h2>
          <p>Source ESPN ID: {selected.sourceEspnId ?? 'unavailable'}</p>
          <p>Provider: {selected.provider}</p>
          <p className="break-all text-xs">Source SHA-256: {selected.sourceHash ?? 'unavailable'}</p>
          <p className="break-all text-xs">Image source: {selected.imageUrl}</p>
          <p>Rights: {selected.rightsEvidence.status} — {selected.rightsEvidence.review} <a href={selected.rightsEvidence.termsUrl} target="_blank" rel="noreferrer" className="underline">Terms</a></p>
          {preview ? <><img src={preview.url} alt={`Candidate to compare with ${selected.playerName ?? selected.playerId}`} className="my-4 max-h-72 max-w-full object-contain" />
            <p className="break-all text-xs">Inspected image SHA-256: {preview.hash}</p></> : <p className="my-4">Loading safe preview…</p>}
          {selected.review && <p className="my-3 rounded border p-3 text-sm">Latest decision: {selected.review.previousDecision} by {selected.review.reviewerId} on {selected.review.reviewedAt}. {selected.review.reason}
            {selected.review.decision === 'needs_review' && ' Source or URL changed; review again.'}
            {preview && selected.review.imageHash !== preview.hash && ' Image bytes changed; previous decision does not apply.'}</p>}
          {history.length > 0 && <details className="my-3"><summary>Decision history ({history.length})</summary>
            <ol className="max-h-48 overflow-y-auto text-xs">{history.map(record =>
              <li key={record.id} className="my-2 border-b pb-2">
                {record.decision} · {record.reviewedAt} · {record.reviewerId} · {record.reason}
                <span className="block break-all">Source: {record.sourceHash} · Image: {record.imageHash} · URL: {record.imageUrl}</span>
                <span className="block break-all">Rights evidence: {record.rightsEvidence}</span>
              </li>)}</ol>
          </details>}
          <label className="mt-4 block">Reason for decision
            <textarea className="mt-1 block w-full rounded border bg-background p-2" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} />
          </label>
          <div className="mt-3 flex gap-3">
            <button className="button button-subtle" disabled={!preview || !reason.trim() || busy || queue.sources.roster?.stale} onClick={() => void decide('rejected')}>Reject / dispute</button>
            <button className="button button-primary" disabled={!preview || !reason.trim() || busy || !allowed || queue.sources.roster?.stale} onClick={() => void decide('approved')}>Approve this image</button>
          </div>
          {!allowed && <p className="mt-2 text-sm">Approval unavailable: the photo host has no public display grant. Rejections can still be recorded.</p>}
        </section>}
      </div>}
  </main>;
}