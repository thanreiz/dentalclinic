# Build Plan — Dental Clinic Appointment System

Source of truth: [docs/PRD.md](docs/PRD.md). Every FR/NF/Business Rule ID there is built and tested here.

## Fixed decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Framework | Next.js **15.5.x** (App Router) + React + TypeScript | 15 keeps `middleware.ts` (Next 16 renamed it `proxy.ts`); PRD and paper name `middleware.ts` |
| Styling | Tailwind CSS v4 | PRD |
| DB access | `mysql2/promise`, hand-written SQL, pool `connectionLimit: 5`, `timezone: '+08:00'`, `dateStrings: true` | PRD NF08, connection cap |
| Schema | Listing 3.2 DDL verbatim in `db/schema.sql` | NF02, no ORM |
| Validation | Zod (client + route handler) | PRD |
| Auth | `bcryptjs` (cost 12) + `jose` HS256 signed httpOnly cookie, 8 h, `SameSite=Lax`, `Secure` in prod | Edge-safe in middleware; route handlers re-verify session (defense in depth vs middleware bypass) |
| Mail | Nodemailer, Gmail SMTP, `runtime = 'nodejs'` | PRD |
| Tests | Vitest (unit + integration against real MySQL 8), Playwright (e2e smoke) | |
| Local MySQL | `mysql-memory-server` dev dependency spins a real MySQL 8.0 binary locally (no Docker/brew on this Mac) | Overnight build needs a real DB without your cloud accounts |
| Mail in dev | If SMTP vars empty: log email to console instead of sending | Lets QA run before you make the Gmail account |

## Layout (NF06)

```
app/                 pages + route handlers (UI only, no SQL)
  book/ login/ (staff)/dashboard|requests|appointments|patients|setup|reports
  api/...            every write; thin: parse (Zod) -> lib -> respond
lib/db.ts            pool, withTransaction, query helpers
lib/rules.ts         Business Rules 1–12, pure where possible
lib/queries/*.ts     all SQL (Listing 3.1 overlap, 3.4 history/reports)
lib/services/*.ts    booking, confirm, reschedule, status, cron (transactions + locks)
lib/auth.ts lib/mail.ts lib/time.ts lib/validation.ts
db/schema.sql db/seed.ts scripts/db-reset.ts scripts/db-local.ts
middleware.ts  vercel.json  .env.example
tests/unit tests/integration tests/e2e
```

## Agent pipeline

| Step | Agent | Owns | Output |
| --- | --- | --- | --- |
| 1 | **Backend-A: Foundation** | scaffold, `db/`, `lib/db|rules|time|auth|validation`, seed, local MySQL, middleware, login/logout | PRD Phases 1–2; unit tests green; Table 3.17/3.18 checks |
| 2a | **Backend-B: API** (parallel) | `app/api/**`, `lib/queries`, `lib/services`, `lib/mail`, cron, `vercel.json` | Every API row in PRD; integration tests incl. 10-concurrent-booking race |
| 2b | **Frontend** (parallel) | pages, `components/**`, styles | All 9 screens; /book mobile-first 360 px; staff 768/1280 px |
| 3a | **QA** (parallel) | `tests/e2e`, `docs/TEST-REPORT.md` | FR1–FR16 test table (steps/expected/actual), Table 3.21 transitions, Table 3.22 report numbers, 360/768 px screenshots, NF10 timing |
| 3b | **Security** (parallel) | `docs/SECURITY-REVIEW.md` | Auth/middleware bypass, IDOR, SQLi, CSRF, cron secret, honeypot, headers, secrets, `npm audit`, PII leakage on public routes |
| 4 | **Fixer** | whatever 3a/3b found | All failing rows fixed + rerun |
| 5 | Me | final gate | `npm run build`, lint, typecheck, all tests, screenshots of 9 screens, `docs/HANDOFF.md` |

Each step commits to git (`feat: phase N ...`). File ownership prevents agents in parallel from overwriting each other.

## Done = all true

- [ ] `npm run build`, `npm run lint`, `tsc --noEmit` clean
- [ ] `npm test` (unit + integration on real MySQL 8) green
- [ ] Playwright e2e smoke green
- [ ] FR1–FR16, NF01–NF10 rows in `docs/TEST-REPORT.md` all PASS (local)
- [ ] October 2026 report = Dr. Reyes 10.0%, Dr. Lim 20.0%, total 14.3%
- [ ] Security review: no open High/Critical
- [ ] Screenshots of all 9 screens in `docs/screenshots/` (Appendix B)

## Not doable overnight without you (needs your accounts)

Deploy to Vercel, hosted MySQL, real Gmail send, cron firing on Vercel. All code + `docs/DEPLOY.md` step list will be ready; see [SETUP.md](SETUP.md).

## Paper-sync flags (left for you)

- Listing 3.1 / 3.4 SQL text isn't in the PRD, so queries are written to match their described behavior. Diff against the paper and paste exact text if it differs.
- Table 3.6 seeds Oct 12 as `attended`/`no-show` while today is Oct 9. PRD says expected; dashboard will show them as-is.
- Table 3.15 `patient_note` row (Open Question #1).
