import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const STAFF = { email: 'staff@clinic.test', password: process.env.SEED_STAFF_PASSWORD || 'ClinicDemo2026!' };
export const MAIL_LOG = process.env.E2E_MAIL_LOG || '';
const DB_URL = process.env.E2E_DATABASE_URL || 'mysql://root@127.0.0.1:3307/dental_qa';

// Seed ids (docs/CONTRACTS.md): dentists 1 Reyes, 2 Lim; services 1 prophylaxis 30, 2 filling 60, 3 extraction 45.
export const REYES = 1;
export const LIM = 2;
export const SVC = { prophylaxis: 1, filling: 2, extraction: 3 } as const;

// ---------- dates (Asia/Manila) ----------
export function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const dow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function calendarLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[dow(date)]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}
export function time12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ---------- unique test data ----------
let seq = 0;
export function uniqueContact(): string {
  const n = String(Math.floor(Math.random() * 1e8) + seq++).padStart(9, '0').slice(-9);
  return `09${n}`;
}
export const uniqueName = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`;

// ---------- db (test setup only) ----------
export async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T[]> {
  const u = new URL(DB_URL);
  const c = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    timezone: '+08:00',
    dateStrings: true,
  });
  try {
    await c.query("SET time_zone='+08:00'");
    const [rows] = await c.query(query, params);
    return rows as T[];
  } finally {
    await c.end();
  }
}

// ---------- mail sink ----------
export function mailCount(): number {
  if (!MAIL_LOG || !fs.existsSync(MAIL_LOG)) return 0;
  return fs.readFileSync(MAIL_LOG, 'utf8').split('\n').filter(Boolean).length;
}
export function mailsSince(n: number): string[] {
  if (!MAIL_LOG || !fs.existsSync(MAIL_LOG)) return [];
  return fs.readFileSync(MAIL_LOG, 'utf8').split('\n').filter(Boolean).slice(n).map((l) => JSON.parse(l).raw as string);
}

// ---------- navigation ----------
/** goto + wait for network idle so React has hydrated before the test types or clicks (avoids flaky early input). */
export async function gotoReady(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

// ---------- staff session ----------
export async function loginUi(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(STAFF.email);
  await page.getByLabel('Password').fill(STAFF.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
/** Logs the browser context in through the API (cookie lands in the context's jar). */
export async function loginApi(request: APIRequestContext) {
  const r = await request.post('/api/auth/login', { data: STAFF });
  expect(r.status(), 'staff login').toBe(200);
}

// ---------- slots ----------
export type Slot = { start: string; end: string; dentistIds: number[] };
export async function getSlots(request: APIRequestContext, date: string, serviceId: number, dentistId: number | 'any'): Promise<Slot[]> {
  const r = await request.get(`/api/slots?date=${date}&serviceId=${serviceId}&dentistId=${dentistId}`);
  expect(r.status()).toBe(200);
  return (await r.json()).slots as Slot[];
}
/**
 * First Mon-Sat date at or after today+fromDays that has >= minSlots open slots; returns the date and
 * the slot at `index` (negative = from the end). Specs use different fromDays so they never fight over a slot.
 */
export async function findSlot(
  request: APIRequestContext,
  opts: { dentistId: number; serviceId: number; fromDays: number; index?: number; minSlots?: number },
): Promise<{ date: string; slot: Slot; slots: Slot[] }> {
  const minSlots = opts.minSlots ?? 4;
  for (let i = 0; i < 40; i++) {
    const date = addDays(manilaToday(), opts.fromDays + i);
    if (dow(date) === 0) continue;
    const slots = await getSlots(request, date, opts.serviceId, opts.dentistId);
    if (slots.length >= minSlots) {
      const idx = opts.index ?? 0;
      return { date, slot: slots.at(idx)!, slots };
    }
  }
  throw new Error('no free date found');
}

// ---------- api-level fixtures ----------
export async function freeChairId(request: APIRequestContext, date: string, start: string, end: string): Promise<number> {
  const r = await request.get(`/api/chairs/free?date=${date}&start=${start}&end=${end}`);
  expect(r.status()).toBe(200);
  const { chairs } = await r.json();
  expect(chairs.length).toBeGreaterThan(0);
  return chairs[0].chairId as number;
}
export function bookingPayload(o: { date: string; start: string; dentistId: number | 'any'; serviceId: number; name?: string; contact?: string; email?: string }) {
  return {
    serviceId: o.serviceId,
    dentistId: o.dentistId,
    date: o.date,
    start: o.start,
    fullName: o.name ?? uniqueName('E2E Patient'),
    contactNumber: o.contact ?? uniqueContact(),
    email: o.email ?? 'e2e.patient@example.com',
    birthdate: '1995-05-05',
    patientNote: '',
    consent: true,
    website: '',
  };
}
/** Public online request (pending). Returns the appointment id looked up from the DB by contact. */
export async function createPendingRequest(request: APIRequestContext, o: Parameters<typeof bookingPayload>[0]) {
  const payload = bookingPayload(o);
  const r = await request.post('/api/requests', { data: payload });
  expect(r.status(), await r.text()).toBe(201);
  const rows = await sql<{ appointment_id: number; patient_id: number }>(
    `SELECT a.appointment_id, a.patient_id FROM appointments a JOIN patients p USING (patient_id)
     WHERE p.contact_number = ? ORDER BY a.appointment_id DESC LIMIT 1`,
    [payload.contactNumber],
  );
  return { id: rows[0].appointment_id, patientId: rows[0].patient_id, payload };
}
/** Staff booking (scheduled) through the API; requires a logged-in request context. */
export async function createStaffBooking(
  request: APIRequestContext,
  o: { date: string; start: string; dentistId: number; serviceId: number; patientId?: number; channel?: 'phone' | 'chat' | 'walk-in'; name?: string; email?: string | null; chairId?: number },
) {
  const dur = { 1: 30, 2: 60, 3: 45 }[o.serviceId] ?? 30;
  const [h, m] = o.start.split(':').map(Number);
  const endMin = h * 60 + m + dur;
  const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  const chairId = o.chairId ?? (await freeChairId(request, o.date, o.start, end));
  const who = o.patientId
    ? { patientId: o.patientId }
    : { newPatient: { fullName: o.name ?? uniqueName('E2E Walker'), contactNumber: uniqueContact(), email: o.email === undefined ? 'e2e.walker@example.com' : o.email, birthdate: '1990-01-01' } };
  const r = await request.post('/api/appointments', {
    data: { ...who, serviceId: o.serviceId, dentistId: o.dentistId, date: o.date, start: o.start, chairId, channel: o.channel ?? 'phone', patientNote: '' },
  });
  expect(r.status(), await r.text()).toBe(201);
  const body = await r.json();
  return { id: body.appointmentId as number, patientId: body.patientId as number, chairId, end };
}

// ---------- /book wizard ----------
export async function pickCalendarDate(page: Page, date: string) {
  const day = page.getByRole('button', { name: calendarLabel(date), exact: false });
  for (let i = 0; i < 4 && (await day.count()) === 0; i++) await page.getByRole('button', { name: 'Next month' }).click();
  await day.click();
}
export async function bookStepsOneAndTwo(page: Page, o: { serviceName: RegExp; dentistName: string; date: string; start: string }) {
  await page.goto('/book');
  await page.getByRole('radio', { name: o.serviceName }).check();
  await page.getByRole('radio', { name: o.dentistName }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await pickCalendarDate(page, o.date);
  await page.getByText(time12(o.start), { exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
}
export async function fillDetails(page: Page, d: { name: string; contact: string; email: string; birthdate?: string }) {
  await page.getByLabel('Full name').fill(d.name);
  await page.getByLabel('Contact number').fill(d.contact);
  await page.getByLabel('Email').fill(d.email);
  await page.getByLabel('Birthdate').fill(d.birthdate ?? '1995-05-05');
}
