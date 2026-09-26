import { useState } from 'react';
import { UserRound } from 'lucide-react';

export function imageAvailable(url: string | null, failedUrl: string | null) {
  return Boolean(url && url !== failedUrl);
}

export function PlayerPortrait({ url, name }: { url: string | null; name: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const visible = imageAvailable(url, failedUrl);
  return <div className="puc-avatar" role="img" aria-label={visible ? `Portrait of ${name}` : `Photo unavailable for ${name}`}>
    {visible ? <img src={url!} alt="" onError={() => setFailedUrl(url)} loading="lazy" decoding="async" /> : <UserRound className="h-5 w-5" aria-hidden="true" />}
  </div>;
}

export function TeamMark({ url, abbreviation, className }: { url: string | null; abbreviation: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <span className={className} role="img" aria-label={`${abbreviation} team mark`}>
    {imageAvailable(url, failedUrl) ? <img src={url!} alt="" onError={() => setFailedUrl(url)} /> : abbreviation}
  </span>;
}