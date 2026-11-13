/** Pending online requests queue (/requests, FR2). Oldest request first. */
import { revalidateTag, unstable_cache } from 'next/cache';
import { query, queryOne } from '../db';
import { hasStarted } from '../rules';
import { nowManila, toHHMM } from '../time';
import type { PendingRequest } from '../types';

type Row = {
  appointment_id: number;
  patient_id: number;
  full_name: string;
  contact_number: string;
  email: string | null;
  service_id: number;
  service_name: string;
  duration_minutes: number;
  dentist_id: number;
  dentist_name: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  patient_note: string | null;
  requested_at: string;
  rescheduled_from_id: number | null;
  orig_date: string | null;
  orig_start: string | null;
};

export async function listPendingRequests(now: { date: string; time: string } = nowManila()): Promise<PendingRequest[]> {
  const rows = await query<Row>(
    `SELECT a.appointment_id, p.patient_id, p.full_name, p.contact_number, p.email,
            s.service_id, s.service_name, s.duration_minutes, d.dentist_id, d.dentist_name,
            a.appointment_date, a.start_time, a.end_time, a.patient_note, a.requested_at,
            a.rescheduled_from_id, o.appointment_date AS orig_date, o.start_time AS orig_start
     FROM appointments a
     JOIN patients p ON p.patient_id = a.patient_id
     JOIN services s ON s.service_id = a.service_id
     JOIN dentists d ON d.dentist_id = a.dentist_id
     LEFT JOIN appointments o ON o.appointment_id = a.rescheduled_from_id
     WHERE a.status = 'pending'
     ORDER BY a.requested_at, a.appointment_id`,
  );
  // Rows arrive ordered by requested_at, appointment_id: the queue order for reschedule requests.
  const resched = rows.filter((r) => r.rescheduled_from_id != null);
  const queuePos = (r: Row): number => {
    const s = toHHMM(r.start_time);
    const e = toHHMM(r.end_time);
    let n = 0;
    for (const o of resched) {
      if (o.dentist_id === r.dentist_id && o.appointment_date === r.appointment_date && s < toHHMM(o.end_time) && e > toHHMM(o.start_time)) n++;
      if (o.appointment_id === r.appointment_id) break;
    }
    return n;
  };
  return rows.map((r) => ({
    appointmentId: r.appointment_id,
    patientId: r.patient_id,
    patientName: r.full_name,
    contactNumber: r.contact_number,
    email: r.email,
    serviceId: r.service_id,
    serviceName: r.service_name,
    durationMinutes: Number(r.duration_minutes),
    dentistId: r.dentist_id,
    dentistName: r.dentist_name,
    date: r.appointment_date,
    start: toHHMM(r.start_time),
    end: toHHMM(r.end_time),
    patientNote: r.patient_note,
    requestedAt: r.requested_at,
    startPassed: hasStarted(r.appointment_date, r.start_time, now),
    rescheduleOf:
      r.rescheduled_from_id != null && r.orig_date != null && r.orig_start != null
        ? { appointmentId: r.rescheduled_from_id, date: r.orig_date, start: toHHMM(r.orig_start) }
        : null,
    queuePosition: r.rescheduled_from_id != null ? queuePos(r) : null,
  }));
}

/** Uncached count. Use this inside transactions and tests; never the cached badge value. */
export async function countPending(): Promise<number> {
  const r = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM appointments WHERE status = 'pending'");
  return Number(r?.n ?? 0);
}

export const PENDING_TAG = 'pending';

/**
 * Sidebar badge count, cached for 15 s (tag `pending`). The layout runs on every staff navigation, so
 * this keeps it off the DB; writes call invalidatePendingCount() so the badge updates at once.
 */
export const countPendingCached = unstable_cache(countPending, ['pending-count'], { revalidate: 15, tags: [PENDING_TAG] });

/**
 * Call AFTER a request is created, confirmed, declined, cancelled or rescheduled has committed.
 * Outside a Next request (vitest, scripts) there is no cache to bust, so the throw is swallowed.
 */
export function invalidatePendingCount(): void {
  try {
    revalidateTag(PENDING_TAG);
  } catch {
    /* no Next runtime */
  }
}
