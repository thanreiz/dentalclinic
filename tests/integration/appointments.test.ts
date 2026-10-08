/** Confirm, decline, reschedule, status (Table 3.21), note, chairs/free. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as confirm } from '@/app/api/appointments/[id]/confirm/route';
import { POST as decline } from '@/app/api/appointments/[id]/decline/route';
import { PATCH as note } from '@/app/api/appointments/[id]/note/route';
import { POST as reschedule } from '@/app/api/appointments/[id]/reschedule/route';
import { POST as status } from '@/app/api/appointments/[id]/status/route';
import { GET as freeChairsRoute } from '@/app/api/chairs/free/route';
import { POST as postRequest } from '@/app/api/requests/route';
import { queryOne } from '@/lib/db';
import { getAppointmentDetail } from '@/lib/queries/appointments';
import { getMonthlyReport } from '@/lib/queries/reports';
import { addDays, monthOf, todayManila } from '@/lib/time';
import { bookingBody, fakeMail, FILLING, idCtx, insertAppt, LIM, req, REYES, staffCookie, workday } from './api-helpers';
import { resetTestDb } from './helpers';

let cookie = '';
const mail = { current: null as ReturnType<typeof fakeMail> | null };

beforeAll(async () => {
  await resetTestDb();
  cookie = await staffCookie();
  mail.current = fakeMail();
});
afterAll(() => mail.current?.restore());

const statusOf = async (id: number) => (await queryOne<{ status: string }>('SELECT status FROM appointments WHERE appointment_id = ?', [id]))?.status;

/** Make a pending online request through the public route and return its id. */
async function pendingRequest(over: Record<string, unknown>): Promise<number> {
  const body = bookingBody(over);
  const res = await postRequest(req('POST', '/api/requests', body));
  expect(res.status).toBe(201);
  const r = await queryOne<{ appointment_id: number }>(
    `SELECT a.appointment_id FROM appointments a JOIN patients p USING (patient_id)
     WHERE p.contact_number = ? AND a.status = 'pending' ORDER BY a.appointment_id DESC LIMIT 1`,
    [String(body.contactNumber).replace(/\D/g, '').replace(/^63/, '0')],
  );
  return r!.appointment_id;
}

describe('POST /api/appointments/[id]/confirm', () => {
  it('pending -> scheduled with chair; confirmation email after commit', async () => {
    const date = workday(0);
    const id = await pendingRequest({ date, start: '09:00', email: 'ana.p@example.com', fullName: 'Ana P' });
    const res = await confirm(req('POST', `/api/appointments/${id}/confirm`, { chairId: 1 }, cookie), idCtx(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailSent: true });
    expect(await queryOne('SELECT status, chair_id FROM appointments WHERE appointment_id = ?', [id])).toEqual({ status: 'scheduled', chair_id: 1 });
    const m = mail.current!.sent.at(-1)!;
    expect(m.to).toBe('ana.p@example.com');
    expect(m.subject).toMatch(/^Appointment confirmed: [A-Z][a-z]{2} \d{1,2}, 2026, 9:00 AM$/);
    expect(m.text).toContain('Dentist: Dr. Reyes');
    expect(m.text).toContain('Service: Oral prophylaxis');
    expect(m.text).toContain('Time: 9:00 AM');
  });

  it('mail failure keeps it scheduled and returns the staff warning', async () => {
    const id = await pendingRequest({ date: workday(0), start: '10:00', email: 'fail.me@example.com' });
    mail.current!.failFor.add('fail.me@example.com');
    const res = await confirm(req('POST', `/api/appointments/${id}/confirm`, { chairId: 1 }, cookie), idCtx(id));
    expect(await res.json()).toEqual({ ok: true, emailSent: false, emailError: 'Confirmed, but the email could not be sent.' });
    expect(await statusOf(id)).toBe('scheduled');
  });

  it('patient without email -> confirmed, emailSkipped', async () => {
    const id = await insertAppt({ patientId: 6, date: workday(0), start: '13:00', end: '13:30', status: 'pending', chairId: null, channel: 'online' });
    const res = await confirm(req('POST', `/api/appointments/${id}/confirm`, { chairId: 2 }, cookie), idCtx(id));
    expect(await res.json()).toEqual({ ok: true, emailSent: false, emailSkipped: 'no_email' });
  });

  it('re-check: chair taken -> 409 slot_unavailable with slots + freeChairs; stays pending', async () => {
    const date = workday(0);
    // A pending Reyes request at 14:00 (no chair yet), then Lim is booked on Chair 2 at the same time.
    const pid = await pendingRequest({ date, start: '14:00' });
    await insertAppt({ dentistId: LIM, chairId: 2, date, start: '14:00', end: '14:30', status: 'scheduled', patientId: 4 });
    const res = await confirm(req('POST', `/api/appointments/${pid}/confirm`, { chairId: 2 }, cookie), idCtx(pid));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('slot_unavailable');
    expect(body.reason).toBe('chair_conflict');
    expect(Array.isArray(body.slots)).toBe(true);
    expect(body.freeChairs.map((c: { chairId: number }) => c.chairId)).not.toContain(2);
    expect(await statusOf(pid)).toBe('pending');
  });

  it('re-check: start time passed -> 409 (Rule 3)', async () => {
    const id = await insertAppt({ date: addDays(todayManila(), -1), start: '09:00', end: '09:30', status: 'pending', chairId: null, channel: 'online' });
    const res = await confirm(req('POST', `/api/appointments/${id}/confirm`, { chairId: 1 }, cookie), idCtx(id));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('in_past');
  });

  it('only pending can be confirmed; 404; 401; bad chair 400', async () => {
    expect((await confirm(req('POST', '/api/appointments/2/confirm', { chairId: 1 }, cookie), idCtx(2))).status).toBe(409);
    expect((await confirm(req('POST', '/api/appointments/99999/confirm', { chairId: 1 }, cookie), idCtx(99999))).status).toBe(404);
    expect((await confirm(req('POST', '/api/appointments/2/confirm', { chairId: 1 }), idCtx(2))).status).toBe(401);
    expect((await confirm(req('POST', '/api/appointments/abc/confirm', { chairId: 1 }, cookie), idCtx('abc'))).status).toBe(400);
    const id = await insertAppt({ date: workday(1), start: '15:00', end: '15:30', status: 'pending', chairId: null, channel: 'online' });
    expect((await confirm(req('POST', `/api/appointments/${id}/confirm`, { chairId: 77 }, cookie), idCtx(id))).status).toBe(400);
  });
});

describe('POST /api/appointments/[id]/decline (Rule 12)', () => {
  it('pending -> declined, no email, and the slot is free again', async () => {
    const date = workday(1);
    const sentBefore = mail.current!.sent.length;
    const id = await pendingRequest({ date, start: '11:00' });
    expect((await postRequest(req('POST', '/api/requests', bookingBody({ date, start: '11:00' })))).status).toBe(409);
    const res = await decline(req('POST', `/api/appointments/${id}/decline`, undefined, cookie), idCtx(id));
    expect(res.status).toBe(200);
    expect(await statusOf(id)).toBe('declined');
    expect(mail.current!.sent.length).toBe(sentBefore);
    expect((await postRequest(req('POST', '/api/requests', bookingBody({ date, start: '11:00' })))).status).toBe(201);
    // declined is final
    const again = await decline(req('POST', `/api/appointments/${id}/decline`, {}, cookie), idCtx(id));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('invalid_transition');
  });
});

describe('POST /api/appointments/[id]/reschedule (Rule 11)', () => {
  it('old -> cancelled, new scheduled copy linked, notes copied, both in one go', async () => {
    const date = workday(2);
    const oldId = await insertAppt({ date, start: '10:00', end: '11:00', status: 'scheduled', serviceId: FILLING, channel: 'chat', reminderSentAt: '2026-10-01 09:00:00' });
    await queryOne("UPDATE appointments SET patient_note = 'pn', dentist_note = 'dn' WHERE appointment_id = ?", [oldId]);
    const month = monthOf(date);
    const cancelledBefore = (await getMonthlyReport(month)).totals.cancelled;

    // move within its own slot by 30 min (overlap must exclude the old row)
    const res = await reschedule(req('POST', `/api/appointments/${oldId}/reschedule`, { date, start: '10:30', dentistId: REYES, chairId: 1 }, cookie), idCtx(oldId));
    expect(res.status).toBe(200);
    const { ok, newId } = await res.json();
    expect(ok).toBe(true);
    expect(await statusOf(oldId)).toBe('cancelled');
    const n = await queryOne<Record<string, unknown>>('SELECT * FROM appointments WHERE appointment_id = ?', [newId]);
    expect(n).toMatchObject({
      status: 'scheduled', patient_id: 1, service_id: FILLING, channel: 'chat', dentist_id: REYES, chair_id: 1,
      appointment_date: date, start_time: '10:30:00', end_time: '11:30:00', patient_note: 'pn', dentist_note: 'dn',
      reminder_sent_at: null, rescheduled_from_id: oldId,
    });
    expect((await getAppointmentDetail(oldId))?.replacedById).toBe(newId);
    expect((await getAppointmentDetail(newId))?.rescheduledFromId).toBe(oldId);
    // report: a rescheduled cancellation is not counted; a real cancel is
    expect((await getMonthlyReport(month)).totals.cancelled).toBe(cancelledBefore);
    expect((await status(req('POST', `/api/appointments/${newId}/status`, { status: 'cancelled' }, cookie), idCtx(newId))).status).toBe(200);
    expect((await getMonthlyReport(month)).totals.cancelled).toBe(cancelledBefore + 1);
  });

  it('conflict -> 409 and nothing changes; non-scheduled -> invalid_transition', async () => {
    const date = workday(3);
    const a = await insertAppt({ date, start: '09:00', end: '10:00', status: 'scheduled', serviceId: FILLING, dentistId: REYES, chairId: 1 });
    await insertAppt({ date, start: '11:00', end: '12:00', status: 'scheduled', dentistId: LIM, chairId: 2, patientId: 3 });
    const res = await reschedule(req('POST', `/api/appointments/${a}/reschedule`, { date, start: '11:30', dentistId: REYES, chairId: 2 }, cookie), idCtx(a));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('chair_conflict');
    expect(await statusOf(a)).toBe('scheduled');
    const past = await reschedule(req('POST', `/api/appointments/${a}/reschedule`, { date: addDays(todayManila(), -1), start: '11:30', dentistId: REYES, chairId: 1 }, cookie), idCtx(a));
    expect((await past.json()).error).toBe('in_past');
    const pend = await insertAppt({ date, start: '15:00', end: '15:30', status: 'pending', chairId: null, channel: 'online' });
    const r2 = await reschedule(req('POST', `/api/appointments/${pend}/reschedule`, { date, start: '16:00', dentistId: REYES, chairId: 1 }, cookie), idCtx(pend));
    expect((await r2.json()).error).toBe('invalid_transition');
  });
});

describe('POST /api/appointments/[id]/status — Table 3.21 matrix', () => {
  const targets = ['attended', 'cancelled', 'no-show'] as const;
  const future = () => ({ date: workday(5), start: '09:00', end: '09:30' });
  const past = () => ({ date: addDays(todayManila(), -1), start: '09:00', end: '09:30' });

  type Case = { from: string; when: 'future' | 'past'; to: (typeof targets)[number]; ok: boolean };
  const cases: Case[] = [];
  for (const to of targets) {
    cases.push({ from: 'scheduled', when: 'future', to, ok: to === 'cancelled' });
    cases.push({ from: 'scheduled', when: 'past', to, ok: true });
    for (const from of ['pending', 'declined', 'attended', 'cancelled', 'no-show']) {
      cases.push({ from, when: 'past', to, ok: false });
      cases.push({ from, when: 'future', to, ok: false });
    }
  }

  it.each(cases)('$from ($when) -> $to : ok=$ok', async ({ from, when, to, ok }) => {
    const id = await insertAppt({ ...(when === 'future' ? future() : past()), status: from, chairId: from === 'pending' ? null : 1, patientId: 7 });
    const res = await status(req('POST', `/api/appointments/${id}/status`, { status: to }, cookie), idCtx(id));
    expect(res.status).toBe(ok ? 200 : 409);
    expect(await statusOf(id)).toBe(ok ? to : from);
    if (!ok) expect((await res.json()).error).toBe('invalid_transition');
  });

  it('attended before start explains why; bad status value -> 400', async () => {
    const id = await insertAppt({ ...future(), date: workday(6), status: 'scheduled' });
    const res = await status(req('POST', `/api/appointments/${id}/status`, { status: 'attended' }, cookie), idCtx(id));
    expect((await res.json()).message).toMatch(/start time/);
    expect((await status(req('POST', `/api/appointments/${id}/status`, { status: 'scheduled' }, cookie), idCtx(id))).status).toBe(400);
    expect((await status(req('POST', `/api/appointments/${id}/status`, { status: 'canceled' }, cookie), idCtx(id))).status).toBe(400);
  });
});

describe('PATCH note, GET chairs/free', () => {
  it('saves, clears, limits length', async () => {
    const r = await note(req('PATCH', '/api/appointments/2/note', { dentistNote: '  Check molar  ' }, cookie), idCtx(2));
    expect(await r.json()).toEqual({ ok: true, dentistNote: 'Check molar' });
    expect((await queryOne<{ dentist_note: string }>('SELECT dentist_note FROM appointments WHERE appointment_id = 2'))?.dentist_note).toBe('Check molar');
    await note(req('PATCH', '/api/appointments/2/note', { dentistNote: '' }, cookie), idCtx(2));
    expect((await queryOne<{ dentist_note: string | null }>('SELECT dentist_note FROM appointments WHERE appointment_id = 2'))?.dentist_note).toBeNull();
    expect((await note(req('PATCH', '/api/appointments/2/note', { dentistNote: 'x'.repeat(2001) }, cookie), idCtx(2))).status).toBe(400);
    expect((await note(req('PATCH', '/api/appointments/99999/note', { dentistNote: 'x' }, cookie), idCtx(99999))).status).toBe(404);
  });

  it('free chairs (Rule 6), excludeId frees its own chair', async () => {
    const q = '/api/chairs/free?date=2026-10-19&start=10:00&serviceId=2';
    const r = await (await freeChairsRoute(req('GET', q, undefined, cookie))).json();
    expect(r.chairs).toEqual([{ chairId: 2, chairName: 'Chair 2' }]);
    const r2 = await (await freeChairsRoute(req('GET', `${q}&excludeId=2`, undefined, cookie))).json();
    expect(r2.chairs.map((c: { chairId: number }) => c.chairId)).toEqual([1, 2]);
    expect((await freeChairsRoute(req('GET', q))).status).toBe(401);
    expect((await freeChairsRoute(req('GET', '/api/chairs/free?date=2026-10-19&start=10:00', undefined, cookie))).status).toBe(400);
  });
});
