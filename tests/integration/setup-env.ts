/** Point lib/db at the test database inside every worker, and close the pool afterwards. */
import { afterAll } from 'vitest';
import { closePool } from '../../lib/db';
import { testDatabaseUrl } from './test-db';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET ??= 'test-session-secret-that-is-at-least-32-chars';

afterAll(async () => {
  await closePool();
});
