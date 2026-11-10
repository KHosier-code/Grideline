/**
 * Restores model runs that are on the public `receipts` branch but missing
 * from the database (everything before the October 2026 database move).
 *
 * The caller supplies nothing but the go-ahead: the server reads the branch
 * from GitHub itself, so a restored run can only be one that was published
 * there. Each run's received time is the time of the GitHub commit that saved
 * it. The Weekly picks workflow commits right after it sends a payload, so the
 * commit time is never earlier than the moment the site first received it:
 * a restored pick can only look later than it really was, never earlier.
 */
export const RECEIPTS_REPO = "KHosier-code/Grideline";
export const RECEIPTS_BRANCH = "receipts";

export type ReceiptKind = "games" | "touchdowns";
export type ReceiptFile = { path: string; season: number; week: number; stamp: string; kind: ReceiptKind };
export type ReceiptCommit = { sha: string; committedAt: Date };
export type DatedReceipt = ReceiptFile & ReceiptCommit;

const PATH = /^(\d{4})\/week-(\d{2})\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)-(games|touchdowns)\.json$/;

/** `2026/week-05/2026-10-11T12-18-05Z-games.json` → its season, week, run stamp and kind. */
export function parseReceiptPath(path: string): ReceiptFile | null {
  const match = PATH.exec(path);
  if (!match) return null;
  const week = Number(match[2]);
  if (week < 1 || week > 22) return null;
  return { path, season: Number(match[1]), week, stamp: match[3], kind: match[4] as ReceiptKind };
}

/** The stamp in a file name as a time: 2026-10-11T12-18-05Z → 2026-10-11T12:18:05Z. */
export function stampTime(stamp: string) {
  return new Date(stamp.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, "T$1:$2:$3Z"));
}

type GitHubCommit = { sha: string; commit: { message: string; committer: { date: string } | null } };

/**
 * save-receipts.sh commits every file of a run in one commit titled
 * "Receipts <stamp>", using the same stamp as the file names. Map each stamp
 * to that commit. A stamp committed twice keeps the earliest commit, the one
 * that first published it.
 */
export function commitsByStamp(commits: GitHubCommit[]) {
  const byStamp = new Map<string, ReceiptCommit>();
  for (const item of commits) {
    const stamp = /^Receipts (\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)\s*$/.exec(item.commit.message.split("\n")[0] ?? "")?.[1];
    const date = item.commit.committer?.date ? new Date(item.commit.committer.date) : null;
    if (!stamp || !date || Number.isNaN(date.getTime())) continue;
    const known = byStamp.get(stamp);
    if (!known || date < known.committedAt) byStamp.set(stamp, { sha: item.sha, committedAt: date });
  }
  return byStamp;
}

/**
 * Pair each receipt file with its commit. A file whose run stamp is after its
 * commit, or more than a day before it, is left out: that is not how the
 * workflow writes them, so it can't be trusted as a timestamp.
 */
export function datedReceipts(paths: string[], byStamp: Map<string, ReceiptCommit>) {
  const files: DatedReceipt[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const path of paths) {
    const file = parseReceiptPath(path);
    if (!file) continue;
    const commit = byStamp.get(file.stamp);
    if (!commit) { skipped.push({ path, reason: "no matching commit" }); continue; }
    const lag = commit.committedAt.getTime() - stampTime(file.stamp).getTime();
    if (lag < 0 || lag > 86_400_000) { skipped.push({ path, reason: "commit time does not match the run" }); continue; }
    files.push({ ...file, ...commit });
  }
  return { files: files.sort((a, b) => a.stamp.localeCompare(b.stamp) || a.path.localeCompare(b.path)), skipped };
}

type Fetch = typeof fetch;

/**
 * A token only raises GitHub's rate limit (shared hosting IPs often hit the
 * anonymous one). It reads public data, so it can't change what is restored.
 */
function githubHeaders(token?: string) {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "probable-receipts-restore" };
  token = token?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubJson<T>(url: string, fetchImpl: Fetch, token?: string): Promise<T> {
  const response = await fetchImpl(url, { headers: githubHeaders(token), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${url}`);
  return await response.json() as T;
}

/** Every receipt file on the branch with the commit that published it. Two to a few GitHub API calls. */
export async function listReceipts(fetchImpl: Fetch = fetch, token?: string) {
  const api = `https://api.github.com/repos/${RECEIPTS_REPO}`;
  const tree = await githubJson<{ tree: Array<{ path: string; type: string }>; truncated?: boolean }>(
    `${api}/git/trees/${RECEIPTS_BRANCH}?recursive=1`, fetchImpl, token);
  if (tree.truncated) throw new Error("The receipts tree is too large to list in one call");
  const commits: GitHubCommit[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await githubJson<GitHubCommit[]>(`${api}/commits?sha=${RECEIPTS_BRANCH}&per_page=100&page=${page}`, fetchImpl, token);
    commits.push(...batch);
    if (batch.length < 100) break;
  }
  return datedReceipts(tree.tree.filter((item) => item.type === "blob").map((item) => item.path), commitsByStamp(commits));
}

/** The file exactly as committed, read at its commit so later pushes can't change it. */
export async function readReceipt(file: DatedReceipt, fetchImpl: Fetch = fetch): Promise<unknown> {
  const url = `https://raw.githubusercontent.com/${RECEIPTS_REPO}/${file.sha}/${file.path}`;
  const response = await fetchImpl(url, { headers: { "User-Agent": "probable-receipts-restore" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${file.path}`);
  return await response.json();
}
