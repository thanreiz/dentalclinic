/** Small shared lookups for services. */
import { query, queryOne, type Queryable } from '../db';
import type { ServiceRow } from '../types';
import { ServiceError } from './errors';

export async function getServiceOrThrow(serviceId: number, conn?: Queryable): Promise<ServiceRow> {
  const s = await queryOne<ServiceRow>(
    'SELECT service_id, service_name, duration_minutes FROM services WHERE service_id = ?',
    [serviceId],
    conn,
  );
  if (!s) throw new ServiceError(400, 'unknown_service', 'That service does not exist', { issues: { serviceId: 'Unknown service' } });
  return { ...s, duration_minutes: Number(s.duration_minutes) };
}

export async function allDentistIds(conn?: Queryable): Promise<number[]> {
  const rows = await query<{ dentist_id: number }>('SELECT dentist_id FROM dentists ORDER BY dentist_id', [], conn);
  return rows.map((r) => r.dentist_id);
}

export async function dentistExists(dentistId: number, conn?: Queryable): Promise<boolean> {
  return !!(await queryOne('SELECT 1 AS x FROM dentists WHERE dentist_id = ?', [dentistId], conn));
}
