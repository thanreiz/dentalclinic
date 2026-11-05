/** Messenger webhook (GET handshake, signed POST) and chat-channel booking requests. */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as webhookGet, POST as webhookPost } from '@/app/api/messenger/route';
import { POST as postRequest } from '@/app/api/requests/route';
import { queryOne } from '@/lib/db';
import { setMessengerTransport, signChatRef, type OutgoingMessage } from '@/lib/messenger';
import { bookingBody, req, workday } from './api-helpers';
import { resetTestDb } from './helpers';

const SECRET = 'app-secret-for-tests';

beforeAll(async () => {
  await resetTestDb();
});
afterAll(async () => {
  await resetTestDb();
});

const sent: { to: string; message: OutgoingMessage }[] = [];
beforeEach(() => {
  sent.length = 0;
  vi.stubEnv('MESSENGER_APP_SECRET', SECRET);
  vi.stubEnv('MESSENGER_VERIFY_TOKEN', 'verify-me');
  vi.stubEnv('REQUEST_LIMIT_PER_IP', '0');
  setMessengerTransport({ send: async (to, message) => (sent.push({ to, message }), { ok: true }) });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setMessengerTransport(null);
});

const signed = (body: string, secret = SECRET) =>
  new Request('http://localhost/api/messenger', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
    body,
  });

const event = (id: string, extra: object) => JSON.stringify({ object: 'page', entry: [{ messaging: [{ sender: { id }, ...extra }] }] });

describe('GET /api/messenger (Meta handshake)', () => {
  const url = (q: string) => new Request(`http://localhost/api/messenger?${q}`);
  it('echoes the challenge for the right verify token', async () => {
    const res = await webhookGet(url('hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('12345');
  });
  it('403 for a wrong token or mode; 503 when not configured', async () => {
    expect((await webhookGet(url('hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1'))).status).toBe(403);
    expect((await webhookGet(url('hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=1'))).status).toBe(403);
    vi.stubEnv('MESSENGER_VERIFY_TOKEN', '');
    expect((await webhookGet(url('hub.mode=subscribe&hub.verify_token=&hub.challenge=1'))).status).toBe(503);
  });
});

describe('POST /api/messenger', () => {
  it('rejects unsigned and wrongly signed deliveries without replying', async () => {
    const body = event('111', { message: { text: 'hi' } });
    expect((await webhookPost(new Request('http://localhost/api/messenger', { method: 'POST', body }))).status).toBe(403);
    expect((await webhookPost(signed(body, 'wrong-secret'))).status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('503 when the app secret is not set (never open)', async () => {
    vi.stubEnv('MESSENGER_APP_SECRET', '');
    expect((await webhookPost(signed(event('111', { message: { text: 'hi' } })))).status).toBe(503);
  });

  it('signed greeting gets the menu; the book button gets services', async () => {
    expect((await webhookPost(signed(event('111', { message: { text: 'hi' } })))).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('111');
    expect(JSON.stringify(sent[0].message)).toContain('"payload":"book"');

    sent.length = 0;
    await webhookPost(signed(event('111', { postback: { payload: 'book' } })));
    const m = sent[0].message as { quick_replies: { title: string }[] };
    expect(m.quick_replies.map((q) => q.title)).toEqual(['Oral prophylaxis', 'Tooth filling', 'Tooth extraction', 'Exam and X-ray', 'Wisdom tooth removal', 'Root canal treatment', 'Crown preparation', 'Braces fitting', 'Braces adjustment', 'Braces removal', 'Teeth whitening', 'Dental implant']);
  });

  it('walks to a summary, change, confirm and a prefilled /book link carrying a verifiable token (real slots from the database)', async () => {
    await webhookPost(signed(event('222', { postback: { payload: 'den:1:any' } })));
    const days = sent[0].message as { quick_replies: { payload: string }[] };
    expect(days.quick_replies.length).toBeGreaterThan(0);
    const datePayload = days.quick_replies[0].payload; // date:1:any:YYYY-MM-DD

    sent.length = 0;
    await webhookPost(signed(event('222', { message: { quick_reply: { payload: datePayload }, text: 'x' } })));
    const times = sent[0].message as { quick_replies: { payload: string }[] };
    const timePayload = times.quick_replies[0].payload;

    // the last answer shows a summary first (no link yet); Confirm releases the link
    sent.length = 0;
    await webhookPost(signed(event('222', { message: { quick_reply: { payload: timePayload }, text: 'x' } })));
    const summary = sent[0].message as { text: string; quick_replies: { title: string; payload: string }[] };
    expect(summary.text).toContain('Please check your request');
    expect(JSON.stringify(summary)).not.toContain('/book?');
    expect(summary.quick_replies.map((q) => q.title)).toEqual(['Confirm', 'Change something', 'Start over']);

    // change the time: only the time is redone, then the summary returns
    sent.length = 0;
    await webhookPost(signed(event('222', { message: { quick_reply: { payload: summary.quick_replies[1].payload }, text: 'x' } })));
    const changeMenu = sent[0].message as { quick_replies: { title: string; payload: string }[] };
    const changeTime = changeMenu.quick_replies.find((q) => q.title === 'Time')!;
    sent.length = 0;
    await webhookPost(signed(event('222', { postback: { payload: changeTime.payload } })));
    const newTimes = sent[0].message as { quick_replies: { payload: string }[] };
    sent.length = 0;
    await webhookPost(signed(event('222', { postback: { payload: newTimes.quick_replies[0].payload } })));
    expect((sent[0].message as { text: string }).text).toContain('Please check your request');

    // typed "start over" restarts from the services
    sent.length = 0;
    await webhookPost(signed(event('222', { message: { text: 'Start Over' } })));
    expect(sent).toHaveLength(2);
    expect((sent[1].message as { quick_replies: { payload: string }[] }).quick_replies[0].payload).toBe('svc:1');

    sent.length = 0;
    await webhookPost(signed(event('222', { postback: { payload: summary.quick_replies[0].payload } })));
    const btn = (sent[0].message as { attachment: { payload: { buttons: { url: string }[] } } }).attachment.payload.buttons[0].url;
    const u = new URL(btn);
    expect(u.pathname).toBe('/book');
    expect(u.searchParams.get('service')).toBe('1');
    expect(u.searchParams.get('ref')).toMatch(/^222\.\d+\./);
  });

  it('a delivery with a reply failure still answers 200; echoes are ignored', async () => {
    setMessengerTransport({ send: async () => ({ ok: false, error: 'boom' }) });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await webhookPost(signed(event('333', { message: { text: 'hi' } })))).status).toBe(200);
    err.mockRestore();
    sent.length = 0;
    setMessengerTransport({ send: async (to, message) => (sent.push({ to, message }), { ok: true }) });
    await webhookPost(signed(event('333', { message: { text: 'echo', is_echo: true } })));
    expect(sent).toHaveLength(0);
  });

  it('malformed JSON with a valid signature -> 400', async () => {
    expect((await webhookPost(signed('{not json'))).status).toBe(400);
  });
});

describe('POST /api/requests with a Messenger token', () => {
  const channelOf = async (contact: string) =>
    (await queryOne<{ channel: string }>(
      'SELECT a.channel FROM appointments a JOIN patients p USING (patient_id) WHERE p.contact_number = ? ORDER BY a.appointment_id DESC LIMIT 1',
      [contact],
    ))!.channel;

  it('a valid token records channel chat', async () => {
    const body = bookingBody({ start: '09:00', chatRef: signChatRef('555') });
    const res = await postRequest(req('POST', '/api/requests', body));
    expect(res.status).toBe(201);
    expect(await channelOf(body.contactNumber)).toBe('chat');
  });

  it('a bad or expired token still books the request, as online', async () => {
    const bad = bookingBody({ start: '09:30', chatRef: '555.1.AAAA' });
    expect((await postRequest(req('POST', '/api/requests', bad))).status).toBe(201);
    expect(await channelOf(bad.contactNumber)).toBe('online');

    const old = bookingBody({ start: '10:00', chatRef: signChatRef('555', Math.floor(Date.now() / 1000) - 3 * 3600) });
    expect((await postRequest(req('POST', '/api/requests', old))).status).toBe(201);
    expect(await channelOf(old.contactNumber)).toBe('online');
  });

  it('no token -> online (unchanged)', async () => {
    const body = bookingBody({ start: '10:30' });
    expect((await postRequest(req('POST', '/api/requests', body))).status).toBe(201);
    expect(await channelOf(body.contactNumber)).toBe('online');
  });

  it('chat requests count toward the per-contact pending cap', async () => {
    const contact = bookingBody().contactNumber;
    const day = workday(1);
    for (const start of ['09:00', '09:30', '10:00']) {
      const r = await postRequest(req('POST', '/api/requests', bookingBody({ contactNumber: contact, date: day, start, chatRef: signChatRef('777') })));
      expect(r.status).toBe(201);
    }
    const fourth = await postRequest(req('POST', '/api/requests', bookingBody({ contactNumber: contact, date: day, start: '10:30', chatRef: signChatRef('777') })));
    expect(fourth.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Messenger notifications (confirmation, day-before reminder) and storing the Messenger id
// ---------------------------------------------------------------------------
describe('Messenger id and notifications', () => {
  const psidOf = async (contact: string) =>
    (await queryOne<{ messenger_psid: string | null }>('SELECT messenger_psid FROM patients WHERE contact_number = ?', [contact]))?.messenger_psid ?? null;

  it('a chat request stores the Messenger id; an online one does not; the latest chat booking wins', async () => {
    const a = bookingBody({ start: '13:00', chatRef: signChatRef('9001') });
    expect((await postRequest(req('POST', '/api/requests', a))).status).toBe(201);
    expect(await psidOf(a.contactNumber)).toBe('9001');

    const online = bookingBody({ start: '13:30' });
    expect((await postRequest(req('POST', '/api/requests', online))).status).toBe(201);
    expect(await psidOf(online.contactNumber)).toBeNull();

    const again = bookingBody({ contactNumber: a.contactNumber, date: workday(2), start: '13:00', chatRef: signChatRef('9002') });
    expect((await postRequest(req('POST', '/api/requests', again))).status).toBe(201);
    expect(await psidOf(a.contactNumber)).toBe('9002');
  });

  it('a bad token stores no id', async () => {
    const b = bookingBody({ start: '14:00', chatRef: '9003.1.BAD' });
    await postRequest(req('POST', '/api/requests', b));
    expect(await psidOf(b.contactNumber)).toBeNull();
  });
});
