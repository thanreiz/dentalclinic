/** Patient notices after staff reschedule, decline and cancel (email first, Messenger copy). */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execute, queryOne } from '@/lib/db';
import { setMessengerTransport, type OutgoingMessage } from '@/lib/messenger';
import { declineAppointment, rescheduleAppointment, setAppointmentStatus } from '@/lib/services/appointments';
import { runReminders } from '@/lib/services/reminders';
import { tomorrowManila } from '@/lib/time';
import { fakeMail, insertAppt, workday } from './api-helpers';
import { resetTestDb } from './helpers';

let mail: ReturnType<typeof fakeMail>;
const chat: { to: string; text: string }[] = [];
let messengerFails = false;

beforeAll(async () => {
  await resetTestDb();
  mail = fakeMail();
});
afterAll(async () => {
  mail.restore();
  await resetTestDb();
});
beforeEach(() => {
  chat.length = 0;
  messengerFails = false;
  mail.sent.length = 0;
  mail.setFailAll(false);
  setMessengerTransport({
    send: async (to, message: OutgoingMessage) => {
      if (messengerFails) return { ok: false, error: 'outside the 24 hour window' };
      chat.push({ to, text: 'text' in message ? message.text : '' });
      return { ok: true };
    },
  });
});
afterEach(() => setMessengerTransport(null));

const setPsid = (patientId: number, psid: string | null) => execute('UPDATE patients SET messenger_psid = ? WHERE patient_id = ?', [psid, patientId]);
const setEmail = (patientId: number, email: string | null) => execute('UPDATE patients SET email = ? WHERE patient_id = ?', [email, patientId]);
const statusOf = async (id: number) => (await queryOne<{ status: string }>('SELECT status FROM appointments WHERE appointment_id = ?', [id]))?.status;
const move = { date: workday(5), start: '14:00', dentistId: 2, chairId: 2 };

describe('reschedule notice', () => {
  it('emails and messages the patient with the old time and the new details', async () => {
    await setPsid(1, '6001');
    const id = await insertAppt({ patientId: 1, date: workday(3), start: '09:00', end: '09:30', status: 'scheduled' });
    const r = await rescheduleAppointment(id, move);
    expect(r).toMatchObject({ ok: true, emailSent: true, messengerSent: true });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toContain('moved');
    expect(mail.sent[0].text).toContain('Was: ');
    expect(mail.sent[0].text).toContain('9:00 AM');
    expect(mail.sent[0].text).toContain('2:00 PM');
    expect(mail.sent[0].text).toContain('Dr. Lim');
    expect(chat).toHaveLength(1);
    expect(chat[0].to).toBe('6001');
    expect(chat[0].text).toContain('has been moved');
    expect(chat[0].text).toContain('Oral prophylaxis with Dr. Lim');
  });

  it('a patient with no email still gets the Messenger message; one with neither gets none and the move stands', async () => {
    await setPsid(2, '6002');
    await setEmail(2, null);
    const a = await insertAppt({ patientId: 2, date: workday(3), start: '10:00', end: '10:30', status: 'scheduled' });
    expect(await rescheduleAppointment(a, { ...move, start: '14:30' })).toMatchObject({ ok: true, emailSent: false, emailSkipped: 'no_email', messengerSent: true });
    expect(mail.sent).toHaveLength(0);
    expect(chat).toHaveLength(1);

    await setPsid(3, null);
    await setEmail(3, null);
    chat.length = 0;
    const b = await insertAppt({ patientId: 3, date: workday(3), start: '11:00', end: '11:30', status: 'scheduled' });
    const r = await rescheduleAppointment(b, { ...move, start: '15:00' });
    expect(r).toMatchObject({ ok: true, emailSent: false, emailSkipped: 'no_email' });
    expect(r.messengerSent).toBeUndefined();
    expect(chat).toHaveLength(0);
    expect(await statusOf(b)).toBe('cancelled');
  });

  it('a refused Messenger message or a failed email never blocks or undoes the reschedule', async () => {
    await setPsid(1, '6003');
    messengerFails = true;
    mail.setFailAll(true);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = await insertAppt({ patientId: 1, date: workday(3), start: '13:00', end: '13:30', status: 'scheduled' });
    const r = await rescheduleAppointment(id, { ...move, start: '15:30' });
    expect(r).toMatchObject({ ok: true, emailSent: false, messengerSent: false });
    expect(await statusOf(id)).toBe('cancelled');
    expect(await statusOf(r.newId)).toBe('scheduled');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('a retry is refused and sends nothing more; a rejected move sends nothing', async () => {
    await setPsid(1, '6004');
    const id = await insertAppt({ patientId: 1, date: workday(3), start: '14:00', end: '14:30', status: 'scheduled' });
    await rescheduleAppointment(id, { ...move, start: '16:00' });
    const sentBefore = mail.sent.length + chat.length;
    await expect(rescheduleAppointment(id, { ...move, start: '16:30' })).rejects.toMatchObject({ code: 'invalid_transition' });
    const other = await insertAppt({ patientId: 1, date: workday(3), start: '15:00', end: '15:30', status: 'scheduled' });
    await expect(rescheduleAppointment(other, { ...move, date: '2020-01-01' })).rejects.toBeDefined();
    expect(mail.sent.length + chat.length).toBe(sentBefore);
  });

  it('the new appointment still gets its day-before reminder', async () => {
    await setPsid(1, null);
    const id = await insertAppt({ patientId: 1, date: workday(3), start: '09:00', end: '09:30', status: 'scheduled' });
    const tomorrow = tomorrowManila();
    const r = await rescheduleAppointment(id, { date: tomorrow, start: '09:00', dentistId: 1, chairId: 1 }).catch(() => null);
    if (!r) return; // tomorrow may be a day off; the reminder path is covered in reminders.test.ts
    const row = await queryOne<{ r: string | null }>('SELECT reminder_sent_at AS r FROM appointments WHERE appointment_id = ?', [r.newId]);
    expect(row?.r).toBeNull();
    mail.sent.length = 0;
    await runReminders();
    expect(mail.sent.some((m) => m.subject.startsWith('Reminder'))).toBe(true);
  });
});

describe('decline and cancel notices', () => {
  it('declining a pending request tells the patient on email and Messenger; failures do not block', async () => {
    await setPsid(1, '6010');
    const id = await insertAppt({ patientId: 1, date: workday(3), start: '09:00', end: '09:30', status: 'pending', chairId: null });
    await declineAppointment(id);
    expect(await statusOf(id)).toBe('declined');
    expect(mail.sent[0].subject).toContain('not available');
    expect(chat[0]).toMatchObject({ to: '6010' });

    messengerFails = true;
    mail.setFailAll(true);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const id2 = await insertAppt({ patientId: 1, date: workday(3), start: '09:30', end: '10:00', status: 'pending', chairId: null });
    await declineAppointment(id2);
    expect(await statusOf(id2)).toBe('declined');
    err.mockRestore();
  });

  it('cancelling a scheduled appointment notifies; attended and no-show do not', async () => {
    await setPsid(1, '6011');
    const id = await insertAppt({ patientId: 1, date: workday(3), start: '10:00', end: '10:30', status: 'scheduled' });
    await setAppointmentStatus(id, 'cancelled');
    expect(mail.sent[0].subject).toContain('cancelled');
    expect(chat[0].text).toContain('has been cancelled');

    mail.sent.length = 0;
    chat.length = 0;
    const past = await insertAppt({ patientId: 1, date: '2026-01-05', start: '09:00', end: '09:30', status: 'scheduled' });
    await setAppointmentStatus(past, 'attended');
    const past2 = await insertAppt({ patientId: 1, date: '2026-01-05', start: '10:00', end: '10:30', status: 'scheduled' });
    await setAppointmentStatus(past2, 'no-show');
    expect(mail.sent).toHaveLength(0);
    expect(chat).toHaveLength(0);
  });

  it('an invalid transition sends nothing', async () => {
    const id = await insertAppt({ patientId: 1, date: workday(3), start: '11:00', end: '11:30', status: 'declined', chairId: null });
    await expect(setAppointmentStatus(id, 'cancelled')).rejects.toBeDefined();
    await expect(declineAppointment(id)).rejects.toBeDefined();
    expect(mail.sent).toHaveLength(0);
  });
});

describe('late cancels and deferred notices', () => {
  it('cancelling an appointment that has already started sends no notice (record correction)', async () => {
    await setPsid(1, '6021');
    const id = await insertAppt({ patientId: 1, date: '2026-01-06', start: '09:00', end: '09:30', status: 'scheduled' });
    await setAppointmentStatus(id, 'cancelled');
    expect(await statusOf(id)).toBe('cancelled');
    expect(mail.sent).toHaveLength(0);
    expect(chat).toHaveLength(0);
  });

  it('with a defer function the notice is not sent until the deferred task runs', async () => {
    await setPsid(1, '6022');
    const tasks: (() => Promise<unknown>)[] = [];
    const defer = (t: () => Promise<unknown>) => void tasks.push(t);

    const a = await insertAppt({ patientId: 1, date: workday(3), start: '09:00', end: '09:30', status: 'pending', chairId: null });
    await declineAppointment(a, { defer });
    const b = await insertAppt({ patientId: 1, date: workday(3), start: '10:00', end: '10:30', status: 'scheduled' });
    await setAppointmentStatus(b, 'cancelled', { defer });
    const c = await insertAppt({ patientId: 1, date: workday(3), start: '11:00', end: '11:30', status: 'scheduled' });
    const r = await rescheduleAppointment(c, { ...move, start: '12:00' }, { defer });

    // committed already, nothing sent yet, no notice fields in the result
    expect(await statusOf(a)).toBe('declined');
    expect(await statusOf(b)).toBe('cancelled');
    expect(await statusOf(c)).toBe('cancelled');
    expect(r).toEqual({ ok: true, newId: r.newId });
    expect(mail.sent).toHaveLength(0);
    expect(chat).toHaveLength(0);
    expect(tasks).toHaveLength(3);

    for (const t of tasks) await t();
    expect(mail.sent).toHaveLength(3);
    expect(chat).toHaveLength(3);
  });

  it('a failing deferred notice stays quiet and the change stands', async () => {
    mail.setFailAll(true);
    messengerFails = true;
    await setPsid(1, '6023');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tasks: (() => Promise<unknown>)[] = [];
    const id = await insertAppt({ patientId: 1, date: workday(3), start: '14:00', end: '14:30', status: 'pending', chairId: null });
    await declineAppointment(id, { defer: (t) => void tasks.push(t) });
    await expect(tasks[0]()).resolves.toBeUndefined();
    expect(await statusOf(id)).toBe('declined');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
