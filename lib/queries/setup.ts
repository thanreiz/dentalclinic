/** Clinic setup reads (/setup, FR5) and the pickers on booking forms. */
import { unstable_cache } from 'next/cache';
import { query, type Queryable } from '../db';
import { toHHMM } from '../time';
import type { ChairItem, DentistWithSchedules, ScheduleRow, ServiceItem } from '../types';

/** Tag on every cached setup read; lib/services/setup.ts revalidates it after each mutation. */
export const SETUP_TAG = 'setup';
const SETUP_REVALIDATE_SECONDS = 300;

/**
 * unstable_cache needs the Next.js runtime (incremental cache); plain Node callers (vitest, scripts)
 * get the uncached function. Checked per call so tests can opt in with NEXT_RUNTIME + a next/cache mock.
 */
function cachedSetup<A extends unknown[], R>(fn: (...args: A) => Promise<R>, key: string): (...args: A) => Promise<R> {
  let wrapped: ((...args: A) => Promise<R>) | undefined;
  return (...args) => {
    if (!process.env.NEXT_RUNTIME) return fn(...args);
    wrapped ??= unstable_cache(fn, [key], { tags: [SETUP_TAG], revalidate: SETUP_REVALIDATE_SECONDS });
    return wrapped(...args);
  };
}

export type PublicDentist = Omit<DentistWithSchedules, 'appointmentCount'>;
export type PublicService = Omit<ServiceItem, 'appointmentCount'>;

async function loadDentists(conn?: Queryable): Promise<PublicDentist[]> {
  const [dentists, schedules] = await Promise.all([
    query<{ dentist_id: number; dentist_name: string }>('SELECT dentist_id, dentist_name FROM dentists ORDER BY dentist_id', [], conn),
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
    };
  });
}

/** Staff setup screens: includes how many appointments use each dentist. Always fresh. */
export async function listDentistsWithSchedules(conn?: Queryable): Promise<DentistWithSchedules[]> {
  const [dentists, counts] = await Promise.all([
    loadDentists(conn),
    query<{ dentist_id: number; n: number }>('SELECT dentist_id, COUNT(*) AS n FROM appointments GROUP BY dentist_id', [], conn),
  ]);
  const byId = new Map(counts.map((c) => [c.dentist_id, Number(c.n)]));
  return dentists.map((d) => ({ ...d, appointmentCount: byId.get(d.dentistId) ?? 0 }));
}

/** Public pickers (/book, Messenger bot): no appointment counts, cached 5 min and busted by setup writes. */
export const listPublicDentists = cachedSetup(() => loadDentists(), 'public-dentists');

async function loadServices(conn?: Queryable): Promise<PublicService[]> {
  const rows = await query<{ service_id: number; service_name: string; duration_minutes: number }>(
    'SELECT service_id, service_name, duration_minutes FROM services ORDER BY service_id',
    [],
    conn,
  );
  return rows.map((r) => ({ serviceId: r.service_id, serviceName: r.service_name, durationMinutes: Number(r.duration_minutes) }));
}

/** Public pickers: no appointment counts, cached like listPublicDentists. */
export const listPublicServices = cachedSetup(() => loadServices(), 'public-services');

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
