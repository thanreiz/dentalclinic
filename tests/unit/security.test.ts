/** Pure security fixes (docs/SECURITY-REVIEW.md): H2 seed guard, M2 flag, L3 throttles, L4 logs, I1/I3 bodies, L1 headers. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSeedAllowed } from '@/db/reset';
import { DEFAULT_SEED_STAFF_PASSWORD, remoteSeedPasswordProblem, resolveSeedStaffPassword } from '@/db/seed';
import { MAX_JSON_BODY_BYTES, readJsonBody } from '@/lib/http';
import { MISMATCH_PREFIX, mismatchFlag, splitMismatchFlag, withMismatchFlag } from '@/lib/patient-note';
import { safeErrorSummary } from '@/lib/services/errors';
import {
  clientIp,
  LOGIN_MAX_FAILURES,
  LOGIN_MAX_FAILURES_PER_EMAIL,
  LOGIN_WINDOW_MS,
  loginRetryAfter,
  recordLoginFailure,
  recordRequest,
  requestRetryAfter,
  resetLoginThrottle,
  resetRequestThrottle,
} from '@/lib/services/rate-limit';

afterEach(() => {
  vi.unstubAllEnvs();
  resetLoginThrottle();
  resetRequestThrottle();
});

describe('H2: remote seed password guard', () => {
  const REMOTE = 'mysql://u:p@x.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED';
  const LOCAL = 'mysql://root@127.0.0.1:3307/dental';
  const env = (pw?: string) => ({ SEED_STAFF_PASSWORD: pw }) as unknown as NodeJS.ProcessEnv;

  it.each([
    [undefined, /not set/],
    ['', /not set/],
    ['   ', /not set/],
    [DEFAULT_SEED_STAFF_PASSWORD, /default/],
    ['short-pass1', /shorter than 12/],
  ])('remote + %j -> refused', (pw, why) => {
    expect(remoteSeedPasswordProblem({}, env(pw))).toMatch(why);
    expect(() => assertSeedAllowed(REMOTE, {}, env(pw))).toThrow(/Refusing to seed a NON-LOCAL database/);
  });
  it('remote + strong password -> allowed; explicit option also counts', () => {
    expect(() => assertSeedAllowed(REMOTE, {}, env('correct-horse-battery-9'))).not.toThrow();
    expect(() => assertSeedAllowed(REMOTE, { staffPassword: 'another-strong-one-42' }, env(undefined))).not.toThrow();
    expect(() => assertSeedAllowed(REMOTE, { staffPassword: DEFAULT_SEED_STAFF_PASSWORD }, env('correct-horse-battery-9'))).toThrow();
  });
  it('remote schema-only reset (seed: false) and local hosts are not affected', () => {
    expect(() => assertSeedAllowed(REMOTE, { seed: false }, env(undefined))).not.toThrow();
    expect(() => assertSeedAllowed(LOCAL, {}, env(undefined))).not.toThrow();
    expect(() => assertSeedAllowed(LOCAL, {}, env(DEFAULT_SEED_STAFF_PASSWORD))).not.toThrow();
  });
  it('local default still works; blank env var means unset', () => {
    expect(resolveSeedStaffPassword({}, env(undefined))).toBe(DEFAULT_SEED_STAFF_PASSWORD);
    expect(resolveSeedStaffPassword({}, env(''))).toBe(DEFAULT_SEED_STAFF_PASSWORD);
    expect(resolveSeedStaffPassword({}, env('my-own-password-1'))).toBe('my-own-password-1');
  });
});

describe('M2: "details differ" flag', () => {
  const record = { fullName: 'Maria Santos', email: 'maria.santos@example.com', birthdate: '1994-03-12' };

  it('no flag when details match (case/whitespace-insensitive)', () => {
    expect(mismatchFlag(record, { fullName: '  maria   SANTOS ', email: 'MARIA.santos@example.com', birthdate: '1994-03-12' })).toBeNull();
  });
  it('lists each differing field and keeps the record untouched', () => {
    const f = mismatchFlag(record, { fullName: 'SECPROBE Impostor', email: 'attacker@evil.test', birthdate: '2000-02-02' })!;
    expect(f.startsWith(MISMATCH_PREFIX)).toBe(true);
    expect(f).toBe('[Details differ from patient record: name "SECPROBE Impostor", email "attacker@evil.test", birthdate 2000-02-02. Verify before confirming.]');
    expect(mismatchFlag({ ...record, email: null }, { ...record })).toMatch(/email "maria.santos@example.com"/);
  });
  it('typed values cannot break out of the flag line', () => {
    const f = mismatchFlag(record, { ...record, fullName: 'X"]\nfake line [ok' })!;
    expect(f).not.toContain('\n');
    expect(f.indexOf(']')).toBe(f.length - 1);
  });
  it('stored note = flag line + own note; split recovers both', () => {
    const flag = mismatchFlag(record, { ...record, birthdate: '2000-01-01' });
    const stored = withMismatchFlag(flag, 'Tooth pain\nlower left');
    expect(stored).toBe(`${flag}\nTooth pain\nlower left`);
    expect(splitMismatchFlag(stored)).toEqual({ flag, note: 'Tooth pain\nlower left' });
    expect(splitMismatchFlag(withMismatchFlag(flag, null))).toEqual({ flag, note: null });
    expect(withMismatchFlag(null, 'hi')).toBe('hi');
    expect(withMismatchFlag(null, '  ')).toBeNull();
    expect(splitMismatchFlag('plain note')).toEqual({ flag: null, note: 'plain note' });
    expect(splitMismatchFlag(null)).toEqual({ flag: null, note: null });
  });
});

describe('L3: client IP and throttles', () => {
  const r = (headers: Record<string, string>) => new Request('http://localhost/x', { headers });

  it('off Vercel: last X-Forwarded-For hop; Vercel-only headers ignored (client could send them)', () => {
    vi.stubEnv('VERCEL', '');
    expect(clientIp(r({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(r({ 'x-vercel-forwarded-for': '1.1.1.1', 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(r({}))).toBe('unknown');
  });
  it('on Vercel: platform headers first', () => {
    vi.stubEnv('VERCEL', '1');
    expect(clientIp(r({ 'x-vercel-forwarded-for': '198.51.100.4', 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe('198.51.100.4');
    expect(clientIp(r({ 'x-real-ip': '198.51.100.5', 'x-forwarded-for': '2.2.2.2' }))).toBe('198.51.100.5');
    expect(clientIp(r({ 'x-forwarded-for': '198.51.100.6, 10.0.0.1' }))).toBe('198.51.100.6');
  });
  it('login: rotating IPs still hits the per-email bucket', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LOGIN_MAX_FAILURES_PER_EMAIL; i++) recordLoginFailure(`10.0.${Math.floor(i / 250)}.${i % 250}`, 'staff@clinic.test', t0);
    expect(loginRetryAfter('192.0.2.200', 'STAFF@clinic.test', t0 + 1)).toBeGreaterThan(0);
    expect(loginRetryAfter('192.0.2.200', 'other@clinic.test', t0 + 1)).toBe(0);
    expect(loginRetryAfter('192.0.2.200', 'staff@clinic.test', t0 + LOGIN_WINDOW_MS + 1)).toBe(0);
  });
  it('login: per IP + email after LOGIN_MAX_FAILURES', () => {
    const t0 = 2_000_000;
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) recordLoginFailure('192.0.2.1', 'a@b.c', t0);
    expect(loginRetryAfter('192.0.2.1', 'a@b.c', t0 + 1)).toBeGreaterThan(0);
    expect(loginRetryAfter('192.0.2.2', 'a@b.c', t0 + 1)).toBe(0);
  });
  it('requests: REQUEST_LIMIT_PER_IP accepted per window; unknown IP and 0 disable it', () => {
    vi.stubEnv('REQUEST_LIMIT_PER_IP', '2');
    const t0 = 3_000_000;
    recordRequest('192.0.2.9', t0);
    expect(requestRetryAfter('192.0.2.9', t0)).toBe(0);
    recordRequest('192.0.2.9', t0);
    expect(requestRetryAfter('192.0.2.9', t0 + 1)).toBeGreaterThan(0);
    expect(requestRetryAfter('192.0.2.9', t0 + 10 * 60 * 1000 + 1)).toBe(0);
    recordRequest('unknown', t0);
    recordRequest('unknown', t0);
    expect(requestRetryAfter('unknown', t0)).toBe(0);
    vi.stubEnv('REQUEST_LIMIT_PER_IP', '0');
    expect(requestRetryAfter('192.0.2.9', t0 + 1)).toBe(0);
  });
});

describe('L4: error log summary', () => {
  it('mysql errors: code/errno/sqlState only, never the SQL or values', () => {
    const err = Object.assign(new Error("Duplicate entry '09175550101' for key 'patients.contact_number'"), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
      sqlState: '23000',
      sqlMessage: "Duplicate entry '09175550101' for key 'patients.contact_number'",
      sql: "INSERT INTO patients (full_name, contact_number) VALUES ('Maria Santos', '09175550101')",
    });
    const s = safeErrorSummary(err);
    expect(s).toEqual({ code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000', sqlMessage: 'Duplicate entry' });
    expect(JSON.stringify(s)).not.toMatch(/0917|Maria|INSERT/);
  });
  it('other errors keep message and stack', () => {
    expect(safeErrorSummary(new TypeError('boom'))).toMatchObject({ name: 'TypeError', message: 'boom' });
    expect(safeErrorSummary('x')).toEqual({ message: 'x' });
  });
});

describe('I1/I3: JSON bodies', () => {
  const post = (body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    new Request('http://localhost/api/x', { method: 'POST', headers, body });

  it('application/json (with charset) parses', async () => {
    expect(await readJsonBody(post('{"a":1}', { 'content-type': 'application/json; charset=utf-8' }))).toEqual({ ok: true, raw: { a: 1 } });
  });
  it('non-JSON content type -> 415; missing type -> 415', async () => {
    const r = await readJsonBody(post('{"a":1}', { 'content-type': 'text/plain' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(415);
    const r2 = await readJsonBody(new Request('http://localhost/api/x', { method: 'POST', body: new Blob(['{"a":1}']) }));
    if (!r2.ok) expect(r2.response.status).toBe(415);
    expect(r2.ok).toBe(false);
  });
  it('too large -> 413; malformed -> 400; empty allowed only when asked', async () => {
    const big = await readJsonBody(post(JSON.stringify({ a: 'x'.repeat(MAX_JSON_BODY_BYTES) })));
    expect(!big.ok && big.response.status).toBe(413);
    const bad = await readJsonBody(post('{oops'));
    expect(!bad.ok && bad.response.status).toBe(400);
    const empty = await readJsonBody(new Request('http://localhost/api/x', { method: 'POST' }), { allowEmpty: true });
    expect(empty).toEqual({ ok: true, raw: undefined });
    const empty2 = await readJsonBody(new Request('http://localhost/api/x', { method: 'POST' }));
    expect(!empty2.ok && empty2.response.status).toBe(400);
  });
});

describe('L1: security headers (next.config.ts)', () => {
  async function headersFor(nodeEnv: string) {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.resetModules();
    const cfg = (await import('@/next.config')).default;
    const rules = await cfg.headers!();
    expect(cfg.poweredByHeader).toBe(false);
    expect(rules[0].source).toBe('/:path*');
    return Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
  }

  it('production: CSP without unsafe-eval, frame-ancestors none, HSTS, nosniff, referrer, permissions', async () => {
    const h = await headersFor('production');
    expect(h['Content-Security-Policy']).toMatch(/default-src 'self'/);
    expect(h['Content-Security-Policy']).toMatch(/frame-ancestors 'none'/);
    expect(h['Content-Security-Policy']).toMatch(/object-src 'none'/);
    expect(h['Content-Security-Policy']).not.toMatch(/unsafe-eval/);
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Permissions-Policy']).toMatch(/camera=\(\)/);
    expect(h['Strict-Transport-Security']).toMatch(/max-age=\d+/);
  });
  it('dev: allows eval + websocket for HMR, no HSTS', async () => {
    const h = await headersFor('development');
    expect(h['Content-Security-Policy']).toMatch(/'unsafe-eval'/);
    expect(h['Content-Security-Policy']).toMatch(/connect-src 'self' ws: wss:/);
    expect(h['Strict-Transport-Security']).toBeUndefined();
  });
});
