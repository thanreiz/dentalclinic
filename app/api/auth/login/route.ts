/** POST /api/auth/login (public). FR11: bcrypt check, 8-hour signed session cookie. */
import { NextResponse } from 'next/server';
import { createSession, INVALID_LOGIN_MESSAGE, verifyCredentials } from '@/lib/auth';
import { jsonError, parseJsonBody } from '@/lib/http';
import { clearLoginFailures, clientIp, loginRetryAfter, recordLoginFailure } from '@/lib/services/rate-limit';
import { loginSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, loginSchema);
  if (!parsed.ok) return parsed.response;

  const ip = clientIp(req);
  const wait = loginRetryAfter(ip, parsed.data.email);
  if (wait > 0) {
    const res = jsonError(429, 'too_many_attempts', { message: 'Too many login attempts. Please wait a few minutes and try again.' });
    res.headers.set('Retry-After', String(wait));
    return res;
  }

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) {
    recordLoginFailure(ip, parsed.data.email);
    // Same message whichever field was wrong (PRD Phase 1 acceptance).
    return NextResponse.json({ error: 'invalid_credentials', message: INVALID_LOGIN_MESSAGE }, { status: 401 });
  }
  clearLoginFailures(ip, parsed.data.email);
  await createSession(user);
  return NextResponse.json({ ok: true, user: { name: user.name, email: user.email } });
}
