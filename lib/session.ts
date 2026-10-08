/**
 * Session token primitives (jose HS256). Edge-safe: no Node APIs, no next/headers,
 * so both middleware.ts and lib/auth.ts use it.
 */
import { SignJWT, jwtVerify } from 'jose';
import type { StaffUser } from './types';

export const SESSION_COOKIE = 'session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours (PRD API: login)

let cachedKey: { secret: string; key: Uint8Array } | null = null;

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters');
  }
  if (!cachedKey || cachedKey.secret !== secret) {
    cachedKey = { secret, key: new TextEncoder().encode(secret) };
  }
  return cachedKey.key;
}

export async function signSession(user: StaffUser): Promise<string> {
  return new SignJWT({ name: user.name, email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Verify a session token. Returns the staff user, or null if missing/invalid/expired. */
export async function verifySession(token: string | undefined | null): Promise<StaffUser | null> {
  if (!token) return null;
  try {
    // exp/iat/sub must be present and the token no older than the session TTL, so a token minted
    // without `exp` (or with a far-future one) is still refused (SECURITY-REVIEW L2).
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
      maxTokenAge: SESSION_TTL_SECONDS,
    });
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    return {
      userId,
      name: typeof payload.name === 'string' ? payload.name : '',
      email: typeof payload.email === 'string' ? payload.email : '',
    };
  } catch {
    return null;
  }
}

/** Cookie attributes for the session cookie (httpOnly, Lax, Secure in production, path /). */
export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

/** Dummy origin used to normalize `next` values; never leaves this module. */
const NEXT_BASE = 'http://next.invalid';

/**
 * Only allow same-site relative paths as a post-login redirect (no open redirects, SECURITY-REVIEW M1).
 * The value is resolved against a dummy origin and the NORMALIZED result is checked and returned,
 * so dot segments (`/.//evil.com`, `/..//evil.com`, `/%2e%2e//evil.com`) can't turn into a
 * protocol-relative `//evil.com`. Returns `fallback` for anything suspicious.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || typeof next !== 'string') return fallback;
  // Must be a single-slash absolute path; no backslashes (browsers treat `\` as `/`) or control chars.
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  let u: URL;
  try {
    u = new URL(next, NEXT_BASE);
  } catch {
    return fallback;
  }
  if (u.origin !== NEXT_BASE) return fallback;
  const path = u.pathname;
  // The normalized path must still start with exactly one '/' and carry no encoded slashes (%2f, %5c).
  if (!path.startsWith('/') || path.startsWith('//') || /%2f|%5c/i.test(path)) return fallback;
  if (path === '/login' || path.startsWith('/login/') || path === '/api' || path.startsWith('/api/')) return fallback;
  return path + u.search + u.hash;
}
