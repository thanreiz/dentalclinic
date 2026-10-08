/** Reset `dental_test` to the seed state (for suites that write). */
import { resetDatabase } from '../../db/reset';
import { testDatabaseUrl } from './test-db';

export async function resetTestDb(): Promise<void> {
  await resetDatabase(testDatabaseUrl());
}
