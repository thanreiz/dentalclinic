# What You Set Up (when you wake up)

Nothing here blocks the overnight build — it runs on a local MySQL 8. These are needed only to go live (Phase 0 of the PRD). ~30 min total.

## 1. Hosted MySQL 8 — Aiven (free) — NOT TiDB
1. console.aiven.io → Create service → **MySQL** → Free plan → region Singapore.
2. Copy **Service URI** (`mysql://avnadmin:...@...aivencloud.com:PORT/defaultdb?ssl-mode=REQUIRED`).
3. That string = `DATABASE_URL`. (Railway also fine: New → Database → MySQL → `MYSQL_URL`.)
4. Same page → Connection information → **CA certificate → Download** (`ca.pem`). Its contents = `DATABASE_CA_CERT` (required in production; see `docs/DEPLOY.md`).

## 2. Demo Gmail + app password
1. New Gmail, e.g. `yourclinic.demo@gmail.com` (not personal).
2. myaccount.google.com → Security → turn on **2-Step Verification**.
3. myaccount.google.com/apppasswords → create → copy 16-char password.
4. `SMTP_USER` = that address, `SMTP_PASS` = app password, `MAIL_FROM="G4 Dental Clinic <that address>"`.

## 3. Secrets (run twice, one each)
```bash
openssl rand -base64 32
```
First = `SESSION_SECRET`, second = `CRON_SECRET`.

## 4. GitHub repo
```bash
Done: https://github.com/thanreiz/dentalclinic
```
(You're logged into gh as `thanreiz`. Run from the project folder.)

## 5. Vercel
1. vercel.com → Add New Project → import the GitHub repo.
2. Settings → Environment Variables → paste every var from `.env.example` (values from steps 1–3), including `DATABASE_CA_CERT`. Leave `SEED_STAFF_PASSWORD` out of Vercel.
3. Deploy. Then once, seed the hosted DB from your Mac with a strong staff password (≥ 12 chars, not the local default, or it refuses):
```bash
DATABASE_URL="<aiven uri>" DATABASE_CA_CERT="$(cat ca.pem)" SEED_STAFF_PASSWORD="<pick one>" npm run db:reset -- --yes
```
Keep hosted values in `.env.hosted`, never in `.env.production.local` (`next start` would load it).
4. Vercel → Settings → Cron Jobs: confirm `/api/cron/reminders` shows (from `vercel.json`).

## 6. Smoke test on live URL
Log in as `staff@clinic.test` with the `SEED_STAFF_PASSWORD` you picked in step 5, book on phone at `/book`, confirm from `/requests`, check Gmail spam once → "Not spam".

Tell me when 1–3 done and I can wire env + deploy for you.
