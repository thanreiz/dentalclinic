import { describe, expect, it } from 'vitest';
import { buildPoolOptions, caCertFromEnv, parseDatabaseUrl, sslOptions } from '@/lib/db-config';

describe('DATABASE_URL parsing', () => {
  it('local URL without password', () => {
    expect(parseDatabaseUrl('mysql://root@127.0.0.1:3307/dental')).toEqual({
      host: '127.0.0.1', port: 3307, user: 'root', password: '', database: 'dental', ssl: false,
    });
  });
  it('Aiven URL with ssl-mode=REQUIRED and encoded password', () => {
    const p = parseDatabaseUrl('mysql://avnadmin:p%40ss%2Fw0rd@x.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED');
    expect(p).toMatchObject({ user: 'avnadmin', password: 'p@ss/w0rd', database: 'defaultdb', ssl: true, port: 12345 });
  });
  it('pool options follow the PRD', () => {
    const o = buildPoolOptions('mysql://root@127.0.0.1:3307/dental');
    expect(o).toMatchObject({ connectionLimit: 5, timezone: '+08:00', dateStrings: true });
    expect(o.ssl).toBeUndefined();
    expect(buildPoolOptions('mysql://u:p@h:1/d?ssl-mode=REQUIRED').ssl).toBeTruthy();
  });
  it('rejects non-mysql URLs', () => {
    expect(() => parseDatabaseUrl('postgres://x@y/z')).toThrow();
  });
});

describe('TLS verification (M3) and query safety (I9)', () => {
  const remote = 'mysql://u:p@x.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED';
  const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----';
  const env = (over: Record<string, string | undefined>) => ({ ...process.env, ...over }) as NodeJS.ProcessEnv;

  it('production + remote host without DATABASE_CA_CERT -> throws (fail closed)', () => {
    expect(() => sslOptions(parseDatabaseUrl(remote), env({ NODE_ENV: 'production', DATABASE_CA_CERT: '' }))).toThrow(/DATABASE_CA_CERT is required/);
    // even when the URL forgot ssl-mode: remote production traffic must be TLS
    expect(() => sslOptions(parseDatabaseUrl('mysql://u:p@db.example.com/d'), env({ NODE_ENV: 'production', DATABASE_CA_CERT: undefined }))).toThrow();
  });
  it('production + remote host with a CA -> verified TLS; \\n escapes and quotes are unwrapped', () => {
    const escaped = `"${PEM.replace(/\n/g, '\\n')}"`;
    expect(sslOptions(parseDatabaseUrl(remote), env({ NODE_ENV: 'production', DATABASE_CA_CERT: escaped }))).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(caCertFromEnv(env({ DATABASE_CA_CERT: escaped }))).toBe(PEM);
  });
  it('production + local host -> no CA needed', () => {
    expect(sslOptions(parseDatabaseUrl('mysql://root@127.0.0.1:3307/dental'), env({ NODE_ENV: 'production', DATABASE_CA_CERT: '' }))).toBeUndefined();
  });
  it('outside production: TLS without CA still allowed (scripts/tests), CA set -> verified', () => {
    expect(sslOptions(parseDatabaseUrl(remote), env({ NODE_ENV: 'test', DATABASE_CA_CERT: '' }))).toEqual({ rejectUnauthorized: false });
    expect(sslOptions(parseDatabaseUrl(remote), env({ NODE_ENV: 'test', DATABASE_CA_CERT: PEM }))).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(sslOptions(parseDatabaseUrl('mysql://root@127.0.0.1:3307/dental'), env({ NODE_ENV: 'test', DATABASE_CA_CERT: PEM }))).toBeUndefined();
  });
  it('pool never expands objects into SQL (stringifyObjects)', () => {
    expect(buildPoolOptions('mysql://root@127.0.0.1:3307/dental').stringifyObjects).toBe(true);
  });
});
