/** Rebuild + reseed `dental_test` once before the integration suite. */
import { resetDatabase } from '../../db/reset';
import { testDatabaseUrl } from './test-db';

export default async function setup() {
  const url = testDatabaseUrl();
  try {
    await resetDatabase(url, { createDatabase: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reset the test database (${msg}). Is the local DB running? npm run db:local`);
  }
}
