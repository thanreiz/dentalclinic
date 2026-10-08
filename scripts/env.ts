/**
 * Load .env.local then .env for CLI scripts (Next.js loads them itself for the app).
 * Variables already set in the shell win, so `DATABASE_URL=... npm run db:reset` targets that DB.
 */
import path from 'node:path';
import dotenv from 'dotenv';

export const PROJECT_ROOT = path.resolve(__dirname, '..');

export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    dotenv.config({ path: path.join(PROJECT_ROOT, file), quiet: true });
  }
}
