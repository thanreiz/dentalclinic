/**
 * Messenger booking bot (SOP 1). Stateless: every choice travels in the quick-reply payload, so
 * no database state is needed.
 *
 *   greeting -> "book" -> svc:<serviceId> -> den:<serviceId>:<dentistId|any>
 *            -> date:<serviceId>:<dentist>:<YYYY-MM-DD> -> time:<serviceId>:<dentist>:<date>:<HH:MM>
 *            -> a button that opens /book prefilled, carrying a signed token (chatRef)
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

export type BotEvent = { senderId: string; text?: string; payload?: string };

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
const withReplies = (text: string, replies: QuickReply[]): OutgoingMessage => ({ text, quick_replies: replies.slice(0, MAX_QUICK_REPLIES) });

const dentistArg = (v: string): number | 'any' | null => {
  if (v === 'any') return 'any';
  return /^\d{1,9}$/.test(v) ? Number(v) : null;
};

export function dateLabel(date: string): string {
  return `${WEEKDAYS[dayOfWeek(date)]}, ${formatDateHuman(date).replace(/, \d{4}$/, '')}`; // "Mon, Nov 9"
}

const MENU_TEXT =
  'Hi! This is the clinic booking assistant. I can help you request an appointment. A staff member will confirm it afterwards.';

function menu(): OutgoingMessage {
  return withReplies(MENU_TEXT, [reply('Book appointment', 'book')]);
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

/** Up to 13 times, spread across the day when there are more. */
export function pickTimes(slots: Slot[]): Slot[] {
  if (slots.length <= MAX_QUICK_REPLIES) return slots;
  const step = (slots.length - 1) / (MAX_QUICK_REPLIES - 1);
  return Array.from({ length: MAX_QUICK_REPLIES }, (_, i) => slots[Math.round(i * step)]);
}

/** Build the replies for one incoming event. Never throws; unknown input gets the menu. */
export async function botReplies(event: BotEvent, deps: BotDeps = defaultBotDeps): Promise<OutgoingMessage[]> {
  const payload = event.payload ?? '';
  try {
    if (payload === 'book') {
      const services = await deps.services();
      if (services.length === 0) return [{ text: 'Sorry, there are no services to book right now. Please contact the clinic.' }];
      return [withReplies('Which service do you need?', services.map((s) => reply(s.name, `svc:${s.id}`)))];
    }

    let m = /^svc:(\d{1,9})$/.exec(payload);
    if (m) {
      const serviceId = Number(m[1]);
      if (!(await deps.services()).some((s) => s.id === serviceId)) return [menu()];
      const dentists = await deps.dentists();
      return [withReplies('Do you prefer a dentist?', [reply('Any dentist', `den:${serviceId}:any`), ...dentists.map((d) => reply(d.name, `den:${serviceId}:${d.id}`))])];
    }

    m = /^den:(\d{1,9}):(any|\d{1,9})$/.exec(payload);
    if (m) {
      const serviceId = Number(m[1]);
      const dentist = dentistArg(m[2]);
      if (dentist === null) return [menu()];
      const dates = await openDates(deps, serviceId, dentist);
      if (dates.length === 0) return [withReplies('Sorry, there are no open times in the next few weeks. Please call the clinic.', [reply('Start over', 'book')])];
      return [withReplies('Which day works for you?', dates.map((d) => reply(dateLabel(d), `date:${serviceId}:${m![2]}:${d}`)))];
    }

    m = /^date:(\d{1,9}):(any|\d{1,9}):(\d{4}-\d{2}-\d{2})$/.exec(payload);
    if (m) {
      const serviceId = Number(m[1]);
      const dentist = dentistArg(m[2]);
      const date = m[3];
      if (dentist === null) return [menu()];
      const slots = pickTimes(await deps.slots({ date, serviceId, dentistId: dentist }).catch(() => []));
      if (slots.length === 0) return [withReplies('That day just filled up. Please pick another day.', [reply('Pick another day', `den:${serviceId}:${m[2]}`)])];
      return [withReplies(`Open times on ${dateLabel(date)}:`, slots.map((s) => reply(formatTime12(s.start), `time:${serviceId}:${m![2]}:${date}:${s.start}`)))];
    }

    m = /^time:(\d{1,9}):(any|\d{1,9}):(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})$/.exec(payload);
    if (m) {
      const [, svc, den, date, time] = m;
      const qs = new URLSearchParams({ service: svc, dentist: den, date, time, ref: deps.signRef(event.senderId) });
      return [
        {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text: `${dateLabel(date)}, ${formatTime12(time)}. Tap below to enter your details and send the request. The clinic will confirm it.`,
              buttons: [{ type: 'web_url', url: `${deps.baseUrl()}/book?${qs}`, title: 'Enter my details' }],
            },
          },
        },
      ];
    }
  } catch (err) {
    console.error('[messenger:bot] failed to build a reply:', err instanceof Error ? err.message : err);
    return [{ text: 'Sorry, something went wrong. Please try again in a moment.' }];
  }
  return [menu()];
}

const MAX_EVENTS = 50;

export type RawWebhookBody = {
  object?: string;
  entry?: { messaging?: { sender?: { id?: string }; message?: { text?: string; is_echo?: boolean; quick_reply?: { payload?: string } }; postback?: { payload?: string } }[] }[];
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
      out.push({ senderId, payload: typeof payload === 'string' ? payload.slice(0, 200) : undefined, text: typeof text === 'string' ? text.slice(0, 500) : undefined });
      if (out.length >= MAX_EVENTS) return out;
    }
  }
  return out;
}

