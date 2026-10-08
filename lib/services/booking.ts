/**
 * New bookings. Every write follows Rule 9: one transaction, lock the dentist row FOR UPDATE,
 * then the chair row when set (always dentist(s) in ascending id, then chair: one lock order
 * everywhere, so no deadlocks between our own writers), then Rules 1–3 via checkBookable
 * (Listing 3.1 with :appointment_id = 0), then INSERT. A deadlock is retried once (tx.ts).
 */
import { execute, type Queryable } from '../db';
import { mismatchFlag, withMismatchFlag } from '../patient-note';
import { checkBookable, lockChair, lockDentist, workingHoursOn, type BookableResult } from '../queries/overlap';
import { computeEndTime, slotIntervalMinutes } from '../rules';
import { nowManila, toHHMMSS, toMinutes } from '../time';
import type { AppointmentStatus, Channel, Slot } from '../types';
import type { BookingRequest, StaffBooking } from '../validation';
import { ServiceError } from './errors';
import { allDentistIds, getServiceOrThrow } from './lookups';
import { createPatientStrict, matchOrCreatePatient } from './patients';
import { assertContactRequestCap, assertGlobalRequestCaps } from './request-limits';
import { getSlots } from './slots';
import { transaction } from './tx';

type Now = { date: string; time: string };

export type InsertAppointment = {
  patientId: number;
  dentistId: number;
  serviceId: number;
  chairId: number | null;
  date: string;
  start: string;
  end: string;
  status: AppointmentStatus;
  channel: Channel;
  patientNote: string | null;
  dentistNote?: string | null;
  rescheduledFromId?: number | null;
};

/** INSERT with requested_at = NOW() (Manila session time zone) and reminder_sent_at = NULL. */
export async function insertAppointment(conn: Queryable, a: InsertAppointment): Promise<number> {
  const r = await execute(
    `INSERT INTO appointments
       (patient_id, dentist_id, service_id, chair_id, appointment_date, start_time, end_time,
        status, channel, requested_at, patient_note, dentist_note, reminder_sent_at, rescheduled_from_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NULL, ?)`,
    [
      a.patientId,
      a.dentistId,
      a.serviceId,
      a.chairId,
      a.date,
      toHHMMSS(a.start),
      toHHMMSS(a.end),
      a.status,
      a.channel,
      a.patientNote,
      a.dentistNote ?? null,
      a.rescheduledFromId ?? null,
    ],
    conn,
  );
  return r.insertId;
}

/** End time from the service duration (Rule 4); a service running past midnight cannot be booked. */
export function endTimeOrThrow(start: string, duration: number): string {
  try {
    return computeEndTime(start, duration);
  } catch {
    throw new ServiceError(409, 'outside_hours', "That time is outside the dentist's working hours");
  }
}

/** Staff-facing 409 for a failed checkBookable (POST /api/appointments, reschedule). */
export function conflictError(r: Exclude<BookableResult, { ok: true }>, dentistId: number): ServiceError {
  switch (r.reason) {
    case 'in_past':
      return new ServiceError(409, 'in_past', 'That date and time has already passed');
    case 'not_working':
      return new ServiceError(409, 'outside_hours', 'The dentist does not work on that day');
    case 'outside_hours':
      return new ServiceError(409, 'outside_hours', "That time is outside the dentist's working hours");
    case 'overlap': {
      const dentistClash = r.conflicts.some((c) => Number(c.dentist_id) === Number(dentistId));
      return new ServiceError(
        409,
        dentistClash ? 'dentist_conflict' : 'chair_conflict',
        dentistClash ? 'The dentist already has an appointment at that time' : 'That chair is already booked at that time',
        { conflictIds: r.conflicts.map((c) => c.appointment_id) },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/requests (FR1, FR2, FR9; Rules 1–3, 9, 10)
// ---------------------------------------------------------------------------

export const SLOT_TAKEN_MESSAGE = 'That time was just taken. Please pick another slot.';

/**
 * Save an online request as `pending` (channel online, chair NULL). With dentistId 'any', tries
 * dentists in dentist_id order, locking each in turn, and assigns the first that passes Rules 1–3
 * (Rule 10). The start must also be on the Rule 5 slot grid (hours start + k * interval), so the
 * public API cannot book times the form would never offer.
 * Throws 409 slot_taken (with fresh `slots` for the same date/service/dentist choice).
 */
export async function createOnlineRequest(
  input: BookingRequest,
  opts: { now?: Now } = {},
): Promise<{ appointmentId: number; dentistId: number; patientId: number }> {
  const now = opts.now ?? nowManila();
  const service = await getServiceOrThrow(input.serviceId);
  const end = endTimeOrThrow(input.start, service.duration_minutes);
  const interval = slotIntervalMinutes();

  try {
    return await transaction(async (conn) => {
      const candidates = input.dentistId === 'any' ? await allDentistIds(conn) : [input.dentistId];
      let chosen: number | null = null;
      for (const dentistId of candidates) {
        const locked = await lockDentist(conn, dentistId);
        if (!locked) {
          throw new ServiceError(400, 'unknown_dentist', 'That dentist does not exist', { issues: { dentistId: 'Unknown dentist' } });
        }
        const hours = await workingHoursOn(conn, dentistId, input.date);
        if (!hours || (toMinutes(input.start) - toMinutes(hours.start)) % interval !== 0) continue;
        const check = await checkBookable(
          conn,
          { date: input.date, start: input.start, end, dentistId, chairId: null, appointmentId: 0 },
          now,
        );
        if (check.ok) {
          chosen = dentistId;
          break;
        }
      }
      if (chosen === null) throw new ServiceError(409, 'slot_taken', SLOT_TAKEN_MESSAGE);

      // H1: clinic-wide caps, then the per-contact cap once the patient is known. Same 429 for a
      // new or matched number (a new number can't reach the per-contact cap).
      await assertGlobalRequestCaps(conn);
      const typed = { fullName: input.fullName, email: input.email, birthdate: input.birthdate };
      const { patientId, existing } = await matchOrCreatePatient(conn, { ...typed, contactNumber: input.contactNumber });
      if (existing) await assertContactRequestCap(conn, patientId);

      // M2: never overwrite the record (B6), but flag a mismatch for staff in patient_note.
      const flag = existing
        ? mismatchFlag({ fullName: existing.full_name, email: existing.email, birthdate: existing.birthdate }, typed)
        : null;
      const appointmentId = await insertAppointment(conn, {
        patientId,
        dentistId: chosen,
        serviceId: input.serviceId,
        chairId: null,
        date: input.date,
        start: input.start,
        end,
        status: 'pending',
        channel: 'online',
        patientNote: withMismatchFlag(flag, input.patientNote),
      });
      return { appointmentId, dentistId: chosen, patientId };
    });
  } catch (err) {
    if (err instanceof ServiceError && err.code === 'slot_taken') {
      err.extra.slots = await freshSlots({ date: input.date, serviceId: input.serviceId, dentistId: input.dentistId }, now);
    }
    throw err;
  }
}

async function freshSlots(input: { date: string; serviceId: number; dentistId: number | 'any'; excludeAppointmentId?: number }, now: Now): Promise<Slot[]> {
  try {
    return await getSlots(input, { now });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// POST /api/appointments (FR3; Rules 1–4, 6, 9). Saves `scheduled`. No email (PRD decision).
// ---------------------------------------------------------------------------

export async function createStaffBooking(
  input: StaffBooking,
  opts: { now?: Now } = {},
): Promise<{ appointmentId: number; patientId: number }> {
  const now = opts.now ?? nowManila();
  const service = await getServiceOrThrow(input.serviceId);
  const end = endTimeOrThrow(input.start, service.duration_minutes);

  return transaction(async (conn) => {
    if (!(await lockDentist(conn, input.dentistId))) {
      throw new ServiceError(400, 'unknown_dentist', 'That dentist does not exist', { issues: { dentistId: 'Unknown dentist' } });
    }
    if (!(await lockChair(conn, input.chairId))) {
      throw new ServiceError(400, 'unknown_chair', 'That chair does not exist', { issues: { chairId: 'Unknown chair' } });
    }
    const check = await checkBookable(
      conn,
      { date: input.date, start: input.start, end, dentistId: input.dentistId, chairId: input.chairId, appointmentId: 0 },
      now,
    );
    if (!check.ok) throw conflictError(check, input.dentistId);

    let patientId: number;
    if (input.patientId !== undefined) {
      const exists = await conn.query('SELECT 1 FROM patients WHERE patient_id = ?', [input.patientId]);
      if ((exists[0] as unknown[]).length === 0) {
        throw new ServiceError(400, 'unknown_patient', 'That patient does not exist', { issues: { patientId: 'Unknown patient' } });
      }
      patientId = input.patientId;
    } else {
      patientId = await createPatientStrict(conn, input.newPatient!);
    }

    const appointmentId = await insertAppointment(conn, {
      patientId,
      dentistId: input.dentistId,
      serviceId: input.serviceId,
      chairId: input.chairId,
      date: input.date,
      start: input.start,
      end,
      status: 'scheduled',
      channel: input.channel,
      patientNote: input.patientNote ?? null,
    });
    return { appointmentId, patientId };
  });
}

export { freshSlots };
