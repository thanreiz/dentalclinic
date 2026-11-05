/**
 * Changes to an existing appointment: confirm, decline (Rule 12), reschedule (Rule 11),
 * status (Rule 7), dentist note. Lock order everywhere: dentist -> chair -> appointment row.
 */
import { execute, getPool, queryOne, type Queryable } from '../db';
import { sendCancellationEmail, sendConfirmation, sendDeclineEmail, sendRescheduleEmail } from '../mail';
import { sendMessengerCancellation, sendMessengerConfirmation, sendMessengerDecline, sendMessengerReschedule } from './messenger-notify';
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

export type ConfirmResult = { ok: true; emailSent: boolean; emailError?: string; emailSkipped?: 'no_email'; messengerSent?: boolean };

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

  let mail: { to: string | null; psid: string | null; patientName: string; date: string; start: string; dentist: string; service: string };
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
      const info = await queryOne<{ full_name: string; email: string | null; messenger_psid: string | null; dentist_name: string; service_name: string }>(
        `SELECT p.full_name, p.email, p.messenger_psid, d.dentist_name, s.service_name
         FROM appointments a JOIN patients p ON p.patient_id = a.patient_id
         JOIN dentists d ON d.dentist_id = a.dentist_id JOIN services s ON s.service_id = a.service_id
         WHERE a.appointment_id = ?`,
        [id],
        conn,
      );
      return {
        to: info?.email ?? null,
        psid: info?.messenger_psid ?? null,
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

  // Messenger copy for patients who booked through the bot; never blocks the confirm (best effort).
  let messengerSent: boolean | undefined;
  if (mail.psid) {
    const m = await sendMessengerConfirmation(mail.psid, { patientName: mail.patientName, date: mail.date, startTime: mail.start, dentist: mail.dentist, service: mail.service });
    messengerSent = m.ok;
    if (!m.ok) console.error(`[confirm] appointment ${id} confirmed but the Messenger message failed: ${m.error}`);
  }

  if (!mail.to) return { ok: true, emailSent: false, emailSkipped: 'no_email', ...(messengerSent === undefined ? {} : { messengerSent }) };
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
    return { ok: true, emailSent: false, emailError: EMAIL_FAILED_MESSAGE, ...(messengerSent === undefined ? {} : { messengerSent }) };
  }
  return { ok: true, emailSent: true, ...(messengerSent === undefined ? {} : { messengerSent }) };
}

// ---------------------------------------------------------------------------
// Patient notices after a staff change (reschedule, decline, cancel). Always AFTER the commit,
// never inside the transaction. Best effort: a failure is logged and never blocks or undoes the
// change. Email is the main channel; Messenger is a copy for patients with a stored Messenger id
// (Meta delivers it only within 24 hours of the patient's last message, see DECISIONS M3).
// ---------------------------------------------------------------------------

type NoticeInfo = { to: string | null; psid: string | null; patientName: string; date: string; start: string; dentist: string; service: string };
type NoticeResult = { emailSent: boolean; emailSkipped?: 'no_email'; messengerSent?: boolean };

async function noticeInfo(conn: Queryable, appointmentId: number): Promise<NoticeInfo> {
  const r = await queryOne<{ full_name: string; email: string | null; messenger_psid: string | null; dentist_name: string; service_name: string; appointment_date: string; start_time: string }>(
    `SELECT p.full_name, p.email, p.messenger_psid, d.dentist_name, s.service_name, a.appointment_date, a.start_time
       FROM appointments a JOIN patients p ON p.patient_id = a.patient_id
       JOIN dentists d ON d.dentist_id = a.dentist_id JOIN services s ON s.service_id = a.service_id
      WHERE a.appointment_id = ?`,
    [appointmentId],
    conn,
  );
  if (!r) throw notFound();
  return { to: r.email, psid: r.messenger_psid, patientName: r.full_name, date: r.appointment_date, start: toHHMM(r.start_time), dentist: r.dentist_name, service: r.service_name };
}

async function notifyPatient(
  label: string,
  id: number,
  info: NoticeInfo,
  send: {
    email: (a: { to: string; patientName: string; date: string; startTime: string; dentist: string; service: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
    messenger: (psid: string, a: { patientName: string; date: string; startTime: string; dentist: string; service: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  },
): Promise<NoticeResult> {
  const base = { patientName: info.patientName, date: info.date, startTime: info.start, dentist: info.dentist, service: info.service };
  let messengerSent: boolean | undefined;
  if (info.psid) {
    try {
      const m = await send.messenger(info.psid, base);
      messengerSent = m.ok;
      if (!m.ok) console.error(`[${label}] appointment ${id}: the Messenger message failed: ${m.error}`);
    } catch (err) {
      messengerSent = false;
      console.error(`[${label}] appointment ${id}: the Messenger message threw:`, err instanceof Error ? err.message : err);
    }
  }
  const tail = messengerSent === undefined ? {} : { messengerSent };
  if (!info.to) return { emailSent: false, emailSkipped: 'no_email', ...tail };
  try {
    const sent = await send.email({ ...base, to: info.to });
    if (!sent.ok) console.error(`[${label}] appointment ${id}: the email failed: ${sent.error}`);
    return { emailSent: sent.ok, ...tail };
  } catch (err) {
    console.error(`[${label}] appointment ${id}: the email threw:`, err instanceof Error ? err.message : err);
    return { emailSent: false, ...tail };
  }
}

// ---------------------------------------------------------------------------
// POST /api/appointments/[id]/decline (Rule 12): pending -> declined. Patient notice after commit.
// ---------------------------------------------------------------------------

export async function declineAppointment(id: number, opts: { now?: Now } = {}): Promise<void> {
  const now = opts.now ?? nowManila();
  const info = await transaction(async (conn) => {
    const a = await loadForUpdate(conn, id);
    const startPassed = hasStarted(a.appointment_date, a.start_time, now);
    if (!canTransition(a.status, 'declined', { startPassed })) {
      throw invalidTransition(a.status, 'Only pending requests can be declined');
    }
    await execute("UPDATE appointments SET status = 'declined' WHERE appointment_id = ?", [id], conn);
    return noticeInfo(conn, id);
  });
  await notifyPatient('decline', id, info, { email: sendDeclineEmail, messenger: sendMessengerDecline });
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
  const { info } = await transaction(async (conn) => {
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
    return { info: to === 'cancelled' ? await noticeInfo(conn, id) : null };
  });
  // Cancelled by staff: tell the patient (attended / no-show are record-keeping, no notice).
  if (info) await notifyPatient('cancel', id, info, { email: sendCancellationEmail, messenger: sendMessengerCancellation });
  return { status: to };
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
): Promise<{ ok: true; newId: number } & Partial<NoticeResult>> {
  const now = opts.now ?? nowManila();
  const pre = await peek(id);
  if (pre.status !== 'scheduled') throw invalidTransition(pre.status, 'Only scheduled appointments can be rescheduled');
  const service = await getServiceOrThrow(pre.service_id);
  const end = endTimeOrThrow(input.start, service.duration_minutes);

  const moved = await transaction(async (conn) => {
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
      followUpOfId: old.follow_up_of_id,
    });
    return { newId, info: await noticeInfo(conn, newId), oldDate: old.appointment_date, oldStart: toHHMM(old.start_time) };
  });

  // Tell the patient after the commit (a retry finds the old row cancelled and throws above, so
  // the notice is never sent twice). The new row has reminder_sent_at NULL, so its day-before
  // reminder still goes out.
  const notice = await notifyPatient('reschedule', moved.newId, moved.info, {
    email: (a) => sendRescheduleEmail({ ...a, oldDate: moved.oldDate, oldStart: moved.oldStart }),
    messenger: (psid, a) => sendMessengerReschedule(psid, { ...a, oldDate: moved.oldDate, oldStartTime: moved.oldStart }),
  });
  return { ok: true as const, newId: moved.newId, ...notice };
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
