/**
 * GET /api/slots (FR7, Rule 5). Open slots are computed per dentist from working hours, the
 * service duration, and that dentist's pending + scheduled rows; with dentistId 'any' the union
 * across dentists (lib/rules unionSlots). Never stored.
 */
import { getPool, type Queryable } from '../db';
import { activeRangesForDentist, workingHoursOn } from '../queries/overlap';
import { openSlots, unionSlots } from '../rules';
import { addDays, nowManila } from '../time';
import type { Slot } from '../types';
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
  const service = await getServiceOrThrow(input.serviceId, conn);
  let ids: number[];
  if (input.dentistId === 'any') {
    ids = await allDentistIds(conn);
  } else {
    if (!(await dentistExists(input.dentistId, conn))) {
      throw new ServiceError(400, 'unknown_dentist', 'That dentist does not exist', { issues: { dentistId: 'Unknown dentist' } });
    }
    ids = [input.dentistId];
  }
  const perDentist = await Promise.all(
    ids.map(async (dentistId) => {
      const [hours, existing] = await Promise.all([
        workingHoursOn(conn, dentistId, input.date),
        activeRangesForDentist(conn, dentistId, input.date, input.excludeAppointmentId ?? 0),
      ]);
      return {
        dentistId,
        slots: openSlots({ date: input.date, hours, durationMinutes: service.duration_minutes, existing, now: opts.now }),
      };
    }),
  );
  return unionSlots(perDentist);
}
