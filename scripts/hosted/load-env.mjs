// Reads the hosted values from .env.hosted (gitignored, never auto-loaded by Next)
// and the Aiven CA from .aiven-ca.pem. Never prints secret values.
import fs from "node:fs";

export function loadHostedEnv() {
  if (!fs.existsSync(".env.hosted")) {
    throw new Error("Missing .env.hosted in the project root (see docs/DEPLOY.md).");
  }
  const vars = {};
  for (const line of fs.readFileSync(".env.hosted", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) vars[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
  if (fs.existsSync(".aiven-ca.pem")) {
    vars.DATABASE_CA_CERT = fs.readFileSync(".aiven-ca.pem", "utf8");
  }
  const missing = ["DATABASE_URL", "DATABASE_CA_CERT", "SESSION_SECRET", "CRON_SECRET", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"]
    .filter((k) => !vars[k]);
  if (missing.length) throw new Error(`Missing in .env.hosted / .aiven-ca.pem: ${missing.join(", ")}`);
  return vars;
}

export function scrub(text, vars) {
  let out = text ?? "";
  for (const k of ["DATABASE_URL", "SMTP_PASS", "SESSION_SECRET", "CRON_SECRET", "SEED_STAFF_PASSWORD"]) {
    if (vars[k]) out = out.split(vars[k]).join(`<${k}>`);
  }
  return out.replace(/:\/\/([^:/\s]+):[^@\s]+@/g, "://$1:***@");
}
