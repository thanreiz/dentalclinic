/**
 * Patient "manage your appointment" link (panel feedback: let the patient reschedule, not only staff).
 * Patients have no accounts, so the link itself is the key: `<id>-<YYYYMMDD>-<hmac>`, signed with
 * SESSION_SECRET under a separate "manage:" label so it can never pass as a staff session.
 * The date is the appointment date; the link stops working after that day. A reschedule creates a
 * new appointment row, so the old link dies with the old (cancelled) row and the new notice
 * carries a fresh link.
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { compareDates, todayManila } from './time';

function sign(payload: string): string {
  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters');
  return createHmac('sha256', secret).update(`manage:${payload}`).digest('base64url').slice(0, 32);
}

export function manageToken(appointmentId: number, date: string): string {
  const payload = `${appointmentId}-${date.replace(/-/g, '')}`;
  return `${payload}-${sign(payload)}`;
}

export function appBaseUrl(): string {
  return (process.env.APP_URL || 'https://molarandco.vercel.app').replace(/\/+$/, '');
}

export function manageUrl(appointmentId: number, date: string): string {
  return `${appBaseUrl()}/book/manage/${manageToken(appointmentId, date)}`;
}

/** Appointment id for a valid, unexpired token; null otherwise. */
export function verifyManageToken(token: string, today = todayManila()): number | null {
  const m = /^(\d{1,10})-(\d{8})-([A-Za-z0-9_-]{32})$/.exec(token);
  if (!m) return null;
  const payload = `${m[1]}-${m[2]}`;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  const a = Buffer.from(m[3]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const date = `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6)}`;
  if (compareDates(date, today) < 0) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
