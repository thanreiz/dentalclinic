/**
 * Slow channels never hold up the response: confirm notices and Messenger replies run after the
 * response (Next.js after()), email + Messenger go out in parallel, and the reminder cron sends in
 * small parallel batches without double-sending.
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture after() callbacks so a test can see the response was ready before the work ran.
const deferred: (() => Promise<unknown>)[] = [];
vi.mock('next/server', async (orig) => {
  const mod = await orig<typeof import('next/server')>();
  return { ...mod, after: (task: () => Promise<unknown>) => void deferred.push(task) };
});

import { POST as webhookPost } from '@/app/api/messenger/route';
import { POST as confirmRoute } from '@/app/api/appointments/[id]/confirm/route';
import { GET as cron } from '@/app/api/cron/reminders/route';
import { execute, queryOne } from '@/lib/db';
import { setMailTransport, type MailMessage } from '@/lib/mail';
import { setMessengerTransport } from '@/lib/messenger';
import { confirmAppointment } from '@/lib/services/appointments';
import { REMINDER_BATCH_SIZE } from '@/lib/services/reminders';
import { tomorrowManila } from '@/lib/time';
import { idCtx, insertAppt, req, staffCookie, workday } from './api-helpers';
import { resetTestDb } from './helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const runDeferred = async () => {
  const tasks = deferred.splice(0);
  await Promise.all(tasks.map((t) => t()));
};

let mailLog: MailMessage[] = [];
let mailDelay = 0;
let mailInFlight = 0;
let mailPeak = 0;
let chatLog: string[] = [];
let chatDelay = 0;

beforeAll(async () => {
  await resetTestDb();
});
afterAll(async () => {
  setMailTransport(null);
  setMessengerTransport(null);
  await resetTestDb();
});
beforeEach(() => {
  deferred.length = 0;
  mailLog = [];
  mailDelay = 0;
  mailInFlight = 0;
  mailPeak = 0;
  chatLog = [];
  chatDelay = 0;
  vi.stubEnv('MESSENGER_APP_SECRET', 's3cret');
  setMailTransport({
    async sendMail(m) {
      mailInFlight++;
      mailPeak = Math.max(mailPeak, mailInFlight);
      await sleep(mailDelay);
      mailInFlight--;
      mailLog.push(m);
    },
  });
  setMessengerTransport({
    send: async (to) => {
      await sleep(chatDelay);
      chatLog.push(to);
      return { ok: true };
    },
  });
});
afterEach(() => vi.unstubAllEnvs());

const pending = (start: string, patientId = 1) => insertAppt({ patientId, date: workday(0), start, end: start.replace(/:(\d\d)$/, (_, m) => `:${String(Number(m) + 30).padStart(2, '0')}`), status: 'pending', chairId: null, channel: 'online' });

describe('confirm', () => {
  it('route answers before a slow SMTP finishes; the notice runs in after()', async () => {
    mailDelay = 400;
    const id = await pending('09:00');
    const t0 = Date.now();
    const res = await confirmRoute(req('POST', `/api/appointments/${id}/confirm`, { chairId: 1 }, await staffCookie()), idCtx(id));
    const took = Date.now() - t0;
    expect(await res.json()).toEqual({ ok: true, noticeQueued: true });
    expect(took).toBeLessThan(300);
    expect(mailLog).toHaveLength(0);
    expect(deferred).toHaveLength(1);
    await runDeferred();
    expect(mailLog.map((m) => m.subject)).toEqual([expect.stringMatching(/^Appointment confirmed/)]);
    expect((await queryOne<{ status: string }>('SELECT status FROM appointments WHERE appointment_id = ?', [id]))?.status).toBe('scheduled');
  });

  it('a failing email in the deferred notice never throws and the confirm stays', async () => {
    const id = await pending('10:00');
    setMailTransport({ sendMail: async () => Promise.reject(new Error('SMTP down')) });
    const r = await confirmAppointment(id, 1, { defer: async (t) => void deferred.push(t) });
    expect(r).toEqual({ ok: true, noticeQueued: true });
    await expect(runDeferred()).resolves.toBeUndefined();
  });

  it('email and Messenger go out in parallel, not one after the other', async () => {
    await execute("UPDATE patients SET messenger_psid = '7001' WHERE patient_id = 1");
    mailDelay = 300;
    chatDelay = 300;
    const id = await pending('11:00');
    const t0 = Date.now();
    const r = await confirmAppointment(id, 1); // no defer: awaited (direct service call)
    expect(Date.now() - t0).toBeLessThan(550);
    expect(r).toEqual({ ok: true, emailSent: true, messengerSent: true });
    await execute('UPDATE patients SET messenger_psid = NULL WHERE patient_id = 1');
  });
});

describe('messenger webhook', () => {
  const signed = (body: string) =>
    new Request('http://localhost/api/messenger', {
      method: 'POST',
      headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}` },
      body,
    });
  const ev = (id: string, mid: string) => ({ sender: { id }, message: { mid, text: 'hi' } });
  const payload = (...m: object[]) => JSON.stringify({ object: 'page', entry: [{ messaging: m }] });

  it('answers 200 before any reply is sent; replies go out in after()', async () => {
    chatDelay = 300;
    const t0 = Date.now();
    const res = await webhookPost(signed(payload(ev('8001', 'm.async.1'))));
    expect(res.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(250);
    expect(chatLog).toHaveLength(0);
    await runDeferred();
    expect(chatLog).toEqual(['8001']);
  });

  it('a bad signature is still 403 and queues nothing', async () => {
    const res = await webhookPost(new Request('http://localhost/api/messenger', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=00' }, body: payload(ev('8002', 'm.async.2')) }));
    expect(res.status).toBe(403);
    expect(deferred).toHaveLength(0);
  });

  it('oversize body is still 413', async () => {
    const res = await webhookPost(signed('x'.repeat(256 * 1024 + 1)));
    expect(res.status).toBe(413);
    expect(deferred).toHaveLength(0);
  });

  it('keeps one user\'s order, de-dupes redelivered mids, runs different users in parallel', async () => {
    chatDelay = 150;
    const body = payload(ev('8100', 'm.o.1'), ev('8100', 'm.o.2'), ev('8101', 'm.o.3'), ev('8102', 'm.o.4'));
    await webhookPost(signed(body));
    await webhookPost(signed(body)); // redelivery
    const t0 = Date.now();
    await runDeferred();
    // 8100 needs 2 replies in series (~300ms); the other users overlap it. Serial would be ~600ms+.
    expect(Date.now() - t0).toBeLessThan(550);
    expect(chatLog.filter((t) => t === '8100')).toHaveLength(2);
    expect(chatLog).toHaveLength(4);
  });
});

describe('reminder cron', () => {
  const SECRET = 'test-cron-secret-0123456789abcdefghij';
  beforeEach(() => vi.stubEnv('CRON_SECRET', SECRET));

  it('sends in parallel batches of at most 5 and never double-sends on a re-run', async () => {
    const t = tomorrowManila();
    const n = 12;
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const h = String(8 + Math.floor(i / 2)).padStart(2, '0');
      ids.push(await insertAppt({ patientId: 1 + (i % 4), dentistId: 1 + (i % 3), chairId: 1 + (i % 2), date: t, start: `${h}:${i % 2 ? '30' : '00'}`, end: `${h}:${i % 2 ? '45' : '15'}`, status: 'scheduled' }));
    }
    mailDelay = 100;
    const call = () => cron(new Request('http://localhost/api/cron/reminders', { headers: { authorization: `Bearer ${SECRET}` } }));
    const t0 = Date.now();
    const first = await (await call()).json();
    const took = Date.now() - t0;
    expect(first).toMatchObject({ failed: 0 });
    expect(first.sent).toBeGreaterThanOrEqual(n);
    expect(mailPeak).toBeGreaterThan(1);
    expect(mailPeak).toBeLessThanOrEqual(REMINDER_BATCH_SIZE);
    expect(took).toBeLessThan(first.sent * mailDelay * 0.7); // serial would take sent * 100ms
    const sentMails = mailLog.length;
    const second = await (await call()).json();
    expect(second).toMatchObject({ sent: 0, failed: 0 });
    expect(mailLog).toHaveLength(sentMails);
    for (const id of ids) {
      expect((await queryOne<{ reminder_sent_at: string | null }>('SELECT reminder_sent_at FROM appointments WHERE appointment_id = ?', [id]))?.reminder_sent_at).not.toBeNull();
    }
  });
});
