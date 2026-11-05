/** Appointment detail page read (/appointments/[id]). */
import { query, queryOne } from '../db';
import { allowedTransitions, hasStarted } from '../rules';
import { nowManila, toHHMM } from '../time';
import type { AppointmentDetailView, AppointmentListItem, AppointmentRow, AppointmentStatus, Channel } from '../types';
import { contactSearchDigits, likeEscape } from './patients';

type Row = AppointmentRow & {
  full_name: string;
  contact_number: string;
  patient_email: string | null;
  birthdate: string;
  dentist_name: string;
  service_name: string;
  duration_minutes: number;
  chair_name: string | null;
  replaced_by_id: number | null;
  follow_up_ids: string | null;
};

export async function getAppointmentDetail(
  id: number,
  now: { date: string; time: string } = nowManila(),
): Promise<AppointmentDetailView | null> {
  const r = await queryOne<Row>(
    `SELECT a.*, p.full_name, p.contact_number, p.email AS patient_email, p.birthdate,
            d.dentist_name, s.service_name, s.duration_minutes, c.chair_name,
            (SELECT MIN(n.appointment_id) FROM appointments n WHERE n.rescheduled_from_id = a.appointment_id) AS replaced_by_id,
            (SELECT GROUP_CONCAT(f.appointment_id ORDER BY f.appointment_id) FROM appointments f
              WHERE f.follow_up_of_id = a.appointment_id AND f.status <> 'cancelled') AS follow_up_ids
     FROM appointments a
     JOIN patients p ON p.patient_id = a.patient_id
     JOIN dentists d ON d.dentist_id = a.dentist_id
     JOIN services s ON s.service_id = a.service_id
     LEFT JOIN chairs c ON c.chair_id = a.chair_id
     WHERE a.appointment_id = ?`,
    [id],
  );
  if (!r) return null;
  const startPassed = hasStarted(r.appointment_date, r.start_time, now);
  return {
    appointmentId: r.appointment_id,
    patient: { id: r.patient_id, name: r.full_name, contact: r.contact_number, email: r.patient_email, birthdate: r.birthdate },
    dentist: { id: r.dentist_id, name: r.dentist_name },
    service: { id: r.service_id, name: r.service_name, durationMinutes: Number(r.duration_minutes) },
    chair: r.chair_id === null ? null : { id: r.chair_id, name: r.chair_name ?? '' },
    status: r.status,
    channel: r.channel,
    date: r.appointment_date,
    start: toHHMM(r.start_time),
    end: toHHMM(r.end_time),
    requestedAt: r.requested_at,
    patientNote: r.patient_note,
    dentistNote: r.dentist_note,
    reminderSentAt: r.reminder_sent_at,
    rescheduledFromId: r.rescheduled_from_id,
    replacedById: r.replaced_by_id === null ? null : Number(r.replaced_by_id),
    followUpOfId: r.follow_up_of_id,
    followUpIds: r.follow_up_ids ? String(r.follow_up_ids).split(',').map(Number) : [],
    allowedTransitions: allowedTransitions(r.status, { startPassed }),
    startPassed,
  };
}

export type AppointmentFilters = {
  channel?: Channel;
  status?: AppointmentStatus;
  from?: string; // 'YYYY-MM-DD', appointment date >= from
  to?: string; // 'YYYY-MM-DD', appointment date <= to
  q?: string; // patient name, or part of the contact number
};

type ListRow = {
  appointment_id: number;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  channel: Channel;
  patient_id: number;
  full_name: string;
  contact_number: string;
  dentist_name: string;
  service_name: string;
  requested_at: string;
};

/**
 * Every appointment from every channel in one list (SOP 1: centralized bookings), newest date
 * first. All filters are optional and bound as parameters; `page` is 1-based.
 */
export async function listAppointments(
  filters: AppointmentFilters = {},
  page = 1,
  pageSize = 50,
): Promise<{ rows: AppointmentListItem[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.channel) {
    where.push('a.channel = ?');
    params.push(filters.channel);
  }
  if (filters.status) {
    where.push('a.status = ?');
    params.push(filters.status);
  }
  if (filters.from) {
    where.push('a.appointment_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('a.appointment_date <= ?');
    params.push(filters.to);
  }
  const text = (filters.q ?? '').trim();
  if (text) {
    const digits = contactSearchDigits(text);
    const parts = ["p.full_name LIKE ? ESCAPE '\\\\'"];
    params.push(`%${likeEscape(text)}%`);
    if (digits) {
      parts.push("p.contact_number LIKE ? ESCAPE '\\\\'");
      params.push(`%${likeEscape(digits)}%`);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const size = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const offset = (Math.max(1, Math.floor(page)) - 1) * size;
  const from = `FROM appointments a
     JOIN patients p ON p.patient_id = a.patient_id
     JOIN dentists d ON d.dentist_id = a.dentist_id
     JOIN services s ON s.service_id = a.service_id
     ${whereSql}`;

  const [countRow, rows] = await Promise.all([
    queryOne<{ n: number | string }>(`SELECT COUNT(*) AS n ${from}`, params),
    query<ListRow>(
      `SELECT a.appointment_id, a.appointment_date, a.start_time, a.end_time, a.status, a.channel, a.requested_at,
              p.patient_id, p.full_name, p.contact_number, d.dentist_name, s.service_name
       ${from}
       ORDER BY a.appointment_date DESC, a.start_time DESC, a.appointment_id DESC
       LIMIT ${size} OFFSET ${offset}`,
      params,
    ),
  ]);
  return {
    total: Number(countRow?.n ?? 0),
    rows: rows.map((r) => ({
      appointmentId: r.appointment_id,
      date: r.appointment_date,
      start: toHHMM(r.start_time),
      end: toHHMM(r.end_time),
      status: r.status,
      channel: r.channel,
      patientId: r.patient_id,
      patientName: r.full_name,
      contactNumber: r.contact_number,
      dentistName: r.dentist_name,
      serviceName: r.service_name,
      requestedAt: r.requested_at,
    })),
  };
}
