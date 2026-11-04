# HeatWave cutover runbook (Aiven -> OCI Always Free MySQL)

Status: PLAN ONLY. Nothing provisioned. Tracks GitHub issue #1.
Sample data only. Never load real PHI.

## 0. Pre-checks (5 min)

- Is Aiven still alive? `node scripts/hosted/smoke.mjs`. If yes, nothing to dump: data is seed data, `db:reset` rebuilds it. Skip the dump.
- Confirm Always Free MySQL.Free (HeatWave standalone) is offered in your OCI home region. Capacity can be out in some regions.
- Spend guard: Always Free only. Do not upgrade the tenancy to PAYG without asking first. If a console wizard shows a price, stop.

## 1. OCI network

1. VCN with wizard "VCN with internet connectivity": one public subnet, one private subnet.
2. Private-subnet security list: ingress TCP 3306 from the public subnet CIDR. No ingress from 0.0.0.0/0.
3. Public-subnet security list: ingress TCP 3306 from 0.0.0.0/0 (Vercel egress IPs are not fixed on free plans). Egress all.

## 2. DB system

1. MySQL > DB Systems > Create. Shape `MySQL.Free`, private subnet, MySQL 8.x.
2. Admin user `admin`, strong random password (password manager).
3. Create DB `dental` after connect (see step 5), or use `db:reset` which creates tables only: create the schema manually first.
4. Note the DB private IP.

## 3. Network Load Balancer (Always Free)

1. NLB in the public subnet, public.
2. Listener TCP 3306. Backend set: the DB private IP, port 3306. Health check TCP.
3. Note NLB public IP.
4. Verify: `nc -vz <NLB-IP> 3306`.

## 4. TLS (code change needed)

Problem: `lib/db-config.ts` sslOptions uses `{ ca, rejectUnauthorized: true }`. Node also checks hostname/IP against cert SAN. Client connects to NLB IP, cert is issued for the DB, so verification will most likely fail with `ERR_TLS_CERT_ALTNAME_INVALID`.

Fix, keeping chain verification:
- Add env `DATABASE_TLS_SERVERNAME` (optional) or skip identity check via `checkServerIdentity: () => undefined` when `DATABASE_CA_CERT` is set and `DATABASE_SKIP_HOSTNAME_CHECK=1`.
- Chain still verified against pinned CA. Risk accepted: pinned CA means only that DB cert is trusted. Document in DECISIONS.md.

CA cert: HeatWave certs come from the service CA. Get PEM via OCI docs for MySQL "Connecting with TLS" or from `SHOW STATUS LIKE 'Ssl_cipher'` plus `mysql --ssl-mode=VERIFY_CA`. Confirm the actual chain before coding. Test first, from laptop:

```bash
openssl s_client -starttls mysql -connect <NLB-IP>:3306 -showcerts
```

## 5. First connect + seed

```bash
mysql -h <NLB-IP> -u admin -p --ssl-mode=REQUIRED -e "CREATE DATABASE dental CHARACTER SET utf8mb4;"
```

Update `.env.hosted` (gitignored): `DATABASE_URL=mysql://admin:<PW>@<NLB-IP>:3306/dental?ssl-mode=REQUIRED`, replace `.aiven-ca.pem` with the HeatWave PEM (or rename file and loader), keep `SEED_STAFF_PASSWORD` 12+ chars.

```bash
node scripts/hosted/seed.mjs
```

## 6. Vercel cutover

```bash
node scripts/hosted/vercel-env.mjs
```

Check it sets `DATABASE_URL` and `DATABASE_CA_CERT` for production. Then redeploy (push or `vercel --prod`).

## 7. Smoke

- `https://dentalclinic-sooty.vercel.app/book` loads slots.
- Staff login works.
- `node scripts/hosted/smoke.mjs`.
- Cron endpoint still rejects without secret.

## 8. Docs after success

- `docs/DEPLOY.md`: replace Aiven sections with this flow.
- `docs/HANDOFF.md`, `SECURITY-REVIEW.md` mentions: update.
- PRD constraint says "Aiven or Railway": paper wording patch, mention OCI HeatWave MySQL 8.

## Known risks

- Public 3306 open to world. Mitigate: strong password, TLS required, dedicated non-admin app user limited to `dental.*` (create after seed).
- Always Free DB can be reclaimed if idle/unused long: keep cron hitting it.
- Connection limit 5 in pool: fine.
