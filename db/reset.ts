/**
 * Rebuild a database from db/schema.sql and seed it. Shared by scripts/db-reset.ts,
 * scripts/db-local.ts, and the integration-test global setup.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { buildPoolOptions, isLocalHost, parseDatabaseUrl } from '../lib/db-config';
import { remoteSeedPasswordProblem, seedDatabase, type SeedOptions } from './seed';

export const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/** Connection options (single connection, multi-statement for the DDL file). */
function connectionOptions(url: string, withDatabase: boolean): mysql.ConnectionOptions {
  const { connectionLimit: _cl, waitForConnections: _w, queueLimit: _q, ...opts } = buildPoolOptions(url);
  void _cl; void _w; void _q;
  return { ...opts, database: withDatabase ? opts.database : undefined, multipleStatements: true, namedPlaceholders: false };
}

/** CREATE DATABASE IF NOT EXISTS for the URL's database (local dev / tests). */
export async function ensureDatabase(url: string): Promise<void> {
  const { database } = parseDatabaseUrl(url);
  const conn = await mysql.createConnection(connectionOptions(url, false));
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await conn.end();
  }
}

export type ResetOptions = SeedOptions & { seed?: boolean; createDatabase?: boolean };

/** Drop and recreate all seven tables, then (by default) seed. */
export async function resetDatabase(url: string, opts: ResetOptions = {}): Promise<void> {
  assertSeedAllowed(url, opts);
  if (opts.createDatabase) await ensureDatabase(url);
  const schema = await readFile(SCHEMA_PATH, 'utf8');
  const conn = await mysql.createConnection(connectionOptions(url, true));
  try {
    await conn.query("SET time_zone = '+08:00'");
    await conn.query(schema);
    opts.log?.('Schema applied (Listing 3.2).');
    if (opts.seed !== false) await seedDatabase(conn, opts);
  } finally {
    await conn.end();
  }
}

/**
 * SECURITY-REVIEW H2: never seed a NON-local database with the default or a short staff password.
 * Checked here (not only in scripts/db-reset.ts) so every caller is covered, before anything is dropped.
 */
export function assertSeedAllowed(url: string, opts: ResetOptions = {}, env: NodeJS.ProcessEnv = process.env): void {
  if (opts.seed === false || isLocalHost(parseDatabaseUrl(url).host)) return;
  const problem = remoteSeedPasswordProblem(opts, env);
  if (problem) {
    throw new Error(
      `Refusing to seed a NON-LOCAL database: ${problem}. Set a strong staff password (>= 12 chars, not the default), e.g. ` +
        'SEED_STAFF_PASSWORD="<strong password>" DATABASE_URL="<remote url>" npm run db:reset -- --yes',
    );
  }
}
