/**
 * Attendance reports (FR15, FR16), Listing 3.4-style SQL. Computed on request, never stored (NF04).
 *
 * Cancelled counts EXCLUDE cancellations that were reschedules: a cancelled row that some other
 * row's rescheduled_from_id points to is a move, not a lost visit (Rule 11).
 * No-show rate = no-show / (attended + no-show); null when the denominator is 0.
 */
import { query, queryOne } from '../db';
import { CHANNELS, noShowRate } from '../rules';
import { monthRange } from '../time';
import type { ChannelReport, MonthlyReport, RepeatNoShow, ReportCounts } from '../types';

const COUNT_COLUMNS = `
       SUM(a.status = 'attended') AS attended,
       SUM(a.status = 'cancelled' AND NOT EXISTS (
             SELECT 1 FROM appointments r WHERE r.rescheduled_from_id = a.appointment_id)) AS cancelled,
       SUM(a.status = 'no-show') AS no_show`;

const MONTH_FILTER = `
WHERE a.appointment_date BETWEEN :first_day AND :last_day
  AND a.status IN ('attended', 'cancelled', 'no-show')`;

/** Totals for the month. */
export const REPORT_TOTALS_SQL = `
SELECT ${COUNT_COLUMNS}
FROM appointments a
${MONTH_FILTER}`;

/** Per dentist. */
export const REPORT_BY_DENTIST_SQL = `
SELECT d.dentist_id, d.dentist_name, ${COUNT_COLUMNS}
FROM appointments a
JOIN dentists d ON d.dentist_id = a.dentist_id
${MONTH_FILTER}
GROUP BY d.dentist_id, d.dentist_name
ORDER BY d.dentist_id`;

/** Per service. */
export const REPORT_BY_SERVICE_SQL = `
SELECT s.service_id, s.service_name, ${COUNT_COLUMNS}
FROM appointments a
JOIN services s ON s.service_id = a.service_id
${MONTH_FILTER}
GROUP BY s.service_id, s.service_name
ORDER BY s.service_id`;

/**
 * Bookings per channel in the month (SOP 1). Declined requests and cancellations that were
 * reschedules are left out (a reschedule would count twice); everything else counts once.
 */
export const REPORT_BY_CHANNEL_SQL = `
SELECT a.channel, COUNT(*) AS bookings,
       SUM(a.status = 'attended') AS attended,
       SUM(a.status = 'no-show') AS no_show
FROM appointments a
WHERE a.appointment_date BETWEEN :first_day AND :last_day
  AND a.status <> 'declined'
  AND NOT (a.status = 'cancelled' AND EXISTS (
        SELECT 1 FROM appointments r WHERE r.rescheduled_from_id = a.appointment_id))
GROUP BY a.channel`;

/** FR16: patients whose no-show count reaches the threshold (all time). */
export const REPEAT_NO_SHOWS_SQL = `
SELECT p.patient_id, p.full_name, p.contact_number,
       COUNT(*) AS no_show_count, MAX(a.appointment_date) AS last_no_show_date
FROM appointments a
JOIN patients p ON p.patient_id = a.patient_id
WHERE a.status = 'no-show'
GROUP BY p.patient_id, p.full_name, p.contact_number
HAVING COUNT(*) >= :threshold
ORDER BY no_show_count DESC, p.full_name`;

type CountRow = { attended: number | string | null; cancelled: number | string | null; no_show: number | string | null };

function counts(r: CountRow | undefined): ReportCounts {
  const attended = Number(r?.attended ?? 0);
  const cancelled = Number(r?.cancelled ?? 0);
  const noShow = Number(r?.no_show ?? 0);
  return { attended, cancelled, noShow, total: attended + cancelled + noShow, noShowRate: noShowRate(attended, noShow) };
}

export async function getMonthlyReport(month: string): Promise<MonthlyReport> {
  const { first, last } = monthRange(month);
  const params = { first_day: first, last_day: last };
  const [totals, byDentist, byService] = await Promise.all([
    query<CountRow>(REPORT_TOTALS_SQL, params),
    query<CountRow & { dentist_id: number; dentist_name: string }>(REPORT_BY_DENTIST_SQL, params),
    query<CountRow & { service_id: number; service_name: string }>(REPORT_BY_SERVICE_SQL, params),
  ]);
  return {
    month,
    totals: counts(totals[0]),
    byDentist: byDentist.map((r) => ({ dentistId: r.dentist_id, dentistName: r.dentist_name, ...counts(r) })),
    byService: byService.map((r) => ({ serviceId: r.service_id, serviceName: r.service_name, ...counts(r) })),
  };
}

/**
 * The most recent month (YYYY-MM) that has completed visits (attended, no-show, or a cancellation that
 * was not a reschedule), or null when there are none. Lets the Reports empty state point at real data.
 */
export async function getLatestReportMonth(): Promise<string | null> {
  const r = await queryOne<{ month: string | null }>(
    `SELECT DATE_FORMAT(MAX(a.appointment_date), '%Y-%m') AS month
       FROM appointments a
      WHERE a.status IN ('attended', 'no-show')
         OR (a.status = 'cancelled' AND NOT EXISTS (
               SELECT 1 FROM appointments r WHERE r.rescheduled_from_id = a.appointment_id))`,
  );
  return r?.month ?? null;
}

export async function getRepeatNoShows(threshold: number): Promise<RepeatNoShow[]> {
  const t = Math.max(1, Math.floor(Number(threshold) || 1));
  const rows = await query<{
    patient_id: number;
    full_name: string;
    contact_number: string;
    no_show_count: number;
    last_no_show_date: string;
  }>(REPEAT_NO_SHOWS_SQL, { threshold: t });
  return rows.map((r) => ({
    patientId: r.patient_id,
    fullName: r.full_name,
    contactNumber: r.contact_number,
    noShowCount: Number(r.no_show_count),
    lastNoShowDate: r.last_no_show_date,
  }));
}

/** Bookings by channel for a month; all four channels always appear (zero when unused). */
export async function getChannelReport(month: string): Promise<ChannelReport> {
  const { first, last } = monthRange(month);
  const rows = await query<{ channel: (typeof CHANNELS)[number]; bookings: number | string; attended: number | string | null; no_show: number | string | null }>(
    REPORT_BY_CHANNEL_SQL,
    { first_day: first, last_day: last },
  );
  const byChannel = new Map(rows.map((r) => [r.channel, r]));
  const base = CHANNELS.map((channel) => {
    const r = byChannel.get(channel);
    return { channel, bookings: Number(r?.bookings ?? 0), attended: Number(r?.attended ?? 0), noShow: Number(r?.no_show ?? 0) };
  });
  const total = base.reduce((n, r) => n + r.bookings, 0);
  return { month, total, rows: base.map((r) => ({ ...r, share: total === 0 ? null : r.bookings / total })) };
}

/** Every appointment dated in the month, for the spreadsheet export. Oldest first. */
export const REPORT_APPOINTMENTS_SQL = `
SELECT a.appointment_id, a.appointment_date, a.start_time, a.end_time, a.status, a.channel, a.requested_at,
       p.patient_id, p.full_name, p.contact_number, p.email,
       d.dentist_name, s.service_name, c.chair_name,
       EXISTS (SELECT 1 FROM appointments r WHERE r.rescheduled_from_id = a.appointment_id) AS was_rescheduled
FROM appointments a
JOIN patients p ON p.patient_id = a.patient_id
JOIN dentists d ON d.dentist_id = a.dentist_id
JOIN services s ON s.service_id = a.service_id
LEFT JOIN chairs c ON c.chair_id = a.chair_id
WHERE a.appointment_date BETWEEN :first_day AND :last_day
ORDER BY a.appointment_date, a.start_time, a.appointment_id`;

export type ReportAppointment = {
  appointmentId: number;
  date: string;
  start: string;
  end: string;
  status: string;
  channel: string;
  requestedAt: string;
  patientId: number;
  fullName: string;
  contactNumber: string;
  email: string | null;
  dentistName: string;
  serviceName: string;
  chairName: string | null;
  wasRescheduled: boolean;
};

export async function getMonthAppointments(month: string): Promise<ReportAppointment[]> {
  const { first, last } = monthRange(month);
  const rows = await query<{
    appointment_id: number;
    appointment_date: string;
    start_time: string;
    end_time: string;
    status: string;
    channel: string;
    requested_at: string;
    patient_id: number;
    full_name: string;
    contact_number: string;
    email: string | null;
    dentist_name: string;
    service_name: string;
    chair_name: string | null;
    was_rescheduled: number | string;
  }>(REPORT_APPOINTMENTS_SQL, { first_day: first, last_day: last });
  return rows.map((r) => ({
    appointmentId: r.appointment_id,
    date: r.appointment_date,
    start: r.start_time.slice(0, 5),
    end: r.end_time.slice(0, 5),
    status: r.status,
    channel: r.channel,
    requestedAt: r.requested_at,
    patientId: r.patient_id,
    fullName: r.full_name,
    contactNumber: r.contact_number,
    email: r.email,
    dentistName: r.dentist_name,
    serviceName: r.service_name,
    chairName: r.chair_name,
    wasRescheduled: Number(r.was_rescheduled) === 1,
  }));
}
