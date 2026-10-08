/**
 * Schedule dashboard reads (FR6, FR7, NF05). Computed live on every call; no caching (NF04).
 *
 * Grid content: pending + scheduled + attended + no-show. Cancelled and declined rows are left
 * out (they no longer hold the time; a cancelled-by-reschedule row would otherwise show twice).
 * Open slots: Rule 5 via lib/rules openSlots with SLOT_INTERVAL_MINUTES and the SHORTEST service
 * duration, i.e. "a start where at least the shortest service fits" (the dashboard has no service).
 */
import { query, queryOne } from '../db';
import { hoursForDate, openSlots, slotIntervalMinutes } from '../rules';
import { addDays, compareTimes, dayOfWeek, nowManila, todayManila, toHHMM } from '../time';
import type { AppointmentStatus, ApptBlock, Channel, ChairDay, DashboardSummary, DaySchedule, DentistDay, ScheduleRow } from '../types';

type BlockRow = {
  appointment_id: number;
  dentist_id: number;
  chair_id: number | null;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  channel: Channel;
  full_name: string;
  service_name: string;
  dentist_name: string;
  chair_name: string | null;
};

const DAY_BLOCKS_SQL = `
SELECT a.appointment_id, a.dentist_id, a.chair_id, a.start_time, a.end_time, a.status, a.channel,
       p.full_name, s.service_name, d.dentist_name, c.chair_name
FROM appointments a
JOIN patients p ON p.patient_id = a.patient_id
JOIN services s ON s.service_id = a.service_id
JOIN dentists d ON d.dentist_id = a.dentist_id
LEFT JOIN chairs c ON c.chair_id = a.chair_id
WHERE a.appointment_date = ?
  AND a.status IN ('pending', 'scheduled', 'attended', 'no-show')
ORDER BY a.start_time, a.dentist_id, a.appointment_id`;

function toBlock(r: BlockRow): ApptBlock {
  return {
    appointmentId: r.appointment_id,
    start: toHHMM(r.start_time),
    end: toHHMM(r.end_time),
    status: r.status,
    channel: r.channel,
    patientName: r.full_name,
    serviceName: r.service_name,
    dentistName: r.dentist_name,
    chairName: r.chair_name,
  };
}

/** One day's schedule per dentist and per chair (Figure 3.7). `date` = 'YYYY-MM-DD'. */
export async function getDaySchedule(date: string, now: { date: string; time: string } = nowManila()): Promise<DaySchedule> {
  const dow = dayOfWeek(date);
  const [dentists, chairs, schedules, rows, shortest] = await Promise.all([
    query<{ dentist_id: number; dentist_name: string }>('SELECT dentist_id, dentist_name FROM dentists ORDER BY dentist_id'),
    query<{ chair_id: number; chair_name: string }>('SELECT chair_id, chair_name FROM chairs ORDER BY chair_id'),
    query<ScheduleRow>(
      'SELECT schedule_id, dentist_id, day_of_week, start_time, end_time FROM dentist_schedules WHERE day_of_week = ?',
      [dow],
    ),
    query<BlockRow>(DAY_BLOCKS_SQL, [date]),
    queryOne<{ service_id: number; duration_minutes: number }>(
      'SELECT service_id, duration_minutes FROM services ORDER BY duration_minutes, service_id LIMIT 1',
    ),
  ]);

  const duration = Number(shortest?.duration_minutes ?? 0) || slotIntervalMinutes();
  const blocks = rows.map((r) => ({ row: r, block: toBlock(r) }));

  const dentistDays: DentistDay[] = dentists.map((d) => {
    const sched = hoursForDate(
      schedules.filter((s) => Number(s.dentist_id) === Number(d.dentist_id)),
      date,
    );
    const hours = sched ? { start: toHHMM(sched.start_time), end: toHHMM(sched.end_time) } : null;
    const mine = blocks.filter((b) => b.row.dentist_id === d.dentist_id);
    const active = mine
      .filter((b) => b.row.status === 'pending' || b.row.status === 'scheduled')
      .map((b) => ({ start: b.block.start, end: b.block.end }));
    return {
      dentistId: d.dentist_id,
      dentistName: d.dentist_name,
      hours,
      appointments: mine.map((b) => b.block),
      openSlots: openSlots({ date, hours, durationMinutes: duration, existing: active, now }),
    };
  });

  const chairDays: ChairDay[] = chairs.map((c) => ({
    chairId: c.chair_id,
    chairName: c.chair_name,
    appointments: blocks.filter((b) => b.row.chair_id === c.chair_id).map((b) => b.block),
  }));

  const unassigned = blocks.filter((b) => b.row.chair_id === null).map((b) => b.block);

  const starts = [
    ...dentistDays.flatMap((d) => (d.hours ? [d.hours.start] : [])),
    ...blocks.map((b) => b.block.start),
  ];
  const ends = [...dentistDays.flatMap((d) => (d.hours ? [d.hours.end] : [])), ...blocks.map((b) => b.block.end)];
  const gridStart = starts.length ? starts.reduce((a, b) => (compareTimes(a, b) <= 0 ? a : b)) : null;
  const gridEnd = ends.length ? ends.reduce((a, b) => (compareTimes(a, b) >= 0 ? a : b)) : null;

  return {
    date,
    dayOfWeek: dow,
    dentists: dentistDays,
    chairs: chairDays,
    unassigned,
    gridStart,
    gridEnd,
    slotDurationMinutes: duration,
    slotServiceId: shortest ? Number(shortest.service_id) : null,
  };
}

/**
 * Summary strip: `todayTotal` = appointments on `date` shown on the grid (pending, scheduled,
 * attended, no-show); `pendingCount` = all pending requests (any date); `tomorrowCount` =
 * `scheduled` rows on date + 1 (the reminder candidates). `date` defaults to today (Manila).
 */
export async function getDashboardSummary(date: string = todayManila()): Promise<DashboardSummary> {
  const row = await queryOne<{ today_total: number; pending_count: number; tomorrow_count: number }>(
    `SELECT
       (SELECT COUNT(*) FROM appointments
         WHERE appointment_date = ? AND status IN ('pending', 'scheduled', 'attended', 'no-show')) AS today_total,
       (SELECT COUNT(*) FROM appointments WHERE status = 'pending') AS pending_count,
       (SELECT COUNT(*) FROM appointments WHERE appointment_date = ? AND status = 'scheduled') AS tomorrow_count`,
    [date, addDays(date, 1)],
  );
  return {
    todayTotal: Number(row?.today_total ?? 0),
    pendingCount: Number(row?.pending_count ?? 0),
    tomorrowCount: Number(row?.tomorrow_count ?? 0),
  };
}
