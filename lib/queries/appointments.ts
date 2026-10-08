/** Appointment detail page read (/appointments/[id]). */
import { queryOne } from '../db';
import { allowedTransitions, hasStarted } from '../rules';
import { nowManila, toHHMM } from '../time';
import type { AppointmentDetailView, AppointmentRow } from '../types';

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
};

export async function getAppointmentDetail(
  id: number,
  now: { date: string; time: string } = nowManila(),
): Promise<AppointmentDetailView | null> {
  const r = await queryOne<Row>(
    `SELECT a.*, p.full_name, p.contact_number, p.email AS patient_email, p.birthdate,
            d.dentist_name, s.service_name, s.duration_minutes, c.chair_name,
            (SELECT MIN(n.appointment_id) FROM appointments n WHERE n.rescheduled_from_id = a.appointment_id) AS replaced_by_id
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
    allowedTransitions: allowedTransitions(r.status, { startPassed }),
    startPassed,
  };
}
