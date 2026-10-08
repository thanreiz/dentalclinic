/** Patient records (FR9, FR10): search, profile, Listing 3.4-style history. */
import { query, queryOne, type Queryable } from '../db';
import { toHHMM } from '../time';
import type { AppointmentStatus, Channel, PatientHistoryItem, PatientListItem, PatientProfile, PatientRow } from '../types';

/** Escape LIKE wildcards so user text matches literally. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Digits of a (partial) contact number typed in a search box, normalized like FR9
 * ('+63 917-555' -> '0917555'). Null when the text has fewer than 3 digits.
 */
export function contactSearchDigits(q: string): string | null {
  let s = q.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('+63')) s = '0' + s.slice(3);
  if (!/^\+?\d+$/.test(s)) return null;
  s = s.replace(/\D/g, '');
  return s.length >= 3 ? s : null;
}

/**
 * Search by name (LIKE, case-insensitive) or by normalized contact number (partial match).
 * Empty `q` lists everyone. Sorted by name. `page` is 1-based.
 */
export async function searchPatients(
  q: string,
  page = 1,
  pageSize = 20,
): Promise<{ rows: PatientListItem[]; total: number }> {
  const text = (q ?? '').trim();
  const digits = contactSearchDigits(text);
  const where: string[] = [];
  const params: unknown[] = [];
  if (text) {
    where.push("p.full_name LIKE ? ESCAPE '\\\\'");
    params.push(`%${likeEscape(text)}%`);
    if (digits) {
      where.push("p.contact_number LIKE ? ESCAPE '\\\\'");
      params.push(`%${likeEscape(digits)}%`);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' OR ')}` : '';
  const size = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const offset = (Math.max(1, Math.floor(page)) - 1) * size;

  const [countRow, rows] = await Promise.all([
    queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM patients p ${whereSql}`, params),
    query<PatientRow & { appointment_count: number; last_visit_date: string | null }>(
      `SELECT p.patient_id, p.full_name, p.contact_number, p.email, p.birthdate,
              (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.patient_id) AS appointment_count,
              (SELECT MAX(a.appointment_date) FROM appointments a
                WHERE a.patient_id = p.patient_id AND a.status = 'attended') AS last_visit_date
       FROM patients p
       ${whereSql}
       ORDER BY p.full_name, p.patient_id
       LIMIT ${size} OFFSET ${offset}`,
      params,
    ),
  ]);
  return {
    total: Number(countRow?.n ?? 0),
    rows: rows.map((r) => ({
      patientId: r.patient_id,
      fullName: r.full_name,
      contactNumber: r.contact_number,
      email: r.email,
      birthdate: r.birthdate,
      appointmentCount: Number(r.appointment_count),
      lastVisitDate: r.last_visit_date,
    })),
  };
}

export async function getPatient(id: number, conn?: Queryable): Promise<PatientProfile | null> {
  const r = await queryOne<PatientRow>(
    'SELECT patient_id, full_name, contact_number, email, birthdate FROM patients WHERE patient_id = ?',
    [id],
    conn,
  );
  return r
    ? { patientId: r.patient_id, fullName: r.full_name, contactNumber: r.contact_number, email: r.email, birthdate: r.birthdate }
    : null;
}

/** Listing 3.4-style patient history: every appointment with service, dentist, chair, notes. Newest first. */
export const PATIENT_HISTORY_SQL = `
SELECT a.appointment_id, a.appointment_date, a.start_time, a.end_time,
       s.service_name, d.dentist_name, c.chair_name,
       a.status, a.channel, a.dentist_note, a.patient_note,
       a.rescheduled_from_id, a.requested_at
FROM appointments a
JOIN services s ON s.service_id = a.service_id
JOIN dentists d ON d.dentist_id = a.dentist_id
LEFT JOIN chairs c ON c.chair_id = a.chair_id
WHERE a.patient_id = :patient_id
ORDER BY a.appointment_date DESC, a.start_time DESC, a.appointment_id DESC`;

export async function getPatientHistory(id: number): Promise<PatientHistoryItem[]> {
  const rows = await query<{
    appointment_id: number;
    appointment_date: string;
    start_time: string;
    end_time: string;
    service_name: string;
    dentist_name: string;
    chair_name: string | null;
    status: AppointmentStatus;
    channel: Channel;
    dentist_note: string | null;
    patient_note: string | null;
    rescheduled_from_id: number | null;
    requested_at: string;
  }>(PATIENT_HISTORY_SQL, { patient_id: id });
  return rows.map((r) => ({
    appointmentId: r.appointment_id,
    date: r.appointment_date,
    start: toHHMM(r.start_time),
    end: toHHMM(r.end_time),
    serviceName: r.service_name,
    dentistName: r.dentist_name,
    chairName: r.chair_name,
    status: r.status,
    channel: r.channel,
    dentistNote: r.dentist_note,
    patientNote: r.patient_note,
    rescheduledFromId: r.rescheduled_from_id,
    requestedAt: r.requested_at,
  }));
}
