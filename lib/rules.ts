/**
 * Business Rules 1–12 (PRD "Business Rules"), single home (NF06).
 * Everything here is pure: no DB, no clock reads unless `now` is defaulted.
 * The DB-backed parts of rules 1, 6, 9 live in lib/queries/overlap.ts.
 *
 * Times are 'HH:MM' or 'HH:MM:SS' strings; dates are 'YYYY-MM-DD' (Manila).
 */
import {
  addMinutes,
  dayOfWeek,
  fromMinutes,
  nowManila,
  toMinutes,
} from './time';
import type { Slot, TimeRange, WorkingHours } from './types';

// ---------- ENUM values (must match Listing 3.2 exactly) ----------

export const APPOINTMENT_STATUSES = ['pending', 'scheduled', 'attended', 'cancelled', 'declined', 'no-show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const CHANNELS = ['online', 'phone', 'chat', 'walk-in'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Channels staff can pick on /appointments/new (online comes only from /book). */
export const STAFF_CHANNELS = ['phone', 'chat', 'walk-in'] as const;
export type StaffChannel = (typeof STAFF_CHANNELS)[number];

/** Statuses that hold a slot (Rule 1). */
export const ACTIVE_STATUSES = ['pending', 'scheduled'] as const satisfies readonly AppointmentStatus[];

/** Statuses that can never change (Rule 7). */
export const FINAL_STATUSES = ['declined', 'attended', 'cancelled', 'no-show'] as const satisfies readonly AppointmentStatus[];

/** Statuses staff set via POST /api/appointments/[id]/status. */
export const STAFF_SET_STATUSES = ['attended', 'cancelled', 'no-show'] as const satisfies readonly AppointmentStatus[];

export const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

// ---------- config ----------

function intEnv(name: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** SLOT_INTERVAL_MINUTES, default 30 (PRD Assumptions). */
export function slotIntervalMinutes(): number {
  return intEnv('SLOT_INTERVAL_MINUTES', 30);
}

/** NO_SHOW_THRESHOLD, default 2 (PRD Assumptions). */
export function defaultNoShowThreshold(): number {
  return intEnv('NO_SHOW_THRESHOLD', 2);
}

// ---------- Rule 4: end time ----------

/** end_time = start_time + duration. Returns 'HH:MM'. Throws if it runs past midnight. */
export function computeEndTime(start: string, durationMinutes: number): string {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new RangeError(`Invalid duration: ${durationMinutes}`);
  }
  return addMinutes(start, durationMinutes);
}

// ---------- Rule 2: working hours ----------

/** The schedule row for `date`'s weekday, or null when the dentist does not work that day. */
export function hoursForDate<T extends { day_of_week: number }>(schedules: T[], date: string): T | null {
  const dow = dayOfWeek(date);
  return schedules.find((s) => Number(s.day_of_week) === dow) ?? null;
}

/** Rule 2: start and end inside the working hours. `hours` null = not working that day. */
export function isWithinHours(range: TimeRange, hours: WorkingHours | null | undefined): boolean {
  if (!hours) return false;
  const s = toMinutes(range.start);
  const e = toMinutes(range.end);
  return s < e && s >= toMinutes(hours.start) && e <= toMinutes(hours.end);
}

// ---------- Rule 3: not in the past ----------

/**
 * Rule 3: true when date+start is at or before now (Manila).
 * A booking must be strictly later than now, so start == now counts as past.
 */
export function isInPast(date: string, start: string, now: { date: string; time: string } = nowManila()): boolean {
  if (date < now.date) return true;
  if (date > now.date) return false;
  return toMinutes(start) <= toMinutes(now.time);
}

/** Rule 7 helper: the appointment's start time has been reached (attended/no-show allowed). */
export function hasStarted(date: string, start: string, now: { date: string; time: string } = nowManila()): boolean {
  return isInPast(date, start, now);
}

// ---------- Rule 1: overlap (pure form) ----------

/** Rule 1: new_start < existing_end AND new_end > existing_start. Back-to-back is NOT an overlap. */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(a.end) > toMinutes(b.start);
}

export function overlapsAny(range: TimeRange, existing: TimeRange[]): boolean {
  return existing.some((e) => overlaps(range, e));
}

// ---------- Rule 5: open slots ----------

export type OpenSlotsInput = {
  date: string;
  hours: WorkingHours | null | undefined;
  durationMinutes: number;
  /** That dentist's pending + scheduled appointments on `date`. */
  existing: TimeRange[];
  now?: { date: string; time: string };
  intervalMinutes?: number;
};

/**
 * Rule 5: step through working hours every SLOT_INTERVAL_MINUTES; keep each start whose end is
 * within hours and that overlaps no pending/scheduled appointment. For today, drop starts at or
 * before now. Past dates and non-working days return [].
 * Worked example: hours 09:00–12:00, existing 10:00–11:00, 45 min -> ['09:00', '11:00'].
 */
export function openSlots(input: OpenSlotsInput): TimeRange[] {
  const { date, hours, durationMinutes, existing } = input;
  const now = input.now ?? nowManila();
  const step = input.intervalMinutes ?? slotIntervalMinutes();
  if (!hours || durationMinutes <= 0 || step <= 0) return [];
  if (date < now.date) return [];

  const open = toMinutes(hours.start);
  const close = toMinutes(hours.end);
  const nowMins = date === now.date ? toMinutes(now.time) : -1;
  const out: TimeRange[] = [];
  for (let s = open; s + durationMinutes <= close; s += step) {
    if (s <= nowMins) continue;
    const range = { start: fromMinutes(s), end: fromMinutes(s + durationMinutes) };
    if (!overlapsAny(range, existing)) out.push(range);
  }
  return out;
}

/**
 * Union of per-dentist open slots for `dentistId=any`: one entry per start time, listing every
 * dentist free then (ascending ids). Rule 10 assigns the first id on submit.
 */
export function unionSlots(perDentist: { dentistId: number; slots: TimeRange[] }[]): Slot[] {
  const byStart = new Map<string, Slot>();
  for (const { dentistId, slots } of perDentist) {
    for (const s of slots) {
      const key = `${s.start}-${s.end}`;
      const cur = byStart.get(key);
      if (cur) {
        if (!cur.dentistIds.includes(dentistId)) cur.dentistIds.push(dentistId);
      } else {
        byStart.set(key, { start: s.start, end: s.end, dentistIds: [dentistId] });
      }
    }
  }
  return [...byStart.values()]
    .map((s) => ({ ...s, dentistIds: [...s.dentistIds].sort((a, b) => a - b) }))
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

// ---------- Rule 7: status transitions ----------

/**
 * Rule 7 (Table 3.21):
 *   pending   -> scheduled (confirm) | declined
 *   scheduled -> cancelled | attended | no-show   (attended/no-show only once start time passed)
 *   declined, attended, cancelled, no-show are final.
 */
export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
  opts: { startPassed: boolean },
): boolean {
  switch (from) {
    case 'pending':
      return to === 'scheduled' || to === 'declined';
    case 'scheduled':
      if (to === 'cancelled') return true;
      if (to === 'attended' || to === 'no-show') return opts.startPassed;
      return false;
    default:
      return false;
  }
}

/** Statuses reachable from `from` right now (for rendering buttons). */
export function allowedTransitions(from: AppointmentStatus, opts: { startPassed: boolean }): AppointmentStatus[] {
  return APPOINTMENT_STATUSES.filter((to) => canTransition(from, to, opts));
}

export function isActiveStatus(s: AppointmentStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(s);
}

export function isFinalStatus(s: AppointmentStatus): boolean {
  return (FINAL_STATUSES as readonly string[]).includes(s);
}

// ---------- FR9: contact numbers ----------

const MOBILE_RE = /^09\d{9}$/; // 11 digits, e.g. 09175550101
const LANDLINE_AREA_RE = /^0[2-8]\d{7,8}$/; // with area code, 9–10 digits, e.g. 0281234567
const LANDLINE_LOCAL_RE = /^[2-8]\d{6,7}$/; // no area code, 7–8 digits, e.g. 81234567

/**
 * FR9: normalize a PH contact number to digits only so it can be matched.
 * Strips spaces, dashes, parentheses, and dots; '+63' or '63' country prefix -> '0'.
 * Returns null if the result is not a PH mobile (09 + 9 digits) or landline (7–10 digits,
 * not starting with 09/1/9). '+63 917-555-0101' -> '09175550101'.
 */
export function normalizeContact(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('+63')) s = '0' + s.slice(3);
  else if (s.startsWith('63') && (s.length === 11 || s.length === 12)) s = '0' + s.slice(2);
  if (!/^\d+$/.test(s)) return null;
  if (MOBILE_RE.test(s) || LANDLINE_AREA_RE.test(s) || LANDLINE_LOCAL_RE.test(s)) return s;
  return null;
}

export function isValidContact(raw: string): boolean {
  return normalizeContact(raw) !== null;
}

/** Display form: '09175550101' -> '0917 555 0101'; '0281234567' -> '(02) 8123 4567'. */
export function formatContact(digits: string): string {
  if (MOBILE_RE.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (/^02\d{8}$/.test(digits)) return `(02) ${digits.slice(2, 6)} ${digits.slice(6)}`;
  if (/^0[3-8]\d{7,8}$/.test(digits)) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return digits;
}

// ---------- FR15: no-show rate ----------

/** No-show rate = no-show / (attended + no-show). Null when there is nothing to rate. */
export function noShowRate(attended: number, noShow: number): number | null {
  const denom = attended + noShow;
  return denom === 0 ? null : noShow / denom;
}

/** 0.142857 -> '14.3%'; null -> '—'. */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`;
}
