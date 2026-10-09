# dentalclinic

A Web-Based Appointment Scheduling and Attendance Tracking System for a Small Dental Clinic.
BSCS Information Management, Group 2, Pamantasan ng Lungsod ng Maynila.

Patients request appointments online without an account; clinic staff confirm or decline them, encode phone/chat/walk-in bookings, see each dentist's and chair's day, keep one record per patient, and get attendance and no-show reports. Confirmation and day-before reminder emails are sent automatically.

Sample data only. Never enter real patient information.

## Stack

Next.js 15 (App Router) + React + TypeScript, Tailwind CSS, MySQL 8 (`mysql2`, hand-written SQL, schema = paper Listing 3.2), Zod, bcrypt + signed session cookie, Nodemailer (Gmail SMTP), Vercel Cron.

## Run locally

Needs Node.js 20+. No MySQL install needed: `db:local` downloads and runs a real MySQL 8 for you.

```bash
npm install
```
```bash
npm run db:local
```
In a second terminal:
```bash
npm run dev
```

- Booking form: http://localhost:3000/book
- Staff login: http://localhost:3000/login (local seed user `staff@clinic.test`; password printed by `db:local`)

## Tests

```bash
npm test
```
```bash
npm run e2e
```

`npm test` runs unit and integration tests against a real MySQL 8 (`db:local` must be running). `npm run e2e` runs the Playwright suite; see `playwright.config.ts`.

## Docs

- [docs/PRD.md](docs/PRD.md): requirements (FR1–FR16, NF01–NF10, business rules)
- [docs/TEST-REPORT.md](docs/TEST-REPORT.md): developer testing table
- [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md): security review and fixes
- [docs/DEPLOY.md](docs/DEPLOY.md): Vercel + Aiven deployment
- [docs/DECISIONS.md](docs/DECISIONS.md), [docs/CONTRACTS.md](docs/CONTRACTS.md): design decisions and API reference
- [docs/screenshots/appendix-b/](docs/screenshots/appendix-b/): screenshots of all nine screens
