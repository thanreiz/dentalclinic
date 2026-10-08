/**
 * DB-backed parts of Business Rules 1, 2, 6, 9 (pure parts are in lib/rules.ts).
 *
 * Every function takes a `conn` so it can run inside `withTransaction` after the locks:
 *
 *   await withTransaction(async (conn) => {
 *     await lockDentist(conn, dentistId);              // Rule 9: dentist first
 *     if (chairId) await lockChair(conn, chairId);     // ... then the chair
 *     const check = await checkBookable(conn, {...});  // Rules 1–3
 *     if (!check.ok) throw ...;
 *     await conn.query('INSERT ...');
 *   });
 */
import { query, queryOne, type Queryable } from '../db';
import { hoursForDate, isInPast, isWithinHours } from '../rules';
import { nowManila, toHHMM, toHHMMSS } from '../time';
import type { ChairRow, DentistRow, ScheduleRow, TimeRange } from '../types';

export type OverlapParams = {
  date: string; // 'YYYY-MM-DD'
  start: string; // 'HH:MM'
  end: string; // 'HH:MM'
  dentistId: number;
  /** null/undefined for a pending online request (no chair yet): only the dentist is checked. */
  chairId?: number | null;
  /** The appointment being confirmed/rescheduled; 0 for a new booking. NEVER null (PRD FR8). */
  appointmentId: number;
};

export type OverlapRow = {
  appointment_id: number;
  dentist_id: number;
  chair_id: number | null;
  start_time: string;
  end_time: string;
  status: 'pending' | 'scheduled';
};

/**
 * Listing 3.1-style overlap query (Rule 1). Same date, pending/scheduled only, not the row itself,
 * same dentist OR same chair, and new_start < existing_end AND new_end > existing_start.
 */
export const OVERLAP_SQL = `
SELECT appointment_id, dentist_id, chair_id, start_time, end_time, status
FROM appointments
WHERE appointment_date = :appointment_date
  AND status IN ('pending', 'scheduled')
  AND appointment_id <> :appointment_id
  AND (dentist_id = :dentist_id OR (chair_id IS NOT NULL AND chair_id = :chair_id))
  AND start_time < :end_time
  AND end_time > :start_time`;

export async function findOverlaps(conn: Queryable, p: OverlapParams): Promise<OverlapRow[]> {
  if (p.appointmentId === null || p.appointmentId === undefined) {
    throw new Error('findOverlaps: appointmentId must be a number (use 0 for new bookings), never null');
  }
  return query<OverlapRow>(
    OVERLAP_SQL,
    {
      appointment_date: p.date,
      appointment_id: p.appointmentId,
      dentist_id: p.dentistId,
      chair_id: p.chairId ?? null,
      start_time: toHHMMSS(p.start),
      end_time: toHHMMSS(p.end),
    },
    conn,
  );
}

/**
 * Rule 6: chairs free for date/start–end (no pending/scheduled row on that chair overlaps),
 * ignoring `excludeAppointmentId` (the row being confirmed/rescheduled; 0 for new bookings).
 */
export async function freeChairs(
  conn: Queryable,
  date: string,
  start: string,
  end: string,
  excludeAppointmentId = 0,
): Promise<ChairRow[]> {
  return query<ChairRow>(
    `SELECT c.chair_id, c.chair_name
     FROM chairs c
     WHERE NOT EXISTS (
       SELECT 1 FROM appointments a
       WHERE a.chair_id = c.chair_id
         AND a.appointment_date = :appointment_date
         AND a.status IN ('pending', 'scheduled')
         AND a.appointment_id <> :appointment_id
         AND a.start_time < :end_time
         AND a.end_time > :start_time
     )
     ORDER BY c.chair_id`,
    {
      appointment_date: date,
      appointment_id: excludeAppointmentId,
      start_time: toHHMMSS(start),
      end_time: toHHMMSS(end),
    },
    conn,
  );
}

/** Rule 9: lock the dentist row for the rest of the transaction. Null if it does not exist. */
export async function lockDentist(conn: Queryable, dentistId: number): Promise<DentistRow | null> {
  return queryOne<DentistRow>(
    'SELECT dentist_id, dentist_name FROM dentists WHERE dentist_id = ? FOR UPDATE',
    [dentistId],
    conn,
  );
}

/** Rule 9: lock the chair row (after the dentist). Null if it does not exist. */
export async function lockChair(conn: Queryable, chairId: number): Promise<ChairRow | null> {
  return queryOne<ChairRow>('SELECT chair_id, chair_name FROM chairs WHERE chair_id = ? FOR UPDATE', [chairId], conn);
}

/** All schedule rows of a dentist (0–7 rows). */
export async function dentistSchedules(conn: Queryable, dentistId: number): Promise<ScheduleRow[]> {
  return query<ScheduleRow>(
    `SELECT schedule_id, dentist_id, day_of_week, start_time, end_time
     FROM dentist_schedules WHERE dentist_id = ? ORDER BY day_of_week`,
    [dentistId],
    conn,
  );
}

/** Working hours ('HH:MM') of a dentist on a date, or null if not working (Rule 2). */
export async function workingHoursOn(
  conn: Queryable,
  dentistId: number,
  date: string,
): Promise<{ start: string; end: string } | null> {
  const row = hoursForDate(await dentistSchedules(conn, dentistId), date);
  return row ? { start: toHHMM(row.start_time), end: toHHMM(row.end_time) } : null;
}

/** A dentist's pending + scheduled intervals on a date ('HH:MM'), for openSlots (Rule 5). */
export async function activeRangesForDentist(
  conn: Queryable,
  dentistId: number,
  date: string,
  excludeAppointmentId = 0,
): Promise<TimeRange[]> {
  const rows = await query<{ start_time: string; end_time: string }>(
    `SELECT start_time, end_time FROM appointments
     WHERE dentist_id = ? AND appointment_date = ? AND status IN ('pending', 'scheduled')
       AND appointment_id <> ?
     ORDER BY start_time`,
    [dentistId, date, excludeAppointmentId],
    conn,
  );
  return rows.map((r) => ({ start: toHHMM(r.start_time), end: toHHMM(r.end_time) }));
}

export type BookableResult =
  | { ok: true }
  | { ok: false; reason: 'in_past' | 'not_working' | 'outside_hours' }
  | { ok: false; reason: 'overlap'; conflicts: OverlapRow[] };

/**
 * Rules 3, 2, 1 in that order for one candidate booking. Call inside the transaction,
 * after lockDentist/lockChair. `now` is injectable for tests.
 */
export async function checkBookable(
  conn: Queryable,
  p: OverlapParams,
  now: { date: string; time: string } = nowManila(),
): Promise<BookableResult> {
  if (isInPast(p.date, p.start, now)) return { ok: false, reason: 'in_past' };
  const hours = await workingHoursOn(conn, p.dentistId, p.date);
  if (!hours) return { ok: false, reason: 'not_working' };
  if (!isWithinHours({ start: p.start, end: p.end }, hours)) return { ok: false, reason: 'outside_hours' };
  const conflicts = await findOverlaps(conn, p);
  if (conflicts.length > 0) return { ok: false, reason: 'overlap', conflicts };
  return { ok: true };
}
