/**
 * Changes to an existing appointment: confirm, decline (Rule 12), reschedule (Rule 11),
 * status (Rule 7), dentist note. Lock order everywhere: dentist -> chair -> appointment row.
 */
import { execute, getPool, queryOne, type Queryable } from '../db';
import { sendConfirmation } from '../mail';
import { checkBookable, freeChairs, lockChair, lockDentist } from '../queries/overlap';
import { canTransition, hasStarted } from '../rules';
import { nowManila, toHHMM } from '../time';
import type { AppointmentRow, AppointmentStatus } from '../types';
import type { RescheduleInput } from '../validation';
import { conflictError, endTimeOrThrow, freshSlots, insertAppointment } from './booking';
import { notFound, ServiceError } from './errors';
import { getServiceOrThrow } from './lookups';
import { transaction } from './tx';

type Now = { date: string; time: string };

export const EMAIL_FAILED_MESSAGE = 'Confirmed, but the email could not be sent.';

async function loadForUpdate(conn: Queryable, id: number): Promise<AppointmentRow> {
  const row = await queryOne<AppointmentRow>('SELECT * FROM appointments WHERE appointment_id = ? FOR UPDATE', [id], conn);
  if (!row) throw notFound();
  return row;
}

async function peek(id: number): Promise<AppointmentRow> {
  const row = await queryOne<AppointmentRow>('SELECT * FROM appointments WHERE appointment_id = ?', [id]);
  if (!row) throw notFound();
  return row;
}

function invalidTransition(from: AppointmentStatus, message: string) {
  return new ServiceError(409, 'invalid_transition', message, { status: from });
}

// ---------------------------------------------------------------------------
// POST /api/appointments/[id]/confirm  (FR2, FR8, FR12; Rules 1–3, 6, 7, 9)
// ---------------------------------------------------------------------------

export type ConfirmResult = { ok: true; emailSent: boolean; emailError?: string; emailSkipped?: 'no_email' };

/**
 * pending -> scheduled with a chair. Re-checks Rules 1–3 for the slot (excluding the row itself)
 * and that the chair is free. Commits, THEN sends the confirmation (only if the patient has an
 * email). A mail failure never rolls back the confirm (FR12).
 * 409 slot_unavailable { reason, slots, freeChairs } when the slot or chair is gone.
 */
export async function confirmAppointment(id: number, chairId: number, opts: { now?: Now } = {}): Promise<ConfirmResult> {
  const now = opts.now ?? nowManila();
  const pre = await peek(id);
  if (pre.status !== 'pending') throw invalidTransition(pre.status, 'Only pending requests can be confirmed');

  let mail: { to: string | null; patientName: string; date: string; start: string; dentist: string; service: string };
  try {
    mail = await transaction(async (conn) => {
      if (!(await lockDentist(conn, pre.dentist_id))) throw notFound('Dentist');
      if (!(await lockChair(conn, chairId))) {
        throw new ServiceError(400, 'unknown_chair', 'That chair does not exist', { issues: { chairId: 'Unknown chair' } });
      }
      const a = await loadForUpdate(conn, id);
      if (a.status !== 'pending') throw invalidTransition(a.status, 'Only pending requests can be confirmed');
      const check = await checkBookable(
        conn,
        { date: a.appointment_date, start: toHHMM(a.start_time), end: toHHMM(a.end_time), dentistId: a.dentist_id, chairId, appointmentId: id },
        now,
      );
      if (!check.ok) {
        const reason =
          check.reason === 'overlap' ? conflictError(check, a.dentist_id).code : check.reason === 'not_working' ? 'outside_hours' : check.reason;
        throw new ServiceError(409, 'slot_unavailable', 'Slot no longer free', { reason });
      }
      await execute("UPDATE appointments SET status = 'scheduled', chair_id = ? WHERE appointment_id = ? AND status = 'pending'", [chairId, id], conn);
      const info = await queryOne<{ full_name: string; email: string | null; dentist_name: string; service_name: string }>(
        `SELECT p.full_name, p.email, d.dentist_name, s.service_name
         FROM appointments a JOIN patients p ON p.patient_id = a.patient_id
         JOIN dentists d ON d.dentist_id = a.dentist_id JOIN services s ON s.service_id = a.service_id
         WHERE a.appointment_id = ?`,
        [id],
        conn,
      );
      return {
        to: info?.email ?? null,
        patientName: info?.full_name ?? '',
        date: a.appointment_date,
        start: toHHMM(a.start_time),
        dentist: info?.dentist_name ?? '',
        service: info?.service_name ?? '',
      };
    });
  } catch (err) {
    if (err instanceof ServiceError && err.code === 'slot_unavailable') {
      const start = toHHMM(pre.start_time);
      const end = toHHMM(pre.end_time);
      err.extra.slots = await freshSlots(
        { date: pre.appointment_date, serviceId: pre.service_id, dentistId: pre.dentist_id, excludeAppointmentId: id },
        now,
      );
      try {
        const chairs = await freeChairs(getPool(), pre.appointment_date, start, end, id);
        err.extra.freeChairs = chairs.map((c) => ({ chairId: c.chair_id, chairName: c.chair_name }));
      } catch {
        err.extra.freeChairs = [];
      }
    }
    throw err;
  }

  if (!mail.to) return { ok: true, emailSent: false, emailSkipped: 'no_email' };
  const sent = await sendConfirmation({
    to: mail.to,
    patientName: mail.patientName,
    date: mail.date,
    startTime: mail.start,
    dentist: mail.dentist,
    service: mail.service,
  });
  if (!sent.ok) {
    console.error(`[confirm] appointment ${id} confirmed but email failed: ${sent.error}`);
    return { ok: true, emailSent: false, emailError: EMAIL_FAILED_MESSAGE };
  }
  return { ok: true, emailSent: true };
}

// ---------------------------------------------------------------------------
// POST /api/appointments/[id]/decline (Rule 12): pending -> declined. No email.
// ---------------------------------------------------------------------------

export async function declineAppointment(id: number, opts: { now?: Now } = {}): Promise<void> {
  const now = opts.now ?? nowManila();
  await transaction(async (conn) => {
    const a = await loadForUpdate(conn, id);
    const startPassed = hasStarted(a.appointment_date, a.start_time, now);
    if (!canTransition(a.status, 'declined', { startPassed })) {
      throw invalidTransition(a.status, 'Only pending requests can be declined');
    }
    await execute("UPDATE appointments SET status = 'declined' WHERE appointment_id = ?", [id], conn);
  });
}

// ---------------------------------------------------------------------------
// POST /api/appointments/[id]/status (Rule 7 via canTransition, Table 3.21)
// ---------------------------------------------------------------------------

export async function setAppointmentStatus(
  id: number,
  to: 'attended' | 'cancelled' | 'no-show',
  opts: { now?: Now } = {},
): Promise<{ status: AppointmentStatus }> {
  const now = opts.now ?? nowManila();
  return transaction(async (conn) => {
    const a = await loadForUpdate(conn, id);
    const startPassed = hasStarted(a.appointment_date, a.start_time, now);
    if (!canTransition(a.status, to, { startPassed })) {
      const msg =
        a.status === 'scheduled' && (to === 'attended' || to === 'no-show')
          ? `"${to === 'attended' ? 'Attended' : 'No-show'}" can only be set once the appointment's start time has passed`
          : `Cannot change a ${a.status} appointment to ${to}`;
      throw invalidTransition(a.status, msg);
    }
    await execute('UPDATE appointments SET status = ? WHERE appointment_id = ?', [to, id], conn);
    return { status: to };
  });
}

// ---------------------------------------------------------------------------
// POST /api/appointments/[id]/reschedule (FR4, Rule 11; Rules 1–4, 6, 9)
// ---------------------------------------------------------------------------

/**
 * Only `scheduled`. In ONE transaction: lock new dentist, new chair, then the old row; check
 * Rules 1–3 for the new time with :appointment_id = old id (so it may move within its own slot);
 * set old -> cancelled; insert the new `scheduled` copy (same patient, service, channel; both
 * notes copied; requested_at NOW(); reminder_sent_at NULL; rescheduled_from_id = old id).
 */
export async function rescheduleAppointment(
  id: number,
  input: RescheduleInput,
  opts: { now?: Now } = {},
): Promise<{ ok: true; newId: number }> {
  const now = opts.now ?? nowManila();
  const pre = await peek(id);
  if (pre.status !== 'scheduled') throw invalidTransition(pre.status, 'Only scheduled appointments can be rescheduled');
  const service = await getServiceOrThrow(pre.service_id);
  const end = endTimeOrThrow(input.start, service.duration_minutes);

  return transaction(async (conn) => {
    if (!(await lockDentist(conn, input.dentistId))) {
      throw new ServiceError(400, 'unknown_dentist', 'That dentist does not exist', { issues: { dentistId: 'Unknown dentist' } });
    }
    if (!(await lockChair(conn, input.chairId))) {
      throw new ServiceError(400, 'unknown_chair', 'That chair does not exist', { issues: { chairId: 'Unknown chair' } });
    }
    const old = await loadForUpdate(conn, id);
    if (old.status !== 'scheduled') throw invalidTransition(old.status, 'Only scheduled appointments can be rescheduled');

    const check = await checkBookable(
      conn,
      { date: input.date, start: input.start, end, dentistId: input.dentistId, chairId: input.chairId, appointmentId: id },
      now,
    );
    if (!check.ok) throw conflictError(check, input.dentistId);

    await execute("UPDATE appointments SET status = 'cancelled' WHERE appointment_id = ?", [id], conn);
    const newId = await insertAppointment(conn, {
      patientId: old.patient_id,
      dentistId: input.dentistId,
      serviceId: old.service_id,
      chairId: input.chairId,
      date: input.date,
      start: input.start,
      end,
      status: 'scheduled',
      channel: old.channel,
      patientNote: old.patient_note,
      dentistNote: old.dentist_note,
      rescheduledFromId: id,
    });
    return { ok: true as const, newId };
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/appointments/[id]/note
// ---------------------------------------------------------------------------

export async function setDentistNote(id: number, note: string | null): Promise<void> {
  await transaction(async (conn) => {
    await loadForUpdate(conn, id);
    await execute('UPDATE appointments SET dentist_note = ? WHERE appointment_id = ?', [note, id], conn);
  });
}
