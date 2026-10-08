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

// ---------------------------------------------------------------------------
// Read-model DTOs returned by lib/queries/* (Backend-B). camelCase, times 'HH:MM',
// dates 'YYYY-MM-DD', datetimes 'YYYY-MM-DD HH:MM:SS' (Manila). All computed live (NF04).
// ---------------------------------------------------------------------------

/** One appointment block on the dashboard grid. */
export type ApptBlock = {
  appointmentId: number;
  start: string;
  end: string;
  status: AppointmentStatus;
  channel: Channel;
  patientName: string;
  serviceName: string;
  dentistName: string;
  chairName: string | null;
};

export type DentistDay = {
  dentistId: number;
  dentistName: string;
  /** Working hours that weekday; null = "Not working". */
  hours: TimeRange | null;
  appointments: ApptBlock[];
  /** Rule 5 open starts for the shortest service (see CONTRACTS). */
  openSlots: TimeRange[];
};

export type ChairDay = { chairId: number; chairName: string; appointments: ApptBlock[] };

export type DaySchedule = {
  date: string;
  /** 0 = Sunday ... 6 = Saturday */
  dayOfWeek: number;
  dentists: DentistDay[];
  chairs: ChairDay[];
  /** Pending requests have no chair yet; they appear here (and in their dentist's column). */
  unassigned: ApptBlock[];
  /** Earliest start / latest end of that day's hours and appointments; null = nothing that day. */
  gridStart: string | null;
  gridEnd: string | null;
  /** Duration (minutes) used for openSlots: the shortest service. */
  slotDurationMinutes: number;
};

export type DashboardSummary = { todayTotal: number; pendingCount: number; tomorrowCount: number };

export type PendingRequest = {
  appointmentId: number;
  patientId: number;
  patientName: string;
  contactNumber: string;
  email: string | null;
  serviceId: number;
  serviceName: string;
  durationMinutes: number;
  dentistId: number;
  dentistName: string;
  date: string;
  start: string;
  end: string;
  patientNote: string | null;
  requestedAt: string;
  /** Start time already reached: can no longer be confirmed (Rule 3), only declined. */
  startPassed: boolean;
};

export type AppointmentDetailView = {
  appointmentId: number;
  patient: { id: number; name: string; contact: string; email: string | null; birthdate: string };
  dentist: { id: number; name: string };
  service: { id: number; name: string; durationMinutes: number };
  chair: { id: number; name: string } | null;
  status: AppointmentStatus;
  channel: Channel;
  date: string;
  start: string;
  end: string;
  requestedAt: string;
  patientNote: string | null;
  dentistNote: string | null;
  reminderSentAt: string | null;
  /** This row replaced that one (Rule 11). */
  rescheduledFromId: number | null;
  /** The row that replaced this one (whose rescheduled_from_id = this id), if any. */
  replacedById: number | null;
  /** Statuses reachable now (Rule 7, Manila now). 'scheduled' = Confirm, 'declined' = Decline. */
  allowedTransitions: AppointmentStatus[];
  startPassed: boolean;
};

export type PatientListItem = {
  patientId: number;
  fullName: string;
  contactNumber: string;
  email: string | null;
  birthdate: string;
  appointmentCount: number;
  lastVisitDate: string | null;
};

export type PatientProfile = {
  patientId: number;
  fullName: string;
  contactNumber: string;
  email: string | null;
  birthdate: string;
};

export type PatientHistoryItem = {
  appointmentId: number;
  date: string;
  start: string;
  end: string;
  serviceName: string;
  dentistName: string;
  chairName: string | null;
  status: AppointmentStatus;
  channel: Channel;
  dentistNote: string | null;
  patientNote: string | null;
  rescheduledFromId: number | null;
  requestedAt: string;
};

export type ScheduleItem = { scheduleId: number; dayOfWeek: number; startTime: string; endTime: string };

export type DentistWithSchedules = {
  dentistId: number;
  dentistName: string;
  /** Rows sorted by dayOfWeek (only working days). */
  schedules: ScheduleItem[];
  /** Index 0 = Sunday ... 6 = Saturday; null = off. Convenient for the weekly grid. */
  week: (TimeRange | null)[];
  appointmentCount: number;
};

export type ServiceItem = { serviceId: number; serviceName: string; durationMinutes: number; appointmentCount: number };
export type ChairItem = { chairId: number; chairName: string; appointmentCount: number };

export type ReportCounts = {
  attended: number;
  /** Excludes cancellations that were reschedules (another row's rescheduled_from_id points to them). */
  cancelled: number;
  noShow: number;
  /** attended + cancelled + noShow */
  total: number;
  /** noShow / (attended + noShow); null when that is 0. Format with formatRate(). */
  noShowRate: number | null;
};

export type MonthlyReport = {
  month: string;
  totals: ReportCounts;
  byDentist: (ReportCounts & { dentistId: number; dentistName: string })[];
  byService: (ReportCounts & { serviceId: number; serviceName: string })[];
};

export type RepeatNoShow = {
  patientId: number;
  fullName: string;
  contactNumber: string;
  noShowCount: number;
  lastNoShowDate: string;
};
