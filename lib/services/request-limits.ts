/**
 * DB-backed abuse caps for public online requests (SECURITY-REVIEW H1). They use only the existing
 * `appointments` table, so they hold across Vercel instances without an 8th table:
 *   - REQUEST_LIMIT_PER_CONTACT (default 3): pending online requests dated today or later per
 *     patient (= per normalized contact number). A brand-new number can never hit it.
 *   - REQUEST_LIMIT_PER_HOUR (default 60) / REQUEST_LIMIT_PER_DAY (default 300): online requests
 *     created clinic-wide in the last hour / 24 hours.
 * 0 disables a cap. Call inside the booking transaction; the counts are soft under heavy
 * concurrency (a few parallel requests can each see count = cap - 1), which is fine for a brake.
 */
import type { Queryable } from '../db';
import { queryOne } from '../db';
import { envInt } from './env-int';
import { ServiceError } from './errors';

export const requestLimitPerContact = () => envInt('REQUEST_LIMIT_PER_CONTACT', 3);
export const requestLimitPerHour = () => envInt('REQUEST_LIMIT_PER_HOUR', 60);
export const requestLimitPerDay = () => envInt('REQUEST_LIMIT_PER_DAY', 300);

const callClinic = () => {
  const phone = process.env.CLINIC_PHONE?.trim();
  return phone ? `call the clinic at ${phone}` : 'call the clinic';
};

export const tooManyPendingMessage = () =>
  `You already have requests waiting for the clinic to review. Please wait for the clinic to reply before sending another, or ${callClinic()}.`;
export const clinicBusyMessage = () =>
  `The clinic is receiving a lot of online requests right now. Please try again later, or ${callClinic()}.`;
export const tooManyFromDeviceMessage = () =>
  `You've sent several requests in a short time. Please wait a few minutes and try again, or ${callClinic()}.`;

export const tooManyRequests = (message: string, extra: Record<string, unknown> = {}) =>
  new ServiceError(429, 'too_many_requests', message, extra);

/** Clinic-wide caps on online requests created in the last hour / day. */
export async function assertGlobalRequestCaps(conn: Queryable): Promise<void> {
  const perHour = requestLimitPerHour();
  const perDay = requestLimitPerDay();
  if (perHour <= 0 && perDay <= 0) return;
  const r = await queryOne<{ lastHour: number | string | null; lastDay: number | string | null }>(
    `SELECT SUM(requested_at >= NOW() - INTERVAL 1 HOUR) AS lastHour, COUNT(*) AS lastDay
       FROM appointments
      WHERE channel = 'online' AND requested_at >= NOW() - INTERVAL 1 DAY`,
    [],
    conn,
  );
  const lastHour = Number(r?.lastHour ?? 0);
  const lastDay = Number(r?.lastDay ?? 0);
  if ((perHour > 0 && lastHour >= perHour) || (perDay > 0 && lastDay >= perDay)) {
    throw tooManyRequests(clinicBusyMessage());
  }
}

/** Per-contact cap: pending online requests (today or later) already on this patient. */
export async function assertContactRequestCap(conn: Queryable, patientId: number): Promise<void> {
  const max = requestLimitPerContact();
  if (max <= 0) return;
  const r = await queryOne<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM appointments
      WHERE patient_id = ? AND channel = 'online' AND status = 'pending' AND appointment_date >= CURDATE()`,
    [patientId],
    conn,
  );
  if (Number(r?.n ?? 0) >= max) throw tooManyRequests(tooManyPendingMessage());
}
