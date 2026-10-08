/**
 * Integration tests run against a SEPARATE database (`dental_test`) on the local server so they
 * never clobber dev data. URL: TEST_DATABASE_URL, else DATABASE_URL with the db renamed.
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { isLocalHost, parseDatabaseUrl } from '../../lib/db-config';

export function testDatabaseUrl(): string {
  const root = path.resolve(__dirname, '../..');
  dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
  dotenv.config({ path: path.join(root, '.env'), quiet: true });
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const base = process.env.DATABASE_URL;
    if (!base) {
      throw new Error('No DATABASE_URL/TEST_DATABASE_URL. Start the local DB first: npm run db:local');
    }
    const u = new URL(base);
    u.pathname = '/dental_test';
    url = u.toString();
  }
  const { host, database } = parseDatabaseUrl(url);
  if (!isLocalHost(host)) throw new Error(`Integration tests only run against a local DB (got ${host})`);
  if (!/test/i.test(database)) throw new Error(`Test database name must contain "test" (got ${database})`);
  return url;
}
