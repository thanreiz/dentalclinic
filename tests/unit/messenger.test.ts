import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_REF_TTL_SECONDS, sendMessengerMessage, setMessengerTransport, signChatRef, verifyChatRef, verifyMessengerSignature, type OutgoingMessage } from '@/lib/messenger';
import { alreadyHandled, botReplies, dateLabel, extractEvents, normalizeTyped, pickTimes, processEvents, resetHandledMids, type BotDeps, type BotEvent } from '@/lib/services/messenger-bot';
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
    upcoming: async () => [],
    requestReschedule: async () => ({ ok: true, position: 1 }),
    pendingFor: async () => null,
  };
  const first = async (payload: string | undefined, text?: string) => (await botReplies({ senderId: '77', payload, text }, deps))[0];

  it('greets with a menu for free text, unknown or malformed payloads', async () => {
    for (const p of [undefined, 'hello', 'svc:abc', "svc:1'; DROP", 'den:1:xyz', 'time:1:any:2026-11-09:25:99x']) {
      const m = (await first(p, 'hi')) as { text: string; quick_replies: { payload: string }[] };
      expect(m.quick_replies.map((q) => q.payload)).toEqual(['book', 'resched']);
    }
  });

  it('book -> services -> dentists -> days -> times -> link', async () => {
    const services = (await first('book')) as { quick_replies: { title: string; payload: string }[] };
    expect(services.quick_replies.map((q) => q.payload)).toEqual(['svc:1', 'svc:2']);

    const dentists = (await first('svc:1')) as { quick_replies: { payload: string }[] };
    expect(dentists.quick_replies.map((q) => q.payload)).toEqual(['den:1:any', 'den:1:1', 'den:1:2', 'restart']);

    const days = (await first('den:1:any')) as { quick_replies: { title: string; payload: string }[] };
    expect(days.quick_replies.map((q) => q.payload)).toEqual(['date:1:any:2026-11-09', 'date:1:any:2026-11-10', 'restart']);
    expect(days.quick_replies[0].title).toBe('Mon, Nov 9');

    const times = (await first('date:1:any:2026-11-09')) as { quick_replies: { title: string; payload: string }[] };
    expect(times.quick_replies.map((q) => [q.title, q.payload])).toEqual([
      ['9:00 AM', 'time:1:any:2026-11-09:09:00'],
      ['9:30 AM', 'time:1:any:2026-11-09:09:30'],
      ['Start over', 'restart'],
    ]);

    const summary = (await first('time:1:any:2026-11-09:09:30')) as { text: string; quick_replies: { title: string; payload: string }[] };
    expect(summary.text).toContain('Service: Oral prophylaxis');
    expect(summary.text).toContain('Dentist: Any available dentist');
    expect(summary.text).toContain('Day: Mon, Nov 9');
    expect(summary.text).toContain('Time: 9:30 AM');
    expect(summary.quick_replies.map((q) => [q.title, q.payload])).toEqual([
      ['Confirm', 'ok:1:any:2026-11-09:09:30'],
      ['Change something', 'chg:1:any:2026-11-09:09:30'],
      ['Start over', 'restart'],
    ]);

    // no link before Confirm
    expect(JSON.stringify(summary)).not.toContain('/book?');
    const link = (await first('ok:1:any:2026-11-09:09:30')) as { attachment: { payload: { text: string; buttons: { url: string }[] } } };
    const url = new URL(link.attachment.payload.buttons[0].url);
    expect(url.origin + url.pathname).toBe('https://clinic.example/book');
    expect(Object.fromEntries(url.searchParams)).toEqual({ service: '1', dentist: 'any', date: '2026-11-09', time: '09:30', ref: 'ref-for-77' });
    expect(link.attachment.payload.text).toContain('Mon, Nov 9');
  });

  it('unknown service falls back to the menu; no open days / full day get a way out', async () => {
    expect(((await first('svc:99')) as { quick_replies: { payload: string }[] }).quick_replies[0].payload).toBe('book');
    const none = (await botReplies({ senderId: '1', payload: 'den:1:any' }, { ...deps, slots: async () => [] }))[0] as { quick_replies: { payload: string }[] };
    expect(none.quick_replies[0].payload).toBe('restart');
    const full = (await botReplies({ senderId: '1', payload: 'date:1:any:2026-11-11' }, deps))[0] as { text: string; quick_replies: { payload: string }[] };
    expect(full.text).toContain('filled up');
    expect(full.quick_replies.map((q) => q.payload)).toEqual(['den:1:any', 'restart']);
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

describe('bot reschedule', () => {
  const slot = (start: string): Slot => ({ start, end: start, dentistIds: [3] });
  const appt = { id: 12, date: '2026-11-20', start: '10:00', dentistId: 3, dentistName: 'Dr. Lim', serviceId: 2, serviceName: 'Tooth filling' };
  const calls: unknown[][] = [];
  const mk = (over: Partial<BotDeps> = {}): BotDeps => ({
    services: async () => [{ id: 2, name: 'Tooth filling' }],
    dentists: async () => [{ id: 3, name: 'Dr. Lim' }],
    slots: async ({ date }) => (date === '2026-11-09' ? [slot('09:00'), slot('09:30')] : []),
    today: () => '2026-11-08',
    baseUrl: () => 'https://clinic.example',
    signRef: (p) => p,
    upcoming: async (psid) => (psid === '77' ? [appt] : []),
    requestReschedule: async (...a) => (calls.push(a), { ok: true, position: 2 }),
    pendingFor: async () => null,
    ...over,
  });
  type M = { text: string; quick_replies?: { title: string; payload: string }[] };
  const run = async (payload: string | undefined, over: Partial<BotDeps> = {}, text?: string, senderId = '77') => (await botReplies({ senderId, payload, text }, mk(over))) as M[];
  beforeEach(() => { calls.length = 0; });

  it('typed phrases start it', async () => {
    for (const t of ['Reschedule', 'move appointment', 'Palipat!', 'change schedule', 'resched']) {
      expect((await run(undefined, {}, t))[0].quick_replies?.[0].payload).toBe('rsd:12:2026-11-09');
    }
  });

  it('no appointments gets the clinic message and menu', async () => {
    const r = await run('resched', {}, undefined, '5');
    expect(r[0].text).toContain("couldn't find an upcoming confirmed appointment");
    expect(r[1].quick_replies?.map((q) => q.payload)).toEqual(['book', 'resched']);
  });

  it('one appointment goes straight to dates; many ask which', async () => {
    const r = (await run('resched'))[0];
    expect(r.text).toContain('Tooth filling with Dr. Lim');
    expect(r.quick_replies?.map((q) => q.payload)).toEqual(['rsd:12:2026-11-09', 'rskeep']);
    const many = (await run('resched', { upcoming: async () => [appt, { ...appt, id: 13 }] }))[0];
    expect(many.quick_replies?.map((q) => q.payload)).toEqual(['rs:12', 'rs:13', 'restart']);
  });

  it('mentions an existing pending request', async () => {
    const r = (await run('rs:12', { pendingFor: async () => ({ id: 99, date: '2026-11-09', start: '09:00', position: 3 }) }))[0];
    expect(r.text).toContain('#3 in line');
    expect(r.text).toContain('replaces it');
  });

  it('full path: day -> time -> summary -> request', async () => {
    const times = (await run('rsd:12:2026-11-09'))[0];
    expect(times.quick_replies?.map((q) => q.payload)).toEqual(['rst:12:2026-11-09:09:00', 'rst:12:2026-11-09:09:30', 'rs:12', 'rskeep']);
    const sum = (await run('rst:12:2026-11-09:09:30'))[0];
    expect(sum.text).toContain('Move Tooth filling from');
    expect(sum.text).toContain('Your current time stays until then');
    expect(sum.quick_replies?.map((q) => q.payload)).toEqual(['rsok:12:2026-11-09:09:30', 'rs:12', 'rskeep']);
    const done = (await run('rsok:12:2026-11-09:09:30'))[0];
    expect(calls).toEqual([['77', 12, '2026-11-09', '09:30']]);
    expect(done.text).toContain('#2 in line');
    expect((await run('rskeep'))[0].text).toBe('Okay, your appointment stays.');
  });

  it('a forged appointment id is rejected at every step and never requested', async () => {
    for (const p of ['rs:12', 'rsd:12:2026-11-09', 'rst:12:2026-11-09:09:00', 'rsok:12:2026-11-09:09:00']) {
      const r = await run(p, {}, undefined, '999');
      expect(r[0].text).toContain('no longer available');
    }
    expect((await run('rsok:55:2026-11-09:09:00'))[0].text).toContain('no longer available');
    expect(calls).toEqual([]);
    expect((await run('rsok:012:2026-11-09:09:00'))[0].quick_replies?.[0].payload).toBe('book');
  });

  it('slot_unavailable offers fresh times; other errors show their message', async () => {
    const taken = { requestReschedule: async () => ({ ok: false as const, code: 'slot_unavailable', message: 'x', slots: [slot('11:00')] }) };
    const r = (await run('rsok:12:2026-11-09:09:30', taken))[0];
    expect(r.text).toContain('just got taken');
    expect(r.quick_replies?.[0].payload).toBe('rst:12:2026-11-09:11:00');
    const bad = (await run('rsok:12:2026-11-09:09:30', { requestReschedule: async () => ({ ok: false, code: 'in_past', message: 'That time has passed.' }) }))[0];
    expect(bad.text).toBe('That time has passed.');
  });
});

describe('bot start over, summary and change answer', () => {
  const slot = (start: string): Slot => ({ start, end: start, dentistIds: [1] });
  let open: Record<string, string[]>; // `${date}|${dentist}` -> times; falls back to the `*` key
  const deps: BotDeps = {
    services: async () => [{ id: 1, name: 'Oral prophylaxis' }, { id: 2, name: 'Tooth filling' }],
    dentists: async () => [{ id: 1, name: 'Dr. Reyes' }, { id: 2, name: 'Dr. Lim' }],
    slots: async ({ date, dentistId }) => (open[`${date}|${dentistId}`] ?? open[`${date}|*`] ?? []).map(slot),
    today: () => '2026-11-08',
    baseUrl: () => 'https://molarandco.vercel.app',
    signRef: (psid) => `ref-${psid}`,
    upcoming: async () => [],
    requestReschedule: async () => ({ ok: true, position: 1 }),
    pendingFor: async () => null,
  };
  beforeEach(() => {
    open = { '2026-11-09|*': ['09:00', '09:30'], '2026-11-10|*': ['13:00'] };
  });
  const run = async (payload?: string, text?: string) => botReplies({ senderId: '77', payload, text }, deps);
  const one = async (payload: string) => (await run(payload))[0] as { text: string; quick_replies: { title: string; payload: string }[] };
  const KEY = '1:1:2026-11-09:09:00';

  it('typed "start over", "restart" or "menu" (any case) restarts; a tap with a payload wins over its text', async () => {
    for (const t of ['start over', 'Restart', '  MENU ', 'Start over!']) {
      const r = await run(undefined, t);
      expect((r[0] as { text: string }).text).toContain('starting over');
      expect((r[1] as { quick_replies: { payload: string }[] }).quick_replies.map((q) => q.payload)).toEqual(['svc:1', 'svc:2']);
    }
    const tap = (await botReplies({ senderId: '1', payload: 'svc:1', text: 'Start over' }, deps))[0] as { text: string };
    expect(tap.text).toBe('Do you prefer a dentist?');
    expect((await run('restart'))[1]).toBeDefined();
  });

  it('every step after the first offers Start over, within 13 quick replies', async () => {
    for (const p of ['svc:1', 'den:1:any', 'date:1:any:2026-11-09', `time:${KEY}`, `chg:${KEY}`]) {
      const m = await one(p);
      expect(m.quick_replies.at(-1)).toEqual({ content_type: 'text', title: 'Start over', payload: 'restart' });
      expect(m.quick_replies.length).toBeLessThanOrEqual(13);
    }
  });

  it('keeps Start over when the lists are long (12 times, many services)', async () => {
    open['2026-11-09|*'] = Array.from({ length: 30 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
    const times = await one('date:1:any:2026-11-09');
    expect(times.quick_replies).toHaveLength(13);
    expect(times.quick_replies.at(-1)?.payload).toBe('restart');
    const many = { ...deps, services: async () => Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Service ${i + 1}` })) };
    const svc = (await botReplies({ senderId: '1', payload: 'cs:' + KEY }, many))[0] as { quick_replies: { payload: string }[] };
    expect(svc.quick_replies).toHaveLength(13);
    expect(svc.quick_replies.at(-1)?.payload).toBe(`sum:${KEY}`);
  });

  it('summary lists service, dentist, day and time; a named dentist shows by name', async () => {
    const m = await one(`sum:${KEY}`);
    expect(m.text).toContain('Dentist: Dr. Reyes');
    expect(m.text).toContain('Time: 9:00 AM');
  });

  it('change menu offers each answer, back to the summary and start over', async () => {
    const m = await one(`chg:${KEY}`);
    expect(m.quick_replies.map((q) => q.payload)).toEqual([`cs:${KEY}`, `cd:${KEY}`, `cx:${KEY}`, `ct:${KEY}`, `sum:${KEY}`, 'restart']);
  });

  it('change time redoes only the time and returns to the summary with the rest unchanged', async () => {
    const pick = await one(`ct:${KEY}`);
    expect(pick.quick_replies.map((q) => q.payload)).toEqual(['sum:1:1:2026-11-09:09:00', 'sum:1:1:2026-11-09:09:30', `sum:${KEY}`]);
    const m = await one('sum:1:1:2026-11-09:09:30');
    expect(m.text).toContain('Time: 9:30 AM');
    expect(m.text).toContain('Dentist: Dr. Reyes');
    expect(m.text).toContain('Service: Oral prophylaxis');
  });

  it('change day / dentist / service each offer their own picker; the answer returns to the summary', async () => {
    const days = await one(`cx:${KEY}`);
    expect(days.quick_replies.map((q) => q.payload)).toEqual(['sum:1:1:2026-11-09:09:00', 'sum:1:1:2026-11-10:09:00', `sum:${KEY}`]);
    const dentists = await one(`cd:${KEY}`);
    expect(dentists.quick_replies.map((q) => q.payload)).toEqual(['sum:1:any:2026-11-09:09:00', 'sum:1:1:2026-11-09:09:00', 'sum:1:2:2026-11-09:09:00', `sum:${KEY}`]);
    const services = await one(`cs:${KEY}`);
    expect(services.quick_replies.map((q) => q.payload)).toEqual(['sum:1:1:2026-11-09:09:00', 'sum:2:1:2026-11-09:09:00', `sum:${KEY}`]);
    expect((await one('sum:2:1:2026-11-09:09:00')).text).toContain('Service: Tooth filling');
  });

  it('a change that no longer fits sends the patient to the step to redo, not to a stale summary', async () => {
    // new day: the old time does not exist there -> time picker for that day
    const t = await one('sum:1:1:2026-11-10:09:00');
    expect(t.text).toContain('no longer open on Tue, Nov 10');
    expect(t.quick_replies.map((q) => q.payload)).toEqual(['sum:1:1:2026-11-10:13:00', 'restart']);
    // new dentist with no times that day -> day picker
    open['2026-11-09|2'] = [];
    open['2026-11-10|2'] = ['10:00'];
    const d = await one('sum:1:2:2026-11-09:09:00');
    expect(d.text).toContain('no open times');
    expect(d.quick_replies.map((q) => q.payload)).toEqual(['sum:1:2:2026-11-10:09:00', 'restart']);
    // unknown service / dentist -> menu or dentist picker
    expect((await one('sum:9:1:2026-11-09:09:00')).quick_replies[0].payload).toBe('book');
    expect((await one('sum:1:9:2026-11-09:09:00')).text).toContain('no longer available');
  });

  it('confirm re-checks availability: still free gives the link, taken meanwhile does not', async () => {
    const ok = (await run(`ok:${KEY}`))[0] as { attachment?: { payload: { buttons: { url: string }[] } } };
    expect(ok.attachment?.payload.buttons[0].url).toBe('https://molarandco.vercel.app/book?service=1&dentist=1&date=2026-11-09&time=09%3A00&ref=ref-77');
    open['2026-11-09|*'] = ['09:30'];
    const taken = (await run(`ok:${KEY}`))[0] as { text?: string; attachment?: unknown };
    expect(taken.attachment).toBeUndefined();
    expect(taken.text).toContain('no longer open');
  });

  it('malformed or hostile state payloads get the menu', async () => {
    for (const p of ['sum:1:x:2026-11-09:09:00', 'ok:1:1:2026-13-99:9:0', 'chg:1', 'cz:' + KEY, "ok:1:1:2026-11-09:09:00'; DROP", 'cs:']) {
      expect((await one(p)).quick_replies.map((q) => q.payload)).toEqual(['book', 'resched']);
    }
  });

  it('copy says Molar & Co., never G4, and payloads stay short', async () => {
    const all = JSON.stringify([await run(undefined, 'hi'), await run(`ok:${KEY}`), await run(`sum:${KEY}`)]);
    expect(all).toContain('Molar & Co.');
    expect(all).not.toMatch(/G4/);
    expect(all).toContain('molarandco.vercel.app');
    expect(`sum:${KEY}`.length).toBeLessThan(100);
  });
});

describe('pickTimes / dateLabel', () => {
  const mk = (n: number): Slot[] => Array.from({ length: n }, (_, i) => ({ start: String(i), end: String(i), dentistIds: [1] }));
  it('keeps up to 12, spread over the day, always including first and last', () => {
    expect(pickTimes(mk(5))).toHaveLength(5);
    const p = pickTimes(mk(30));
    expect(p).toHaveLength(12); // one reply is kept for Start over
    expect(p[0].start).toBe('0');
    expect(p[11].start).toBe('29');
  });
  it('labels a date with its weekday', () => {
    expect(dateLabel('2026-11-09')).toBe('Mon, Nov 9');
  });
});

describe('verifyChatRefDetail', () => {
  it('returns the issue time; rejects bad or expired tokens', async () => {
    const { verifyChatRefDetail } = await import('@/lib/messenger');
    const now = 1_800_000_000;
    expect(verifyChatRefDetail(signChatRef('42', now), now + 60)).toEqual({ psid: '42', issuedAt: now });
    expect(verifyChatRefDetail(signChatRef('42', now), now + CHAT_REF_TTL_SECONDS + 1)).toBeNull();
    expect(verifyChatRefDetail('42.1.AAAA', now)).toBeNull();
    expect(verifyChatRefDetail(undefined)).toBeNull();
  });
});

describe('QA fixes: restart words, greeting, window, ids', () => {
  const slot = (start: string): Slot => ({ start, end: start, dentistIds: [1] });
  const deps: BotDeps = {
    services: async () => [{ id: 1, name: 'Oral prophylaxis' }, { id: 2, name: 'Tooth filling' }],
    dentists: async () => [{ id: 1, name: 'Dr. Reyes' }],
    slots: async ({ date }) => (date <= '2026-12-31' && date >= '2026-11-08' ? [slot('09:00')] : []),
    today: () => '2026-11-08',
    baseUrl: () => 'https://molarandco.vercel.app',
    signRef: () => 'ref',
    upcoming: async () => [],
    requestReschedule: async () => ({ ok: true, position: 1 }),
    pendingFor: async () => null,
  };
  const first = async (payload?: string, text?: string) => (await botReplies({ senderId: '1', payload, text }, deps))[0] as { text?: string; quick_replies?: { title: string; payload: string }[]; attachment?: unknown };

  it('normalizes typed text: NFKC, case, whitespace, punctuation, emoji', () => {
    expect(normalizeTyped('  ＭＥＮＵ！ ')).toBe('menu');
    expect(normalizeTyped('Start   Over...')).toBe('start over');
    expect(normalizeTyped('Restart 🔁')).toBe('restart');
  });

  it('typed restart variants all restart; near misses do not', async () => {
    for (const t of ['start over', 'startover', 'Restart', 'MENU', 'start  over', 'menu please', 'Start over please!', 'please restart', 'ｍｅｎｕ', 'restart 🔁', 'Start-over'.replace('-', ' ')]) {
      const r = await botReplies({ senderId: '1', text: t }, deps);
      expect(r[0], t).toMatchObject({ text: expect.stringContaining('starting over') });
    }
    for (const t of ['', 'hi', 'menu items?', 'I want to restart my life', 'cancel']) {
      expect(((await first(undefined, t)) as { quick_replies: { payload: string }[] }).quick_replies.map((q) => q.payload), t).toEqual(['book', 'resched']);
    }
  });

  it('Get Started shows the greeting with the Book button, not the service list', async () => {
    const m = await first('GET_STARTED');
    expect(m.text).toContain("Molar & Co.'s booking assistant");
    expect(m.quick_replies?.map((q) => q.payload)).toEqual(['book', 'resched']);
  });

  it('the message with the booking link also offers Start over', async () => {
    const m = await first('ok:1:any:2026-11-09:09:00');
    expect(m.attachment).toBeDefined();
    expect(m.quick_replies).toEqual([{ content_type: 'text', title: 'Start over', payload: 'restart' }]);
  });

  it('a date past the 60-day window or in the past gets no link: back to the day picker', async () => {
    for (const p of ['ok:1:any:2027-12-31:09:00', 'sum:1:any:2027-12-31:09:00', 'ok:1:any:2020-01-01:09:00']) {
      const m = await first(p);
      expect(m.attachment, p).toBeUndefined();
      expect(m.text).toContain('not open for booking');
      expect(m.quick_replies?.at(-1)?.payload).toBe('restart');
    }
    expect((await first('ok:1:any:2027-01-06:09:00')).attachment).toBeUndefined(); // 60 days = 2027-01-07
    expect((await first('ok:1:any:2026-12-31:09:00')).attachment).toBeDefined();
  });

  it('leading-zero ids are rejected everywhere (menu, no link)', async () => {
    for (const p of ['ok:01:any:2026-11-09:09:00', 'sum:1:01:2026-11-09:09:00', 'chg:001:any:2026-11-09:09:00', 'cs:01:any:2026-11-09:09:00', 'svc:01', 'den:1:01', 'date:01:any:2026-11-09']) {
      const m = await first(p);
      expect(m.attachment, p).toBeUndefined();
      expect(m.quick_replies?.map((q) => q.payload), p).toEqual(['book', 'resched']);
    }
  });
});

describe('extractEvents mid, de-dupe and concurrency', () => {
  beforeEach(() => resetHandledMids());
  it('keeps the message id of messages and postbacks', () => {
    const e = extractEvents({ object: 'page', entry: [{ messaging: [{ sender: { id: '1' }, message: { mid: 'm.1', text: 'a' } }, { sender: { id: '2' }, postback: { mid: 'm.2', payload: 'book' } }, { sender: { id: '3' }, message: { text: 'b' } }] }] });
    expect(e.map((x) => x.mid)).toEqual(['m.1', 'm.2', undefined]);
  });
  it('a mid seen within 10 minutes is a duplicate; later or different is not; no mid is never one', () => {
    expect(alreadyHandled('a', 1000)).toBe(false);
    expect(alreadyHandled('a', 2000)).toBe(true);
    expect(alreadyHandled('a', 1000 + 10 * 60 * 1000 + 1)).toBe(false);
    expect(alreadyHandled('b', 1000)).toBe(false);
    expect(alreadyHandled(undefined)).toBe(false);
  });
  const ev = (senderId: string, n: number, mid?: string): BotEvent => ({ senderId, text: String(n), ...(mid ? { mid } : {}) });
  it('runs users concurrently (bounded), one user strictly in order, skips redelivered ids', async () => {
    const log: string[] = [];
    let running = 0;
    let peak = 0;
    const events = [...Array.from({ length: 20 }, (_, i) => ev(`u${i}`, 0)), ev('u0', 1), ev('u0', 2), ev('u1', 1, 'dup'), ev('u1', 2, 'dup')];
    await processEvents(
      events,
      async (e) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        log.push(`${e.senderId}:${e.text}`);
        running--;
      },
      4,
    );
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    const u0 = log.filter((l) => l.startsWith('u0:'));
    expect(u0).toEqual(['u0:0', 'u0:1', 'u0:2']);
    expect(log.filter((l) => l.startsWith('u1:'))).toEqual(['u1:0', 'u1:1']); // second 'dup' skipped
    expect(log).toHaveLength(23);
  });
  it('a throwing handler does not stop the others', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const done: string[] = [];
    await processEvents([ev('a', 1), ev('b', 1), ev('a', 2)], async (e) => {
      if (e.senderId === 'a' && e.text === '1') throw new Error('boom');
      done.push(`${e.senderId}${e.text}`);
    });
    expect(done.sort()).toEqual(['a2', 'b1']);
    err.mockRestore();
  });
});
