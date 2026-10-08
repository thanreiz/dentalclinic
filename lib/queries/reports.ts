/**
 * Attendance reports (FR15, FR16), Listing 3.4-style SQL. Computed on request, never stored (NF04).
 *
 * Cancelled counts EXCLUDE cancellations that were reschedules: a cancelled row that some other
 * row's rescheduled_from_id points to is a move, not a lost visit (Rule 11).
 * No-show rate = no-show / (attended + no-show); null when the denominator is 0.
 */
import { query } from '../db';
import { noShowRate } from '../rules';
import { monthRange } from '../time';
import type { MonthlyReport, RepeatNoShow, ReportCounts } from '../types';

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
