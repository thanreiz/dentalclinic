/** SECURITY-REVIEW H1 (abuse caps on POST /api/requests) and M2 ("details differ" flag). */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as postRequest } from '@/app/api/requests/route';
import { execute, query, queryOne } from '@/lib/db';
import { MISMATCH_PREFIX } from '@/lib/patient-note';
import { resetRequestThrottle } from '@/lib/services/rate-limit';
import { bookingBody, LIM, newContact, REYES, workday } from './api-helpers';
import { resetTestDb } from './helpers';

beforeAll(async () => {
  await resetTestDb();
});
afterAll(async () => {
  await resetTestDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetRequestThrottle();
});

const send = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  postRequest(
    new Request('http://localhost/api/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
const count = async (sql: string, params: unknown[] = []) => Number((await queryOne<{ n: number }>(sql, params))!.n);

describe('per-contact cap (REQUEST_LIMIT_PER_CONTACT, default 3 pending)', () => {
  it('3 pending requests on one number -> 201 x3, 4th -> 429 too_many_requests; nothing saved', async () => {
    const contactNumber = newContact();
    const date = workday(0);
    for (const start of ['09:00', '09:30', '10:00']) {
      expect((await send(bookingBody({ date, start, contactNumber }))).status).toBe(201);
    }
    const before = await count('SELECT COUNT(*) AS n FROM appointments');
    const res = await send(bookingBody({ date, start: '10:30', contactNumber }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('too_many_requests');
    expect(body.message).toMatch(/already have requests waiting/);
    expect(Object.keys(body).sort()).toEqual(['error', 'message']);
    expect(await count('SELECT COUNT(*) AS n FROM appointments')).toBe(before);
    expect(await count('SELECT COUNT(*) AS n FROM patients WHERE contact_number = ?', [contactNumber])).toBe(1);
  });

  it('only pending rows count: once staff decline one, the number can request again', async () => {
    const contactNumber = newContact();
    const date = workday(1);
    for (const start of ['09:00', '09:30', '10:00']) expect((await send(bookingBody({ date, start, contactNumber }))).status).toBe(201);
    expect((await send(bookingBody({ date, start: '10:30', contactNumber }))).status).toBe(429);
    await execute(
      `UPDATE appointments a JOIN patients p ON p.patient_id = a.patient_id
          SET a.status = 'declined' WHERE p.contact_number = ? AND a.start_time = '09:00:00'`,
      [contactNumber],
    );
    expect((await send(bookingBody({ date, start: '10:30', contactNumber }))).status).toBe(201);
  });

  it('env override: REQUEST_LIMIT_PER_CONTACT=1', async () => {
    vi.stubEnv('REQUEST_LIMIT_PER_CONTACT', '1');
    const contactNumber = newContact();
    expect((await send(bookingBody({ date: workday(2), start: '09:00', contactNumber }))).status).toBe(201);
    expect((await send(bookingBody({ date: workday(2), start: '10:00', contactNumber }))).status).toBe(429);
  });
});

describe('clinic-wide caps (REQUEST_LIMIT_PER_HOUR / PER_DAY)', () => {
  const recentOnline = () => count("SELECT COUNT(*) AS n FROM appointments WHERE channel = 'online' AND requested_at >= NOW() - INTERVAL 1 HOUR");

  it('hourly cap reached -> 429 with the "clinic busy" message, for new numbers too', async () => {
    vi.stubEnv('REQUEST_LIMIT_PER_HOUR', String((await recentOnline()) + 1));
    expect((await send(bookingBody({ date: workday(3), start: '09:00' }))).status).toBe(201);
    const patientsBefore = await count('SELECT COUNT(*) AS n FROM patients');
    const res = await send(bookingBody({ date: workday(3), start: '10:00' }));
    expect(res.status).toBe(429);
    expect((await res.json()).message).toMatch(/receiving a lot of online requests/);
    expect(await count('SELECT COUNT(*) AS n FROM patients')).toBe(patientsBefore); // rolled back
  });

  it('daily cap counts the last 24 hours; 0 disables a cap', async () => {
    vi.stubEnv('REQUEST_LIMIT_PER_HOUR', '0');
    const lastDay = await count("SELECT COUNT(*) AS n FROM appointments WHERE channel = 'online' AND requested_at >= NOW() - INTERVAL 1 DAY");
    vi.stubEnv('REQUEST_LIMIT_PER_DAY', String(lastDay));
    expect((await send(bookingBody({ date: workday(3), start: '11:00' }))).status).toBe(429);
    vi.stubEnv('REQUEST_LIMIT_PER_DAY', '0');
    expect((await send(bookingBody({ date: workday(3), start: '11:00' }))).status).toBe(201);
  });
});

describe('per-IP limiter (REQUEST_LIMIT_PER_IP, default 5 per 10 min)', () => {
  it('5 accepted from one IP, 6th -> 429 + Retry-After; another IP is unaffected', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.50' };
    const date = workday(4);
    for (const start of ['09:00', '09:30', '10:00', '10:30', '11:00']) {
      expect((await send(bookingBody({ date, start, dentistId: LIM }), ip)).status).toBe(201);
    }
    const blocked = await send(bookingBody({ date, start: '11:30', dentistId: LIM }), ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await blocked.json()).error).toBe('too_many_requests');
    expect((await send(bookingBody({ date, start: '11:30', dentistId: LIM }), { 'x-forwarded-for': '203.0.113.51' })).status).toBe(201);
  });

  it('honeypot hits and rejected requests do not use up the allowance', async () => {
    vi.stubEnv('REQUEST_LIMIT_PER_IP', '1');
    const ip = { 'x-forwarded-for': '203.0.113.60' };
    expect((await send(bookingBody({ website: 'spam' }), ip)).status).toBe(201);
    expect((await send(bookingBody({ date: '2020-01-01' }), ip)).status).toBe(400);
    expect((await send(bookingBody({ date: workday(5), start: '09:00', dentistId: REYES }), ip)).status).toBe(201);
    expect((await send(bookingBody({ date: workday(5), start: '10:00', dentistId: REYES }), ip)).status).toBe(429);
  });

  it('non-JSON body -> 415 (I1)', async () => {
    const res = await postRequest(
      new Request('http://localhost/api/requests', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(bookingBody()) }),
    );
    expect(res.status).toBe(415);
  });
});

describe('M2: request on an existing number with different details', () => {
  const maria = { contactNumber: '+63 917-555-0101' };
  const noteOf = async (date: string, start: string) =>
    (await queryOne<{ patient_note: string | null; patient_id: number }>(
      'SELECT patient_note, patient_id FROM appointments WHERE appointment_date = ? AND start_time = ?',
      [date, `${start}:00`],
    ))!;

  it('same 201 response; record untouched; patient_note starts with the flag, then the own note', async () => {
    const date = workday(6);
    const res = await send(
      bookingBody({ date, start: '09:00', ...maria, fullName: 'SECPROBE Impostor', email: 'attacker@evil.test', birthdate: '2000-02-02', patientNote: 'Please call me' }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    const row = await noteOf(date, '09:00');
    expect(row.patient_id).toBe(1);
    expect(row.patient_note).toBe(
      '[Details differ from patient record: name "SECPROBE Impostor", email "attacker@evil.test", birthdate 2000-02-02. Verify before confirming.]\nPlease call me',
    );
    const rec = await queryOne('SELECT full_name, email, birthdate FROM patients WHERE patient_id = 1');
    expect(rec).toEqual({ full_name: 'Maria Santos', email: 'maria.santos@example.com', birthdate: '1994-03-12' });
  });

  it('matching details (any case/spacing) -> no flag; a brand-new number -> no flag', async () => {
    const date = workday(6);
    await send(bookingBody({ date, start: '10:00', ...maria, fullName: 'maria  santos', email: 'Maria.Santos@example.com', birthdate: '1994-03-12', patientNote: 'Cleaning' }));
    expect((await noteOf(date, '10:00')).patient_note).toBe('Cleaning');
    await send(bookingBody({ date, start: '11:00', patientNote: null }));
    expect((await noteOf(date, '11:00')).patient_note).toBeNull();
  });

  it('the requests queue carries the flag for staff', async () => {
    const rows = await query<{ patient_note: string }>("SELECT patient_note FROM appointments WHERE status = 'pending' AND patient_id = 1");
    expect(rows.some((r) => r.patient_note?.startsWith(MISMATCH_PREFIX))).toBe(true);
  });
});
