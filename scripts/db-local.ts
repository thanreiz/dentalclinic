/**
 * npm run db:local — a real MySQL 8.4 server for local development, no Docker/brew needed.
 *
 * 1. Gets the official MySQL binary via `mysql-memory-server` (downloaded once from
 *    cdn.mysql.com into $TMPDIR/mysqlmsn/binaries; re-downloaded automatically if macOS purges it).
 * 2. Runs that mysqld ourselves with a PERSISTENT data dir in ./.mysql-data
 *    (mysql-memory-server itself only supports throwaway databases) in ./.mysql-data/data.
 * 3. Listens on 127.0.0.1:3307, user root, no password; creates `dental` and `dental_test`.
 * 4. Writes .env.local (if missing) with DATABASE_URL and random SESSION_SECRET / CRON_SECRET.
 * 5. On first boot (no tables yet) runs schema + seed. Afterwards your data is kept;
 *    use `npm run db:reset` to start over.
 * Stays in the foreground; Ctrl+C shuts MySQL down cleanly.
 *
 * Flags: --ephemeral  use mysql-memory-server's throwaway DB instead (always reseeded)
 *        --reset      reset + reseed `dental` on start even if it has data
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { createDB } from 'mysql-memory-server';
import { ensureDatabase, resetDatabase } from '../db/reset';
import { SEED_STAFF_EMAIL } from '../db/seed';
import { loadEnv, PROJECT_ROOT } from './env';

const MYSQL_VERSION = '8.4.9'; // >= 8.0.16 (CHECK constraints enforced)
const PORT = 3307;
// mysqld refuses a datadir whose own name starts with '.' ("Can't create UNDO tablespace ... './undo_001'"),
// so the data lives one level down in .mysql-data/data.
const DATA_DIR = path.join(PROJECT_ROOT, '.mysql-data', 'data');
const SOCKET = path.join(os.tmpdir(), `dental-mysql-${PORT}.sock`); // short path: macOS 104-char limit
const DEV_URL = `mysql://root@127.0.0.1:${PORT}/dental`;
const TEST_URL = `mysql://root@127.0.0.1:${PORT}/dental_test`;
const ENV_FILE = path.join(PROJECT_ROOT, '.env.local');

const log = (msg: string) => console.log(`[db:local] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function binaryDir(): string {
  return path.join(os.tmpdir(), 'mysqlmsn', 'binaries', MYSQL_VERSION, 'mysql');
}

async function ensureBinary(): Promise<string> {
  const mysqld = path.join(binaryDir(), 'bin', 'mysqld');
  if (existsSync(mysqld)) return mysqld;
  log(`Downloading MySQL ${MYSQL_VERSION} (one time, ~200 MB) via mysql-memory-server ...`);
  const db = await createDB({
    version: MYSQL_VERSION,
    downloadBinaryOnce: true,
    xEnabled: 'OFF',
    logLevel: 'ERROR',
  });
  await db.stop();
  if (!existsSync(mysqld)) throw new Error(`MySQL binary not found at ${mysqld} after download`);
  return mysqld;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`))));
  });
}

async function canConnect(): Promise<boolean> {
  try {
    const c = await mysql.createConnection({ host: '127.0.0.1', port: PORT, user: 'root', connectTimeout: 1000 });
    await c.end();
    return true;
  } catch {
    return false;
  }
}

function writeEnvLocal(): void {
  if (existsSync(ENV_FILE)) {
    const text = readFileSync(ENV_FILE, 'utf8');
    if (!/^DATABASE_URL=/m.test(text)) writeFileSync(ENV_FILE, `${text.trimEnd()}\nDATABASE_URL=${DEV_URL}\n`);
    log('.env.local already exists; left as is.');
    return;
  }
  const secret = () => randomBytes(32).toString('base64url');
  writeFileSync(
    ENV_FILE,
    [
      '# Local development (written by npm run db:local). Never commit this file.',
      `DATABASE_URL=${DEV_URL}`,
      `TEST_DATABASE_URL=${TEST_URL}`,
      `SESSION_SECRET=${secret()}`,
      `CRON_SECRET=${secret()}`,
      'SMTP_HOST=',
      'SMTP_PORT=465',
      'SMTP_USER=',
      'SMTP_PASS=',
      'MAIL_FROM="Sample Dental Clinic <yourclinic.demo@gmail.com>"',
      'CLINIC_NAME="Sample Dental Clinic"',
      'CLINIC_PHONE="0917 000 0000"',
      'SLOT_INTERVAL_MINUTES=30',
      'NO_SHOW_THRESHOLD=2',
      'SEED_STAFF_PASSWORD=ClinicDemo2026!',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  log('Wrote .env.local (random SESSION_SECRET and CRON_SECRET; SMTP empty = emails logged to console).');
}

async function prepareDatabases(forceReset: boolean): Promise<void> {
  await ensureDatabase(DEV_URL);
  await ensureDatabase(TEST_URL);
  const c = await mysql.createConnection({ host: '127.0.0.1', port: PORT, user: 'root', database: 'dental' });
  const [rows] = await c.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = 'dental' AND table_name = 'users'",
  );
  await c.end();
  if (forceReset || Number(rows[0].n) === 0) {
    log(forceReset ? 'Resetting `dental` (--reset) ...' : 'Empty database: applying schema and seed ...');
    await resetDatabase(DEV_URL, { log });
  } else {
    log('`dental` already has data; keeping it (npm run db:reset to start over).');
  }
}

function printReady(): void {
  log('');
  log(`MySQL ${MYSQL_VERSION} ready on 127.0.0.1:${PORT}`);
  log(`  DATABASE_URL=${DEV_URL}`);
  log(`  tests use     ${TEST_URL}`);
  log(`  staff login   ${SEED_STAFF_EMAIL} / ${process.env.SEED_STAFF_PASSWORD ?? 'ClinicDemo2026!'}`);
  log('Leave this running; in another terminal: npm run dev. Ctrl+C to stop MySQL.');
}

async function runEphemeral(): Promise<void> {
  log(`Starting throwaway MySQL ${MYSQL_VERSION} on port ${PORT} (data is lost on exit) ...`);
  const db = await createDB({
    version: MYSQL_VERSION,
    port: PORT,
    dbName: 'dental',
    downloadBinaryOnce: true,
    xEnabled: 'OFF',
    logLevel: 'ERROR',
  });
  writeEnvLocal();
  loadEnv();
  await ensureDatabase(TEST_URL);
  await resetDatabase(DEV_URL, { log });
  printReady();
  const stop = async () => {
    log('Stopping MySQL ...');
    await db.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30);
}

async function runPersistent(forceReset: boolean): Promise<void> {
  if (await canConnect()) {
    log(`Something is already listening on port ${PORT} (another db:local?). Reusing it.`);
    writeEnvLocal();
    loadEnv();
    await prepareDatabases(forceReset);
    printReady();
    return;
  }

  const mysqld = await ensureBinary();
  const basedir = path.dirname(path.dirname(mysqld));

  if (!existsSync(path.join(DATA_DIR, 'mysql.ibd'))) {
    log(`Initializing data directory ${path.relative(PROJECT_ROOT, DATA_DIR)}/ ...`);
    mkdirSync(path.dirname(DATA_DIR), { recursive: true });
    if (existsSync(DATA_DIR)) throw new Error(`${DATA_DIR} exists but is not a complete MySQL data dir; delete it and retry`);
    await run(mysqld, [
      '--no-defaults',
      '--initialize-insecure',
      `--basedir=${basedir}`,
      `--datadir=${DATA_DIR}`,
      `--log-error=${path.join(os.tmpdir(), 'dental-mysql-init.err')}`,
    ]);
  }

  log(`Starting mysqld ${MYSQL_VERSION} on 127.0.0.1:${PORT} ...`);
  const child: ChildProcess = spawn(
    mysqld,
    [
      '--no-defaults',
      `--basedir=${basedir}`,
      `--datadir=${DATA_DIR}`,
      `--port=${PORT}`,
      '--bind-address=127.0.0.1',
      `--socket=${SOCKET}`,
      '--mysqlx=OFF',
      "--default-time-zone=+08:00",
      '--character-set-server=utf8mb4',
      '--max-connections=100',
      `--log-error=${path.join(DATA_DIR, 'mysqld.err')}`,
      `--pid-file=${path.join(DATA_DIR, 'mysqld.pid')}`,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );

  let exited = false;
  activeChild = child;
  child.on('exit', (code, signal) => {
    exited = true;
    log(code === 0 ? 'mysqld stopped.' : `mysqld exited (${signal ?? code}). See .mysql-data/data/mysqld.err`);
    process.exit(code ?? 0);
  });

  for (let i = 0; i < 120 && !(await canConnect()); i++) {
    if (exited) return;
    await sleep(500);
  }
  if (!(await canConnect())) throw new Error('mysqld did not accept connections within 60 s (see .mysql-data/data/mysqld.err)');

  writeEnvLocal();
  loadEnv();
  await prepareDatabases(forceReset);
  printReady();

  const stop = () => {
    log('Shutting down mysqld ...');
    child.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

let activeChild: ChildProcess | null = null;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--ephemeral')) return runEphemeral();
  return runPersistent(args.includes('--reset'));
}

main().catch((err) => {
  console.error('[db:local] failed:', err instanceof Error ? err.message : err);
  if (activeChild && activeChild.exitCode === null) {
    activeChild.removeAllListeners('exit');
    activeChild.kill('SIGTERM');
  }
  console.error('[db:local] Try `npm run db:local -- --ephemeral` (throwaway DB) if the persistent mode fails.');
  process.exit(1);
});
