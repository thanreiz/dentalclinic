# Handoff — Oct 9, 2026 (morning)

## Status

| Area | State |
| --- | --- |
| Build (all 16 FRs, 10 NFs, 9 screens, reminder cron) | **Done**, runs locally |
| Typecheck / lint / production build | Clean |
| Unit + integration tests (real MySQL 8) | **352 / 352 pass** |
| Playwright end-to-end | **31 / 31 pass** (+1 opt-in abuse-limit spec, passes), two runs in a row |
| QA table FR1–FR16, NF01–NF10, Rules 1–12, Phases 1–10 | All PASS: [TEST-REPORT.md](TEST-REPORT.md) (doubles as the paper's developer-testing table) |
| October 2026 report | Dr. Reyes 10.0%, Dr. Lim 20.0%, total 14.3% (Table 3.22) |
| Security review | 0 Critical; 2 High, 4 Medium, 4 Low all **fixed**: [SECURITY-REVIEW.md](SECURITY-REVIEW.md) |
| Appendix B screenshots | `docs/screenshots/appendix-b/` |
| **Deployed** | **No.** The permission system blocked seeding Aiven and deploying to Vercel while you slept. You run the steps below (≈10 min) |
| GitHub | **Not pushed.** Old commits still carry `Co-Authored-By: Claude` lines, and rewriting history was blocked. Step 2 below strips them |

Aiven connection, Gmail SMTP login, and the Aiven CA certificate were all verified working (read-only). Vercel CLI is logged in as `thanreiz`.

## Morning: go live (run in order, from the project folder)

**0. Move the project out of the temporary folder first.** This session's folder is deleted when the session is. Ask Claude to move the session to a folder you pick (e.g. `~/Desktop/Competitions & Hackathons/07. dental-clinic`), then `cd` there.

**1. Check it runs locally** (two terminals):
```bash
npm run db:local
```
```bash
npm run dev
```
Open http://localhost:3000/book and http://localhost:3000/login (`staff@clinic.test` / `ClinicDemo2026!`, local only).

**2. Remove the Claude lines from commit messages** (history is unpushed, so this is safe):
```bash
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --msg-filter 'sed -E "/^[Cc]o-[Aa]uthored-[Bb]y:.*$/d" | git stripspace' -- main && rm -rf .git/refs/original
```

**3. Push to a private GitHub repo:**
```bash
gh repo create dental-clinic-appointments --private --source . --push
```

**4. Create tables + sample data on Aiven** (reads `.env.hosted` and `.aiven-ca.pem`; prints no secrets):
```bash
node scripts/hosted/seed.mjs
```

**5. Create the Vercel project and push all env vars** (values come from `.env.hosted`, never printed; sets `REQUEST_LIMIT_PER_IP=30` for the defense):
```bash
vercel link --yes --project dental-clinic-appointments
```
```bash
node scripts/hosted/vercel-env.mjs
```

**6. Deploy:**
```bash
vercel deploy --prod
```
Optional: in Vercel → Project → Settings → Git, connect the GitHub repo for auto-deploys. Recommended: add `"regions": ["sin1"]` to `vercel.json` (Singapore, next to Aiven) before deploying. Every page makes several DB queries, so a US region adds noticeable latency (NF10).

**7. Smoke test on the live URL:** `/book` on your phone over mobile data → submit → `/login` as `staff@clinic.test` with the **hosted** password (it's `SEED_STAFF_PASSWORD` in `.env.hosted`, not the local one) → `/requests` → confirm with a chair → email arrives in the demo Gmail's recipient (use your own email on the form; check spam once, mark "Not spam"). Then trigger the reminder job once:
```bash
curl -H "Authorization: Bearer <CRON_SECRET from .env.hosted>" https://<your-app>.vercel.app/api/cron/reminders
```
Vercel → Settings → Cron Jobs should list `/api/cron/reminders` (daily 01:00 UTC = 9:00 AM Manila).

## Files only you have (gitignored, never commit)

- `.env.hosted`: Aiven URL, Gmail app password, `SESSION_SECRET`, `CRON_SECRET`, `SEED_STAFF_PASSWORD` (hosted staff login). Named so Next.js never auto-loads it.
- `.aiven-ca.pem`: Aiven project CA (public, but no need to track).
- `.env.local`: local dev values (written by `npm run db:local`).

## Demo day (from PRD Phase 11 + reports)

- Day before and right after the defense: `node scripts/hosted/seed.mjs` (clears panelist entries).
- `REQUEST_LIMIT_PER_IP=30` is already in the env push (shared venue Wi-Fi). After the defense you can remove it and redeploy (default 5).
- Rehearse the deployment answer (PRD Open Questions #4).

## For the paper

- Listing 3.1 / 3.4: the PRD didn't include their exact SQL, so `lib/queries/overlap.ts` and `lib/queries/{patients,reports}.ts` implement the described behaviour. Diff them against the paper.
- Table 3.15: add the `patient_note` row (Open Question #1).
- Table 3.17 / 3.18 cases were written from the Rule 5 worked example (`tests/unit/`); swap in the paper's exact rows if they differ.
- Seed has Oct 12 rows as attended/no-show while today is Oct 9 (Table 3.6, PRD says expected).
- Every judgment call the agents made: [DECISIONS.md](DECISIONS.md). API/function reference: [CONTRACTS.md](CONTRACTS.md).

## How it was built

Backend-A (foundation) → Backend-B (API) ∥ Frontend (9 screens) → Security review ∥ QA → Security fixer → QA fixer → final check. All agents ran on the local MySQL 8 and sent no real email. One exception: before `.env.hosted` was renamed (it was briefly `.env.production.local`, which `next start` auto-loads), the Security agent's server ran one read-only query against Aiven; it failed because the tables didn't exist yet, so nothing was written.
