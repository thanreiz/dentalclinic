/**
 * Staff auth for Server Components and route handlers (FR11, NF03).
 * Middleware already blocks unauthenticated requests; every staff route handler and page
 * should ALSO call requireStaff()/requireStaffPage() (defense in depth).
 */
import 'server-only';
import bcrypt from 'bcryptjs';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { queryOne } from './db';
import {
  SESSION_COOKIE,
  safeNextPath,
  sessionCookieOptions,
  signSession,
  verifySession,
} from './session';
import type { StaffUser, UserRow } from './types';

export { SESSION_COOKIE, safeNextPath } from './session';

export const BCRYPT_COST = 12;
export const INVALID_LOGIN_MESSAGE = 'Invalid email or password';

/** Create the signed session cookie for a staff user (call from a route handler). */
export async function createSession(user: StaffUser): Promise<void> {
  const token = await signSession(user);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

/** Clear the session cookie. */
export async function destroySession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, '', sessionCookieOptions(0));
}

/** Current staff user from the session cookie, or null. */
export async function getSession(): Promise<StaffUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token);
}

/**
 * For route handlers:
 *   const auth = await requireStaff(); if (!auth.ok) return auth.response;
 */
export async function requireStaff(): Promise<{ ok: true; user: StaffUser } | { ok: false; response: NextResponse }> {
  const user = await getSession();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  return { ok: true, user };
}

/**
 * For staff pages (Server Components): returns the user or redirects to /login?next=<path>.
 * The middleware forwards the current path in the `x-pathname` request header.
 */
export async function requireStaffPage(nextPath?: string): Promise<StaffUser> {
  const user = await getSession();
  if (user) return user;
  const path = nextPath ?? (await headers()).get('x-pathname') ?? '/dashboard';
  redirect(`/login?next=${encodeURIComponent(safeNextPath(path))}`);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * A real cost-12 hash (of a random string nobody knows) to compare against when the email is
 * unknown, so timing doesn't reveal valid emails. A constant, so even the first unknown-email
 * login costs the same as a known one (SECURITY-REVIEW I4).
 */
export const DUMMY_HASH = '$2b$12$iwhi3eRu2yeFwkUnZZxBvOnA9n8XOS/Xx0NRyi.Ou9m/8fVVpA.au';

/**
 * Check email + password. Returns the staff user or null. Always runs one bcrypt compare,
 * whether or not the email exists, so response time does not reveal valid emails.
 */
export async function verifyCredentials(email: string, password: string): Promise<StaffUser | null> {
  const row = await queryOne<UserRow>(
    'SELECT user_id, name, email, password FROM users WHERE email = ? LIMIT 1',
    [email.trim().toLowerCase()],
  );
  const ok = await bcrypt.compare(password, row ? row.password : DUMMY_HASH);
  if (!row || !ok) return null;
  return { userId: row.user_id, name: row.name, email: row.email };
}
