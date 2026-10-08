import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { isPublicRoute } from '@/lib/route-access';
import { safeNextPath, signSession, verifySession } from '@/lib/session';

beforeAll(() => {
  process.env.SESSION_SECRET = 'unit-test-session-secret-at-least-32-characters';
});

describe('session token', () => {
  it('round-trips', async () => {
    const token = await signSession({ userId: 1, name: 'Clinic Staff', email: 'staff@clinic.test' });
    expect(await verifySession(token)).toEqual({ userId: 1, name: 'Clinic Staff', email: 'staff@clinic.test' });
  });
  it('rejects tampered or missing tokens', async () => {
    const token = await signSession({ userId: 1, name: 'A', email: 'a@b.c' });
    expect(await verifySession(token.slice(0, -2) + 'xx')).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession('garbage')).toBeNull();
  });
  it('rejects tokens signed with another secret', async () => {
    const token = await signSession({ userId: 1, name: 'A', email: 'a@b.c' });
    process.env.SESSION_SECRET = 'a-completely-different-secret-of-32-chars!!';
    expect(await verifySession(token)).toBeNull();
    process.env.SESSION_SECRET = 'unit-test-session-secret-at-least-32-characters';
  });
});

describe('session token claims (L2)', () => {
  const key = () => new TextEncoder().encode(process.env.SESSION_SECRET!);
  const base = () => new SignJWT({ name: 'A', email: 'a@b.c' }).setProtectedHeader({ alg: 'HS256' }).setSubject('1');
  it('rejects a token without exp', async () => {
    expect(await verifySession(await base().setIssuedAt().sign(key()))).toBeNull();
  });
  it('rejects a token without iat or sub', async () => {
    expect(await verifySession(await base().setExpirationTime('1h').sign(key()))).toBeNull();
    const noSub = await new SignJWT({ name: 'A', email: 'a@b.c' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(key());
    expect(await verifySession(noSub)).toBeNull();
  });
  it('rejects a far-future exp once the token is older than the 8 h TTL', async () => {
    const nineHoursAgo = Math.floor(Date.now() / 1000) - 9 * 3600;
    const t = await base().setIssuedAt(nineHoursAgo).setExpirationTime('10y').sign(key());
    expect(await verifySession(t)).toBeNull();
  });
  it('accepts a normal token with all claims', async () => {
    const t = await base().setIssuedAt().setExpirationTime('8h').sign(key());
    expect(await verifySession(t)).toMatchObject({ userId: 1 });
  });
});

describe('safeNextPath (no open redirect)', () => {
  it.each([
    ['/patients?q=maria', '/patients?q=maria'],
    ['/dashboard', '/dashboard'],
    ['//evil.com', '/dashboard'],
    ['https://evil.com', '/dashboard'],
    ['/\\evil.com', '/dashboard'],
    ['javascript:alert(1)', '/dashboard'],
    ['/login', '/dashboard'],
    [undefined, '/dashboard'],
    // M1: dot-segment bypasses that normalize to //evil.com
    ['/.//evil.com', '/dashboard'],
    ['/..//evil.com', '/dashboard'],
    ['/%2e%2e//evil.com', '/dashboard'],
    ['/%2E//evil.com', '/dashboard'],
    ['/././/evil.com', '/dashboard'],
    ['/a/..//evil.com', '/dashboard'],
    ['/.\\/evil.com', '/dashboard'],
    ['/%5cevil.com', '/dashboard'],
    ['/%2f%2fevil.com', '/dashboard'],
    ['/%09/evil.com', '/%09/evil.com'], // an ENCODED tab is a literal path segment: same origin
    ['/\t/evil.com', '/dashboard'],
    ['/\r\nLocation: x', '/dashboard'],
    ['%2F%2Fevil.com', '/dashboard'],
    ['http:/evil.com', '/dashboard'],
    // login/api targets, also after normalization
    ['/./api/patients', '/dashboard'],
    ['/a/../login', '/dashboard'],
    ['/login?next=/x', '/dashboard'],
    ['/api/patients', '/dashboard'],
    // normal paths pass through in normalized form
    ['/patients/1?x=1', '/patients/1?x=1'],
    ['/appointments/./5', '/appointments/5'],
    ['/reports?month=2026-10#top', '/reports?month=2026-10#top'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe('public routes (method-specific)', () => {
  it.each([
    ['/book', 'GET', true],
    ['/login', 'GET', true],
    ['/api/slots', 'GET', true],
    ['/api/slots', 'POST', false],
    ['/api/requests', 'POST', true],
    ['/api/requests', 'GET', false],
    ['/api/auth/login', 'POST', true],
    ['/api/auth/logout', 'POST', false],
    ['/api/cron/reminders', 'GET', true],
    ['/api/cron/reminders', 'POST', false],
    ['/dashboard', 'GET', false],
    ['/patients', 'GET', false],
    ['/api/patients', 'GET', false],
    ['/', 'GET', false],
    ['/bookings', 'GET', false],
  ])('%s %s -> public=%s', (path, method, expected) => {
    expect(isPublicRoute(path, method)).toBe(expected);
  });
});
