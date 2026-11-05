/** Follow-up visits: POST /api/appointments with followUpOf, and the link surviving a reschedule. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as staffBook } from '@/app/api/appointments/route';
import { queryOne } from '@/lib/db';
import { getAppointmentDetail } from '@/lib/queries/appointments';
import { rescheduleAppointment } from '@/lib/services/appointments';
import { addDays, todayManila } from '@/lib/time';
import { insertAppt, LIM, PROPHY, req, REYES, staffCookie, workday } from './api-helpers';
import { resetTestDb } from './helpers';

beforeAll(async () => {
  await resetTestDb();
});
afterAll(async () => {
  await resetTestDb();
});

const past = () => addDays(todayManila(), -7);
const body = (over: Record<string, unknown> = {}) => ({
  patientId: 4,
  serviceId: PROPHY,
  dentistId: REYES,
  date: workday(1),
  start: '09:00',
  chairId: 1,
  channel: 'phone',
  ...over,
});
const book = async (b: Record<string, unknown>) => staffBook(req('POST', '/api/appointments', b, await staffCookie()));

describe('follow-up visits', () => {
  it('links a new scheduled visit to an attended visit of the same patient', async () => {
    const attended = await insertAppt({ patientId: 4, date: past(), start: '09:00:00', end: '09:30:00', status: 'attended' });
    const res = await book(body({ followUpOf: attended }));
    expect(res.status).toBe(201);
    const { appointmentId } = await res.json();
    const row = await queryOne<{ status: string; follow_up_of_id: number }>('SELECT status, follow_up_of_id FROM appointments WHERE appointment_id = ?', [appointmentId]);
    expect(row).toEqual({ status: 'scheduled', follow_up_of_id: attended });

    const parent = await getAppointmentDetail(attended);
    expect(parent!.followUpIds).toEqual([appointmentId]);
    expect((await getAppointmentDetail(appointmentId))!.followUpOfId).toBe(attended);
  });

  it('the usual overlap check still applies', async () => {
    const attended = await insertAppt({ patientId: 5, date: past(), start: '09:00:00', end: '09:30:00', status: 'attended' });
    const date = workday(2);
    await insertAppt({ patientId: 6, dentistId: REYES, chairId: 2, date, start: '10:00:00', end: '10:30:00', status: 'scheduled' });
    const res = await book(body({ patientId: 5, date, start: '10:00', followUpOf: attended }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('dentist_conflict');
  });

  it('refuses a visit that is not attended', async () => {
    const scheduled = await insertAppt({ patientId: 7, date: workday(3), start: '09:00:00', end: '09:30:00', status: 'scheduled' });
    const res = await book(body({ patientId: 7, date: workday(4), followUpOf: scheduled }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('follow_up_not_attended');
  });

  it('refuses a visit of a different patient', async () => {
    const attended = await insertAppt({ patientId: 8, date: past(), start: '09:00:00', end: '09:30:00', status: 'attended' });
    const res = await book(body({ patientId: 9, dentistId: LIM, chairId: 2, followUpOf: attended }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('follow_up_patient_mismatch');
  });

  it('refuses an unknown visit, and a follow-up with a brand-new patient', async () => {
    const unknown = await book(body({ date: workday(7), followUpOf: 99999 }));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe('unknown_follow_up');

    const newPatient = await book({ ...body(), patientId: undefined, followUpOf: 1, newPatient: { fullName: 'New Person', contactNumber: '09171112222', email: '', birthdate: '1990-01-01' } });
    expect(newPatient.status).toBe(400);
  });

  it('rescheduling a follow-up keeps its link', async () => {
    const attended = await insertAppt({ patientId: 10, date: past(), start: '09:00:00', end: '09:30:00', status: 'attended' });
    const { appointmentId } = await (await book(body({ patientId: 10, dentistId: LIM, chairId: 2, date: workday(5), followUpOf: attended }))).json();
    const { newId } = await rescheduleAppointment(appointmentId, { date: workday(6), start: '11:00', dentistId: LIM, chairId: 2 });
    const moved = await getAppointmentDetail(newId);
    expect(moved!.followUpOfId).toBe(attended);
    // the cancelled original no longer counts as a booked follow-up
    expect((await getAppointmentDetail(attended))!.followUpIds).toEqual([newId]);
  });
});
