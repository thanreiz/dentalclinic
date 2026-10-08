/**
 * Turns DATABASE_URL into mysql2 pool options. Pure (no I/O) so scripts and tests can use it.
 *
 * mysql2 rejects unknown URL params such as Aiven's `ssl-mode=REQUIRED`, so the URL is
 * parsed here and only known fields are passed on.
 *
 * SSL: enabled when the URL has `ssl-mode` = REQUIRED | VERIFY_CA | VERIFY_IDENTITY,
 * `sslmode=require`, or `ssl=true`, or when DATABASE_CA_CERT is set. With DATABASE_CA_CERT
 * (PEM text, `\n` escapes allowed) the server certificate and host name are verified.
 * In production (NODE_ENV=production) a NON-local host must use TLS with DATABASE_CA_CERT, or
 * this throws (fail closed, SECURITY-REVIEW M3). Outside production (scripts, tests) TLS without
 * a CA is still allowed (encrypted, not verified). See docs/DECISIONS.md A8 and docs/DEPLOY.md.
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

/** PEM from DATABASE_CA_CERT (`\n` escapes and surrounding quotes allowed), or undefined. */
export function caCertFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.DATABASE_CA_CERT?.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
  return raw ? raw : undefined;
}

/** TLS options for the URL (throws in production for a remote host without a verified CA). */
export function sslOptions(p: ParsedDbUrl, env: NodeJS.ProcessEnv = process.env): PoolOptions['ssl'] {
  const ca = caCertFromEnv(env);
  if (env.NODE_ENV === 'production' && !isLocalHost(p.host)) {
    if (!ca) {
      throw new Error(
        'DATABASE_CA_CERT is required in production for a remote MySQL host: set it to the PEM of the ' +
          "provider's CA certificate (Aiven: service page -> Connection information -> CA certificate). See docs/DEPLOY.md.",
      );
    }
    return { ca, rejectUnauthorized: true };
  }
  if (!p.ssl && (isLocalHost(p.host) || !ca)) return undefined;
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export function buildPoolOptions(url: string, extra: Partial<PoolOptions> = {}): PoolOptions {
  const p = parseDatabaseUrl(url);
  return {
    host: p.host,
    port: p.port,
    user: p.user,
    password: p.password,
    database: p.database,
    ssl: sslOptions(p),
    // Safety net (SECURITY-REVIEW I9): never expand an object value into `key` = val in query().
    stringifyObjects: true,
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
