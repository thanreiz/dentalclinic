/**
 * Shared row and DTO types. Row types mirror Listing 3.2 column names exactly (snake_case),
 * as returned by mysql2 with `dateStrings: true`:
 *   DATE -> 'YYYY-MM-DD', TIME -> 'HH:MM:SS', DATETIME -> 'YYYY-MM-DD HH:MM:SS'.
 * Use lib/time `toHHMM()` to turn TIME into 'HH:MM' for the UI/API.
 */
import type { AppointmentStatus, Channel } from './rules';

export type { AppointmentStatus, Channel };

export type UserRow = {
  user_id: number;
  name: string;
  email: string;
  password: string; // bcrypt hash; never send to the client
};

/** Safe user shape (no password). */
export type StaffUser = { userId: number; name: string; email: string };

export type PatientRow = {
  patient_id: number;
  full_name: string;
  contact_number: string; // digits only, e.g. '09175550101'
  email: string | null;
  birthdate: string; // 'YYYY-MM-DD'
};
export type Patient = PatientRow;

export type DentistRow = {
  dentist_id: number;
  dentist_name: string;
};
export type Dentist = DentistRow;

export type ScheduleRow = {
  schedule_id: number;
  dentist_id: number;
  day_of_week: number; // 0 = Sunday ... 6 = Saturday
  start_time: string; // 'HH:MM:SS'
  end_time: string;
};
export type Schedule = ScheduleRow;

export type ServiceRow = {
  service_id: number;
  service_name: string;
  duration_minutes: number;
};
export type Service = ServiceRow;

export type ChairRow = {
  chair_id: number;
  chair_name: string;
};
export type Chair = ChairRow;

export type AppointmentRow = {
  appointment_id: number;
  patient_id: number;
  dentist_id: number;
  service_id: number;
  chair_id: number | null; // NULL while pending
  appointment_date: string; // 'YYYY-MM-DD'
  start_time: string; // 'HH:MM:SS'
  end_time: string; // 'HH:MM:SS'
  status: AppointmentStatus;
  channel: Channel;
  requested_at: string; // 'YYYY-MM-DD HH:MM:SS' (Manila)
  patient_note: string | null;
  dentist_note: string | null;
  reminder_sent_at: string | null;
  rescheduled_from_id: number | null;
};
export type Appointment = AppointmentRow;

/** Appointment joined with display names (dashboard, detail, history). */
export type AppointmentDetail = AppointmentRow & {
  full_name: string;
  contact_number: string;
  patient_email: string | null;
  dentist_name: string;
  service_name: string;
  duration_minutes: number;
  chair_name: string | null;
};

/** An existing booking interval used by the pure rule functions ('HH:MM' or 'HH:MM:SS'). */
export type TimeRange = { start: string; end: string };

/** Working hours for one dentist on one weekday. */
export type WorkingHours = { start: string; end: string };

/** GET /api/slots item: `{ start: "09:00", end: "09:45", dentistIds: [1, 2] }`. */
export type Slot = { start: string; end: string; dentistIds: number[] };

/** Standard JSON error body for route handlers. */
export type ApiError = { error: string; message?: string; issues?: unknown; slots?: Slot[] };
