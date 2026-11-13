/** The Reports page as spreadsheet tables (same queries the page uses, plus the month's appointments). */
import { getChannelReport, getMonthAppointments, getMonthlyReport, getRepeatNoShows } from '../queries/reports';
import { formatContact } from '../rules';
import type { ReportCounts } from '../types';
import type { Cell, Sheet } from './sheets';

/** Rate as a percentage with one decimal (12.5), blank when there is nothing to divide by. */
const pct = (r: number | null): Cell => (r === null ? null : Math.round(r * 1000) / 10);
const countCells = (c: ReportCounts): Cell[] => [c.attended, c.cancelled, c.noShow, c.total, pct(c.noShowRate)];
const COUNT_HEADER = ['Attended', 'Cancelled (excl. reschedules)', 'No-show', 'Total', 'No-show rate (%)'];
const CHANNEL_LABEL: Record<string, string> = { online: 'Facebook / online', chat: 'Messenger chat', phone: 'Phone', 'walk-in': 'Walk-in' };

export async function buildReportSheets(month: string, threshold: number): Promise<Sheet[]> {
  const [report, channels, repeat, appts] = await Promise.all([
    getMonthlyReport(month),
    getChannelReport(month),
    getRepeatNoShows(threshold),
    getMonthAppointments(month),
  ]);
  return [
    { name: 'Summary', header: ['Month', ...COUNT_HEADER], rows: [[month, ...countCells(report.totals)]] },
    { name: 'By dentist', header: ['Dentist', ...COUNT_HEADER], rows: report.byDentist.map((r) => [r.dentistName, ...countCells(r)]) },
    { name: 'By service', header: ['Service', ...COUNT_HEADER], rows: report.byService.map((r) => [r.serviceName, ...countCells(r)]) },
    {
      name: 'By channel',
      header: ['Channel', 'Bookings', 'Share (%)', 'Attended', 'No-show'],
      rows: channels.rows.map((r) => [CHANNEL_LABEL[r.channel] ?? r.channel, r.bookings, pct(r.share), r.attended, r.noShow]),
    },
    {
      name: 'Repeat no-shows',
      header: ['Patient ID', 'Patient', 'Contact number', `No-shows (≥ ${threshold}, all time)`, 'Last no-show'],
      rows: repeat.map((p) => [p.patientId, p.fullName, formatContact(p.contactNumber), p.noShowCount, p.lastNoShowDate]),
    },
    {
      name: 'Appointments',
      header: ['Appointment ID', 'Date', 'Start', 'End', 'Patient ID', 'Patient', 'Contact number', 'Email', 'Service', 'Dentist', 'Chair', 'Status', 'Channel', 'Requested at'],
      rows: appts.map((a) => [
        a.appointmentId,
        a.date,
        a.start,
        a.end,
        a.patientId,
        a.fullName,
        // Spaced ('0917 555 0101') so Excel keeps it as text and the leading 0 survives a CSV open.
        formatContact(a.contactNumber),
        a.email,
        a.serviceName,
        a.dentistName,
        a.chairName,
        a.status === 'cancelled' && a.wasRescheduled ? 'cancelled (rescheduled)' : a.status,
        CHANNEL_LABEL[a.channel] ?? a.channel,
        a.requestedAt,
      ]),
    },
  ];
}
