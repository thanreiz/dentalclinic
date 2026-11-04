import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_REF_TTL_SECONDS, sendMessengerMessage, setMessengerTransport, signChatRef, verifyChatRef, verifyMessengerSignature, type OutgoingMessage } from '@/lib/messenger';
import { botReplies, dateLabel, extractEvents, pickTimes, type BotDeps } from '@/lib/services/messenger-bot';
import type { Slot } from '@/lib/types';

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'test-session-secret-that-is-at-least-32-chars');
});
afterEach(() => {
  vi.unstubAllEnvs();
  setMessengerTransport(null);
});

const sign = (body: string, secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('verifyMessengerSignature', () => {
  const body = '{"object":"page","entry":[]}';
  it('accepts the right signature', () => {
    expect(verifyMessengerSignature(body, sign(body, 's3cret'), 's3cret')).toBe(true);
  });
  it('rejects wrong secret, changed body, missing/malformed header, empty secret', () => {
    expect(verifyMessengerSignature(body, sign(body, 'other'), 's3cret')).toBe(false);
    expect(verifyMessengerSignature(body + ' ', sign(body, 's3cret'), 's3cret')).toBe(false);
    expect(verifyMessengerSignature(body, null, 's3cret')).toBe(false);
    expect(verifyMessengerSignature(body, 'sha256=zzzz', 's3cret')).toBe(false);
    expect(verifyMessengerSignature(body, sign(body, 's3cret').replace('sha256=', 'sha1='), 's3cret')).toBe(false);
    expect(verifyMessengerSignature(body, sign(body, ''), '')).toBe(false);
  });
});

describe('chat ref token', () => {
  const now = 1_800_000_000;
  it('round-trips the sender id', () => {
    expect(verifyChatRef(signChatRef('123456789', now), now + 10)).toBe('123456789');
  });
  it('expires', () => {
    const t = signChatRef('123456789', now);
    expect(verifyChatRef(t, now + CHAT_REF_TTL_SECONDS)).toBe('123456789');
    expect(verifyChatRef(t, now + CHAT_REF_TTL_SECONDS + 1)).toBeNull();
  });
  it('rejects tampering, junk and a different secret', () => {
    const t = signChatRef('123456789', now);
    const [psid, exp, sig] = t.split('.');
    expect(verifyChatRef(`999.${exp}.${sig}`, now)).toBeNull();
    expect(verifyChatRef(`${psid}.${Number(exp) + 99999}.${sig}`, now)).toBeNull();
    expect(verifyChatRef(`${psid}.${exp}.x${sig}`, now)).toBeNull();
    for (const junk of ['', 'abc', 'a.b.c', '1.2', undefined, null]) expect(verifyChatRef(junk as string, now)).toBeNull();
    vi.stubEnv('SESSION_SECRET', 'another-secret-that-is-also-32-chars-long');
    expect(verifyChatRef(t, now)).toBeNull();
  });
  it('refuses to sign a non-numeric id', () => {
    expect(() => signChatRef('12 34')).toThrow();
  });
});

describe('sendMessengerMessage', () => {
  it('uses the test transport and rejects a bad recipient', async () => {
    const sent: [string, OutgoingMessage][] = [];
    setMessengerTransport({ send: async (id, m) => (sent.push([id, m]), { ok: true }) });
    expect(await sendMessengerMessage('42', { text: 'hi' })).toEqual({ ok: true });
    expect(sent).toEqual([['42', { text: 'hi' }]]);
    expect((await sendMessengerMessage('4 2', { text: 'x' })).ok).toBe(false);
  });
  it('dev mode (no page token, not production) logs and reports success; production reports failure', async () => {
    vi.stubEnv('MESSENGER_PAGE_TOKEN', '');
    vi.stubEnv('NODE_ENV', 'test');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await sendMessengerMessage('42', { text: 'hi' })).toEqual({ ok: true, dev: true });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    vi.stubEnv('NODE_ENV', 'production');
    expect((await sendMessengerMessage('42', { text: 'hi' })).ok).toBe(false);
  });
});

describe('extractEvents', () => {
  const wrap = (messaging: unknown[]) => ({ object: 'page', entry: [{ messaging }] }) as Parameters<typeof extractEvents>[0];
  it('keeps text, quick replies and postbacks; drops echoes, reads and junk senders', () => {
    const events = extractEvents(
      wrap([
        { sender: { id: '1' }, message: { text: 'hello' } },
        { sender: { id: '2' }, message: { text: 'Mon', quick_reply: { payload: 'svc:1' } } },
        { sender: { id: '3' }, postback: { payload: 'book' } },
        { sender: { id: '4' }, message: { text: 'echo', is_echo: true } },
        { sender: { id: '5' }, read: { watermark: 1 } },
        { sender: { id: 'abc' }, message: { text: 'x' } },
        { message: { text: 'no sender' } },
      ]),
    );
    expect(events).toEqual([
      { senderId: '1', text: 'hello', payload: undefined },
      { senderId: '2', text: 'Mon', payload: 'svc:1' },
      { senderId: '3', payload: 'book', text: undefined },
    ]);
  });
  it('ignores non-page objects and caps the number of events', () => {
    expect(extractEvents({ object: 'user', entry: [] })).toEqual([]);
    const many = wrap(Array.from({ length: 200 }, (_, i) => ({ sender: { id: String(i + 1) }, message: { text: 'x' } })));
    expect(extractEvents(many)).toHaveLength(50);
  });
});

describe('bot flow', () => {
  const slot = (start: string): Slot => ({ start, end: start, dentistIds: [1] });
  const deps: BotDeps = {
    services: async () => [{ id: 1, name: 'Oral prophylaxis' }, { id: 2, name: 'Tooth filling' }],
    dentists: async () => [{ id: 1, name: 'Dr. Reyes' }, { id: 2, name: 'Dr. Lim' }],
    // open Mon 2026-11-09 and Tue 2026-11-10 only
    slots: async ({ date }) => (date === '2026-11-09' ? [slot('09:00'), slot('09:30')] : date === '2026-11-10' ? [slot('13:00')] : []),
    today: () => '2026-11-08',
    baseUrl: () => 'https://clinic.example',
    signRef: (psid) => `ref-for-${psid}`,
  };
  const first = async (payload: string | undefined, text?: string) => (await botReplies({ senderId: '77', payload, text }, deps))[0];

  it('greets with a menu for free text, unknown or malformed payloads', async () => {
    for (const p of [undefined, 'hello', 'svc:abc', "svc:1'; DROP", 'den:1:xyz', 'time:1:any:2026-11-09:25:99x']) {
      const m = (await first(p, 'hi')) as { text: string; quick_replies: { payload: string }[] };
      expect(m.quick_replies.map((q) => q.payload)).toEqual(['book']);
    }
  });

  it('book -> services -> dentists -> days -> times -> link', async () => {
    const services = (await first('book')) as { quick_replies: { title: string; payload: string }[] };
    expect(services.quick_replies.map((q) => q.payload)).toEqual(['svc:1', 'svc:2']);

    const dentists = (await first('svc:1')) as { quick_replies: { payload: string }[] };
    expect(dentists.quick_replies.map((q) => q.payload)).toEqual(['den:1:any', 'den:1:1', 'den:1:2']);

    const days = (await first('den:1:any')) as { quick_replies: { title: string; payload: string }[] };
    expect(days.quick_replies.map((q) => q.payload)).toEqual(['date:1:any:2026-11-09', 'date:1:any:2026-11-10']);
    expect(days.quick_replies[0].title).toBe('Mon, Nov 9');

    const times = (await first('date:1:any:2026-11-09')) as { quick_replies: { title: string; payload: string }[] };
    expect(times.quick_replies.map((q) => [q.title, q.payload])).toEqual([
      ['9:00 AM', 'time:1:any:2026-11-09:09:00'],
      ['9:30 AM', 'time:1:any:2026-11-09:09:30'],
    ]);

    const link = (await first('time:1:any:2026-11-09:09:30')) as { attachment: { payload: { text: string; buttons: { url: string }[] } } };
    const url = new URL(link.attachment.payload.buttons[0].url);
    expect(url.origin + url.pathname).toBe('https://clinic.example/book');
    expect(Object.fromEntries(url.searchParams)).toEqual({ service: '1', dentist: 'any', date: '2026-11-09', time: '09:30', ref: 'ref-for-77' });
    expect(link.attachment.payload.text).toContain('Mon, Nov 9');
  });

  it('unknown service falls back to the menu; no open days / full day get a way out', async () => {
    expect(((await first('svc:99')) as { quick_replies: { payload: string }[] }).quick_replies[0].payload).toBe('book');
    const none = (await botReplies({ senderId: '1', payload: 'den:1:any' }, { ...deps, slots: async () => [] }))[0] as { quick_replies: { payload: string }[] };
    expect(none.quick_replies[0].payload).toBe('book');
    const full = (await botReplies({ senderId: '1', payload: 'date:1:any:2026-11-11' }, deps))[0] as { text: string; quick_replies: { payload: string }[] };
    expect(full.text).toContain('filled up');
    expect(full.quick_replies[0].payload).toBe('den:1:any');
  });

  it('a failing dependency gives an apology, not a throw', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = (await botReplies({ senderId: '1', payload: 'book' }, { ...deps, services: async () => { throw new Error('db down'); } }))[0] as { text: string };
    expect(m.text).toContain('something went wrong');
    err.mockRestore();
  });

  it('quick reply titles stay within Messenger limits', async () => {
    const long = { ...deps, services: async () => [{ id: 1, name: 'A very long service name that overflows' }] };
    const m = (await botReplies({ senderId: '1', payload: 'book' }, long))[0] as { quick_replies: { title: string }[] };
    expect(m.quick_replies[0].title.length).toBeLessThanOrEqual(20);
  });
});

describe('pickTimes / dateLabel', () => {
  const mk = (n: number): Slot[] => Array.from({ length: n }, (_, i) => ({ start: String(i), end: String(i), dentistIds: [1] }));
  it('keeps up to 13, spread over the day, always including first and last', () => {
    expect(pickTimes(mk(5))).toHaveLength(5);
    const p = pickTimes(mk(30));
    expect(p).toHaveLength(13);
    expect(p[0].start).toBe('0');
    expect(p[12].start).toBe('29');
  });
  it('labels a date with its weekday', () => {
    expect(dateLabel('2026-11-09')).toBe('Mon, Nov 9');
  });
});
