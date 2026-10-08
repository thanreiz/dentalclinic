/**
 * Asia/Manila time helpers (NF08). Manila is UTC+8 with no DST, so a fixed offset is exact.
 * Clinic logic never reads the server's local time: everything is 'YYYY-MM-DD' and 'HH:MM'
 * strings in Manila time. Pure functions; safe in middleware, server, and client code.
 */

export const CLINIC_TZ = 'Asia/Manila';
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Shift a UTC instant into a Date whose UTC fields read as Manila wall-clock time. */
function manilaFields(now: Date) {
  const m = new Date(now.getTime() + MANILA_OFFSET_MS);
  return {
    y: m.getUTCFullYear(),
    mo: m.getUTCMonth() + 1,
    d: m.getUTCDate(),
    h: m.getUTCHours(),
    mi: m.getUTCMinutes(),
    s: m.getUTCSeconds(),
  };
}

/** Current Manila date and time. `now` is injectable for tests. */
export function nowManila(now: Date = new Date()): { date: string; time: string } {
  const f = manilaFields(now);
  return { date: `${f.y}-${pad2(f.mo)}-${pad2(f.d)}`, time: `${pad2(f.h)}:${pad2(f.mi)}` };
}

/** 'YYYY-MM-DD HH:MM:SS' in Manila time, for DATETIME columns written from JS. */
export function nowManilaDateTime(now: Date = new Date()): string {
  const f = manilaFields(now);
  return `${f.y}-${pad2(f.mo)}-${pad2(f.d)} ${pad2(f.h)}:${pad2(f.mi)}:${pad2(f.s)}`;
}

export function todayManila(now: Date = new Date()): string {
  return nowManila(now).date;
}

export function tomorrowManila(now: Date = new Date()): string {
  return addDays(todayManila(now), 1);
}

export function isValidDate(dateStr: string): boolean {
  const m = DATE_RE.exec(dateStr);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function parseDate(dateStr: string): Date {
  if (!isValidDate(dateStr)) throw new Error(`Invalid date: ${dateStr}`);
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

function formatDate(dt: Date): string {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Calendar arithmetic on 'YYYY-MM-DD' (no time zone involved). */
export function addDays(dateStr: string, days: number): string {
  const dt = parseDate(dateStr);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatDate(dt);
}

/** Day of week for a calendar date: 0 = Sunday ... 6 = Saturday (matches dentist_schedules.day_of_week). */
export function dayOfWeek(dateStr: string): number {
  return parseDate(dateStr).getUTCDay();
}

/** Compare 'YYYY-MM-DD' strings: negative, 0, positive. */
export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 'YYYY-MM' of a date string. */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** First and last day of a 'YYYY-MM' month. */
export function monthRange(month: string): { first: string; last: string } {
  const first = `${month}-01`;
  const last = addDays(addDays(first, 32).slice(0, 7) + '-01', -1);
  return { first, last };
}

// ---------- time of day ('HH:MM' or 'HH:MM:SS') ----------

export function isValidTime(t: string): boolean {
  const m = TIME_RE.exec(t);
  if (!m) return false;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = m[3] === undefined ? 0 : Number(m[3]);
  return h <= 23 && mi <= 59 && s <= 59;
}

/** 'HH:MM[:SS]' -> minutes since midnight (seconds ignored). */
export function toMinutes(t: string): number {
  const m = TIME_RE.exec(t);
  if (!m) throw new Error(`Invalid time: ${t}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** minutes since midnight -> 'HH:MM'. Throws outside 00:00–24:00. */
export function fromMinutes(mins: number): string {
  if (!Number.isInteger(mins) || mins < 0 || mins > 24 * 60) throw new Error(`Time out of range: ${mins}`);
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

/** Normalize 'HH:MM:SS' (as MySQL returns TIME) to 'HH:MM'. */
export function toHHMM(t: string): string {
  return fromMinutes(toMinutes(t));
}

/** 'HH:MM' -> 'HH:MM:SS' for binding to TIME columns. */
export function toHHMMSS(t: string): string {
  return `${toHHMM(t)}:00`;
}

export function addMinutes(t: string, mins: number): string {
  return fromMinutes(toMinutes(t) + mins);
}

/** Compare two times of day: negative, 0, positive. */
export function compareTimes(a: string, b: string): number {
  return toMinutes(a) - toMinutes(b);
}

// ---------- display ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '10:00' -> '10:00 AM', '13:30:00' -> '1:30 PM'. */
export function formatTime12(t: string): string {
  const mins = toMinutes(t);
  const h = Math.floor(mins / 60);
  const mi = mins % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(mi)} ${suffix}`;
}

/** '2026-10-15' -> 'Oct 15, 2026'. */
export function formatDateHuman(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  if (!isValidDate(dateStr)) throw new Error(`Invalid date: ${dateStr}`);
  return `${MONTHS[mo - 1]} ${d}, ${y}`;
}

/** ('2026-10-15', '10:00') -> 'Oct 15, 2026, 10:00 AM' (PRD Email format). */
export function formatHuman(dateStr: string, time?: string): string {
  return time ? `${formatDateHuman(dateStr)}, ${formatTime12(time)}` : formatDateHuman(dateStr);
}
