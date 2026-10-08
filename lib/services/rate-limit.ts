/**
 * Best-effort in-memory throttles (no 8th table, per the PRD):
 *   - login: 10 failed attempts per IP + email per 15 minutes, and 50 per email from any IP
 *     (rotating IPs does not buy many more guesses) -> 429 too_many_attempts;
 *   - public booking requests: REQUEST_LIMIT_PER_IP accepted requests per IP per
 *     REQUEST_LIMIT_IP_WINDOW_MINUTES -> 429 too_many_requests (the DB-backed caps in
 *     lib/services/request-limits.ts are the real, cross-instance limit).
 *
 * Memory is per server instance: on Vercel each warm lambda keeps its own counts and a cold start
 * resets them, so these slow casual abuse but are not hard guarantees (bcrypt cost 12 and a strong
 * staff password are the real brakes for login). A shared store would need an 8th table.
 */
import { envInt } from './env-int';

export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_MAX_FAILURES_PER_EMAIL = 50;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

type Entry = { count: number; resetAt: number };

/** A fixed-window counter keyed by string. */
class Buckets {
  private map = new Map<string, Entry>();

  retryAfter(key: string, max: number, now: number): number {
    const e = this.map.get(key);
    if (!e || e.resetAt <= now) return 0;
    return e.count >= max ? Math.ceil((e.resetAt - now) / 1000) : 0;
  }

  hit(key: string, windowMs: number, now: number): void {
    this.prune(now);
    const e = this.map.get(key);
    if (!e || e.resetAt <= now) this.map.set(key, { count: 1, resetAt: now + windowMs });
    else e.count++;
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  private prune(now: number) {
    if (this.map.size < 5000) return;
    for (const [k, v] of this.map) if (v.resetAt <= now) this.map.delete(k);
  }
}

const firstHop = (v: string | null) => v?.split(',')[0]?.trim() || '';
const lastHop = (v: string | null) => {
  const parts = v?.split(',').map((p) => p.trim()).filter(Boolean) ?? [];
  return parts[parts.length - 1] ?? '';
};

/**
 * Client IP for throttling, without trusting client-supplied headers more than necessary.
 * - On Vercel (`VERCEL` env set by the platform): `x-vercel-forwarded-for`, then `x-real-ip`,
 *   then the first `x-forwarded-for` hop. Vercel overwrites these, so clients can't spoof them.
 * - Anywhere else (local `next start`, self-hosting): the LAST `x-forwarded-for` hop, i.e. the
 *   address the nearest proxy (or Next itself) saw. Vercel-specific headers are ignored there
 *   because any client could send them. Without a proxy a client can still pick its XFF value;
 *   the per-email login bucket and the DB-backed booking caps don't depend on the IP.
 * Returns 'unknown' when nothing is available.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  if (process.env.VERCEL) {
    return firstHop(h.get('x-vercel-forwarded-for')) || h.get('x-real-ip')?.trim() || firstHop(h.get('x-forwarded-for')) || 'unknown';
  }
  return lastHop(h.get('x-forwarded-for')) || 'unknown';
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

const loginBuckets = new Buckets();
const normEmail = (email: string) => email.trim().toLowerCase();
const ipEmailKey = (ip: string, email: string) => `ip:${ip}|${normEmail(email)}`;
const emailKey = (email: string) => `email:${normEmail(email)}`;

/** Seconds until the caller may try again, or 0 if allowed. */
export function loginRetryAfter(ip: string, email: string, now = Date.now()): number {
  return Math.max(
    loginBuckets.retryAfter(ipEmailKey(ip, email), LOGIN_MAX_FAILURES, now),
    loginBuckets.retryAfter(emailKey(email), LOGIN_MAX_FAILURES_PER_EMAIL, now),
  );
}

export function recordLoginFailure(ip: string, email: string, now = Date.now()): void {
  loginBuckets.hit(ipEmailKey(ip, email), LOGIN_WINDOW_MS, now);
  loginBuckets.hit(emailKey(email), LOGIN_WINDOW_MS, now);
}

/** Success clears this IP's count only; the per-email window still runs out on its own. */
export function clearLoginFailures(ip: string, email: string): void {
  loginBuckets.delete(ipEmailKey(ip, email));
}

/** Tests only. */
export function resetLoginThrottle(): void {
  loginBuckets.clear();
}

// ---------------------------------------------------------------------------
// Public booking requests (POST /api/requests), per IP
// ---------------------------------------------------------------------------

const requestBuckets = new Buckets();

/** Accepted requests allowed per IP per window (REQUEST_LIMIT_PER_IP, default 5; 0 = off). */
export const requestLimitPerIp = () => envInt('REQUEST_LIMIT_PER_IP', 5);
/** Window for the per-IP limit (REQUEST_LIMIT_IP_WINDOW_MINUTES, default 10). */
export const requestIpWindowMs = () => Math.max(1, envInt('REQUEST_LIMIT_IP_WINDOW_MINUTES', 10)) * 60 * 1000;

/** Seconds until this IP may send another request, or 0. Unknown IPs are not limited here. */
export function requestRetryAfter(ip: string, now = Date.now()): number {
  const max = requestLimitPerIp();
  if (max <= 0 || ip === 'unknown') return 0;
  return requestBuckets.retryAfter(ip, max, now);
}

/** Count one accepted (201) request for this IP. */
export function recordRequest(ip: string, now = Date.now()): void {
  if (requestLimitPerIp() <= 0 || ip === 'unknown') return;
  requestBuckets.hit(ip, requestIpWindowMs(), now);
}

/** Tests only. */
export function resetRequestThrottle(): void {
  requestBuckets.clear();
}
