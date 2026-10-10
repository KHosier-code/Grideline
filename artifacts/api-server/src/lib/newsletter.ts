import { and, eq } from "drizzle-orm";
import { db, weeklyReportsTable } from "@workspace/db";

/**
 * The "Get Tuesday's picks" newsletter, sent through Buttondown
 * (BUTTONDOWN_API_KEY in Replit Secrets). The key stays on the server: the
 * site posts an address here, never to Buttondown directly.
 *
 * Buttondown applies double opt-in to new subscribers, so an address only
 * starts receiving mail after its owner clicks the confirmation link.
 */
/** Overridable so tests can point at a stand-in. */
const API = process.env.BUTTONDOWN_API_URL || "https://api.buttondown.com/v1";
const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]{1,64}@[^\s@<>()[\],;:"]{1,255}\.[a-z]{2,24}$/i;

export function newsletterConfigured(environment: NodeJS.ProcessEnv = process.env) {
  return Boolean(environment.BUTTONDOWN_API_KEY?.trim());
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

async function buttondown(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Token ${process.env.BUTTONDOWN_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, text: (await response.text()).slice(0, 600) };
}

export type SubscribeResult = "subscribed" | "invalid" | "not_configured" | "failed";

/**
 * Adds an address. An address that is already subscribed counts as success,
 * so the form never reveals who is on the list.
 */
export async function subscribe(email: string, source: string): Promise<{ result: SubscribeResult; detail?: string }> {
  if (!newsletterConfigured()) return { result: "not_configured" };
  const tags = [...new Set(["site", source.replace(/[^a-z0-9-]/gi, "").slice(0, 30) || "site"])];
  // Buttondown's v1 API takes `email_address`; older accounts took `email`.
  let response = await buttondown("/subscribers", { email_address: email, tags });
  if (response.status === 400 && /email_address/.test(response.text) && !/already/i.test(response.text)) {
    response = await buttondown("/subscribers", { email, tags });
  }
  if (response.status >= 200 && response.status < 300) return { result: "subscribed" };
  if (/already|exists|duplicate/i.test(response.text)) return { result: "subscribed" };
  if (response.status === 400 && /invalid|valid email|email/i.test(response.text)) return { result: "invalid", detail: response.text };
  return { result: "failed", detail: `HTTP ${response.status}: ${response.text}` };
}

export type DraftResult = { status: "created" | "exists" | "not_configured" | "failed"; detail?: string };

/** Creates this week's Tuesday email as a Buttondown draft, once per season-week. */
export async function createWeeklyDraft(input: { season: number; week: number; subject: string; body: string }): Promise<DraftResult> {
  if (!newsletterConfigured()) return { status: "not_configured" };
  const [existing] = await db.select({ id: weeklyReportsTable.id }).from(weeklyReportsTable).where(and(
    eq(weeklyReportsTable.kind, "newsletter-draft"), eq(weeklyReportsTable.season, input.season), eq(weeklyReportsTable.week, input.week),
  )).limit(1);
  if (existing) return { status: "exists" };
  const response = await buttondown("/emails", { subject: input.subject, body: input.body, status: "draft" });
  if (response.status < 200 || response.status >= 300) return { status: "failed", detail: `HTTP ${response.status}: ${response.text}` };
  let id: string | null = null;
  try { id = (JSON.parse(response.text) as { id?: string }).id ?? null; } catch { /* body cut short; the draft still exists */ }
  await db.insert(weeklyReportsTable).values({
    kind: "newsletter-draft", season: input.season, week: input.week, generatedAt: new Date(),
    payload: { buttondownId: id, subject: input.subject },
  }).onConflictDoNothing();
  return { status: "created" };
}

/** At most `limit` attempts per key in `windowMs` (in memory; resets on restart). */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.delete(hits.keys().next().value!);
    return true;
  };
}
