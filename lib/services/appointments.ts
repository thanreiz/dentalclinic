/**
 * Changes to an existing appointment: confirm, decline (Rule 12), reschedule (Rule 11),
 * status (Rule 7), dentist note. Lock order everywhere: dentist -> chair -> appointment row.
 */
import { execute, getPool, query, queryOne, type Queryable } from '../db';
import { sendCancellationEmail, sendConfirmation, sendDeclineEmail, sendRescheduleEmail, sendRescheduleRequestEmail, sendRescheduleTakenEmail } from '../mail';
import {
  sendMessengerCancellation,
  sendMessengerConfirmation,
  sendMessengerDecline,
  sendMessengerReschedule,
  sendMessengerRescheduleRequest,
  sendMessengerRescheduleTaken,
} from './messenger-notify';
import { checkBookable, freeChairs, lockChair, lockDentist } from '../queries/overlap';
import { canTransition, hasStarted } from '../rules';
import { nowManila, toHHMM, toHHMMSS } from '../time';
import type { AppointmentRow, AppointmentStatus } from '../types';
import type { RescheduleInput } from '../validation';
import { conflictError, endTimeOrThrow, freshSlots, insertAppointment } from './booking';
import { notFound, ServiceError } from './errors';
import { getServiceOrThrow } from './lookups';
import { transaction } from './tx';
import { invalidatePendingCount } from '../queries/requests';

type Now = { date: string; time: string };

/**
 * Runs a patient notice after the response instead of inside the request (routes pass `deferNotice`
 * from lib/http, which uses next/server `after()`). Without it the notice is awaited, as before
 * (services called directly, tests). The notice code never throws, so a deferred one cannot fail.
 */
export type Defer = (task: () => Promise<unknown>) => Promise<void> | void;

async function runNotice<T>(defer: Defer | undefined, task: () => Promise<T>): Promise<T | undefined> {
  if (!defer) return task();
  await defer(async () => {
    await task();
  });
  return undefined;
}

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

export type ConfirmResult =
  | { ok: true; emailSent: boolean; emailError?: string; emailSkipped?: 'no_email'; messengerSent?: boolean }
  // `defer` given (the route): the notice goes out after the response, so no sent / error fields.
  | { ok: true; noticeQueued: true; emailSkipped?: 'no_email' };

/**
 * pending -> scheduled with a chair. Re-checks Rules 1–3 for the slot (excluding the row itself)
 * and that the chair is free. Commits, THEN sends the confirmation (only if the patient has an
 * email). A mail failure never rolls back the confirm (FR12).
 * 409 slot_unavailable { reason, slots, freeChairs } when the slot or chair is gone.
 */
export async function confirmAppointment(id: number, chairId: number, opts: { now?: Now; defer?: Defer } = {}): Promise<ConfirmResult> {
  const now = opts.now ?? nowManila();
  const pre = await peek(id);
  if (pre.status !== 'pending') throw invalidTransition(pre.status, 'Only pending requests can be confirmed');

  type Loser = { id: number; info: NoticeInfo; original: { id: number; date: string; start: string } | null };
  let mail: NoticeInfo & { move: { oldDate: string; oldStart: string } | null; losers: Loser[] };
  try {
    mail = await transaction(async (conn) => {
      if (!(await lockDentist(conn, pre.dentist_id))) throw notFound('Dentist');
      if (!(await lockChair(conn, chairId))) {
        throw new ServiceError(400, 'unknown_chair', 'That chair does not exist', { issues: { chairId: 'Unknown chair' } });
      }
      const a = await loadForUpdate(conn, id);
      if (a.status !== 'pending') throw invalidTransition(a.status, 'Only pending requests can be confirmed');
      // A patient reschedule request: approving it moves the original appointment.
      const original = a.rescheduled_from_id ? await loadForUpdate(conn, a.rescheduled_from_id) : null;
      if (original && original.status !== 'scheduled') {
        throw invalidTransition(a.status, `The original appointment is ${original.status} now; decline this reschedule request.`);
      }
      const check = await checkBookable(
        conn,
        {
          date: a.appointment_date,
          start: toHHMM(a.start_time),
          end: toHHMM(a.end_time),
          dentistId: a.dentist_id,
          chairId,
          appointmentId: id,
          alsoExcludeId: original?.appointment_id ?? 0,
          ignorePending: !!original,
        },
        now,
      );
      if (!check.ok) {
        const reason =
          check.reason === 'overlap' ? conflictError(check, a.dentist_id).code : check.reason === 'not_working' ? 'outside_hours' : check.reason;
        throw new ServiceError(409, 'slot_unavailable', 'Slot no longer free', { reason });
      }
      await execute("UPDATE appointments SET status = 'scheduled', chair_id = ? WHERE appointment_id = ? AND status = 'pending'", [chairId, id], conn);
      if (original) await execute("UPDATE appointments SET status = 'cancelled' WHERE appointment_id = ?", [original.appointment_id], conn);

      // First come, first served: other pending requests for an overlapping time with this dentist
      // lose (reschedule requests always; ordinary requests only when a reschedule request won,
      // since ordinary ones already block each other).
      const losing = await query<{ appointment_id: number; rescheduled_from_id: number | null }>(
        `SELECT appointment_id, rescheduled_from_id FROM appointments
          WHERE status = 'pending' AND appointment_id <> ? AND dentist_id = ? AND appointment_date = ?
            AND start_time < ? AND end_time > ? AND (? = 1 OR rescheduled_from_id IS NOT NULL)
          FOR UPDATE`,
        [id, a.dentist_id, a.appointment_date, toHHMMSS(a.end_time), toHHMMSS(a.start_time), original ? 1 : 0],
        conn,
      );
      const losers: Loser[] = [];
      for (const l of losing) {
        await execute("UPDATE appointments SET status = 'declined' WHERE appointment_id = ?", [l.appointment_id], conn);
        const orig = l.rescheduled_from_id
          ? await queryOne<{ appointment_id: number; appointment_date: string; start_time: string; status: string }>(
              'SELECT appointment_id, appointment_date, start_time, status FROM appointments WHERE appointment_id = ?',
              [l.rescheduled_from_id],
              conn,
            )
          : null;
        losers.push({
          id: l.appointment_id,
          info: await noticeInfo(conn, l.appointment_id),
          original: orig && orig.status === 'scheduled' ? { id: orig.appointment_id, date: orig.appointment_date, start: toHHMM(orig.start_time) } : null,
        });
      }

      return {
        ...(await noticeInfo(conn, id)),
        move: original ? { oldDate: original.appointment_date, oldStart: toHHMM(original.start_time) } : null,
        losers,
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

  invalidatePendingCount();

  // Patient notices after the commit: email + Messenger copy, in parallel, never blocking the confirm
  // (FR12). With `defer` they run after the response, so the result only says they were queued.
  const info: NoticeInfo = mail;
  const move = mail.move;
  const senders = move
    ? {
        email: (x: Parameters<typeof sendConfirmation>[0]) => sendRescheduleEmail({ ...x, oldDate: move.oldDate, oldStart: move.oldStart, byPatient: true }),
        messenger: (psid: string, x: Parameters<typeof sendMessengerConfirmation>[1]) =>
          sendMessengerReschedule(psid, { ...x, oldDate: move.oldDate, oldStartTime: move.oldStart, byPatient: true }),
      }
    : CONFIRM_SENDERS;
  const losers = mail.losers;
  const tellLosers = () =>
    Promise.all(
      losers.map((l) =>
        l.original
          ? notifyPatient('reschedule-taken', l.id, l.info, {
              email: (x) => sendRescheduleTakenEmail({ ...x, currentDate: l.original!.date, currentStart: l.original!.start, currentId: l.original!.id, appointmentId: undefined }),
              messenger: (psid, x) =>
                sendMessengerRescheduleTaken(psid, { ...x, currentDate: l.original!.date, currentStartTime: l.original!.start, currentId: l.original!.id, appointmentId: undefined }),
            })
          : notifyPatient('decline', l.id, l.info, { email: sendDeclineEmail, messenger: sendMessengerDecline }),
      ),
    );
  if (opts.defer) {
    await runNotice(opts.defer, () => Promise.all([notifyPatient('confirm', id, info, senders), tellLosers()]));
    return { ok: true, noticeQueued: true, ...(info.to ? {} : { emailSkipped: 'no_email' as const }) };
  }
  const [r] = await Promise.all([notifyPatient('confirm', id, info, senders), tellLosers()]);
  const tail = r.messengerSent === undefined ? {} : { messengerSent: r.messengerSent };
  if (r.emailSkipped) return { ok: true, emailSent: false, emailSkipped: 'no_email', ...tail };
  if (!r.emailSent) return { ok: true, emailSent: false, emailError: EMAIL_FAILED_MESSAGE, ...tail };
  return { ok: true, emailSent: true, ...tail };
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
    email: (a: { to: string; appointmentId: number; patientName: string; date: string; startTime: string; dentist: string; service: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
    messenger: (psid: string, a: { appointmentId: number; patientName: string; date: string; startTime: string; dentist: string; service: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  },
): Promise<NoticeResult> {
  const base = { appointmentId: id, patientName: info.patientName, date: info.date, startTime: info.start, dentist: info.dentist, service: info.service };
  // Both channels at once: the slower one no longer delays the other, and neither can throw out.
  const [messengerSent, emailRes] = await Promise.all([
    info.psid
      ? send.messenger(info.psid, base).then(
          (m) => {
            if (!m.ok) console.error(`[${label}] appointment ${id}: the Messenger message failed: ${m.error}`);
            return m.ok;
          },
          (err) => {
            console.error(`[${label}] appointment ${id}: the Messenger message threw:`, err instanceof Error ? err.message : err);
            return false;
          },
        )
      : Promise.resolve<boolean | undefined>(undefined),
    info.to
      ? send.email({ ...base, to: info.to }).then(
          (sent) => {
            if (!sent.ok) console.error(`[${label}] appointment ${id}: the email failed: ${sent.error}`);
            return sent.ok;
          },
          (err) => {
            console.error(`[${label}] appointment ${id}: the email threw:`, err instanceof Error ? err.message : err);
            return false;
          },
        )
      : Promise.resolve<boolean | undefined>(undefined),
  ]);
  const tail = messengerSent === undefined ? {} : { messengerSent };
  if (emailRes === undefined) return { emailSent: false, emailSkipped: 'no_email', ...tail };
  return { emailSent: emailRes, ...tail };
}

const CONFIRM_SENDERS = { email: sendConfirmation, messenger: sendMessengerConfirmation };

// ---------------------------------------------------------------------------
// POST /api/appointments/[id]/decline (Rule 12): pending -> declined. Patient notice after commit.
// ---------------------------------------------------------------------------

export async function declineAppointment(id: number, opts: { now?: Now; defer?: Defer } = {}): Promise<void> {
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
  invalidatePendingCount();
  await runNotice(opts.defer, () => notifyPatient('decline', id, info, { email: sendDeclineEmail, messenger: sendMessengerDecline }));
}

// ---------------------------------------------------------------------------
// POST /api/appointments/[id]/status (Rule 7 via canTransition, Table 3.21)
// ---------------------------------------------------------------------------

export async function setAppointmentStatus(
  id: number,
  to: 'attended' | 'cancelled' | 'no-show',
  opts: { now?: Now; defer?: Defer } = {},
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
    // A cancel after the start time is a record correction, not news for the patient (QA finding L1).
    return { info: to === 'cancelled' && !startPassed ? await noticeInfo(conn, id) : null };
  });
  invalidatePendingCount();
  // Cancelled by staff before the start: tell the patient (attended / no-show / late cancels are record-keeping, no notice).
  if (info) await runNotice(opts.defer, () => notifyPatient('cancel', id, info, { email: sendCancellationEmail, messenger: sendMessengerCancellation }));
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
  opts: { now?: Now; defer?: Defer } = {},
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

  invalidatePendingCount();
  // Tell the patient after the commit (a retry finds the old row cancelled and throws above, so
  // the notice is never sent twice). The new row has reminder_sent_at NULL, so its day-before
  // reminder still goes out.
  // With `defer` the notice goes out after the response, so the result carries no notice fields.
  const notice = await runNotice(opts.defer, () =>
    notifyPatient('reschedule', moved.newId, moved.info, {
      email: (a) => sendRescheduleEmail({ ...a, oldDate: moved.oldDate, oldStart: moved.oldStart }),
      messenger: (psid, a) => sendMessengerReschedule(psid, { ...a, oldDate: moved.oldDate, oldStartTime: moved.oldStart }),
    }),
  );
  return { ok: true as const, newId: moved.newId, ...(notice ?? {}) };
}

// ---------------------------------------------------------------------------
// Patient reschedule REQUEST (web link /book/manage/<token> and the Messenger bot)
// ---------------------------------------------------------------------------

export const PATIENT_RESCHEDULE_WINDOW_DAYS = 60;

const NOT_CHANGEABLE = 'This appointment can no longer be changed online. Please contact the clinic.';

/** 1-based place in line: pending reschedule requests for an overlapping time with this dentist, oldest first. */
export async function queuePosition(conn: Queryable, requestId: number): Promise<number> {
  const r = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointments o JOIN appointments me ON me.appointment_id = ?
      WHERE o.status = 'pending' AND o.rescheduled_from_id IS NOT NULL
        AND o.dentist_id = me.dentist_id AND o.appointment_date = me.appointment_date
        AND o.start_time < me.end_time AND o.end_time > me.start_time
        AND (o.requested_at < me.requested_at OR (o.requested_at = me.requested_at AND o.appointment_id <= me.appointment_id))`,
    [requestId],
    conn,
  );
  return Math.max(1, Number(r?.n ?? 1));
}

/** The patient's open request to move this appointment, if any. */
export async function pendingRescheduleFor(appointmentId: number): Promise<{ id: number; date: string; start: string; position: number } | null> {
  const r = await queryOne<{ appointment_id: number; appointment_date: string; start_time: string }>(
    "SELECT appointment_id, appointment_date, start_time FROM appointments WHERE rescheduled_from_id = ? AND status = 'pending' ORDER BY appointment_id DESC LIMIT 1",
    [appointmentId],
  );
  if (!r) return null;
  return { id: r.appointment_id, date: r.appointment_date, start: toHHMM(r.start_time), position: await queuePosition(getPool(), r.appointment_id) };
}

/**
 * The patient asks to move their own `scheduled` appointment to another open time with the same
 * dentist and service. Nothing moves yet: a `pending` row (rescheduled_from_id = the original) goes
 * to the clinic's Requests queue and the original stays scheduled. Requests for the same time do not
 * block each other; they line up by requested_at and the first one staff approve wins (the rest are
 * declined automatically, see confirmAppointment). A new request replaces the patient's earlier one.
 * 409 slot_unavailable { slots } when a scheduled appointment (or a new booking request) holds the time.
 */
export async function requestPatientReschedule(
  id: number,
  input: { date: string; start: string },
  opts: { now?: Now; defer?: Defer } = {},
): Promise<{ ok: true; requestId: number; date: string; start: string; position: number }> {
  const now = opts.now ?? nowManila();
  const pre = await peek(id);
  if (pre.status !== 'scheduled') throw invalidTransition(pre.status, NOT_CHANGEABLE);
  if (hasStarted(pre.appointment_date, pre.start_time, now)) {
    throw invalidTransition(pre.status, 'This appointment has already started. Please contact the clinic.');
  }
  const service = await getServiceOrThrow(pre.service_id);
  const end = endTimeOrThrow(input.start, service.duration_minutes);

  let made: { requestId: number; position: number; info: NoticeInfo; currentDate: string; currentStart: string };
  try {
    made = await transaction(async (conn) => {
      if (!(await lockDentist(conn, pre.dentist_id))) throw notFound('Dentist');
      const old = await loadForUpdate(conn, id);
      if (old.status !== 'scheduled' || old.dentist_id !== pre.dentist_id) throw invalidTransition(old.status, NOT_CHANGEABLE);
      const check = await checkBookable(conn, { date: input.date, start: input.start, end, dentistId: old.dentist_id, chairId: null, appointmentId: id }, now);
      if (!check.ok) {
        if (check.reason === 'overlap') throw new ServiceError(409, 'slot_unavailable', 'That time is no longer open. Please pick another time.');
        throw conflictError(check, old.dentist_id);
      }
      // One open request per appointment: an earlier one is withdrawn.
      await execute("UPDATE appointments SET status = 'declined' WHERE rescheduled_from_id = ? AND status = 'pending'", [id], conn);
      const requestId = await insertAppointment(conn, {
        patientId: old.patient_id,
        dentistId: old.dentist_id,
        serviceId: old.service_id,
        chairId: null,
        date: input.date,
        start: input.start,
        end,
        status: 'pending',
        channel: old.channel,
        patientNote: old.patient_note,
        dentistNote: old.dentist_note,
        rescheduledFromId: id,
        followUpOfId: old.follow_up_of_id,
      });
      return {
        requestId,
        position: await queuePosition(conn, requestId),
        info: await noticeInfo(conn, requestId),
        currentDate: old.appointment_date,
        currentStart: toHHMM(old.start_time),
      };
    });
  } catch (err) {
    if (err instanceof ServiceError && err.code === 'slot_unavailable') {
      err.extra.slots = await freshSlots({ date: input.date, serviceId: pre.service_id, dentistId: pre.dentist_id }, now);
    }
    throw err;
  }

  invalidatePendingCount();
  const extra = { currentDate: made.currentDate, position: made.position };
  await runNotice(opts.defer, () =>
    notifyPatient('reschedule-request', made.requestId, made.info, {
      email: (a) => sendRescheduleRequestEmail({ ...a, ...extra, currentStart: made.currentStart, appointmentId: undefined }),
      messenger: (psid, a) => sendMessengerRescheduleRequest(psid, { ...a, ...extra, currentStartTime: made.currentStart, appointmentId: undefined }),
    }),
  );
  return { ok: true as const, requestId: made.requestId, date: input.date, start: input.start, position: made.position };
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
