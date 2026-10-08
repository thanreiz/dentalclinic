import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite (QA). Runs against an already-running production server:
 *   DATABASE_URL=mysql://root@127.0.0.1:3307/dental_qa NEXT_DIST_DIR=.next-qa npm run build
 *   DATABASE_URL=... NEXT_DIST_DIR=.next-qa npx next start -p 3004
 *   npm run e2e
 * Start the server with the public abuse caps off so the suite is not throttled:
 *   REQUEST_LIMIT_PER_IP=0 REQUEST_LIMIT_PER_CONTACT=0 REQUEST_LIMIT_PER_HOUR=0 REQUEST_LIMIT_PER_DAY=0
 * (12-abuse-limits.spec.ts is opt-in and needs the DEFAULT caps: E2E_ABUSE_LIMITS=1.)
 * Env: E2E_BASE_URL (default http://localhost:3004), E2E_DATABASE_URL (default dental_qa on :3307),
 *      E2E_MAIL_LOG (JSONL file written by tests/e2e/support/smtp-sink.mjs; mail asserts are skipped without it).
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3004',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
