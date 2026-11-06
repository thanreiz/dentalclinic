/**
 * Public setup cache (lib/queries/setup listPublic*) and the batched slots query.
 * next/cache is replaced by an in-memory tag cache so we can prove a setup write is visible
 * to /book data, the Messenger pickers and /api/slots straight away, not after the 300 s TTL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  process.env.NEXT_RUNTIME = 'nodejs';
  return { entries: new Map<string, unknown>(), fills: 0, tags: new Map<string, Set<string>>() };
});

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => Promise<unknown>, keys: string[], opts: { tags?: string[] }) => async (...args: unknown[]) => {
    const k = JSON.stringify([keys, args]);
    if (store.entries.has(k)) return store.entries.get(k);
    store.fills++;
    const v = await fn(...args);
    store.entries.set(k, v);
    for (const t of opts.tags ?? []) store.tags.set(t, (store.tags.get(t) ?? new Set()).add(k));
    return v;
  },
  revalidateTag: (tag: string) => {
    for (const k of store.tags.get(tag) ?? []) store.entries.delete(k);
    store.tags.delete(tag);
  },
}));

import { GET as getSlotsRoute } from '@/app/api/slots/route';
import { getPool, query } from '@/lib/db';
import { listDentistsWithSchedules, listPublicDentists, listPublicServices } from '@/lib/queries/setup';
import { activeRangesForDentist, workingHoursOn } from '@/lib/queries/overlap';
import { openSlots, unionSlots } from '@/lib/rules';
import { allDentistIds } from '@/lib/services/lookups';
import { createService, deleteService, replaceSchedules, updateSchedule, updateService } from '@/lib/services/setup';
import { getSlots } from '@/lib/services/slots';
import { addDays } from '@/lib/time';
import { EXTRACTION, insertAppt, LIM, PROPHY, req, REYES, workday } from './api-helpers';
import { resetTestDb } from './helpers';

beforeAll(async () => {
  await resetTestDb();
});
afterAll(async () => {
  await resetTestDb();
});
beforeEach(() => {
  store.entries.clear();
  store.tags.clear();
  store.fills = 0;
});

const slotsVia = async (date: string, serviceId: number, dentistId: number | 'any') => {
  const res = await getSlotsRoute(req('GET', `/api/slots?date=${date}&serviceId=${serviceId}&dentistId=${dentistId}`));
  return (await res.json()).slots as { start: string; end: string; dentistIds: number[] }[];
};

describe('lean public readers', () => {
  it('match the staff readers minus appointmentCount, and are served from cache on the 2nd call', async () => {
    const [pd, pdAgain] = [await listPublicDentists(), await listPublicDentists()];
    expect(store.fills).toBe(1);
    expect(pdAgain).toEqual(pd);
    const full = await listDentistsWithSchedules();
    expect(pd).toEqual(full.map((d) => ({ dentistId: d.dentistId, dentistName: d.dentistName, schedules: d.schedules, week: d.week })));
    expect(pd[0]).not.toHaveProperty('appointmentCount');
    const ps = await listPublicServices();
    expect(ps[0]).toEqual({ serviceId: 1, serviceName: 'Oral prophylaxis', durationMinutes: 30 });
    expect(ps[0]).not.toHaveProperty('appointmentCount');
  });
});

describe('setup writes show up immediately', () => {
  it('renaming / re-timing a service is visible to /book data and /api/slots', async () => {
    const date = workday(3);
    expect((await listPublicServices()).find((s) => s.serviceId === EXTRACTION)).toMatchObject({ serviceName: 'Tooth extraction', durationMinutes: 45 });
    const before = await slotsVia(date, EXTRACTION, REYES);
    expect(before[0]).toMatchObject({ start: '09:00', end: '09:45' });

    await updateService({ id: EXTRACTION, serviceName: 'Tooth extraction (renamed)', durationMinutes: 60 });

    expect((await listPublicServices()).find((s) => s.serviceId === EXTRACTION)).toMatchObject({ serviceName: 'Tooth extraction (renamed)', durationMinutes: 60 });
    expect((await slotsVia(date, EXTRACTION, REYES))[0]).toMatchObject({ start: '09:00', end: '10:00' });
  });

  it('adding and deleting a service updates the public list', async () => {
    const id = await createService({ serviceName: 'Cache probe', durationMinutes: 15 });
    expect((await listPublicServices()).some((s) => s.serviceName === 'Cache probe')).toBe(true);
    await deleteService(id);
    expect((await listPublicServices()).some((s) => s.serviceName === 'Cache probe')).toBe(false);
  });

  it('changing a schedule is visible to /book data and /api/slots', async () => {
    const date = workday(2);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const reyes = async () => (await listPublicDentists()).find((d) => d.dentistId === REYES)!;
    const row = (await reyes()).schedules.find((s) => s.dayOfWeek === dow)!;
    expect(row).toBeDefined();
    const lastEnd = async () => (await slotsVia(date, PROPHY, REYES)).at(-1)!.end;
    expect(await lastEnd()).toBe(row.endTime);

    await updateSchedule({ id: row.scheduleId, startTime: row.startTime, endTime: '12:00' });
    expect((await reyes()).schedules.find((s) => s.dayOfWeek === dow)!.endTime).toBe('12:00');
    expect(await lastEnd()).toBe('12:00');

    // Day off: dentist drops out of /book's working days and out of the slots.
    const week = (await reyes()).week.map((w, i) => (i === dow ? null : w && { startTime: w.start, endTime: w.end }));
    await replaceSchedules({ dentistId: REYES, week });
    expect((await reyes()).schedules.some((s) => s.dayOfWeek === dow)).toBe(false);
    expect(await slotsVia(date, PROPHY, REYES)).toEqual([]);
  });
});

describe('getSlots batching keeps the output identical', () => {
  /** The pre-batching implementation: one hours query + one appointments query per dentist. */
  async function reference(date: string, serviceId: number, dentistId: number | 'any', exclude = 0) {
    const conn = getPool();
    const [svc] = await query<{ duration_minutes: number }>('SELECT duration_minutes FROM services WHERE service_id = ?', [serviceId]);
    const ids = dentistId === 'any' ? await allDentistIds(conn) : [dentistId];
    const per = await Promise.all(
      ids.map(async (id) => {
        const [hours, existing] = await Promise.all([workingHoursOn(conn, id, date), activeRangesForDentist(conn, id, date, exclude)]);
        return { dentistId: id, slots: openSlots({ date, hours, durationMinutes: Number(svc.duration_minutes), existing }) };
      }),
    );
    return unionSlots(per);
  }

  it('matches for every service, dentist and a week of dates, with bookings and an exclusion', async () => {
    await resetTestDb();
    const d0 = workday(1);
    const busy = await insertAppt({ dentistId: REYES, date: d0, start: '10:00', end: '11:00', status: 'scheduled' });
    await insertAppt({ dentistId: LIM, date: d0, start: '09:00', end: '12:00', status: 'pending' });
    await insertAppt({ dentistId: REYES, date: d0, start: '14:00', end: '14:30', status: 'cancelled' });
    const services = (await query<{ service_id: number }>('SELECT service_id FROM services ORDER BY service_id')).map((s) => s.service_id);
    let nonEmpty = 0;
    for (let i = 0; i < 8; i++) {
      const date = addDays(d0, i);
      for (const serviceId of services) {
        for (const dentistId of [REYES, LIM, 3, 'any'] as const) {
          for (const exclude of [0, busy]) {
            const got = await getSlots({ date, serviceId, dentistId, excludeAppointmentId: exclude });
            expect(got).toEqual(await reference(date, serviceId, dentistId, exclude));
            if (got.length) nonEmpty++;
          }
        }
      }
    }
    expect(nonEmpty).toBeGreaterThan(50);
  });

  it('still rejects an unknown service or dentist', async () => {
    const date = workday(1);
    await expect(getSlots({ date, serviceId: 9999, dentistId: 'any' })).rejects.toMatchObject({ code: 'unknown_service' });
    await expect(getSlots({ date, serviceId: PROPHY, dentistId: 9999 })).rejects.toMatchObject({ code: 'unknown_dentist' });
  });
});
