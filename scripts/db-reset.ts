/**
 * npm run db:reset — rebuild the schema (db/schema.sql) and reseed (db/seed.ts).
 *
 * Local hosts (localhost / 127.0.0.1) run straight away. Any other host (e.g. the Aiven demo DB)
 * prints the target and requires `--yes`:
 *   DATABASE_URL="mysql://...aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED" npm run db:reset -- --yes
 */
import { isLocalHost, parseDatabaseUrl } from '../lib/db-config';
import { resetDatabase } from '../db/reset';
import { SEED_STAFF_EMAIL } from '../db/seed';
import { loadEnv } from './env';

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Run `npm run db:local` (writes .env.local) or export DATABASE_URL.');
    process.exit(1);
  }
  const target = parseDatabaseUrl(url);
  const where = `${target.host}:${target.port}/${target.database}`;
  const local = isLocalHost(target.host);
  if (!local && !process.argv.includes('--yes')) {
    console.error(`Refusing to reset NON-LOCAL database ${where} without --yes.`);
    console.error('This DROPS every table and reseeds. Re-run with: npm run db:reset -- --yes');
    process.exit(1);
  }
  console.log(`Resetting ${local ? 'local' : 'REMOTE'} database ${where} ...`);
  await resetDatabase(url, { createDatabase: local, log: (m) => console.log(m) });
  console.log(`Done. Staff login: ${SEED_STAFF_EMAIL} / ${process.env.SEED_STAFF_PASSWORD ? '(SEED_STAFF_PASSWORD)' : 'ClinicDemo2026!'}`);
}

main().catch((err) => {
  console.error('db:reset failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
