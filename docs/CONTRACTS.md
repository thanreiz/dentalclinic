# Contracts (Foundation → Backend-B, Frontend, QA, Security)

Read this instead of the code. Source of truth for behavior is `docs/PRD.md`; calls made by Backend-A are in `docs/DECISIONS.md`.

## Run it locally

```bash
npm install
npm run db:local        # terminal 1: MySQL 8.4.9 on 127.0.0.1:3307, keeps running (Ctrl+C stops it)
npm run dev             # terminal 2: http://localhost:3000
```

- First `db:local` downloads MySQL (~200 MB, once), creates `.mysql-data/data`, DBs `dental` + `dental_test`, writes `.env.local` (random `SESSION_SECRET`/`CRON_SECRET`, SMTP empty), and seeds `dental`. Later runs keep your data.
- `npm run db:local -- --reset` reseeds on start; `-- --ephemeral` = throwaway DB (fallback).
- `npm run db:reset` rebuilds + reseeds `DATABASE_URL` (non-local host needs `-- --yes` **and** a `SEED_STAFF_PASSWORD` that is not the default and has ≥ 12 chars, or it refuses).
- **Staff login (local only):** `staff@clinic.test` / `ClinicDemo2026!` (or `SEED_STAFF_PASSWORD`). The hosted demo uses its own password, shared in person.
- Never keep hosted values in `.env.production.local` / `.env.production`: `next start` loads them automatically. They live in `.env.hosted` (gitignored, never auto-loaded).
- Tests: `npm test` (unit + integration; needs db:local running), `npm run test:unit`, `npm run test:integration`. Integration resets/seeds `dental_test`, never `dental`.

## Module map (NF06)

| File | Use it for | Runtime |
| --- | --- | --- |
| `lib/db.ts` | pool, `query`, `queryOne`, `execute`, `withTransaction`, error helpers | server only (`server-only`) |
| `lib/db-config.ts` | `parseDatabaseUrl`, `buildPoolOptions`, `isLocalHost` | anywhere (pure) |
| `lib/time.ts` | Manila date/time helpers, formatting | anywhere (pure) |
| `lib/rules.ts` | Business Rules 1–12 (pure parts), ENUM constants, contact numbers, no-show rate | anywhere (pure) |
| `lib/queries/overlap.ts` | Listing 3.1 overlap SQL, free chairs, locks, working hours, `checkBookable` | server only |
| `lib/validation.ts` | Zod schemas for every API input + `fieldErrors`, `honeypotTripped` | anywhere |
| `lib/http.ts` | `jsonError`, `parseJsonBody`, `readJsonBody` (415/413 checks), `parseSearchParams`, `parseWith` | route handlers |
| `lib/auth.ts` | `getSession`, `requireStaff`, `requireStaffPage`, `createSession`, `destroySession`, `verifyCredentials`, `hashPassword` | server only |
| `lib/session.ts` | JWT sign/verify (`exp`/`iat`/`sub` required), cookie options, `safeNextPath` (normalized, same-origin only) | edge-safe |
| `lib/patient-note.ts` | M2 "details differ" flag: `mismatchFlag`, `withMismatchFlag`, `splitMismatchFlag`, `MISMATCH_PREFIX` | anywhere (pure) |
| `lib/route-access.ts` | `isPublicRoute(path, method)` | edge-safe |
| `lib/types.ts` | row + DTO types | types |
| `db/schema.sql` | Listing 3.2 verbatim (+ DROPs) | — |
| `db/seed.ts`, `db/reset.ts` | seed data, `resetDatabase(url, opts)` | scripts/tests |

Owned by others (not built yet): `lib/queries/*` (besides overlap), `lib/services/*`, `lib/mail.ts`, `app/api/**` (besides auth), all pages besides the login/dashboard placeholders.

## lib/db.ts

```ts
type Queryable = Pool | PoolConnection;
type SqlParams = unknown[] | Record<string, unknown>;   // `?` array, or `:name` object
getPool(): Pool                                          // globalThis singleton (HMR-safe), connectionLimit 5
query<T>(sql, params?, conn?): Promise<T[]>
queryOne<T>(sql, params?, conn?): Promise<T | null>
execute(sql, params?, conn?): Promise<ResultSetHeader>   // insertId, affectedRows
withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T>  // READ COMMITTED; commit/rollback/release
closePool(): Promise<void>
isDuplicateKeyError(err) / isForeignKeyError(err) / isCheckConstraintError(err): boolean
```

- Dates/times come back as strings: DATE `'2026-10-19'`, TIME `'10:00:00'`, DATETIME `'2026-10-18 09:00:00'`. Bind dates as `'YYYY-MM-DD'`, times as `'HH:MM'` or `'HH:MM:SS'`.
- Session `time_zone` is `+08:00`, so `NOW()` is Manila time.
- `COUNT(*)`/`SUM()` may come back as strings or numbers: wrap with `Number()`.
- FK RESTRICT error code: `ER_ROW_IS_REFERENCED_2` → 409 "In use by existing appointments". Duplicate contact: `ER_DUP_ENTRY` → 409.

## lib/time.ts (Asia/Manila, all pure, `now: Date` injectable)

```ts
nowManila(now?): { date: 'YYYY-MM-DD', time: 'HH:MM' }
nowManilaDateTime(now?): 'YYYY-MM-DD HH:MM:SS'
todayManila(now?) / tomorrowManila(now?): 'YYYY-MM-DD'
addDays(date, n) / dayOfWeek(date) /* 0 = Sunday */ / compareDates(a, b) / monthOf(date) / monthRange('YYYY-MM') -> {first, last}
isValidDate(s) / isValidTime(s)
toMinutes('HH:MM[:SS]') / fromMinutes(n) / toHHMM(t) / toHHMMSS(t) / addMinutes(t, n) / compareTimes(a, b)
formatTime12('13:30') -> '1:30 PM'
formatDateHuman('2026-10-15') -> 'Oct 15, 2026'
formatHuman('2026-10-15', '10:00') -> 'Oct 15, 2026, 10:00 AM'   // use for emails
```

## lib/rules.ts

```ts
APPOINTMENT_STATUSES = ['pending','scheduled','attended','cancelled','declined','no-show']; type AppointmentStatus
CHANNELS = ['online','phone','chat','walk-in']; type Channel
STAFF_CHANNELS = ['phone','chat','walk-in']; ACTIVE_STATUSES = ['pending','scheduled']
FINAL_STATUSES = ['declined','attended','cancelled','no-show']; STAFF_SET_STATUSES = ['attended','cancelled','no-show']
DAYS_OF_WEEK = ['Sunday', ..., 'Saturday']
slotIntervalMinutes()      // SLOT_INTERVAL_MINUTES, default 30
defaultNoShowThreshold()   // NO_SHOW_THRESHOLD, default 2

computeEndTime(start, durationMinutes): 'HH:MM'                 // Rule 4
hoursForDate(scheduleRows, date): row | null                    // Rule 2 (by weekday)
isWithinHours({start,end}, hours | null): boolean               // Rule 2
isInPast(date, start, now?): boolean   /* start <= now */       // Rule 3
hasStarted(date, start, now?): boolean /* same test */          // Rule 7 helper
overlaps(a, b) / overlapsAny(range, list): boolean              // Rule 1, back-to-back allowed
openSlots({ date, hours, durationMinutes, existing, now?, intervalMinutes? }): {start,end}[]   // Rule 5
unionSlots([{ dentistId, slots }]): Slot[]                      // dentistId=any; dentistIds ascending
canTransition(from, to, { startPassed }): boolean               // Rule 7
allowedTransitions(from, { startPassed }): AppointmentStatus[]  // for buttons
isActiveStatus(s) / isFinalStatus(s)
normalizeContact(raw): string | null   // '+63 917-555-0101' -> '09175550101'; null = invalid
isValidContact(raw) / formatContact('09175550101') -> '0917 555 0101'
noShowRate(attended, noShow): number | null   /* noShow / (attended + noShow) */
formatRate(rate) -> '14.3%' ('—' for null)
```

## lib/queries/overlap.ts (call inside `withTransaction`, after the locks)

```ts
type OverlapParams = { date, start, end, dentistId, chairId?: number | null, appointmentId: number /* 0 for new, NEVER null */ };
OVERLAP_SQL                                      // Listing 3.1-style, named params
findOverlaps(conn, p): Promise<OverlapRow[]>     // same date, pending/scheduled, id <> :appointment_id,
                                                 // dentist OR (chair not null AND same chair), start < :end AND end > :start
freeChairs(conn, date, start, end, excludeAppointmentId = 0): Promise<ChairRow[]>   // Rule 6
lockDentist(conn, id) / lockChair(conn, id): Promise<row | null>                    // SELECT ... FOR UPDATE (Rule 9)
dentistSchedules(conn, dentistId): ScheduleRow[]
workingHoursOn(conn, dentistId, date): { start, end } | null    // 'HH:MM'
activeRangesForDentist(conn, dentistId, date, excludeId = 0): { start, end }[]   // feed to openSlots
checkBookable(conn, p, now?): { ok: true } | { ok: false, reason: 'in_past' | 'not_working' | 'outside_hours' }
                              | { ok: false, reason: 'overlap', conflicts }     // Rules 3, 2, 1
```

Rule 9 pattern: `withTransaction(async c => { await lockDentist(c, d); if (chair) await lockChair(c, chair); const r = await checkBookable(c, {...}); if (!r.ok) throw ...; INSERT ... })`. Rule 10 (any dentist): loop dentists by id, `lockDentist` + `checkBookable` each, take the first ok.

## lib/validation.ts (Zod 4) — schema → endpoint

| Schema (type) | Endpoint | Notes |
| --- | --- | --- |
| `loginSchema` (`LoginInput`) | `POST /api/auth/login` | email trimmed + lowercased |
| `slotsQuerySchema` (`SlotsQuery`) | `GET /api/slots` | `{date, serviceId, dentistId: number \| 'any'}`, coerces strings |
| `bookingRequestSchema` (`BookingRequest`) | `POST /api/requests` | `serviceId, dentistId (id\|'any'), date, start, fullName, contactNumber (normalized), email (required), birthdate, patientNote?, consent: true, website?`. Call `honeypotTripped(body)` **before** parsing and return a fake success without saving. |
| `staffBookingSchema` (`StaffBooking`) | `POST /api/appointments` | exactly one of `patientId` / `newPatient {fullName, contactNumber, email (null ok), birthdate}`; `serviceId, dentistId, date, start, chairId, channel (phone/chat/walk-in), patientNote?` |
| `confirmSchema` | `POST /api/appointments/[id]/confirm` | `{chairId}` |
| `declineSchema` | `POST /api/appointments/[id]/decline` | `{}` |
| `rescheduleSchema` | `POST /api/appointments/[id]/reschedule` | `{date, start, dentistId, chairId}` |
| `statusSchema` | `POST /api/appointments/[id]/status` | `{status: 'attended' \| 'cancelled' \| 'no-show'}` |
| `noteSchema` | `PATCH /api/appointments/[id]/note` | `{dentistNote}`; blank → `null` |
| `idParamSchema` | any `[id]` route param | |
| `setupEntitySchema`, `setupSchemas[entity].create/update`, `setupDeleteSchema` | `/api/setup/[entity]` | dentists `{dentistName, schedules?: [{dayOfWeek,startTime,endTime}]}` (update with `schedules` replaces the week); schedules `{dentistId, dayOfWeek, startTime, endTime}` / `{id, startTime, endTime}`; services `{serviceName, durationMinutes 5–480}`; chairs `{chairName}`; updates carry `id` |
| `patientSearchSchema` | `GET /api/patients?q=&page=` | |
| `patientPatchSchema` | `PATCH /api/patients/[id]` | any subset, ≥ 1 field; `email: ''` → `null` |
| `reportQuerySchema`, `dashboardQuerySchema` | `/reports`, `/dashboard` search params | `month 'YYYY-MM'`, `threshold?`; `date?`, `view dentist\|chair` |

Primitives: `dateSchema`, `timeSchema` ('HH:MM' only), `monthSchema`, `idSchema`, `contactNumberSchema`, `emailSchema`, `optionalEmailSchema`, `birthdateSchema`, `patientNoteSchema`. `fieldErrors(zodError)` → `{ field: message }`.

### Error shape (lib/http.ts)

`parseJsonBody(req, schema)` / `parseSearchParams(params, schema)` → `{ ok: true, data } | { ok: false, response }`. 400 body: `{ "error": "validation_error", "message": "...", "issues": { "field": "message" } }`. Use `jsonError(status, code, extra)` for others, e.g. `jsonError(409, 'slot_taken', { slots })`.

## Auth

| Helper | Where | Behavior |
| --- | --- | --- |
| `requireStaff()` | route handlers | `const a = await requireStaff(); if (!a.ok) return a.response;` → 401 `{"error":"unauthorized"}` |
| `requireStaffPage(nextPath?)` | staff Server Components | returns `StaffUser {userId, name, email}` or redirects to `/login?next=…` |
| `getSession()` | anywhere server-side | `StaffUser \| null` |
| `createSession(user)` / `destroySession()` | login/logout handlers | cookie `session`, httpOnly, Lax, Secure in prod, path `/`, 8 h |
| `verifyCredentials(email, pw)` | login | constant-ish time, `null` on any failure |

- `middleware.ts` guards everything except: pages `/book`, `/book/*`, `/login`; `GET /api/slots`, `POST /api/requests`, `POST /api/auth/login`, `GET /api/cron/reminders`; static files. Other methods on those API paths need a session. Cross-site non-GET API calls → 403.
- `app/(staff)/layout.tsx` calls `requireStaffPage()` — put every staff page under `app/(staff)/`.
- Built: `POST /api/auth/login` → 200 `{ok, user:{name,email}}` / 401 `{"error":"invalid_credentials","message":"Invalid email or password"}` / 400 validation; `POST /api/auth/logout` → 200 `{ok:true}`.
- Placeholders (Frontend replaces): `app/login/page.tsx` + `LoginForm.tsx`, `app/(staff)/dashboard/page.tsx`, `app/(staff)/LogoutButton.tsx`. `/` redirects to `/dashboard`.

## lib/types.ts

Row types use the exact Listing 3.2 column names: `UserRow`, `PatientRow`/`Patient`, `DentistRow`/`Dentist`, `ScheduleRow`/`Schedule`, `ServiceRow`/`Service`, `ChairRow`/`Chair`, `AppointmentRow`/`Appointment`, plus `AppointmentDetail` (row + `full_name, contact_number, patient_email, dentist_name, service_name, duration_minutes, chair_name`), `StaffUser`, `TimeRange {start,end}`, `WorkingHours`, `Slot {start, end, dentistIds}`, `ApiError`.

## Seed facts (for tests and screenshots)

- Users: `staff@clinic.test`. Dentists: 1 Dr. Reyes, 2 Dr. Lim (Mon–Sat 09:00–17:00). Services: 1 Oral prophylaxis 30, 2 Tooth filling 60, 3 Tooth extraction 45. Chairs: 1 Chair 1, 2 Chair 2.
- Patients 1–12: Maria Santos `09175550101`, Jose Ramos `09185550102`, Ana Dela Cruz, Juan Bautista, Liza Mendoza, Paolo Garcia (no email), Kristine Villanueva, Ramon Aquino, Carmela Torres (no email), Miguel Fernandez, Bea Castillo, Nestor Pascual.
- Appointments 1–3 = Table 3.6 (1: Maria Oct 12 09:00 attended; 2: Maria Oct 19 10:00–11:00 Reyes Chair 1 **scheduled**; 3: Jose Oct 12 09:30 Lim no-show). 36 more on Oct 1–8. Nothing else after Oct 12 → the only active row is #2.
- October 2026: Reyes 18/2/2 (10.0%), Lim 12/1/3 (20.0%), total 14.3%. Repeat no-shows at threshold 2: Jose Ramos, Miguel Fernandez; threshold 3: none.

## Read queries for staff pages (Backend-B) — `lib/queries/*`

Server-only (they import `lib/db`). Call them from staff Server Components (`export const dynamic = 'force-dynamic'`). Every call reads the DB live (NF04/NF05); nothing is cached. DTO types are in `lib/types.ts` (camelCase; dates `'YYYY-MM-DD'`, times `'HH:MM'`, datetimes `'YYYY-MM-DD HH:MM:SS'` Manila). `now` params are optional (tests inject them).

| Module | Function | Returns |
| --- | --- | --- |
| `dashboard.ts` | `getDaySchedule(date, now?)` | `DaySchedule` = `{ date, dayOfWeek, dentists: DentistDay[], chairs: ChairDay[], unassigned: ApptBlock[], gridStart, gridEnd, slotDurationMinutes }` |
| | `getDashboardSummary(date = today)` | `{ todayTotal, pendingCount, tomorrowCount }` |
| `requests.ts` | `listPendingRequests(now?)` | `PendingRequest[]`, oldest `requestedAt` first |
| | `countPending()` | `number` (nav badge) |
| `appointments.ts` | `getAppointmentDetail(id, now?)` | `AppointmentDetailView \| null` |
| `patients.ts` | `searchPatients(q, page = 1, pageSize = 20)` | `{ rows: PatientListItem[], total }` |
| | `getPatient(id)` | `PatientProfile \| null` |
| | `getPatientHistory(id)` | `PatientHistoryItem[]`, newest first (Listing 3.4 style, `PATIENT_HISTORY_SQL`) |
| `setup.ts` | `listDentistsWithSchedules()` | `DentistWithSchedules[]` (`schedules` rows + `week[0..6]` with `null` = off + `appointmentCount`) |
| | `listServices()` / `listChairs()` | `ServiceItem[]` / `ChairItem[]` (each with `appointmentCount`) |
| `reports.ts` | `getMonthlyReport('YYYY-MM')` | `MonthlyReport` = `{ month, totals, byDentist[], byService[] }`, each a `ReportCounts` |
| | `getRepeatNoShows(threshold)` | `RepeatNoShow[]` = `{ patientId, fullName, contactNumber, noShowCount, lastNoShowDate }` |

Shapes:

```ts
ApptBlock      = { appointmentId, start, end, status, channel, patientName, serviceName, dentistName, chairName: string | null }
DentistDay     = { dentistId, dentistName, hours: {start,end} | null /* null = "Not working" */, appointments: ApptBlock[], openSlots: {start,end}[] }
ChairDay       = { chairId, chairName, appointments: ApptBlock[] }
PendingRequest = { appointmentId, patientId, patientName, contactNumber, email, serviceId, serviceName, durationMinutes,
                   dentistId, dentistName, date, start, end, patientNote, requestedAt, startPassed }
AppointmentDetailView = { appointmentId, patient: {id,name,contact,email,birthdate}, dentist: {id,name},
                   service: {id,name,durationMinutes}, chair: {id,name} | null, status, channel, date, start, end,
                   requestedAt, patientNote, dentistNote, reminderSentAt, rescheduledFromId, replacedById,
                   allowedTransitions: AppointmentStatus[], startPassed }
PatientListItem = { patientId, fullName, contactNumber, email, birthdate, appointmentCount, lastVisitDate /* last attended */ }
PatientHistoryItem = { appointmentId, date, start, end, serviceName, dentistName, chairName, status, channel,
                   dentistNote, patientNote, rescheduledFromId, requestedAt }
ReportCounts   = { attended, cancelled, noShow, total /* = a + c + n */, noShowRate: number | null /* formatRate() */ }
```

Semantics:

- **Dashboard grid** shows `pending`, `scheduled`, `attended`, `no-show`. `cancelled` and `declined` are left out (they hold no time; a rescheduled original would otherwise appear twice). Pending requests have no chair, so in the chair view they only appear in `unassigned`.
- **`openSlots`** per dentist = Rule 5 (`lib/rules openSlots`) stepping `SLOT_INTERVAL_MINUTES`, using the **shortest service duration** (`slotDurationMinutes`), against that dentist's pending + scheduled rows; past starts dropped for today. Use `GET /api/slots` for a specific service.
- **`gridStart`/`gridEnd`**: earliest start / latest end over that weekday's working hours and that day's blocks; `null` when nobody works and nothing is booked.
- **Summary**: `todayTotal` = grid rows on `date`; `pendingCount` = all pending (any date); `tomorrowCount` = `scheduled` rows on `date + 1` (reminder candidates).
- **`allowedTransitions`** comes from `lib/rules allowedTransitions(status, { startPassed })` with Manila now: for pending it is `['scheduled','declined']` (scheduled = Confirm button); for scheduled before start `['cancelled']`, after start `['attended','cancelled','no-show']`. Reschedule is allowed when `status === 'scheduled'`.
- **`replacedById`**: the row whose `rescheduled_from_id` = this id (link "Rescheduled to #…"); `rescheduledFromId` links back.
- **Patient search**: `q` matches `full_name LIKE %q%` OR (if `q` has ≥ 3 digits) the normalized digits as a partial contact match (`+63 917-555` → `0917555`). Empty `q` lists everyone. Sorted by name.
- **Reports**: only `attended`/`cancelled`/`no-show` rows in the month count; `cancelled` excludes reschedules. Groups with no such rows are omitted. Repeat no-shows are all-time (not month-scoped), `HAVING COUNT(*) >= :threshold`, most no-shows first. Default threshold: `defaultNoShowThreshold()` from `lib/rules`.

## API (Backend-B) — `app/api/**`

All bodies/responses are JSON. Request bodies must be sent as `Content-Type: application/json` (else 415 `unsupported_media_type`) and be ≤ 64 KB (else 413 `payload_too_large`); routes without input accept an empty body. **Every error** is `{ error: <code>, message: <human text>, ...extra }` — show `message` to users; branch on `error`. Validation errors: 400 `{ error: 'validation_error', message, issues: { field: msg } }`. Unexpected errors: 500 `{ error: 'server_error' }` (details only in server logs). Staff routes return 401 `{ error: 'unauthorized' }` without a session (middleware, and again in the handler via `requireStaffApi(req)`).

| Method + path | Access | Body / query | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET /api/slots` | public | `?date&serviceId&dentistId=<id>\|any[&excludeAppointmentId]` | `{ slots: [{ start, end, dentistIds }] }` | 400 `date_in_past`, `date_out_of_range` (public: today..+60 days; staff session: ..+366), `unknown_service`, `unknown_dentist`; 401 if `excludeAppointmentId` without session |
| `POST /api/requests` | public | `bookingRequestSchema` (+ `website` honeypot) | 201 `{ ok: true }` (also for honeypot hits; nothing saved) | 400; 409 `slot_taken` `{ message: 'That time was just taken. Please pick another slot.', slots }`; **429 `too_many_requests` `{ message }`** (show `message`): ≥ `REQUEST_LIMIT_PER_CONTACT` (3) pending online requests on that number, clinic-wide `REQUEST_LIMIT_PER_HOUR` (60) / `REQUEST_LIMIT_PER_DAY` (300) reached, or `REQUEST_LIMIT_PER_IP` (5) accepted per 10 min from this IP (+ `Retry-After`). A matched number with different name/email/birthdate still gets 201; `patient_note` is prefixed with the "details differ" flag. |
| `POST /api/auth/login` | public | `{ email, password }` | `{ ok, user }` + cookie | 401 `invalid_credentials`; 429 `too_many_attempts` (+ `Retry-After`) after 10 failures / 15 min per IP+email, or 50 / 15 min per email from any IP |
| `POST /api/appointments` | staff | `staffBookingSchema` | 201 `{ ok, appointmentId, patientId }` | 409 `in_past` \| `outside_hours` \| `dentist_conflict` \| `chair_conflict` (+`conflictIds`) \| `duplicate_contact` (+`existingPatientId`); 400 `unknown_patient\|unknown_chair\|unknown_dentist\|unknown_service` |
| `POST /api/appointments/[id]/confirm` | staff | `{ chairId }` | `{ ok: true, emailSent, emailError?: 'Confirmed, but the email could not be sent.', emailSkipped?: 'no_email' }` | 409 `slot_unavailable` `{ message: 'Slot no longer free', reason: in_past\|outside_hours\|dentist_conflict\|chair_conflict, slots, freeChairs: [{chairId, chairName}] }`; 409 `invalid_transition`; 404; 400 `unknown_chair` |
| `POST /api/appointments/[id]/decline` | staff | none | `{ ok: true }` | 409 `invalid_transition`; 404 |
| `POST /api/appointments/[id]/reschedule` | staff | `{ date, start, dentistId, chairId }` | `{ ok: true, newId }` | 409 `invalid_transition` (not scheduled) \| `in_past` \| `outside_hours` \| `dentist_conflict` \| `chair_conflict`; 404 |
| `POST /api/appointments/[id]/status` | staff | `{ status: attended\|cancelled\|no-show }` | `{ ok: true, status }` | 409 `invalid_transition` `{ message, status: <current> }`; 404 |
| `PATCH /api/appointments/[id]/note` | staff | `{ dentistNote }` (≤ 2000; `''`/null clears) | `{ ok: true, dentistNote }` | 404 |
| `GET /api/chairs/free` | staff | `?date&start&(end\|serviceId)[&excludeId]` | `{ chairs: [{ chairId, chairName }] }` | 400 |
| `GET /api/patients` | staff | `?q=&page=` | `{ rows: PatientListItem[], total, page, pageSize: 20 }` | |
| `PATCH /api/patients/[id]` | staff | any of `{ fullName, contactNumber, email, birthdate }` | `{ ok: true, patient: PatientProfile }` | 409 `duplicate_contact` 'Contact number already used by another patient'; 404 |
| `GET /api/setup/[entity]` | staff | `entity` ∈ dentists, schedules, services, chairs; schedules accept `?dentistId=` | `{ items }` (dentists: `DentistWithSchedules[]`; services: `ServiceItem[]`; chairs: `ChairItem[]`; schedules: `{scheduleId, dentistId, dayOfWeek, startTime, endTime}[]`) | 404 unknown entity |
| `POST /api/setup/[entity]` | staff | dentists `{ dentistName, schedules? \| week? }`; schedules `{ dentistId, dayOfWeek, startTime, endTime }`; services `{ serviceName, durationMinutes }`; chairs `{ chairName }` | 201 `{ ok: true, id }` | 409 `duplicate_name` / `duplicate_day`; 400 `check_violation`, `unknown_dentist` |
| `PATCH /api/setup/[entity]` | staff | dentists `{ id, dentistName?, schedules? \| week? }` (week given = replace whole week); schedules `{ id, startTime, endTime }` **or** replace a week `{ dentistId, week }` / `{ dentistId, schedules }`; services `{ id, serviceName?, durationMinutes? }`; chairs `{ id, chairName }` | `{ ok: true }` | 404; 409 duplicates |
| `DELETE /api/setup/[entity]` | staff | `{ id }` or `?id=` | `{ ok: true }` | 409 `in_use` 'In use by existing appointments'; 404 |
| `GET /api/cron/reminders` | `Authorization: Bearer $CRON_SECRET` | none | `{ sent, failed, date, skipped?: 'already_running' }` | 401 `unauthorized`; 500 `cron_not_configured` (CRON_SECRET unset or < 32 chars) |

Week shape (setup): `week` = exactly 7 entries, index 0 = Sunday, each `null` (off) or `{ startTime: 'HH:MM', endTime: 'HH:MM' }`. `schedules` = `[{ dayOfWeek, startTime, endTime }]`, omitted days off. If both are sent, `schedules` wins. Changing hours never moves existing appointments.

Confirm flow for the UI: call `GET /api/chairs/free?date&start&end&excludeId=<id>` to fill the chair picker; on 409 `slot_unavailable` show "Slot no longer free" with `freeChairs` (pick another chair) or decline. Reschedule flow: `GET /api/slots?...&dentistId=<id>&excludeAppointmentId=<id>` (staff) then `GET /api/chairs/free?...&excludeId=<id>`.

Services (`lib/services/*`, server-only) if a Server Action or page needs them: `getSlots`, `createOnlineRequest`, `createStaffBooking`, `confirmAppointment`, `declineAppointment`, `rescheduleAppointment`, `setAppointmentStatus`, `setDentistNote`, `updatePatient`, setup CRUD, `runReminders`. They throw `ServiceError(status, code, message, extra)`; `errorResponse(err)` maps any error to the JSON above.

Mail (`lib/mail.ts`): `sendConfirmation`, `sendReminder` never throw (`{ ok } | { ok: false, error }`). With `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` unset and `NODE_ENV !== 'production'`, emails are printed to the server console with a `[mail:dev]` prefix and count as sent. In production, unset SMTP = failure.

## Security behaviour (see docs/SECURITY-REVIEW.md, DECISIONS S1–S14)

- **Headers** on every response (`next.config.ts`): CSP (`default-src 'self'`, no third-party origins; dev also allows eval + `ws:`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, COOP, HSTS in production; no `X-Powered-By`. Don't add external scripts, fonts or fetch targets without updating the CSP. Client-side Zod runs `jitless` (no eval).
- **Booking limits** (env, 0 = off): `REQUEST_LIMIT_PER_CONTACT=3`, `REQUEST_LIMIT_PER_HOUR=60`, `REQUEST_LIMIT_PER_DAY=300`, `REQUEST_LIMIT_PER_IP=5`, `REQUEST_LIMIT_IP_WINDOW_MINUTES=10`. E2E/load runs against a local server: start it with `REQUEST_LIMIT_PER_IP=0` (S14).
- **Production DB**: `DATABASE_CA_CERT` is required for a non-local `DATABASE_URL` when `NODE_ENV=production` (the pool throws without it). See docs/DEPLOY.md.
- **Sessions**: stateless 8 h JWT; tokens must carry `exp`, `iat`, `sub`. Logout clears the cookie only; rotate `SESSION_SECRET` to end every session.
- **Staff note flag**: a `patient_note` starting with `[Details differ from patient record:` (first line) means the online form's name/email/birthdate didn't match the patient on file. Render it with `DetailsDifferFlag` / `splitMismatchFlag`.
