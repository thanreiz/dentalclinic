/** Panel revisions: one visit per patient per day, duplicate checks on email and name + birthdate, "booking for someone else", report export. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as staffBook } from '@/app/api/appointments/route';
import { PATCH as patchPatient } from '@/app/api/patients/[id]/route';
import { GET as searchRoute } from '@/app/api/patients/route';
import { GET as exportRoute } from '@/app/api/reports/export/route';
import { POST as postRequest } from '@/app/api/requests/route';
import { queryOne } from '@/lib/db';
import { splitBookedBy, splitMismatchFlag } from '@/lib/patient-note';
import { confirmAppointment, rescheduleAppointment } from '@/lib/services/appointments';
import { bookingBody, FILLING, idCtx, insertAppt, LIM, newContact, PROPHY, REYES, req, staffCookie, workday } from './api-helpers';
import { resetTestDb } from './helpers';

let cookie = '';
let maria: { full_name: string; email: string; birthdate: string; contact_number: string };
beforeAll(async () => {
  await resetTestDb();
  cookie = await staffCookie();
  maria = (await queryOne('SELECT full_name, email, birthdate, contact_number FROM patients WHERE patient_id = 1'))!;
});
afterAll(async () => {
  await resetTestDb();
});

const countPatients = async () => Number((await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM patients'))!.n);

describe('duplicate patients by email and by name + birthdate', () => {
  it('staff inline create: same email (any case) -> 409 duplicate_email', async () => {
    const before = await countPatients();
    const r = await staffBook(
      req('POST', '/api/appointments', {
        patientId: undefined,
        dentistId: REYES,
        serviceId: PROPHY,
        chairId: 1,
        date: workday(3),
        start: '09:00',
        channel: 'walk-in',
        newPatient: { fullName: 'Totally Different', contactNumber: newContact(), email: maria.email.toUpperCase(), birthdate: '1999-09-09' },
      }, cookie),
    );
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'duplicate_email', existingPatientId: 1, issues: { email: 'Email already used by another patient' } });
    expect(await countPatients()).toBe(before);
  });

  it('staff inline create: same name (case/spacing) + birthdate -> 409 duplicate_name; same name other birthdate is fine', async () => {
    const shout = maria.full_name.toUpperCase().replace(' ', '   ');
    const body = (birthdate: string, start: string) => ({
      dentistId: REYES, serviceId: PROPHY, chairId: 1, date: workday(3), start, channel: 'walk-in',
      newPatient: { fullName: shout, contactNumber: newContact(), email: '', birthdate },
    });
    const dup = await staffBook(req('POST', '/api/appointments', body(maria.birthdate.slice(0, 10), '10:00'), cookie));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toBe('duplicate_name');
    const namesake = await staffBook(req('POST', '/api/appointments', body('2001-02-03', '10:00'), cookie));
    expect(namesake.status).toBe(201);
  });

  it('PATCH: taking another patient\'s email -> 409; own email is fine', async () => {
    const r = await patchPatient(req('PATCH', '/api/patients/2', { email: maria.email }, cookie), idCtx(2));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('duplicate_email');
    expect((await patchPatient(req('PATCH', '/api/patients/1', { email: maria.email }, cookie), idCtx(1))).status).toBe(200);
  });

  it('public form: new number but known email reuses the record and flags the different number', async () => {
    const before = await countPatients();
    const contact = newContact();
    const r = await postRequest(
      req('POST', '/api/requests', bookingBody({ fullName: maria.full_name, email: maria.email, birthdate: maria.birthdate.slice(0, 10), contactNumber: contact, date: workday(4), start: '14:00' })),
    );
    expect(r.status).toBe(201);
    expect(await countPatients()).toBe(before);
    const a = await queryOne<{ patient_id: number; patient_note: string }>('SELECT patient_id, patient_note FROM appointments ORDER BY appointment_id DESC LIMIT 1');
    expect(a!.patient_id).toBe(1);
    expect(splitMismatchFlag(a!.patient_note).flag).toContain('contact number');
  });

  it('search finds patients by email', async () => {
    const r = await (await searchRoute(req('GET', `/api/patients?q=${encodeURIComponent(maria.email)}`, undefined, cookie))).json();
    expect(r.rows.map((p: { patientId: number }) => p.patientId)).toContain(1);
  });
});

describe('booking for someone else', () => {
  it('requires the booker fields, then saves them on the request', async () => {
    const missing = await postRequest(req('POST', '/api/requests', bookingBody({ bookingFor: 'other', date: workday(5) })));
    expect(missing.status).toBe(400);
    expect(Object.keys((await missing.json()).issues)).toEqual(expect.arrayContaining(['bookerName', 'bookerContact', 'bookerRelation']));

    const ok = await postRequest(
      req('POST', '/api/requests', bookingBody({ bookingFor: 'other', bookerName: 'Lorna Dela Cruz', bookerContact: '0917 000 1111', bookerRelation: 'Parent', patientNote: 'Loose tooth', date: workday(5) })),
    );
    expect(ok.status).toBe(201);
    const a = await queryOne<{ patient_note: string }>('SELECT patient_note FROM appointments ORDER BY appointment_id DESC LIMIT 1');
    expect(splitBookedBy(splitMismatchFlag(a!.patient_note).note)).toEqual({ bookedBy: 'Lorna Dela Cruz (Parent), 09170001111', note: 'Loose tooth' });
  });
});

describe('GET /api/reports/export', () => {
  it('needs staff; returns xlsx (zip) and csv', async () => {
    expect((await exportRoute(req('GET', '/api/reports/export?format=csv'))).status).toBe(401);
    const month = workday(0).slice(0, 7);
    const x = await exportRoute(req('GET', `/api/reports/export?month=${month}&format=xlsx`, undefined, cookie));
    expect(x.status).toBe(200);
    expect(x.headers.get('content-disposition')).toContain(`clinic-report-${month}.xlsx`);
    const bytes = new Uint8Array(await x.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const c = await exportRoute(req('GET', `/api/reports/export?month=${month}&format=csv`, undefined, cookie));
    const raw = new Uint8Array(await c.arrayBuffer());
    const text = new TextDecoder().decode(raw);
    expect(c.headers.get('content-type')).toContain('text/csv');
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    for (const title of ['Summary', 'By dentist', 'By service', 'By channel', 'Repeat no-shows', 'Appointments']) expect(text).toContain(title);
    expect((await exportRoute(req('GET', '/api/reports/export?format=pdf', undefined, cookie))).status).toBe(400);
  });
});

describe('one visit per patient per day', () => {
  // Patient 3 (Ana) gets a clean slate on workday(8)/(9) for these checks.
  const day = workday(8);

  it('staff booking for a patient who already has one that day -> 409 patient_same_day, nothing saved', async () => {
    const first = await insertAppt({ patientId: 3, date: day, start: '09:00', end: '09:30', status: 'scheduled' });
    const r = await staffBook(
      req('POST', '/api/appointments', { patientId: 3, dentistId: LIM, serviceId: FILLING, chairId: 2, date: day, start: '13:00', channel: 'phone' }, cookie),
    );
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'patient_same_day', existingAppointmentId: first });
    const n = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM appointments WHERE patient_id = 3 AND appointment_date = ? AND status IN ('pending','scheduled')", [day]);
    expect(Number(n!.n)).toBe(1);
  });

  it('cancelled or declined bookings do not count', async () => {
    const d = workday(9);
    await insertAppt({ patientId: 3, date: d, start: '09:00', end: '09:30', status: 'cancelled' });
    await insertAppt({ patientId: 3, date: d, start: '10:00', end: '10:30', status: 'declined', chairId: null });
    const r = await staffBook(req('POST', '/api/appointments', { patientId: 3, dentistId: REYES, serviceId: PROPHY, chairId: 1, date: d, start: '11:00', channel: 'walk-in' }, cookie));
    expect(r.status).toBe(201);
  });

  it('confirming a second pending request for the same day -> 409', async () => {
    const pendingId = await insertAppt({ patientId: 3, date: day, start: '15:00', end: '15:30', status: 'pending', chairId: null, channel: 'online' });
    await expect(confirmAppointment(pendingId, 2)).rejects.toMatchObject({ code: 'patient_same_day' });
  });

  it('reschedule onto a day with another booking -> 409; within its own day is fine', async () => {
    const other = await insertAppt({ patientId: 3, date: workday(10), start: '09:00', end: '09:30', status: 'scheduled' });
    await expect(rescheduleAppointment(other, { date: day, start: '16:00', dentistId: REYES, chairId: 1 })).rejects.toMatchObject({ code: 'patient_same_day' });
    const moved = await rescheduleAppointment(other, { date: workday(10), start: '11:00', dentistId: REYES, chairId: 1 });
    expect(moved.ok).toBe(true);
  });
});
