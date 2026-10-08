/**
 * Clinic setup writes (FR5): dentists (+ weekly hours), schedules, services, chairs.
 * DB constraints do the integrity work (NF02); their errors become readable messages:
 *   FK RESTRICT (ER_ROW_IS_REFERENCED_2)  -> 409 in_use "In use by existing appointments"
 *   UNIQUE (ER_DUP_ENTRY)                 -> 409 duplicate_* with a specific message
 *   CHECK (ER_CHECK_CONSTRAINT_VIOLATED)  -> 400 check_violation
 * Changing hours or durations never touches existing appointments (end_time is stored, Rule 4).
 */
import { execute, query, queryOne, type Queryable } from '../db';
import { listChairs, listDentistsWithSchedules, listServices } from '../queries/setup';
import { toHHMM, toHHMMSS } from '../time';
import type { ScheduleRow } from '../types';
import {
  weekToSchedules,
  type ChairCreate,
  type ChairUpdate,
  type DentistCreate,
  type DentistUpdate,
  type ScheduleCreate,
  type ScheduleEntry,
  type ScheduleReplace,
  type ScheduleUpdate,
  type ServiceCreate,
  type ServiceUpdate,
  type SetupEntity,
} from '../validation';
import { mysqlCode, notFound, ServiceError } from './errors';
import { transaction } from './tx';

const IN_USE = () => new ServiceError(409, 'in_use', 'In use by existing appointments');

function isRestrict(err: unknown) {
  const c = mysqlCode(err);
  return c === 'ER_ROW_IS_REFERENCED_2' || c === 'ER_ROW_IS_REFERENCED';
}

/** Rethrow a duplicate-key error as a readable 409. */
function dup(err: unknown, code: string, message: string, field: string): never {
  if (mysqlCode(err) === 'ER_DUP_ENTRY') throw new ServiceError(409, code, message, { issues: { [field]: message } });
  throw err;
}

// ---------- GET ----------

export async function listSetup(entity: SetupEntity, dentistId?: number) {
  switch (entity) {
    case 'dentists':
      return listDentistsWithSchedules();
    case 'services':
      return listServices();
    case 'chairs':
      return listChairs();
    case 'schedules': {
      const rows = await query<ScheduleRow>(
        `SELECT schedule_id, dentist_id, day_of_week, start_time, end_time FROM dentist_schedules
         ${dentistId ? 'WHERE dentist_id = ?' : ''} ORDER BY dentist_id, day_of_week`,
        dentistId ? [dentistId] : [],
      );
      return rows.map((r) => ({
        scheduleId: r.schedule_id,
        dentistId: r.dentist_id,
        dayOfWeek: Number(r.day_of_week),
        startTime: toHHMM(r.start_time),
        endTime: toHHMM(r.end_time),
      }));
    }
  }
}

// ---------- dentists ----------

async function replaceWeek(conn: Queryable, dentistId: number, rows: ScheduleEntry[]) {
  await execute('DELETE FROM dentist_schedules WHERE dentist_id = ?', [dentistId], conn);
  for (const r of rows) {
    await execute(
      'INSERT INTO dentist_schedules (dentist_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)',
      [dentistId, r.dayOfWeek, toHHMMSS(r.startTime), toHHMMSS(r.endTime)],
      conn,
    );
  }
}

export async function createDentist(input: DentistCreate): Promise<number> {
  const week = input.schedules ?? (input.week ? weekToSchedules(input.week) : []);
  return transaction(async (conn) => {
    const r = await execute('INSERT INTO dentists (dentist_name) VALUES (?)', [input.dentistName], conn);
    await replaceWeek(conn, r.insertId, week);
    return r.insertId;
  });
}

export async function updateDentist(input: DentistUpdate): Promise<void> {
  const week = input.schedules ?? (input.week ? weekToSchedules(input.week) : undefined);
  await transaction(async (conn) => {
    const row = await queryOne('SELECT dentist_id FROM dentists WHERE dentist_id = ? FOR UPDATE', [input.id], conn);
    if (!row) throw notFound('Dentist');
    if (input.dentistName !== undefined) {
      await execute('UPDATE dentists SET dentist_name = ? WHERE dentist_id = ?', [input.dentistName, input.id], conn);
    }
    if (week) await replaceWeek(conn, input.id, week);
  });
}

/** Deletes the dentist's hours too; refused (409) if any appointment references the dentist. */
export async function deleteDentist(id: number): Promise<void> {
  try {
    await transaction(async (conn) => {
      const row = await queryOne('SELECT dentist_id FROM dentists WHERE dentist_id = ? FOR UPDATE', [id], conn);
      if (!row) throw notFound('Dentist');
      await execute('DELETE FROM dentist_schedules WHERE dentist_id = ?', [id], conn);
      await execute('DELETE FROM dentists WHERE dentist_id = ?', [id], conn);
    });
  } catch (err) {
    if (isRestrict(err)) throw IN_USE();
    throw err;
  }
}

// ---------- schedules ----------

const DUP_DAY = 'That dentist already has hours on that day';

export async function createSchedule(input: ScheduleCreate): Promise<number> {
  if (!(await queryOne('SELECT 1 AS x FROM dentists WHERE dentist_id = ?', [input.dentistId]))) {
    throw new ServiceError(400, 'unknown_dentist', 'That dentist does not exist', { issues: { dentistId: 'Unknown dentist' } });
  }
  try {
    const r = await execute(
      'INSERT INTO dentist_schedules (dentist_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)',
      [input.dentistId, input.dayOfWeek, toHHMMSS(input.startTime), toHHMMSS(input.endTime)],
    );
    return r.insertId;
  } catch (err) {
    dup(err, 'duplicate_day', DUP_DAY, 'dayOfWeek');
  }
}

export async function updateSchedule(input: ScheduleUpdate): Promise<void> {
  const r = await execute('UPDATE dentist_schedules SET start_time = ?, end_time = ? WHERE schedule_id = ?', [
    toHHMMSS(input.startTime),
    toHHMMSS(input.endTime),
    input.id,
  ]);
  if (r.affectedRows === 0) throw notFound('Schedule');
}

/** PUT-like: replace a dentist's whole week (7-entry `week` with null = off, or `schedules` rows). */
export async function replaceSchedules(input: ScheduleReplace): Promise<void> {
  const rows = input.schedules ?? weekToSchedules(input.week!);
  await transaction(async (conn) => {
    const row = await queryOne('SELECT dentist_id FROM dentists WHERE dentist_id = ? FOR UPDATE', [input.dentistId], conn);
    if (!row) throw notFound('Dentist');
    await replaceWeek(conn, input.dentistId, rows);
  });
}

export async function deleteSchedule(id: number): Promise<void> {
  const r = await execute('DELETE FROM dentist_schedules WHERE schedule_id = ?', [id]);
  if (r.affectedRows === 0) throw notFound('Schedule');
}

// ---------- services ----------

const DUP_SERVICE = 'A service with that name already exists';

export async function createService(input: ServiceCreate): Promise<number> {
  try {
    const r = await execute('INSERT INTO services (service_name, duration_minutes) VALUES (?, ?)', [input.serviceName, input.durationMinutes]);
    return r.insertId;
  } catch (err) {
    dup(err, 'duplicate_name', DUP_SERVICE, 'serviceName');
  }
}

export async function updateService(input: ServiceUpdate): Promise<void> {
  const cols: string[] = [];
  const vals: unknown[] = [];
  if (input.serviceName !== undefined) {
    cols.push('service_name = ?');
    vals.push(input.serviceName);
  }
  if (input.durationMinutes !== undefined) {
    cols.push('duration_minutes = ?');
    vals.push(input.durationMinutes);
  }
  if (!(await queryOne('SELECT 1 AS x FROM services WHERE service_id = ?', [input.id]))) throw notFound('Service');
  if (cols.length === 0) return;
  try {
    await execute(`UPDATE services SET ${cols.join(', ')} WHERE service_id = ?`, [...vals, input.id]);
  } catch (err) {
    dup(err, 'duplicate_name', DUP_SERVICE, 'serviceName');
  }
}

export async function deleteService(id: number): Promise<void> {
  try {
    const r = await execute('DELETE FROM services WHERE service_id = ?', [id]);
    if (r.affectedRows === 0) throw notFound('Service');
  } catch (err) {
    if (isRestrict(err)) throw IN_USE();
    throw err;
  }
}

// ---------- chairs ----------

const DUP_CHAIR = 'A chair with that name already exists';

export async function createChair(input: ChairCreate): Promise<number> {
  try {
    const r = await execute('INSERT INTO chairs (chair_name) VALUES (?)', [input.chairName]);
    return r.insertId;
  } catch (err) {
    dup(err, 'duplicate_name', DUP_CHAIR, 'chairName');
  }
}

export async function updateChair(input: ChairUpdate): Promise<void> {
  if (!(await queryOne('SELECT 1 AS x FROM chairs WHERE chair_id = ?', [input.id]))) throw notFound('Chair');
  try {
    await execute('UPDATE chairs SET chair_name = ? WHERE chair_id = ?', [input.chairName, input.id]);
  } catch (err) {
    dup(err, 'duplicate_name', DUP_CHAIR, 'chairName');
  }
}

export async function deleteChair(id: number): Promise<void> {
  try {
    const r = await execute('DELETE FROM chairs WHERE chair_id = ?', [id]);
    if (r.affectedRows === 0) throw notFound('Chair');
  } catch (err) {
    if (isRestrict(err)) throw IN_USE();
    throw err;
  }
}
