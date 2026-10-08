/**
 * Best-effort in-memory login throttle: 10 failed attempts per IP + email per 15 minutes -> 429.
 * Memory is per server instance: on Vercel each warm lambda keeps its own counts and a cold start
 * resets them, so this slows casual guessing but is not a hard guarantee (bcrypt cost 12 is the
 * real brake). A shared store (DB table) would need an 8th table, which the paper forbids.
 */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

type Entry = { count: number; resetAt: number };
const buckets = new Map<string, Entry>();

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

const keyOf = (ip: string, email: string) => `${ip}|${email.trim().toLowerCase()}`;

function prune(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}

/** Seconds until the caller may try again, or 0 if allowed. */
export function loginRetryAfter(ip: string, email: string, now = Date.now()): number {
  const e = buckets.get(keyOf(ip, email));
  if (!e || e.resetAt <= now) return 0;
  return e.count >= LOGIN_MAX_FAILURES ? Math.ceil((e.resetAt - now) / 1000) : 0;
}

export function recordLoginFailure(ip: string, email: string, now = Date.now()): void {
  prune(now);
  const k = keyOf(ip, email);
  const e = buckets.get(k);
  if (!e || e.resetAt <= now) buckets.set(k, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else e.count++;
}

export function clearLoginFailures(ip: string, email: string): void {
  buckets.delete(keyOf(ip, email));
}

/** Tests only. */
export function resetLoginThrottle(): void {
  buckets.clear();
}
