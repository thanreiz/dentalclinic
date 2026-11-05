/** Messenger copies of the confirmation (FR12) and the day-before reminder (FR13). */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execute, queryOne } from '@/lib/db';
import { setMessengerTransport, type OutgoingMessage } from '@/lib/messenger';
import { confirmAppointment } from '@/lib/services/appointments';
import { runReminders } from '@/lib/services/reminders';
import { tomorrowManila } from '@/lib/time';
import { fakeMail, insertAppt, workday } from './api-helpers';
import { resetTestDb } from './helpers';

let mail: ReturnType<typeof fakeMail>;
const sent: { to: string; text: string }[] = [];
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
  sent.length = 0;
  messengerFails = false;
  mail.sent.length = 0;
  mail.setFailAll(false);
  setMessengerTransport({
    send: async (to, message: OutgoingMessage) => {
      if (messengerFails) return { ok: false, error: 'outside the 24 hour window' };
      sent.push({ to, text: 'text' in message ? message.text : '' });
      return { ok: true };
    },
  });
});
afterEach(() => {
  setMessengerTransport(null);
});

const setPsid = (patientId: number, psid: string | null) => execute('UPDATE patients SET messenger_psid = ? WHERE patient_id = ?', [psid, patientId]);
const setEmail = (patientId: number, email: string | null) => execute('UPDATE patients SET email = ? WHERE patient_id = ?', [email, patientId]);
const sentAt = async (id: number) => (await queryOne<{ r: string | null }>('SELECT reminder_sent_at AS r FROM appointments WHERE appointment_id = ?', [id]))?.r;

describe('confirmation', () => {
  it('a chat patient gets the Messenger message and the email', async () => {
    await setPsid(1, '5551'); // Maria Santos (has an email)
    const id = await insertAppt({ patientId: 1, date: workday(3), start: '09:00', end: '09:30', status: 'pending', chairId: null });
    const r = await confirmAppointment(id, 1);
    expect(r).toEqual({ ok: true, emailSent: true, messengerSent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('5551');
    expect(sent[0].text).toContain('confirmed');
    expect(sent[0].text).toContain('Oral prophylaxis with Dr. Reyes');
    expect(sent[0].text).toContain('9:00 AM');
    expect(mail.sent).toHaveLength(1);
  });

  it('a patient without a Messenger id is unchanged (no extra field, nothing sent)', async () => {
    await setPsid(2, null);
    const id = await insertAppt({ patientId: 2, date: workday(3), start: '10:00', end: '10:30', status: 'pending', chairId: null });
    expect(await confirmAppointment(id, 1)).toEqual({ ok: true, emailSent: true });
    expect(sent).toHaveLength(0);
  });

  it('a Messenger failure never blocks the confirm; the email still goes out', async () => {
    await setPsid(3, '5553');
    messengerFails = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = await insertAppt({ patientId: 3, date: workday(3), start: '11:00', end: '11:30', status: 'pending', chairId: null });
    expect(await confirmAppointment(id, 1)).toEqual({ ok: true, emailSent: true, messengerSent: false });
    expect(await queryOne('SELECT status FROM appointments WHERE appointment_id = ?', [id])).toEqual({ status: 'scheduled' });
    err.mockRestore();
  });

  it('a chat patient with no email still gets confirmed on Messenger', async () => {
    await setPsid(6, '5556'); // Paolo Garcia has no email
    const id = await insertAppt({ patientId: 6, date: workday(3), start: '12:00', end: '12:30', status: 'pending', chairId: null });
    expect(await confirmAppointment(id, 1)).toEqual({ ok: true, emailSent: false, emailSkipped: 'no_email', messengerSent: true });
  });
});

describe('day-before reminder', () => {
  const tomorrow = tomorrowManila();

  it('email-only patients behave as before', async () => {
    await setPsid(4, null);
    const id = await insertAppt({ patientId: 4, date: tomorrow, start: '09:00', end: '09:30', status: 'scheduled' });
    const r = await runReminders();
    expect(r.failed).toBe(0);
    expect(await sentAt(id)).not.toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('a chat patient with no email is now reminded on Messenger', async () => {
    await setPsid(7, '5557');
    await setEmail(7, null);
    const id = await insertAppt({ patientId: 7, date: tomorrow, start: '10:00', end: '10:30', status: 'scheduled' });
    await runReminders();
    expect(sent.map((s) => s.to)).toContain('5557');
    expect(sent.find((s) => s.to === '5557')!.text).toContain('tomorrow');
    expect(await sentAt(id)).not.toBeNull();
  });

  it('Messenger refusing (outside the window) while the email works still counts as sent', async () => {
    await setPsid(8, '5558');
    const id = await insertAppt({ patientId: 8, date: tomorrow, start: '11:00', end: '11:30', status: 'scheduled' });
    messengerFails = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runReminders();
    err.mockRestore();
    expect(r.failed).toBe(0);
    expect(await sentAt(id)).not.toBeNull();
  });

  it('nothing delivered on any channel -> failed, stays unsent for a retry', async () => {
    await setPsid(9, '5559');
    await setEmail(9, null);
    const id = await insertAppt({ patientId: 9, date: tomorrow, start: '12:00', end: '12:30', status: 'scheduled' });
    messengerFails = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runReminders();
    err.mockRestore();
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(await sentAt(id)).toBeNull();
  });
});
