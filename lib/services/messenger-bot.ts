/**
 * Molar & Co. Messenger booking bot (SOP 1). Stateless: every choice travels in the quick-reply
 * payload, so no database state is needed.
 *
 *   book -> svc:<serviceId> -> den:<serviceId>:<dentistId|any>
 *        -> date:<serviceId>:<dentist>:<YYYY-MM-DD> -> time:<serviceId>:<dentist>:<date>:<HH:MM>
 *        -> sum:<state>   summary of every choice (Confirm / Change something / Start over)
 *        -> ok:<state>    after Confirm: a button that opens /book prefilled, with a signed token (chatRef)
 *
 *   <state> = <serviceId>:<dentistId|any>:<date>:<HH:MM>
 *   chg:<state>          "what do you want to change?"
 *   cs|cd|cx|ct:<state>  pick a new service / dentist / day / time; each answer is a `sum:<new state>`
 *                        payload, so only that step is redone and the summary comes back
 *   restart              start over (also typed: "start over", "restart", "menu"; also the persistent menu)
 *
 * Every `sum:` / `ok:` is re-checked against live availability: a choice that no longer fits (a
 * changed service or dentist, a slot taken meanwhile) sends the patient back to the step to redo,
 * never to a stale summary.
 *
 * The patient's name, phone, email and consent are collected by the existing /book form (full
 * validation, Data Privacy consent, spam caps), because a Messenger text reply carries no state.
 * Pure of I/O except `deps`, so it is testable without Meta.
 */
import { listDentistsWithSchedules, listServices } from '../queries/setup';
import { signChatRef, type OutgoingMessage, type QuickReply } from '../messenger';
import { addDays, dayOfWeek, formatDateHuman, formatTime12, nowManila, todayManila } from '../time';
import { PUBLIC_BOOKING_WINDOW_DAYS, getSlots } from './slots';
import type { Slot } from '../types';

const MAX_QUICK_REPLIES = 13; // Messenger's limit
const DATES_TO_OFFER = 6;
const DAYS_TO_SCAN = 21;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "start over", "startover", "restart", "menu", each optionally with please/pls. */
const RESTART_RE = /^(?:please |pls )?(?:start ?over|restart|menu)(?: please| pls)?$/;

/** NFKC (full-width letters, ligatures), lower-case, collapsed whitespace, no surrounding punctuation. */
export function normalizeTyped(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u200b-\u200d\ufeff]+/g, ' ')
    .replace(/^[\s.,!?;:…~*_"'`()\-]+|[\s.,!?;:…~*_"'`()\-]+$/gu, '')
    .replace(/\p{Extended_Pictographic}|\uFE0F/gu, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** `mid` is Meta's message id; a redelivered webhook carries the same one. */
export type BotEvent = { senderId: string; text?: string; payload?: string; mid?: string };

export type BotDeps = {
  services: () => Promise<{ id: number; name: string }[]>;
  dentists: () => Promise<{ id: number; name: string }[]>;
  slots: (input: { date: string; serviceId: number; dentistId: number | 'any' }) => Promise<Slot[]>;
  today: () => string;
  baseUrl: () => string;
  signRef: (psid: string) => string;
};

export const defaultBotDeps: BotDeps = {
  services: async () => (await listServices()).map((s) => ({ id: s.serviceId, name: s.serviceName })),
  dentists: async () => (await listDentistsWithSchedules()).map((d) => ({ id: d.dentistId, name: d.dentistName })),
  slots: (input) => getSlots(input, { now: nowManila() }),
  today: todayManila,
  baseUrl: () => (process.env.APP_URL || 'https://molarandco.vercel.app').replace(/\/+$/, ''),
  signRef: (psid) => signChatRef(psid),
};

const clip = (s: string, n = 20) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const reply = (title: string, payload: string): QuickReply => ({ content_type: 'text', title: clip(title), payload });
/** Items are cut first so the fixed `extras` (Start over, Back...) always fit inside Messenger's 13. */
const withReplies = (text: string, items: QuickReply[], extras: QuickReply[] = []): OutgoingMessage => ({
  text,
  quick_replies: [...items.slice(0, MAX_QUICK_REPLIES - extras.length), ...extras],
});

const dentistArg = (v: string): number | 'any' | null => {
  if (v === 'any') return 'any';
  return /^\d{1,9}$/.test(v) ? Number(v) : null;
};

export function dateLabel(date: string): string {
  return `${WEEKDAYS[dayOfWeek(date)]}, ${formatDateHuman(date).replace(/, \d{4}$/, '')}`; // "Mon, Nov 9"
}

const MENU_TEXT =
  "Hi! This is Molar & Co.'s booking assistant. I can help you request an appointment. A staff member will confirm it afterwards.";

function menu(): OutgoingMessage {
  return withReplies(MENU_TEXT, [reply('Book appointment', 'book')]);
}

const START_OVER = reply('Start over', 'restart');

/** The four answers the flow collects; the payload form is `svc:den:date:time`. */
type State = { serviceId: number; dentist: number | 'any'; dentistRaw: string; date: string; time: string };
const STATE_RE = '(\\d{1,9}):(any|\\d{1,9}):(\\d{4}-\\d{2}-\\d{2}):(\\d{2}:\\d{2})';
const stateKey = (x: Pick<State, 'serviceId' | 'dentistRaw' | 'date' | 'time'>) => `${x.serviceId}:${x.dentistRaw}:${x.date}:${x.time}`;

/** Ids in a payload must be canonical (no leading zeros): the bot only ever writes them that way. */
const canonical = (v: string) => v === 'any' || String(Number(v)) === v;

function parseState(m: RegExpExecArray, at = 1): State | null {
  if (!canonical(m[at]) || !canonical(m[at + 1])) return null;
  const dentist = dentistArg(m[at + 1]);
  if (dentist === null) return null;
  return { serviceId: Number(m[at]), dentist, dentistRaw: m[at + 1], date: m[at + 2], time: m[at + 3] };
}

/** Open dates (next few weeks, inside the public booking window) that still have a free time. */
async function openDates(deps: BotDeps, serviceId: number, dentistId: number | 'any'): Promise<string[]> {
  const start = deps.today();
  const out: string[] = [];
  for (let i = 0; i <= Math.min(DAYS_TO_SCAN, PUBLIC_BOOKING_WINDOW_DAYS) && out.length < DATES_TO_OFFER; i++) {
    const date = addDays(start, i);
    const slots = await deps.slots({ date, serviceId, dentistId }).catch(() => []);
    if (slots.length > 0) out.push(date);
  }
  return out;
}

/** Up to 12 times (one quick reply is kept for "Start over"), spread across the day when there are more. */
const MAX_TIMES = MAX_QUICK_REPLIES - 1;
export function pickTimes(slots: Slot[]): Slot[] {
  if (slots.length <= MAX_TIMES) return slots;
  const step = (slots.length - 1) / (MAX_TIMES - 1);
  return Array.from({ length: MAX_TIMES }, (_, i) => slots[Math.round(i * step)]);
}

// ---------- pickers (the payload of each answer is built by `mk`, so edits reuse them) ----------

async function servicePicker(deps: BotDeps, text: string, mk: (id: number) => string, extras: QuickReply[] = []): Promise<OutgoingMessage> {
  const services = await deps.services();
  if (services.length === 0) return { text: 'Sorry, there are no services to book right now. Please contact the clinic.' };
  return withReplies(text, services.map((s) => reply(s.name, mk(s.id))), extras);
}

async function dentistPicker(deps: BotDeps, text: string, mk: (dentist: string) => string, extras: QuickReply[] = []): Promise<OutgoingMessage> {
  const dentists = await deps.dentists();
  return withReplies(text, [reply('Any dentist', mk('any')), ...dentists.map((d) => reply(d.name, mk(String(d.id))))], extras);
}

async function datePicker(deps: BotDeps, serviceId: number, dentist: number | 'any', text: string, mk: (date: string) => string, extras: QuickReply[] = []): Promise<OutgoingMessage> {
  const dates = await openDates(deps, serviceId, dentist);
  if (dates.length === 0) return withReplies('Sorry, there are no open times in the next few weeks. Please call the clinic.', [], [START_OVER]);
  return withReplies(text, dates.map((d) => reply(dateLabel(d), mk(d))), extras);
}

function timePicker(slots: Slot[], text: string, mk: (time: string) => string, extras: QuickReply[] = []): OutgoingMessage {
  return withReplies(text, pickTimes(slots).map((s) => reply(formatTime12(s.start), mk(s.start))), extras);
}

// ---------- review ----------

/**
 * Check a full set of answers against live data. A complete, still-bookable set gets the summary
 * (or, for `confirm`, the link); anything that no longer fits sends the patient to the step to redo.
 */
async function review(st: State, deps: BotDeps, senderId: string, confirm: boolean): Promise<OutgoingMessage[]> {
  const services = await deps.services();
  const service = services.find((s) => s.id === st.serviceId);
  if (!service) return [menu()];
  const dentists = await deps.dentists();
  const dentist = st.dentist === 'any' ? null : dentists.find((d) => d.id === st.dentist);
  const redo = (patch: Partial<State>) => stateKey({ ...st, ...patch });
  if (st.dentist !== 'any' && !dentist) {
    return [await dentistPicker(deps, 'That dentist is no longer available. Please pick again:', (d) => `sum:${redo({ dentistRaw: d })}`, [START_OVER])];
  }

  // Same window the /book form and API enforce: never hand out a link for a day it would reject.
  const today = deps.today();
  if (st.date < today || st.date > addDays(today, PUBLIC_BOOKING_WINDOW_DAYS)) {
    return [await datePicker(deps, st.serviceId, st.dentist, 'That day is not open for booking. Pick another day:', (d) => `sum:${redo({ date: d })}`, [START_OVER])];
  }

  const slots = await deps.slots({ date: st.date, serviceId: st.serviceId, dentistId: st.dentist }).catch(() => []);
  if (!slots.some((s) => s.start === st.time)) {
    if (slots.length > 0) {
      return [timePicker(slots, `${formatTime12(st.time)} is no longer open on ${dateLabel(st.date)}. Pick another time:`, (t) => `sum:${redo({ time: t })}`, [START_OVER])];
    }
    return [await datePicker(deps, st.serviceId, st.dentist, `${dateLabel(st.date)} has no open times for this choice. Pick another day:`, (d) => `sum:${redo({ date: d })}`, [START_OVER])];
  }

  const key = stateKey(st);
  if (confirm) {
    const qs = new URLSearchParams({ service: String(st.serviceId), dentist: st.dentistRaw, date: st.date, time: st.time, ref: deps.signRef(senderId) });
    return [
      {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: `Thanks! ${service.name}, ${dateLabel(st.date)}, ${formatTime12(st.time)}. Tap below to enter your details and send the request. The clinic will confirm it. The link works for 2 hours.`,
            buttons: [{ type: 'web_url', url: `${deps.baseUrl()}/book?${qs}`, title: 'Enter my details' }],
          },
        },
        quick_replies: [START_OVER],
      },
    ];
  }
  const lines = [
    'Please check your request:',
    `Service: ${service.name}`,
    `Dentist: ${dentist ? dentist.name : 'Any available dentist'}`,
    `Day: ${dateLabel(st.date)}`,
    `Time: ${formatTime12(st.time)}`,
    '',
    'Is this correct?',
  ];
  return [withReplies(lines.join('\n'), [reply('Confirm', `ok:${key}`), reply('Change something', `chg:${key}`), START_OVER])];
}

/** Build the replies for one incoming event. Never throws; unknown input gets the menu. */
export async function botReplies(event: BotEvent, deps: BotDeps = defaultBotDeps): Promise<OutgoingMessage[]> {
  const payload = event.payload ?? '';
  try {
    // Typed "start over" / "restart" / "menu" (a quick-reply tap carries a payload and wins).
    if (!payload && RESTART_RE.test(normalizeTyped(event.text ?? ''))) return restart(deps);

    if (payload === 'restart') return restart(deps);

    // Get Started button (first open of the chat): the greeting with the Book button.
    if (payload === 'GET_STARTED') return [menu()];

    if (payload === 'book') return [await servicePicker(deps, 'Which service do you need?', (id) => `svc:${id}`)];

    let m = /^svc:(\d{1,9})$/.exec(payload);
    if (m) {
      if (!canonical(m[1])) return [menu()];
      const serviceId = Number(m[1]);
      if (!(await deps.services()).some((s) => s.id === serviceId)) return [menu()];
      return [await dentistPicker(deps, 'Do you prefer a dentist?', (d) => `den:${serviceId}:${d}`, [START_OVER])];
    }

    m = /^den:(\d{1,9}):(any|\d{1,9})$/.exec(payload);
    if (m) {
      if (!m.slice(1, 3).every(canonical)) return [menu()];
      const serviceId = Number(m[1]);
      const dentist = dentistArg(m[2]);
      if (dentist === null) return [menu()];
      return [await datePicker(deps, serviceId, dentist, 'Which day works for you?', (d) => `date:${serviceId}:${m![2]}:${d}`, [START_OVER])];
    }

    m = /^date:(\d{1,9}):(any|\d{1,9}):(\d{4}-\d{2}-\d{2})$/.exec(payload);
    if (m) {
      if (!m.slice(1, 3).every(canonical)) return [menu()];
      const serviceId = Number(m[1]);
      const dentist = dentistArg(m[2]);
      const date = m[3];
      if (dentist === null) return [menu()];
      const slots = await deps.slots({ date, serviceId, dentistId: dentist }).catch(() => []);
      if (slots.length === 0) return [withReplies('That day just filled up. Please pick another day.', [reply('Pick another day', `den:${serviceId}:${m[2]}`)], [START_OVER])];
      return [timePicker(slots, `Open times on ${dateLabel(date)}:`, (t) => `time:${serviceId}:${m![2]}:${date}:${t}`, [START_OVER])];
    }

    // time: (the last question) and sum: (back from a change) both land on the summary.
    m = new RegExp(`^(?:time|sum):${STATE_RE}$`).exec(payload);
    if (m) {
      const st = parseState(m);
      return st ? review(st, deps, event.senderId, false) : [menu()];
    }

    m = new RegExp(`^ok:${STATE_RE}$`).exec(payload);
    if (m) {
      const st = parseState(m);
      return st ? review(st, deps, event.senderId, true) : [menu()];
    }

    m = new RegExp(`^chg:${STATE_RE}$`).exec(payload);
    if (m) {
      const st = parseState(m);
      if (!st) return [menu()];
      const key = stateKey(st);
      return [
        withReplies('What would you like to change?', [reply('Service', `cs:${key}`), reply('Dentist', `cd:${key}`), reply('Day', `cx:${key}`), reply('Time', `ct:${key}`)], [reply('Back to summary', `sum:${key}`), START_OVER]),
      ];
    }

    // Redo one answer; every choice comes back as `sum:<new state>`, which re-checks the whole set.
    m = new RegExp(`^c([sdxt]):${STATE_RE}$`).exec(payload);
    if (m) {
      const st = parseState(m, 2);
      if (!st) return [menu()];
      const back = reply('Back to summary', `sum:${stateKey(st)}`);
      const redo = (patch: Partial<State>) => `sum:${stateKey({ ...st, ...patch })}`;
      switch (m[1]) {
        case 's':
          return [await servicePicker(deps, 'Pick a different service:', (id) => redo({ serviceId: id }), [back])];
        case 'd':
          return [await dentistPicker(deps, 'Pick a dentist:', (d) => redo({ dentistRaw: d }), [back])];
        case 'x':
          return [await datePicker(deps, st.serviceId, st.dentist, 'Pick a different day:', (d) => redo({ date: d }), [back])];
        default: {
          const slots = await deps.slots({ date: st.date, serviceId: st.serviceId, dentistId: st.dentist }).catch(() => []);
          if (slots.length === 0) return [await datePicker(deps, st.serviceId, st.dentist, `${dateLabel(st.date)} has no open times. Pick another day:`, (d) => redo({ date: d }), [back])];
          return [timePicker(slots, `Open times on ${dateLabel(st.date)}:`, (t) => redo({ time: t }), [back])];
        }
      }
    }
  } catch (err) {
    console.error('[messenger:bot] failed to build a reply:', err instanceof Error ? err.message : err);
    return [{ text: 'Sorry, something went wrong. Please try again in a moment.' }];
  }
  return [menu()];
}

async function restart(deps: BotDeps): Promise<OutgoingMessage[]> {
  return [{ text: 'No problem, starting over.' }, await servicePicker(deps, 'Which service do you need?', (id) => `svc:${id}`)];
}

const MAX_EVENTS = 50;

export type RawWebhookBody = {
  object?: string;
  entry?: { messaging?: { sender?: { id?: string }; message?: { mid?: string; text?: string; is_echo?: boolean; quick_reply?: { payload?: string } }; postback?: { mid?: string; payload?: string } }[] }[];
};

/** Pull the user messages and button taps out of Meta's webhook payload (ignores echoes, reads, deliveries). */
export function extractEvents(body: RawWebhookBody): BotEvent[] {
  if (body.object !== 'page' || !Array.isArray(body.entry)) return [];
  const out: BotEvent[] = [];
  for (const entry of body.entry) {
    for (const m of entry.messaging ?? []) {
      const senderId = m.sender?.id;
      if (typeof senderId !== 'string' || !/^\d{1,40}$/.test(senderId)) continue;
      if (m.message?.is_echo) continue; // our own outgoing message
      const payload = m.postback?.payload ?? m.message?.quick_reply?.payload;
      const text = m.message?.text;
      if (payload === undefined && typeof text !== 'string') continue; // reads, deliveries, attachments
      const mid = m.postback?.mid ?? m.message?.mid;
      out.push({
        senderId,
        payload: typeof payload === 'string' ? payload.slice(0, 200) : undefined,
        text: typeof text === 'string' ? text.slice(0, 500) : undefined,
        ...(typeof mid === 'string' && mid.length > 0 && mid.length <= 300 ? { mid } : {}),
      });
      if (out.length >= MAX_EVENTS) return out;
    }
  }
  return out;
}


// ---------- delivery: concurrency and redelivery ----------

const SEEN_TTL_MS = 10 * 60 * 1000;
const SEEN_MAX = 5000;
const seenMids = new Map<string, number>();

/**
 * True when this Meta message id was already handled in the last 10 minutes (Meta redelivers a
 * webhook it thinks timed out, and the redelivery carries the same ids). In memory, per server
 * instance: it covers the common case (a retry hitting the same warm instance) without a table.
 */
export function alreadyHandled(mid: string | undefined, now = Date.now()): boolean {
  if (!mid) return false;
  const at = seenMids.get(mid);
  if (at !== undefined && now - at < SEEN_TTL_MS) return true;
  seenMids.set(mid, now);
  if (seenMids.size > SEEN_MAX) {
    for (const [k, t] of seenMids) {
      if (now - t >= SEEN_TTL_MS || seenMids.size > SEEN_MAX) seenMids.delete(k);
      if (seenMids.size <= SEEN_MAX * 0.8) break;
    }
  }
  return false;
}

/** Tests only. */
export function resetHandledMids(): void {
  seenMids.clear();
}

/**
 * Run `handle` for every event: different Messenger users concurrently (at most `concurrency` at
 * a time, so a 50-event batch is not 50 sequential Graph calls inside Meta's ~20 s timeout), the
 * events of one user strictly in order. Events already handled (same `mid`) are skipped.
 * `handle` must not throw; a throw is contained so one event never stops the rest.
 */
export async function processEvents(events: BotEvent[], handle: (event: BotEvent) => Promise<void>, concurrency = 5): Promise<void> {
  const byUser = new Map<string, BotEvent[]>();
  for (const e of events) {
    if (alreadyHandled(e.mid)) continue;
    const list = byUser.get(e.senderId);
    if (list) list.push(e);
    else byUser.set(e.senderId, [e]);
  }
  const queues = [...byUser.values()];
  let next = 0;
  const worker = async () => {
    while (next < queues.length) {
      const queue = queues[next++];
      for (const e of queue) {
        try {
          await handle(e);
        } catch (err) {
          console.error('[messenger] event failed:', err instanceof Error ? err.message : err);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queues.length) }, worker));
}
