/** withTransaction + one retry on InnoDB deadlock (ER_LOCK_DEADLOCK, errno 1213). */
import { withTransaction, type PoolConnection } from '../db';
import { isDeadlock } from './errors';

export async function transaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  try {
    return await withTransaction(fn);
  } catch (err) {
    if (!isDeadlock(err)) throw err;
    return withTransaction(fn);
  }
}
