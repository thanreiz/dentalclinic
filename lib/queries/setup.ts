/** Clinic setup reads (/setup, FR5) and the pickers on booking forms. */
import { query, type Queryable } from '../db';
import { toHHMM } from '../time';
import type { ChairItem, DentistWithSchedules, ScheduleRow, ServiceItem } from '../types';

export async function listDentistsWithSchedules(conn?: Queryable): Promise<DentistWithSchedules[]> {
  const [dentists, schedules] = await Promise.all([
    query<{ dentist_id: number; dentist_name: string; appointment_count: number }>(
      `SELECT d.dentist_id, d.dentist_name,
              (SELECT COUNT(*) FROM appointments a WHERE a.dentist_id = d.dentist_id) AS appointment_count
       FROM dentists d ORDER BY d.dentist_id`,
      [],
      conn,
    ),
    query<ScheduleRow>(
      'SELECT schedule_id, dentist_id, day_of_week, start_time, end_time FROM dentist_schedules ORDER BY dentist_id, day_of_week',
      [],
      conn,
    ),
  ]);
  return dentists.map((d) => {
    const mine = schedules
      .filter((s) => s.dentist_id === d.dentist_id)
      .map((s) => ({
        scheduleId: s.schedule_id,
        dayOfWeek: Number(s.day_of_week),
        startTime: toHHMM(s.start_time),
        endTime: toHHMM(s.end_time),
      }));
    const week = Array.from({ length: 7 }, (_, dow) => {
      const s = mine.find((x) => x.dayOfWeek === dow);
      return s ? { start: s.startTime, end: s.endTime } : null;
    });
    return {
      dentistId: d.dentist_id,
      dentistName: d.dentist_name,
      schedules: mine,
      week,
      appointmentCount: Number(d.appointment_count),
    };
  });
}

export async function listServices(conn?: Queryable): Promise<ServiceItem[]> {
  const rows = await query<{ service_id: number; service_name: string; duration_minutes: number; appointment_count: number }>(
    `SELECT s.service_id, s.service_name, s.duration_minutes,
            (SELECT COUNT(*) FROM appointments a WHERE a.service_id = s.service_id) AS appointment_count
     FROM services s ORDER BY s.service_id`,
    [],
    conn,
  );
  return rows.map((r) => ({
    serviceId: r.service_id,
    serviceName: r.service_name,
    durationMinutes: Number(r.duration_minutes),
    appointmentCount: Number(r.appointment_count),
  }));
}

export async function listChairs(conn?: Queryable): Promise<ChairItem[]> {
  const rows = await query<{ chair_id: number; chair_name: string; appointment_count: number }>(
    `SELECT c.chair_id, c.chair_name,
            (SELECT COUNT(*) FROM appointments a WHERE a.chair_id = c.chair_id) AS appointment_count
     FROM chairs c ORDER BY c.chair_id`,
    [],
    conn,
  );
  return rows.map((r) => ({ chairId: r.chair_id, chairName: r.chair_name, appointmentCount: Number(r.appointment_count) }));
}
