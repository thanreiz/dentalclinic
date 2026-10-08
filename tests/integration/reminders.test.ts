/** GET /api/cron/reminders (FR13, Rule 8) + lib/mail behavior. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GET as cron } from '@/app/api/cron/reminders/route';
import { execute, queryOne } from '@/lib/db';
import { confirmationEmail, reminderEmail, sendMail, setMailTransport } from '@/lib/mail';
import { cronAuthorized } from '@/lib/services/reminders';
import { tomorrowManila } from '@/lib/time';
import { fakeMail, insertAppt, LIM } from './api-helpers';
import { resetTestDb } from './helpers';

const SECRET = 'test-cron-secret-0123456789';
let mail: ReturnType<typeof fakeMail>;
const ids: Record<string, number> = {};

beforeAll(async () => {
  await resetTestDb();
  process.env.CRON_SECRET = SECRET;
  mail = fakeMail();
  const t = tomorrowManila();
  ids.maria = await insertAppt({ patientId: 1, date: t, start: '09:00', end: '09:30', status: 'scheduled' });
  ids.jose = await insertAppt({ patientId: 2, dentistId: LIM, chairId: 2, date: t, start: '09:00', end: '09:45', status: 'scheduled', serviceId: 3 });
  ids.noEmail = await insertAppt({ patientId: 6, date: t, start: '10:00', end: '10:30', status: 'scheduled' });
  ids.pending = await insertAppt({ patientId: 3, date: t, start: '11:00', end: '11:30', status: 'pending', chairId: null });
  ids.already = await insertAppt({ patientId: 4, date: t, start: '12:00', end: '12:30', status: 'scheduled', reminderSentAt: '2026-10-01 09:00:00' });
  ids.cancelled = await insertAppt({ patientId: 5, date: t, start: '13:00', end: '13:30', status: 'cancelled' });
});
// Leave dental_test as seeded for suites that don't reset (e.g. seed-report).
afterAll(async () => {
  await resetTestDb();
});
afterAll(() => mail.restore());
afterEach(() => {
  mail.failFor.clear();
  mail.setFailAll(false);
});

const auth = (token = SECRET) => ({ authorization: `Bearer ${token}` });
const call = (headers: Record<string, string> = {}) => cron(new Request('http://localhost/api/cron/reminders', { headers }));
const sentAt = async (id: number) =>
  (await queryOne<{ reminder_sent_at: string | null }>('SELECT reminder_sent_at FROM appointments WHERE appointment_id = ?', [id]))?.reminder_sent_at;

describe('cron auth', () => {
  it('401 without header or with a wrong token; 500 when CRON_SECRET is unset', async () => {
    expect((await call()).status).toBe(401);
    expect((await call(auth('wrong'))).status).toBe(401);
    expect((await call({ authorization: SECRET })).status).toBe(401);
    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = '';
    const r = await call(auth(''));
    expect(r.status).toBe(500);
    expect((await r.json()).error).toBe('cron_not_configured');
    process.env.CRON_SECRET = saved;
    expect(mail.sent).toHaveLength(0);
    expect(cronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(cronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(cronAuthorized('Bearer ', '')).toBe(false);
  });
});

describe('Rule 8 selection and idempotency', () => {
  it('failed send leaves reminder_sent_at NULL; success sets it', async () => {
    mail.failFor.add('jose.ramos@example.com');
    const r = await (await call(auth())).json();
    expect(r).toMatchObject({ sent: 1, failed: 1, date: tomorrowManila() });
    expect(mail.sent.map((m) => m.to)).toEqual(['maria.santos@example.com']);
    expect(await sentAt(ids.maria)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(await sentAt(ids.jose)).toBeNull();
    expect(await sentAt(ids.noEmail)).toBeNull();
    expect(await sentAt(ids.pending)).toBeNull();
    expect(await sentAt(ids.already)).toBe('2026-10-01 09:00:00');
    const m = mail.sent[0];
    expect(m.subject).toBe('Reminder: your appointment tomorrow at 9:00 AM');
    expect(m.text).toContain('Dentist: Dr. Reyes');
  });

  it('second run sends only the previously failed one; third run sends nothing', async () => {
    const r2 = await (await call(auth())).json();
    expect(r2).toMatchObject({ sent: 1, failed: 0 });
    expect(mail.sent.map((m) => m.to)).toEqual(['maria.santos@example.com', 'jose.ramos@example.com']);
    const r3 = await (await call(auth())).json();
    expect(r3).toMatchObject({ sent: 0, failed: 0 });
    expect(mail.sent).toHaveLength(2);
  });

  it('two overlapping runs never double-send', async () => {
    await execute('UPDATE appointments SET reminder_sent_at = NULL WHERE appointment_id IN (?, ?)', [ids.maria, ids.jose]);
    const before = mail.sent.length;
    const [a, b] = await Promise.all([call(auth()), call(auth())]);
    const [ra, rb] = [await a.json(), await b.json()];
    expect(ra.sent + rb.sent).toBe(2);
    expect(mail.sent.length - before).toBe(2);
  });
});

describe('lib/mail', () => {
  it('formats per PRD and strips CR/LF from headers', async () => {
    const a = { to: 'x@example.com\r\nBcc: evil@example.com', patientName: 'Maria', date: '2026-10-15', startTime: '10:00', dentist: 'Dr. Reyes', service: 'Tooth filling' };
    expect(confirmationEmail(a).subject).toBe('Appointment confirmed: Oct 15, 2026, 10:00 AM');
    expect(reminderEmail(a).text).toContain('Date: Oct 15, 2026\nTime: 10:00 AM\nDentist: Dr. Reyes\nService: Tooth filling');
    await sendMail({ to: a.to, subject: 'Hi\nthere', text: 'body' });
    const last = mail.sent.at(-1)!;
    expect(last.to).not.toMatch(/[\r\n]/);
    expect(last.subject).toBe('Hi there');
  });

  it('dev mode (no SMTP) logs and reports sent; production without SMTP fails', async () => {
    setMailTransport(null);
    const env = process.env as Record<string, string | undefined>;
    const saved = { host: env.SMTP_HOST, user: env.SMTP_USER, pass: env.SMTP_PASS, node: env.NODE_ENV };
    env.SMTP_HOST = '';
    env.SMTP_USER = '';
    env.SMTP_PASS = '';
    try {
      expect(await sendMail({ to: 'a@example.com', subject: 's', text: 't' })).toEqual({ ok: true, dev: true });
      env.NODE_ENV = 'production';
      expect(await sendMail({ to: 'a@example.com', subject: 's', text: 't' })).toEqual({ ok: false, error: 'smtp_not_configured' });
    } finally {
      env.NODE_ENV = saved.node;
      env.SMTP_HOST = saved.host;
      env.SMTP_USER = saved.user;
      env.SMTP_PASS = saved.pass;
      mail = fakeMail();
    }
  });
});
