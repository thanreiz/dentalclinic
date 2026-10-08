/** Helpers for calling route handlers directly (no server) against dental_test. */
import { execute } from '@/lib/db';
import { setMailTransport, type MailMessage } from '@/lib/mail';
import { signSession } from '@/lib/session';
import { addDays, dayOfWeek, todayManila } from '@/lib/time';

export const REYES = 1;
export const LIM = 2;
export const PROPHY = 1; // 30 min
export const FILLING = 2; // 60 min
export const EXTRACTION = 3; // 45 min

/** Cookie header for the seeded staff user (signed like a real login). */
export async function staffCookie(): Promise<string> {
  return `session=${await signSession({ userId: 1, name: 'Clinic Staff', email: 'staff@clinic.test' })}`;
}

export function req(method: string, path: string, body?: unknown, cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export const idCtx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
export const entityCtx = (entity: string) => ({ params: Promise.resolve({ entity }) });

/**
 * The n-th (0-based) Mon–Sat date at least 2 days from today (Manila), skipping the seeded
 * Oct 19 row's date, so route handlers using the real clock see it as future and open.
 */
export function workday(n = 0): string {
  let d = addDays(todayManila(), 2);
  let i = -1;
  for (;;) {
    if (dayOfWeek(d) !== 0 && d !== '2026-10-19') {
      i++;
      if (i === n) return d;
    }
    d = addDays(d, 1);
  }
}

export function sundayAhead(): string {
  let d = addDays(todayManila(), 1);
  while (dayOfWeek(d) !== 0) d = addDays(d, 1);
  return d;
}

let contactSeq = 0;
/** A fresh valid mobile number not in the seed. */
export function newContact(): string {
  contactSeq++;
  return `0966${String(Date.now() % 10000).padStart(4, '0')}${String(contactSeq).padStart(3, '0')}`.slice(0, 11);
}

export function bookingBody(over: Record<string, unknown> = {}) {
  return {
    serviceId: PROPHY,
    dentistId: REYES,
    date: workday(0),
    start: '09:00',
    fullName: 'Test Patient',
    contactNumber: newContact(),
    email: 'test.patient@example.com',
    birthdate: '1990-05-05',
    patientNote: null,
    consent: true,
    website: '',
    ...over,
  };
}

/** Insert a row directly (bypasses rules: fixtures only). Returns the id. */
export async function insertAppt(a: {
  patientId?: number;
  dentistId?: number;
  serviceId?: number;
  chairId?: number | null;
  date: string;
  start: string;
  end: string;
  status: string;
  channel?: string;
  reminderSentAt?: string | null;
}): Promise<number> {
  const r = await execute(
    `INSERT INTO appointments (patient_id, dentist_id, service_id, chair_id, appointment_date, start_time, end_time,
       status, channel, requested_at, reminder_sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
    [
      a.patientId ?? 1,
      a.dentistId ?? REYES,
      a.serviceId ?? PROPHY,
      a.chairId === undefined ? 1 : a.chairId,
      a.date,
      a.start,
      a.end,
      a.status,
      a.channel ?? 'phone',
      a.reminderSentAt ?? null,
    ],
  );
  return r.insertId;
}

/** Fake mail transport: records messages; throws for addresses in `failFor`. */
export function fakeMail() {
  const sent: MailMessage[] = [];
  const failFor = new Set<string>();
  let failAll = false;
  setMailTransport({
    async sendMail(m) {
      if (failAll || failFor.has(m.to)) throw new Error('SMTP 535 auth failed');
      sent.push(m);
    },
  });
  return {
    sent,
    failFor,
    setFailAll(v: boolean) {
      failAll = v;
    },
    restore() {
      setMailTransport(null);
    },
  };
}
