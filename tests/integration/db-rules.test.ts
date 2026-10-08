/** DB-backed rules (Listing 3.1 overlap, chairs, locks) + NF02 constraints + NF08 time zone. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execute, getPool, query, queryOne, withTransaction } from '@/lib/db';
import {
  activeRangesForDentist,
  checkBookable,
  findOverlaps,
  freeChairs,
  lockChair,
  lockDentist,
  workingHoursOn,
} from '@/lib/queries/overlap';
import { openSlots } from '@/lib/rules';
import { resetTestDb } from './helpers';

const NOW = { date: '2026-10-09', time: '08:00' };
const REYES = 1;
const LIM = 2;

beforeAll(async () => {
  await resetTestDb();
});
afterAll(async () => {
  await resetTestDb();
});

// Maria's seeded Oct 19 row: Dr. Reyes, Chair 1, 10:00–11:00, scheduled (appointment_id 2).
describe('findOverlaps (Listing 3.1, Rule 1)', () => {
  it.each([
    ['09:00', '10:00', REYES, 2, 0],
    ['11:00', '11:30', REYES, 2, 0],
    ['10:30', '11:30', REYES, 2, 1],
    ['09:30', '10:15', REYES, 2, 1],
    ['10:00', '11:00', LIM, 2, 0], // other dentist, other chair
    ['10:00', '11:00', LIM, 1, 1], // other dentist, SAME chair
    ['10:00', '11:00', LIM, null, 0], // pending request: no chair yet
  ])('%s–%s dentist %i chair %s -> %i conflict(s)', async (start, end, dentistId, chairId, n) => {
    const rows = await findOverlaps(await getConn(), { date: '2026-10-19', start, end, dentistId, chairId, appointmentId: 0 });
    expect(rows).toHaveLength(n);
  });

  it('excludes the appointment itself (confirm/reschedule)', async () => {
    const rows = await findOverlaps(await getConn(), { date: '2026-10-19', start: '10:00', end: '11:00', dentistId: REYES, chairId: 1, appointmentId: 2 });
    expect(rows).toHaveLength(0);
  });

  it('why appointmentId must be 0, not NULL: "<> NULL" matches nothing (PRD FR8)', async () => {
    const [r] = await query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM appointments WHERE appointment_date = '2026-10-19' AND appointment_id <> NULL",
    );
    expect(Number(r.n)).toBe(0);
    await expect(
      findOverlaps(await getConn(), { date: '2026-10-19', start: '10:00', end: '11:00', dentistId: 1, appointmentId: null as unknown as number }),
    ).rejects.toThrow(/never null/);
  });

  it('final statuses do not block: Oct 12 09:00 (attended) is free again', async () => {
    const rows = await findOverlaps(await getConn(), { date: '2026-10-12', start: '09:00', end: '09:30', dentistId: REYES, chairId: 1, appointmentId: 0 });
    expect(rows).toEqual([]);
  });
});

describe('freeChairs (Rule 6)', () => {
  it('Chair 1 is taken 10:00–11:00 on Oct 19; Chair 2 is free', async () => {
    const chairs = await freeChairs(await getConn(), '2026-10-19', '10:30', '11:00');
    expect(chairs.map((c) => c.chair_name)).toEqual(['Chair 2']);
    const back2back = await freeChairs(await getConn(), '2026-10-19', '11:00', '11:30');
    expect(back2back.map((c) => c.chair_name)).toEqual(['Chair 1', 'Chair 2']);
    const self = await freeChairs(await getConn(), '2026-10-19', '10:00', '11:00', 2);
    expect(self.map((c) => c.chair_name)).toEqual(['Chair 1', 'Chair 2']);
  });
});

describe('checkBookable + openSlots against the DB', () => {
  it('reasons', async () => {
    const c = await getConn();
    const base = { dentistId: REYES, chairId: 1, appointmentId: 0 };
    expect(await checkBookable(c, { ...base, date: '2026-10-08', start: '10:00', end: '10:30' }, NOW)).toEqual({ ok: false, reason: 'in_past' });
    expect(await checkBookable(c, { ...base, date: '2026-10-18', start: '10:00', end: '10:30' }, NOW)).toEqual({ ok: false, reason: 'not_working' });
    expect(await checkBookable(c, { ...base, date: '2026-10-19', start: '16:30', end: '17:30' }, NOW)).toEqual({ ok: false, reason: 'outside_hours' });
    const clash = await checkBookable(c, { ...base, date: '2026-10-19', start: '10:30', end: '11:00' }, NOW);
    expect(clash.ok).toBe(false);
    expect(clash.ok === false && clash.reason).toBe('overlap');
    expect(await checkBookable(c, { ...base, date: '2026-10-19', start: '11:00', end: '11:30' }, NOW)).toEqual({ ok: true });
  });

  it('open slots for Dr. Reyes on Oct 19, 60-min filling', async () => {
    const c = await getConn();
    const hours = await workingHoursOn(c, REYES, '2026-10-19');
    expect(hours).toEqual({ start: '09:00', end: '17:00' });
    const existing = await activeRangesForDentist(c, REYES, '2026-10-19');
    expect(existing).toEqual([{ start: '10:00', end: '11:00' }]);
    const starts = openSlots({ date: '2026-10-19', hours, durationMinutes: 60, existing, now: NOW, intervalMinutes: 30 }).map((s) => s.start);
    expect(starts).toEqual(['09:00', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00']);
  });
});

describe('transactions and locks (Rule 9)', () => {
  it('withTransaction commits, rolls back on throw, uses READ COMMITTED', async () => {
    await expect(
      withTransaction(async (conn) => {
        expect(await lockDentist(conn, REYES)).toMatchObject({ dentist_name: 'Dr. Reyes' });
        expect(await lockChair(conn, 2)).toMatchObject({ chair_name: 'Chair 2' });
        const [iso] = await query<{ iso: string }>(
          'SELECT trx_isolation_level AS iso FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = CONNECTION_ID()',
          [],
          conn,
        );
        expect(iso.iso).toBe('READ COMMITTED');
        await execute("UPDATE chairs SET chair_name = 'Temp' WHERE chair_id = 2", [], conn);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await queryOne('SELECT chair_name FROM chairs WHERE chair_id = 2')).toEqual({ chair_name: 'Chair 2' });
    expect(await withTransaction(async (conn) => lockDentist(conn, 999))).toBeNull();
  });

  it('a second transaction waits for the dentist lock', async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const first = withTransaction(async (conn) => {
      await lockDentist(conn, LIM);
      order.push('first locked');
      await held;
      order.push('first done');
    });
    await new Promise((r) => setTimeout(r, 100));
    const second = withTransaction(async (conn) => {
      await lockDentist(conn, LIM);
      order.push('second locked');
    });
    await new Promise((r) => setTimeout(r, 200));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first locked', 'first done', 'second locked']);
  });
});

describe('NF02 constraints and NF08 time zone', () => {
  it('CHECK constraints are enforced (MySQL >= 8.0.16)', async () => {
    await expect(execute("INSERT INTO services (service_name, duration_minutes) VALUES ('Bad', 0)")).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
    await expect(
      execute("INSERT INTO dentist_schedules (dentist_id, day_of_week, start_time, end_time) VALUES (1, 0, '17:00', '09:00')"),
    ).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
    await expect(execute("UPDATE appointments SET end_time = start_time WHERE appointment_id = 2")).rejects.toMatchObject({ code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
  });

  it('ENUM, UNIQUE and RESTRICT are enforced', async () => {
    await expect(execute("UPDATE appointments SET status = 'canceled' WHERE appointment_id = 2")).rejects.toBeTruthy();
    await expect(execute("INSERT INTO patients (full_name, contact_number, birthdate) VALUES ('Dup', '09175550101', '1990-01-01')")).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    await expect(execute('DELETE FROM dentists WHERE dentist_id = 1')).rejects.toMatchObject({ code: 'ER_ROW_IS_REFERENCED_2' });
  });

  it('session time_zone is +08:00 and dates come back as strings', async () => {
    const [r] = await query<{ tz: string; d: unknown; diff: number }>(
      "SELECT @@session.time_zone AS tz, DATE('2026-10-19') AS d, TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS diff",
    );
    expect(r.tz).toBe('+08:00');
    expect(r.d).toBe('2026-10-19');
    expect(Number(r.diff)).toBeGreaterThanOrEqual(479);
    expect(Number(r.diff)).toBeLessThanOrEqual(480);
  });
});

// Read-only checks run on the pool (a Queryable); transactions use their own connection.
async function getConn() {
  return getPool();
}
