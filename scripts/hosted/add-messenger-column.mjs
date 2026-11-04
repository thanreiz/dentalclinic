// node scripts/hosted/add-messenger-column.mjs
// One-off, safe to re-run: adds patients.messenger_psid to the HOSTED database WITHOUT dropping
// anything (db:reset would wipe it). Run this BEFORE deploying the code that reads the column.
// Reads .env.hosted + .aiven-ca.pem; prints no secrets.
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
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'patients' AND column_name = 'messenger_psid'",
  );
  if (rows[0].n > 0) {
    console.log("patients.messenger_psid already exists: nothing to do.");
  } else {
    await c.query("ALTER TABLE patients ADD COLUMN messenger_psid VARCHAR(40) NULL AFTER birthdate");
    console.log("Added patients.messenger_psid (nullable). Existing rows are untouched.");
  }
  const [[p]] = await c.query("SELECT COUNT(*) AS n FROM patients");
  console.log(`patients rows: ${p.n}`);
} finally {
  await c.end();
}
