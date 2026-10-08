# Deploy checklist (Vercel + Aiven MySQL)

The step-by-step account setup is in `SETUP.md`. This page lists what the **deployed** app needs to start safely. Missing items fail closed: the app returns 500 or the script refuses.

## Environment variables (Vercel → Project → Settings → Environment Variables, Production)

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Aiven Service URI, e.g. `mysql://avnadmin:…@<service>.aivencloud.com:<port>/defaultdb?ssl-mode=REQUIRED` |
| `DATABASE_CA_CERT` | **yes** | PEM of Aiven's CA certificate (see below). Without it every DB call fails in production (SECURITY-REVIEW M3). |
| `SESSION_SECRET` | yes | `openssl rand -base64 32` (≥ 32 chars). Rotating it logs everyone out. |
| `CRON_SECRET` | yes | `openssl rand -base64 32` (≥ 32 chars, else the reminder cron returns 500). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | yes | Gmail app password (SETUP.md step 2). |
| `CLINIC_NAME`, `CLINIC_PHONE` | recommended | `CLINIC_PHONE` appears in the privacy notice and the "too many requests" messages. |
| `SLOT_INTERVAL_MINUTES`, `NO_SHOW_THRESHOLD` | optional | Defaults 30 / 2. |
| `REQUEST_LIMIT_PER_CONTACT`, `REQUEST_LIMIT_PER_HOUR`, `REQUEST_LIMIT_PER_DAY`, `REQUEST_LIMIT_PER_IP`, `REQUEST_LIMIT_IP_WINDOW_MINUTES` | optional | Abuse caps for `/book` (defaults 3 / 60 / 300 / 5 / 10). Keep the defaults on Vercel. |

Do **not** set `SEED_STAFF_PASSWORD` on Vercel; it is only read by `npm run db:reset` on your machine.

## Getting Aiven's CA certificate (`DATABASE_CA_CERT`)

1. Aiven console → your MySQL service → **Overview** → **Connection information**.
2. Next to **CA certificate**, click **Download** (or the eye icon, then copy). You get `ca.pem`, starting with `-----BEGIN CERTIFICATE-----`.
3. Put the whole PEM into `DATABASE_CA_CERT`. Either paste it as-is (Vercel keeps the line breaks) or as one line with `\n` escapes:
   ```bash
   awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' ca.pem   # prints a one-line value to paste
   ```
4. Keep `ssl-mode=REQUIRED` in `DATABASE_URL`. With the CA set, the app verifies the server certificate and host name (`rejectUnauthorized: true`).
5. Don't commit `ca.pem` (`*.pem` is gitignored). It is public data, but there's no need to track it.

## Seeding the hosted database

Run once from your Mac (never from Vercel). The reset refuses a non-local host unless the staff password is strong:

```bash
SEED_STAFF_PASSWORD='<at least 12 chars, not the local default>' \
DATABASE_URL='<aiven uri>' DATABASE_CA_CERT="$(cat ca.pem)" \
npm run db:reset -- --yes
```

Tell panelists the staff password in person; it is not in the repo or the paper.

## Keep hosted secrets out of auto-loaded files

Keep the hosted values in `.env.hosted` (gitignored, never auto-loaded). Never name it `.env.production.local` or `.env.production`: `next start` loads those automatically, so a local production build would talk to the hosted DB and send real email. `npm run db:local` warns if either file exists.

## After deploying

- `curl -sI https://<app>/book` shows `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, and no `X-Powered-By`.
- `/book` works; the browser console shows no CSP violations.
- To end every staff session (e.g. a shared laptop was lost), generate a new `SESSION_SECRET` and redeploy.
