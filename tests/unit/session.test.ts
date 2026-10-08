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
