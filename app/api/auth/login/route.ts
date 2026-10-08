/** POST /api/auth/login (public). FR11: bcrypt check, 8-hour signed session cookie. */
import { NextResponse } from 'next/server';
import { createSession, INVALID_LOGIN_MESSAGE, verifyCredentials } from '@/lib/auth';
import { parseJsonBody } from '@/lib/http';
import { loginSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, loginSchema);
  if (!parsed.ok) return parsed.response;

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) {
    // Same message whichever field was wrong (PRD Phase 1 acceptance).
    return NextResponse.json({ error: 'invalid_credentials', message: INVALID_LOGIN_MESSAGE }, { status: 401 });
  }
  await createSession(user);
  return NextResponse.json({ ok: true, user: { name: user.name, email: user.email } });
}
