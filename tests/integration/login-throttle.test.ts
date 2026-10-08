/** POST /api/auth/login best-effort throttle: 10 failures per IP + email (and 50 per email) per 15 min -> 429. */
import { afterAll, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/auth/login/route';
import { loginRetryAfter, LOGIN_WINDOW_MS, recordLoginFailure, resetLoginThrottle } from '@/lib/services/rate-limit';

afterAll(() => resetLoginThrottle());

const attempt = (email: string, ip = '203.0.113.7') =>
  login(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      // Off Vercel the LAST X-Forwarded-For hop is used (the address the nearest proxy saw).
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `6.6.6.6, ${ip}` },
      body: JSON.stringify({ email, password: 'wrong-password' }),
    }),
  );

describe('login throttle', () => {
  it('10 wrong passwords -> 401 each, then 429 with Retry-After; other IP unaffected', async () => {
    for (let i = 0; i < 10; i++) expect((await attempt('staff@clinic.test')).status).toBe(401);
    const blocked = await attempt('STAFF@clinic.test');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await blocked.json()).error).toBe('too_many_attempts');
    expect((await attempt('staff@clinic.test', '198.51.100.2')).status).toBe(401);
  }, 60_000);

  it('window expires', () => {
    resetLoginThrottle();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) recordLoginFailure('1.1.1.1', 'a@b.c', t0);
    expect(loginRetryAfter('1.1.1.1', 'a@b.c', t0 + 1000)).toBeGreaterThan(0);
    expect(loginRetryAfter('1.1.1.1', 'a@b.c', t0 + LOGIN_WINDOW_MS + 1)).toBe(0);
  });
});
