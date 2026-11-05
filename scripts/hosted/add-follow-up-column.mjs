// node scripts/hosted/add-follow-up-column.mjs
// One-off, safe to re-run: adds appointments.follow_up_of_id (nullable, FK to appointments) to the
// HOSTED database WITHOUT dropping anything (db:reset would wipe it). Run this BEFORE deploying the
// code that reads the column. Reads .env.hosted + .aiven-ca.pem; prints no secrets.
import mysql from "mysql2/promise";
import { loadHostedEnv } from "./load-env.mjs";

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
  const [rows] = await c.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'appointments' AND column_name = 'follow_up_of_id'",
  );
  if (rows[0].n > 0) {
    console.log("appointments.follow_up_of_id already exists: nothing to do.");
  } else {
    await c.query("ALTER TABLE appointments ADD COLUMN follow_up_of_id INT UNSIGNED NULL AFTER rescheduled_from_id");
    await c.query(
      "ALTER TABLE appointments ADD CONSTRAINT fk_appt_follow_up FOREIGN KEY (follow_up_of_id) REFERENCES appointments (appointment_id) ON DELETE RESTRICT",
    );
    console.log("Added appointments.follow_up_of_id (nullable) and its foreign key. Existing rows are untouched.");
  }
  const [[p]] = await c.query("SELECT COUNT(*) AS n FROM appointments");
  console.log(`appointments rows: ${p.n}`);
} finally {
  await c.end();
}
