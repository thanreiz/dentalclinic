import { describe, expect, it } from 'vitest';
import { buildPoolOptions, parseDatabaseUrl } from '@/lib/db-config';

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
