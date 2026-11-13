/**
 * GET /api/slots (FR7, Rule 5). Open slots are computed per dentist from working hours, the
 * service duration, and that dentist's pending + scheduled rows; with dentistId 'any' the union
 * across dentists (lib/rules unionSlots). Never stored.
 */
import { getPool, query, type Queryable } from '../db';
import { hoursForDate, openSlots, unionSlots } from '../rules';
import { addDays, nowManila, toHHMM } from '../time';
import type { ScheduleRow, Slot } from '../types';
import { ServiceError } from './errors';
import { allDentistIds, dentistExists, getServiceOrThrow } from './lookups';

/** Public booking window: today .. today + 60 days (PRD Phase 4). */
export const PUBLIC_BOOKING_WINDOW_DAYS = 60;
/** Staff screens may look further ahead. */
export const STAFF_BOOKING_WINDOW_DAYS = 366;

/** 400 unless `date` is within today..today+windowDays (Manila). */
export function assertDateInWindow(date: string, windowDays: number, now = nowManila()): void {
  const last = addDays(now.date, windowDays);
  if (date < now.date) {
    throw new ServiceError(400, 'date_in_past', 'Pick today or a later date', { issues: { date: 'Date is in the past' } });
  }
  if (date > last) {
    throw new ServiceError(400, 'date_out_of_range', `Pick a date up to ${windowDays} days ahead`, {
      issues: { date: `Date must be on or before ${last}` },
    });
  }
}

export type SlotsInput = {
  date: string;
  serviceId: number;
  dentistId: number | 'any';
  /** Reschedule: treat this appointment's own time as free (staff only). 0 = none. */
  excludeAppointmentId?: number;
};

export async function getSlots(input: SlotsInput, opts: { now?: { date: string; time: string }; conn?: Queryable } = {}): Promise<Slot[]> {
  const conn = opts.conn ?? getPool();
  // Service and dentist lookups are independent: run together. Both read live rows (never cached).
  const [service, ids] = await Promise.all([
    getServiceOrThrow(input.serviceId, conn),
    (async () => {
      if (input.dentistId === 'any') return allDentistIds(conn);
      if (!(await dentistExists(input.dentistId, conn))) {
        throw new ServiceError(400, 'unknown_dentist', 'That dentist does not exist', { issues: { dentistId: 'Unknown dentist' } });
      }
      return [input.dentistId];
    })(),
  ]);
  if (ids.length === 0) return [];
  // One query each for every dentist's weekly hours and that day's active appointments.
  const [schedules, booked] = await Promise.all([
    query<ScheduleRow>(
      `SELECT schedule_id, dentist_id, day_of_week, start_time, end_time
       FROM dentist_schedules WHERE dentist_id IN (${ids.map(() => '?').join(', ')}) ORDER BY dentist_id, day_of_week`,
      ids,
      conn,
    ),
    query<{ dentist_id: number; start_time: string; end_time: string }>(
      `SELECT dentist_id, start_time, end_time FROM appointments
       WHERE dentist_id IN (${ids.map(() => '?').join(', ')}) AND appointment_date = ?
         AND (status = 'scheduled' OR (status = 'pending' AND rescheduled_from_id IS NULL)) AND appointment_id <> ?
       ORDER BY start_time`,
      [...ids, input.date, input.excludeAppointmentId ?? 0],
      conn,
    ),
  ]);
  const perDentist = ids.map((dentistId) => {
    const row = hoursForDate(
      schedules.filter((r) => r.dentist_id === dentistId),
      input.date,
    );
    const hours = row ? { start: toHHMM(row.start_time), end: toHHMM(row.end_time) } : null;
    const existing = booked
      .filter((r) => r.dentist_id === dentistId)
      .map((r) => ({ start: toHHMM(r.start_time), end: toHHMM(r.end_time) }));
    return {
      dentistId,
      slots: openSlots({ date: input.date, hours, durationMinutes: service.duration_minutes, existing, now: opts.now }),
    };
  });
  return unionSlots(perDentist);
}
