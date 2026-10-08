/** GET /api/slots, POST /api/requests (public) and POST /api/appointments (staff). */
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as staffBook } from '@/app/api/appointments/route';
import { POST as postRequest } from '@/app/api/requests/route';
import { GET as getSlotsRoute } from '@/app/api/slots/route';
import { query, queryOne } from '@/lib/db';
import { createOnlineRequest } from '@/lib/services/booking';
import { ServiceError } from '@/lib/services/errors';
import { addDays, todayManila } from '@/lib/time';
import { bookingRequestSchema } from '@/lib/validation';
import { bookingBody, EXTRACTION, FILLING, insertAppt, LIM, newContact, PROPHY, req, REYES, staffCookie, sundayAhead, workday } from './api-helpers';
import { resetTestDb } from './helpers';

beforeAll(async () => {
  await resetTestDb();
});

const countAppts = async () => Number((await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM appointments'))!.n);
const countPatients = async () => Number((await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM patients'))!.n);

describe('GET /api/slots', () => {
  it('Rule 5 for one dentist; dentistIds; no PII', async () => {
    const date = workday(0);
    await insertAppt({ date, start: '10:00', end: '11:00', status: 'scheduled', dentistId: REYES });
    const res = await getSlotsRoute(req('GET', `/api/slots?date=${date}&serviceId=${EXTRACTION}&dentistId=${REYES}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const starts = body.slots.map((s: { start: string }) => s.start);
    expect(starts.slice(0, 3)).toEqual(['09:00', '11:00', '11:30']);
    expect(starts).not.toContain('09:30');
    expect(body.slots[0]).toEqual({ start: '09:00', end: '09:45', dentistIds: [REYES] });
    expect(Object.keys(body)).toEqual(['slots']);
  });

  it('dentistId=any is the union across dentists', async () => {
    const date = workday(0);
    const res = await getSlotsRoute(req('GET', `/api/slots?date=${date}&serviceId=${EXTRACTION}&dentistId=any`));
    const { slots } = await res.json();
    expect(slots.find((s: { start: string }) => s.start === '10:00').dentistIds).toEqual([LIM]);
    expect(slots.find((s: { start: string }) => s.start === '09:00').dentistIds).toEqual([REYES, LIM]);
  });

  it('Sunday -> no slots; past date, >60 days, bad params -> 400', async () => {
    const sun = await (await getSlotsRoute(req('GET', `/api/slots?date=${sundayAhead()}&serviceId=1&dentistId=any`))).json();
    expect(sun.slots).toEqual([]);
    const past = await getSlotsRoute(req('GET', `/api/slots?date=${addDays(todayManila(), -1)}&serviceId=1&dentistId=1`));
    expect(past.status).toBe(400);
    expect((await past.json()).error).toBe('date_in_past');
    const far = await getSlotsRoute(req('GET', `/api/slots?date=${addDays(todayManila(), 61)}&serviceId=1&dentistId=1`));
    expect(far.status).toBe(400);
    const staffFar = await getSlotsRoute(req('GET', `/api/slots?date=${addDays(todayManila(), 61)}&serviceId=1&dentistId=1`, undefined, await staffCookie()));
    expect(staffFar.status).toBe(200);
    expect((await getSlotsRoute(req('GET', '/api/slots?date=2026-02-30&serviceId=1&dentistId=1'))).status).toBe(400);
    expect((await getSlotsRoute(req('GET', `/api/slots?date=${workday(0)}&serviceId=99&dentistId=1`))).status).toBe(400);
    expect((await getSlotsRoute(req('GET', `/api/slots?date=${workday(0)}&serviceId=1&dentistId=99`))).status).toBe(400);
  });

  it('excludeAppointmentId needs a staff session and frees that row', async () => {
    const date = workday(0);
    const row = await queryOne<{ appointment_id: number }>(
      "SELECT appointment_id FROM appointments WHERE appointment_date = ? AND start_time = '10:00:00'",
      [date],
    );
    const path = `/api/slots?date=${date}&serviceId=${FILLING}&dentistId=${REYES}&excludeAppointmentId=${row!.appointment_id}`;
    expect((await getSlotsRoute(req('GET', path))).status).toBe(401);
    const res = await getSlotsRoute(req('GET', path, undefined, await staffCookie()));
    const starts = (await res.json()).slots.map((s: { start: string }) => s.start);
    expect(starts).toContain('10:00');
  });
});

describe('POST /api/requests', () => {
  it('saves pending/online/no chair, end computed, returns nothing sensitive', async () => {
    const date = workday(1);
    const body = bookingBody({ date, start: '13:00', serviceId: FILLING, patientNote: 'Sensitive tooth' });
    const res = await postRequest(req('POST', '/api/requests', body));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    const row = await queryOne<Record<string, unknown>>(
      `SELECT a.status, a.channel, a.chair_id, a.end_time, a.patient_note, a.reminder_sent_at, p.contact_number, p.email
       FROM appointments a JOIN patients p USING (patient_id) WHERE a.appointment_date = ? AND a.start_time = '13:00:00'`,
      [date],
    );
    expect(row).toMatchObject({ status: 'pending', channel: 'online', chair_id: null, end_time: '14:00:00', patient_note: 'Sensitive tooth', reminder_sent_at: null, contact_number: body.contactNumber });
  });

  it('honeypot filled -> looks successful, saves nothing', async () => {
    const [a, p] = [await countAppts(), await countPatients()];
    const res = await postRequest(req('POST', '/api/requests', bookingBody({ website: 'http://spam.example', start: '15:00' })));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect([await countAppts(), await countPatients()]).toEqual([a, p]);
  });

  it('validation: no consent, bad contact, bad JSON -> 400', async () => {
    const r1 = await postRequest(req('POST', '/api/requests', bookingBody({ consent: false })));
    expect(r1.status).toBe(400);
    expect((await r1.json()).issues.consent).toBeTruthy();
    const r2 = await postRequest(req('POST', '/api/requests', bookingBody({ contactNumber: '12345' })));
    expect((await r2.json()).issues.contactNumber).toBeTruthy();
    expect((await postRequest(req('POST', '/api/requests', '{oops'))).status).toBe(400);
    const r3 = await postRequest(req('POST', '/api/requests', bookingBody({ date: addDays(todayManila(), 61) })));
    expect(r3.status).toBe(400);
  });

  it('repeat contact reuses the patient and does not overwrite their details', async () => {
    const before = await countPatients();
    const res = await postRequest(
      req('POST', '/api/requests', bookingBody({ date: workday(2), start: '09:00', contactNumber: '+63 917-555-0101', fullName: 'Not Maria', email: 'evil@example.com' })),
    );
    expect(res.status).toBe(201);
    expect(await countPatients()).toBe(before);
    const maria = await queryOne<{ full_name: string; email: string }>('SELECT full_name, email FROM patients WHERE patient_id = 1');
    expect(maria).toEqual({ full_name: 'Maria Santos', email: 'maria.santos@example.com' });
    const n = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM appointments WHERE patient_id = 1 AND status = 'pending'");
    expect(Number(n!.n)).toBe(1);
  });

  it('slot taken -> 409 slot_taken with fresh slots; off-grid / outside hours / Sunday -> 409', async () => {
    const date = workday(2); // Reyes 09:00 pending from the previous test
    const res = await postRequest(req('POST', '/api/requests', bookingBody({ date, start: '09:00' })));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('slot_taken');
    expect(body.message).toMatch(/just taken/);
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots.map((s: { start: string }) => s.start)).not.toContain('09:00');
    for (const over of [{ start: '09:10' }, { start: '16:45' }, { date: sundayAhead() }]) {
      const r = await postRequest(req('POST', '/api/requests', bookingBody({ date, ...over })));
      expect(r.status).toBe(409);
    }
  });

  it('any available: assigns the first free dentist by id (Rule 10)', async () => {
    const date = workday(3);
    await insertAppt({ date, start: '10:00', end: '10:30', status: 'scheduled', dentistId: REYES });
    expect((await postRequest(req('POST', '/api/requests', bookingBody({ date, start: '10:00', dentistId: 'any' })))).status).toBe(201);
    expect((await postRequest(req('POST', '/api/requests', bookingBody({ date, start: '11:00', dentistId: 'any' })))).status).toBe(201);
    const rows = await query<{ start_time: string; dentist_id: number }>(
      "SELECT start_time, dentist_id FROM appointments WHERE appointment_date = ? AND status = 'pending' ORDER BY start_time",
      [date],
    );
    expect(rows).toEqual([
      { start_time: '10:00:00', dentist_id: LIM },
      { start_time: '11:00:00', dentist_id: REYES },
    ]);
    // both busy at 10:00 now -> 409
    expect((await postRequest(req('POST', '/api/requests', bookingBody({ date, start: '10:00', dentistId: 'any' })))).status).toBe(409);
  });

  it('10 concurrent requests for the same slot -> exactly 1 success (Rule 9), no pool errors', async () => {
    const date = workday(4);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => postRequest(req('POST', '/api/requests', bookingBody({ date, start: '14:00' })))),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    const n = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM appointments WHERE appointment_date = ? AND start_time = '14:00:00'", [date]);
    expect(Number(n!.n)).toBe(1);
  });

  it('10 concurrent "any" requests via the service -> exactly 2 (one per dentist)', async () => {
    const date = workday(4);
    const input = () => bookingRequestSchema.parse(bookingBody({ date, start: '15:00', dentistId: 'any' }));
    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => createOnlineRequest(input())));
    const ok = settled.filter((s) => s.status === 'fulfilled') as PromiseFulfilledResult<{ dentistId: number }>[];
    expect(ok.map((s) => s.value.dentistId).sort()).toEqual([REYES, LIM]);
    const rejected = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.every((r) => r.reason instanceof ServiceError && r.reason.code === 'slot_taken')).toBe(true);
  });

  it('same new contact in parallel -> one patient row (unique-key race re-selects)', async () => {
    const contact = newContact();
    const date = workday(5);
    const res = await Promise.all(
      ['09:00', '10:00', '11:00'].map((start, i) =>
        postRequest(req('POST', '/api/requests', bookingBody({ date, start, contactNumber: contact, dentistId: i % 2 ? LIM : REYES }))),
      ),
    );
    expect(res.map((r) => r.status)).toEqual([201, 201, 201]);
    const n = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM patients WHERE contact_number = ?', [contact]);
    expect(Number(n!.n)).toBe(1);
  });
});

describe('POST /api/appointments (staff booking)', () => {
  const base = () => ({ patientId: 2, serviceId: PROPHY, dentistId: LIM, date: workday(6), start: '09:00', chairId: 2, channel: 'phone' });

  it('401 without a session', async () => {
    expect((await staffBook(req('POST', '/api/appointments', base()))).status).toBe(401);
  });

  it('saves scheduled with chair + channel; no email path', async () => {
    const res = await staffBook(req('POST', '/api/appointments', base(), await staffCookie()));
    expect(res.status).toBe(201);
    const { appointmentId, patientId } = await res.json();
    expect(patientId).toBe(2);
    const row = await queryOne<Record<string, unknown>>('SELECT status, channel, chair_id, end_time FROM appointments WHERE appointment_id = ?', [appointmentId]);
    expect(row).toEqual({ status: 'scheduled', channel: 'phone', chair_id: 2, end_time: '09:30:00' });
  });

  it('conflict by chair only -> 409 chair_conflict; by dentist -> dentist_conflict', async () => {
    const cookie = await staffCookie();
    // Reyes is free at 09:00 but Chair 2 is held by Lim's booking
    const chair = await staffBook(req('POST', '/api/appointments', { ...base(), dentistId: REYES, patientId: 3 }, cookie));
    expect(chair.status).toBe(409);
    expect((await chair.json()).error).toBe('chair_conflict');
    const dentist = await staffBook(req('POST', '/api/appointments', { ...base(), chairId: 1, start: '09:15', patientId: 3 }, cookie));
    expect((await dentist.json()).error).toBe('dentist_conflict');
    const ok = await staffBook(req('POST', '/api/appointments', { ...base(), dentistId: REYES, chairId: 1, patientId: 3 }, cookie));
    expect(ok.status).toBe(201);
  });

  it('outside hours, Sunday, in the past -> 409 with reason codes', async () => {
    const cookie = await staffCookie();
    const late = await staffBook(req('POST', '/api/appointments', { ...base(), start: '16:45' }, cookie));
    expect((await late.json()).error).toBe('outside_hours');
    const sun = await staffBook(req('POST', '/api/appointments', { ...base(), date: sundayAhead() }, cookie));
    expect((await sun.json()).error).toBe('outside_hours');
    const past = await staffBook(req('POST', '/api/appointments', { ...base(), date: addDays(todayManila(), -2) }, cookie));
    expect((await past.json()).error).toBe('in_past');
  });

  it('new patient inline; duplicate contact -> 409 and nothing saved', async () => {
    const cookie = await staffCookie();
    const { patientId: _p, ...rest } = base();
    void _p;
    const contact = newContact();
    const created = await staffBook(
      req('POST', '/api/appointments', { ...rest, start: '11:00', channel: 'walk-in', newPatient: { fullName: 'Walk In', contactNumber: contact, email: '', birthdate: '1980-01-01' } }, cookie),
    );
    expect(created.status).toBe(201);
    const p = await queryOne<{ email: string | null }>('SELECT email FROM patients WHERE contact_number = ?', [contact]);
    expect(p).toEqual({ email: null });
    const before = await countAppts();
    const dupe = await staffBook(
      req('POST', '/api/appointments', { ...rest, start: '12:00', newPatient: { fullName: 'Someone', contactNumber: '0917 555 0101', birthdate: '1980-01-01' } }, cookie),
    );
    expect(dupe.status).toBe(409);
    const body = await dupe.json();
    expect(body).toMatchObject({ error: 'duplicate_contact', message: 'Contact number already used by another patient', existingPatientId: 1 });
    expect(await countAppts()).toBe(before);
  });

  it('bad input -> 400 (both patient forms, unknown chair, online channel)', async () => {
    const cookie = await staffCookie();
    expect((await staffBook(req('POST', '/api/appointments', { ...base(), newPatient: { fullName: 'X Y', contactNumber: newContact(), birthdate: '1990-01-01' } }, cookie))).status).toBe(400);
    expect((await staffBook(req('POST', '/api/appointments', { ...base(), start: '13:00', chairId: 99 }, cookie))).status).toBe(400);
    expect((await staffBook(req('POST', '/api/appointments', { ...base(), channel: 'online' }, cookie))).status).toBe(400);
    expect((await staffBook(req('POST', '/api/appointments', { ...base(), start: '13:00', patientId: 9999 }, cookie))).status).toBe(400);
  });
});
