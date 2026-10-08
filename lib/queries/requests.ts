/** Pending online requests queue (/requests, FR2). Oldest request first. */
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
};

export async function listPendingRequests(now: { date: string; time: string } = nowManila()): Promise<PendingRequest[]> {
  const rows = await query<Row>(
    `SELECT a.appointment_id, p.patient_id, p.full_name, p.contact_number, p.email,
            s.service_id, s.service_name, s.duration_minutes, d.dentist_id, d.dentist_name,
            a.appointment_date, a.start_time, a.end_time, a.patient_note, a.requested_at
     FROM appointments a
     JOIN patients p ON p.patient_id = a.patient_id
     JOIN services s ON s.service_id = a.service_id
     JOIN dentists d ON d.dentist_id = a.dentist_id
     WHERE a.status = 'pending'
     ORDER BY a.requested_at, a.appointment_id`,
  );
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
  }));
}

export async function countPending(): Promise<number> {
  const r = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM appointments WHERE status = 'pending'");
  return Number(r?.n ?? 0);
}
