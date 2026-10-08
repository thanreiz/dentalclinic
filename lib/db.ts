/**
 * Data access foundation (NF06: lib/db). One mysql2/promise pool per process.
 *
 * - connectionLimit: 5 (PRD constraint: free MySQL plans allow few connections)
 * - timezone '+08:00' + dateStrings: DATE/TIME/DATETIME go in and out as strings (NF08)
 * - every new connection runs `SET time_zone = '+08:00'` so NOW()/CURDATE() are Manila time
 * - namedPlaceholders: Listing 3.1-style `:appointment_id` params work; `?` still works
 * - SSL when the URL asks for it (Aiven: `?ssl-mode=REQUIRED`)
 *
 * Server-only. Never import this from middleware or client components.
 */
import 'server-only';
import mysql, {
  type Pool,
  type PoolConnection,
  type PoolOptions,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
import { buildPoolOptions } from './db-config';

export type { Pool, PoolConnection, ResultSetHeader };

/** Anything that can run a query: the pool or a connection inside a transaction. */
export type Queryable = Pool | PoolConnection;

/** SQL parameters: positional array for `?`, or an object for `:named` placeholders. */
export type SqlParams = unknown[] | Record<string, unknown>;

/** mysql2's own (unexported) bind-values type. */
type BindValues = Parameters<Pool['query']>[1];

type GlobalWithPool = typeof globalThis & { __dentalPool?: Pool; __dentalPoolUrl?: string };

function createPool(url: string): Pool {
  const options: PoolOptions = buildPoolOptions(url);
  const pool = mysql.createPool(options);
  // The 'connection' event hands over the core (callback) connection.
  pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+08:00'");
  });
  return pool;
}

/**
 * The shared pool. Stored on globalThis so Next.js dev hot reloads reuse it
 * instead of leaking a new pool (and 5 connections) on every edit.
 */
export function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const g = globalThis as GlobalWithPool;
  if (!g.__dentalPool || g.__dentalPoolUrl !== url) {
    g.__dentalPool = createPool(url);
    g.__dentalPoolUrl = url;
  }
  return g.__dentalPool;
}

/** Close the shared pool (scripts and tests). */
export async function closePool(): Promise<void> {
  const g = globalThis as GlobalWithPool;
  if (g.__dentalPool) {
    const p = g.__dentalPool;
    g.__dentalPool = undefined;
    g.__dentalPoolUrl = undefined;
    await p.end();
  }
}

/**
 * SELECT helper. Returns the rows typed as T.
 * Pass `conn` to run inside a transaction; defaults to the pool.
 */
export async function query<T>(sql: string, params: SqlParams = [], conn?: Queryable): Promise<T[]> {
  const db = conn ?? getPool();
  const [rows] = await db.query<RowDataPacket[]>(sql, params as BindValues);
  return rows as unknown as T[];
}

/** First row or null. */
export async function queryOne<T>(sql: string, params: SqlParams = [], conn?: Queryable): Promise<T | null> {
  const rows = await query<T>(sql, params, conn);
  return rows[0] ?? null;
}

/** INSERT/UPDATE/DELETE helper. Returns insertId / affectedRows. */
export async function execute(sql: string, params: SqlParams = [], conn?: Queryable): Promise<ResultSetHeader> {
  const db = conn ?? getPool();
  const [result] = await db.query<ResultSetHeader>(sql, params as BindValues);
  return result;
}

/**
 * Run `fn` inside one transaction on one connection.
 * Commits if `fn` resolves, rolls back if it throws (and rethrows). Always releases.
 * Use for Business Rule 9 (lock + overlap check + write) and Rule 11 (reschedule).
 *
 * Isolation is READ COMMITTED: after `lockDentist`/`lockChair` acquire their row locks, the
 * plain overlap SELECT must see rows committed by whoever held the lock before us. Under
 * InnoDB's default REPEATABLE READ the snapshot could predate the lock (e.g. Rule 10 trying
 * dentist 2 after dentist 1) and miss a just-committed booking.
 */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // connection may be broken; the original error matters more
    }
    throw err;
  } finally {
    conn.release();
  }
}

/** MySQL error helpers for route handlers. */
export function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: string })?.code === 'ER_DUP_ENTRY';
}

/** ON DELETE RESTRICT / FK violation (FR5: "In use by existing appointments"). */
export function isForeignKeyError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'ER_ROW_IS_REFERENCED_2' || code === 'ER_ROW_IS_REFERENCED' || code === 'ER_NO_REFERENCED_ROW_2';
}

/** CHECK constraint violation (NF02). */
export function isCheckConstraintError(err: unknown): boolean {
  return (err as { code?: string })?.code === 'ER_CHECK_CONSTRAINT_VIOLATED';
}
