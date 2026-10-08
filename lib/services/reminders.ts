/**
 * FR13 / Rule 8: day-before reminders, run by GET /api/cron/reminders (Vercel Cron, 0 1 * * * UTC).
 *
 * Selection: appointment_date = tomorrow (Manila) AND status = 'scheduled'
 *            AND reminder_sent_at IS NULL AND the patient has an email.
 * Sends one at a time; sets reminder_sent_at = NOW() only after a successful send, with a
 * conditional UPDATE (… AND reminder_sent_at IS NULL) so re-runs record nothing twice.
 * A MySQL advisory lock (GET_LOCK) keeps two overlapping runs from emailing the same patient.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { execute, getPool, query, type PoolConnection } from '../db';
import { sendReminder } from '../mail';
import { nowManila, toHHMM, addDays } from '../time';

export const REMINDER_SELECTION_SQL = `
SELECT a.appointment_id, a.appointment_date, a.start_time,
       p.full_name, p.email, d.dentist_name, s.service_name
FROM appointments a
JOIN patients p ON p.patient_id = a.patient_id
JOIN dentists d ON d.dentist_id = a.dentist_id
JOIN services s ON s.service_id = a.service_id
WHERE a.appointment_date = :tomorrow
  AND a.status = 'scheduled'
  AND a.reminder_sent_at IS NULL
  AND p.email IS NOT NULL AND p.email <> ''
ORDER BY a.start_time, a.appointment_id`;

const LOCK_NAME = 'dental_reminders_cron';

export type ReminderRunResult = { sent: number; failed: number; date: string; skipped?: 'already_running' };

export async function runReminders(opts: { now?: { date: string; time: string } } = {}): Promise<ReminderRunResult> {
  const tomorrow = addDays((opts.now ?? nowManila()).date, 1);
  let lockConn: PoolConnection | null = null;
  try {
    lockConn = await getPool().getConnection();
    const [rows] = await lockConn.query(`SELECT GET_LOCK('${LOCK_NAME}', 0) AS got`);
    if (Number((rows as { got: number | null }[])[0]?.got) !== 1) {
      return { sent: 0, failed: 0, date: tomorrow, skipped: 'already_running' };
    }

    const due = await query<{
      appointment_id: number;
      appointment_date: string;
      start_time: string;
      full_name: string;
      email: string;
      dentist_name: string;
      service_name: string;
    }>(REMINDER_SELECTION_SQL, { tomorrow });

    let sent = 0;
    let failed = 0;
    for (const a of due) {
      // Still due? (staff may have cancelled/rescheduled it while earlier emails were sending)
      const still = await query(
        "SELECT 1 AS x FROM appointments WHERE appointment_id = ? AND status = 'scheduled' AND reminder_sent_at IS NULL",
        [a.appointment_id],
      );
      if (still.length === 0) continue;
      const res = await sendReminder({
        to: a.email,
        patientName: a.full_name,
        date: a.appointment_date,
        startTime: toHHMM(a.start_time),
        dentist: a.dentist_name,
        service: a.service_name,
      });
      if (!res.ok) {
        failed++;
        console.error(`[cron:reminders] appointment ${a.appointment_id}: ${res.error}`);
        continue;
      }
      await execute(
        "UPDATE appointments SET reminder_sent_at = NOW() WHERE appointment_id = ? AND reminder_sent_at IS NULL AND status = 'scheduled'",
        [a.appointment_id],
      );
      sent++;
    }
    return { sent, failed, date: tomorrow };
  } finally {
    if (lockConn) {
      try {
        await lockConn.query(`SELECT RELEASE_LOCK('${LOCK_NAME}')`);
      } catch {
        // connection gone; MySQL releases the lock with it
      }
      lockConn.release();
    }
  }
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Constant-time check of `Authorization: Bearer <secret>` (hash both sides so lengths always match). */
export function cronAuthorized(header: string | null, secret: string): boolean {
  if (!secret || !header || !header.startsWith('Bearer ')) return false;
  const token = header.slice('Bearer '.length);
  return timingSafeEqual(digest(token), digest(secret));
}
