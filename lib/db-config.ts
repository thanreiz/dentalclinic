/**
 * Turns DATABASE_URL into mysql2 pool options. Pure (no I/O) so scripts and tests can use it.
 *
 * mysql2 rejects unknown URL params such as Aiven's `ssl-mode=REQUIRED`, so the URL is
 * parsed here and only known fields are passed on.
 *
 * SSL: enabled when the URL has `ssl-mode` = REQUIRED | VERIFY_CA | VERIFY_IDENTITY,
 * `sslmode=require`, or `ssl=true`. Certificates are verified when DATABASE_CA_CERT
 * (PEM text, `\n` escapes allowed) is set; otherwise the connection is encrypted but the
 * server certificate is not verified (Aiven uses a per-project CA). See docs/DECISIONS.md.
 */
import type { PoolOptions } from 'mysql2/promise';

export type ParsedDbUrl = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
};

const SSL_ON = new Set(['required', 'require', 'verify_ca', 'verify-ca', 'verify_identity', 'verify-full', 'true', '1']);

export function parseDatabaseUrl(url: string): ParsedDbUrl {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL (expected mysql://user:pass@host:port/db)');
  }
  if (u.protocol !== 'mysql:' && u.protocol !== 'mysql2:') {
    throw new Error(`DATABASE_URL must start with mysql:// (got ${u.protocol})`);
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL has no database name');
  const sslParam =
    u.searchParams.get('ssl-mode') ?? u.searchParams.get('sslmode') ?? u.searchParams.get('ssl') ?? '';
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    ssl: SSL_ON.has(sslParam.toLowerCase()),
  };
}

export function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export function buildPoolOptions(url: string, extra: Partial<PoolOptions> = {}): PoolOptions {
  const p = parseDatabaseUrl(url);
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  return {
    host: p.host,
    port: p.port,
    user: p.user,
    password: p.password,
    database: p.database,
    ssl: p.ssl ? (ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }) : undefined,
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 0,
    timezone: '+08:00',
    dateStrings: true,
    namedPlaceholders: true,
    decimalNumbers: true,
    ...extra,
  };
}
