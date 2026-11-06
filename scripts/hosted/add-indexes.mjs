// node scripts/hosted/add-indexes.mjs
// One-off, safe to re-run: adds the performance indexes to the HOSTED database WITHOUT dropping or
// changing any data (db:reset would wipe it). Each index is created only if it does not exist yet.
// Reads .env.hosted + .aiven-ca.pem; prints no secrets.
import mysql from "mysql2/promise";
import { loadHostedEnv } from "./load-env.mjs";

const INDEXES = [
  ["appointments", "ix_appt_date_dentist", "(appointment_date, dentist_id, status, start_time)"],
  ["appointments", "ix_appt_status_date", "(status, appointment_date)"],
  ["appointments", "ix_appt_channel_requested", "(channel, requested_at)"],
  ["patients", "ix_patients_psid", "(messenger_psid)"],
];

const v = loadHostedEnv();
const u = new URL(v.DATABASE_URL);
const c = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port || 3306),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  ssl: { ca: v.DATABASE_CA_CERT, rejectUnauthorized: true },
  connectTimeout: 15000,
});
try {
  for (const [table, name, cols] of INDEXES) {
    const [rows] = await c.query(
      "SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?",
      [table, name],
    );
    if (rows[0].n > 0) {
      console.log(`${name} already exists: nothing to do.`);
    } else {
      await c.query(`CREATE INDEX ${name} ON ${table} ${cols}`);
      console.log(`Created ${name} on ${table}.`);
    }
  }
} finally {
  await c.end();
}
