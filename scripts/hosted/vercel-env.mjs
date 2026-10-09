// npm run hosted:env
// Pushes every production env var to the linked Vercel project (run `vercel link` first).
// Values come from .env.hosted + .aiven-ca.pem and are piped over stdin, never printed.
import { spawnSync } from "node:child_process";
import { loadHostedEnv } from "./load-env.mjs";

const hosted = loadHostedEnv();

const vars = {
  DATABASE_URL: hosted.DATABASE_URL,
  DATABASE_CA_CERT: hosted.DATABASE_CA_CERT,
  SESSION_SECRET: hosted.SESSION_SECRET,
  CRON_SECRET: hosted.CRON_SECRET,
  SMTP_HOST: hosted.SMTP_HOST || "smtp.gmail.com",
  SMTP_PORT: hosted.SMTP_PORT || "465",
  SMTP_USER: hosted.SMTP_USER,
  SMTP_PASS: hosted.SMTP_PASS,
  MAIL_FROM: hosted.MAIL_FROM,
  CLINIC_NAME: hosted.CLINIC_NAME || "Sample Dental Clinic",
  CLINIC_PHONE: hosted.CLINIC_PHONE || "0917 000 0000",
  SLOT_INTERVAL_MINUTES: hosted.SLOT_INTERVAL_MINUTES || "30",
  NO_SHOW_THRESHOLD: hosted.NO_SHOW_THRESHOLD || "2",
  // Shared venue Wi-Fi at the defense (docs/DEPLOY.md, QA-2). Remove after the defense.
  REQUEST_LIMIT_PER_IP: hosted.REQUEST_LIMIT_PER_IP || "30",
};

let failed = 0;
for (const [name, value] of Object.entries(vars)) {
  // Remove any old value first so reruns update it; "not found" is fine.
  spawnSync("vercel", ["env", "rm", name, "production", "--yes"], { encoding: "utf8" });
  const r = spawnSync("vercel", ["env", "add", name, "production"], { input: value, encoding: "utf8" });
  if (r.status === 0) {
    console.log(`set ${name}`);
  } else {
    failed++;
    console.error(`FAILED ${name}: ${(r.stderr || r.stdout).split("\n").filter(Boolean).pop()}`);
  }
}
process.exit(failed ? 1 : 0);
