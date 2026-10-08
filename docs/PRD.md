# Dental Clinic Appointment System — PRD

Oct 8, 2026 · @Ethan

This PRD turns Chapters 1–3 of the paper into a build spec. Every requirement keeps the paper's ID (FR1–FR16), so the code and the paper can be checked against each other line by line. Where the paper is silent, this PRD makes a call: the main ones are under Decisions where the paper is silent, and the smaller ones sit in the Business Rules and the API table.

| Field | Detail |
| --- | --- |
| Project Title | A Web-Based Appointment Scheduling and Attendance Tracking System for a Small Dental Clinic |
| Implementing Department | BSCS, Information Management, Group 2, Pamantasan ng Lungsod ng Maynila |
| In coordination with | Prof. Jethro San Diego (project adviser) |
| Proposed Project Head/s | Ethan Baltazar (developer); Leeian Zedric Gusto, Wayne Leal, Ludivic Rhiane Intes |
| Aligned Priority Area | SOP 1–5: centralized booking, schedule visibility, patient records, reminders, attendance reports |

## Problem, Goals & Non-Goals

### Problem Statement

Small dental clinics book through paper logbooks, phone calls, and chat messages. Staff cannot see at a glance which dentist or chair is free, so bookings collide or leave gaps. Patient details are rewritten at each visit or lost. Missed appointments go unrecorded, so the clinic cannot tell who keeps missing or how often.

### Primary Goals

| # | Goal (one per SOP) | Done when |
| --- | --- | --- |
| G1 | Put every booking, from any channel, in one system | Online requests and staff-encoded phone, chat, and walk-in bookings all land in `appointments` with a `channel` |
| G2 | Show who is free and refuse collisions | The dashboard shows each dentist's and chair's day, and an overlapping booking is rejected on save, confirm, and reschedule |
| G3 | One record per patient with a visit history | Online requests match existing patients by contact number, and the patient page lists every appointment |
| G4 | Notify patients without staff action | Confirmation email on confirm, and one reminder email the day before, sent by a daily job |
| G5 | Report no-shows and attendance | Totals per month, dentist, and service, plus a repeat no-show list with an adjustable threshold |

### Non-goals

- Patient accounts or patient login
- SMS, Messenger, or any chat-app messages or integration
- Payments, billing, or cost analysis
- AI, machine learning, or no-show prediction
- Dental charts, x-rays, diagnoses, or prescriptions
- More than one clinic, or more than one staff role
- Live push updates (WebSockets, polling)

## User Roles / Persona

The system has two human actors and one automated actor. There is one staff role with full access (paper scope: "a single staff role").

| Actor | Who | Access | Device (Table 3.5) | Can do |
| --- | --- | --- | --- | --- |
| Patient | Anyone booking a visit | Public, no account | Smartphone, tablet, or computer | Submit a booking request on the online form |
| Clinic Staff | Receptionist, dentist, or owner; all share one role | Email + password login | Desktop, laptop, or tablet | Everything else: dashboard, booking, confirm or decline, reschedule, status updates, patients, setup, reports |
| Scheduled Job | Daily timer | Server-only, secret-protected | None | Send the day-before reminder emails |

Design for the patient on a phone first, since that is where the form will be opened. Staff screens target 768 px and wider (tablet and laptop).

## Constraints & Assumptions

The paper is the contract: if the code needs to differ from Chapter 3, change the paper too, or don't make the change.

### Constraints

- **Seven tables only:** `users`, `patients`, `dentists`, `dentist_schedules`, `services`, `chairs`, `appointments`, exactly as in Listing 3.2. Adding a table means rewriting the ERD, the DFD, and the data dictionary.
- **Computed, never stored:** open slots, no-show counts, attendance totals, and the no-show rate. `end_time` is the one stored derived value.
- **Stack named in Ch. 3:** Next.js + React, Tailwind CSS, MySQL 8.0.16+, Node.js LTS, SMTP mail, a daily scheduled job.
- **Status and channel values** must match the ENUMs exactly: `pending`, `scheduled`, `attended`, `cancelled`, `declined`, `no-show` and `online`, `phone`, `chat`, `walk-in`. Use "cancelled" (double L) in the UI.
- **Public demo:** panelists must be able to open the form themselves as mock patients, so the app runs on a public URL (Vercel + hosted MySQL). The paper keeps "deployment is not covered"; the answer if asked is Open Questions #4.
- **Illustrative data only:** seed with the Ch. 3 sample data, never real patients.
- **Real MySQL 8 only:** host on Aiven or Railway. Not TiDB: it skips CHECK constraints unless a setting is turned on, and its row locking differs, which would break NF02 and the double-booking lock.
- **Connection cap:** set the `mysql2` pool to `connectionLimit: 5`. Each Vercel request can open its own connection, and free MySQL plans allow only a few at once.
- **Demo privacy:** `/book` shows "Demo system: please use sample details, not your real information." Reset the hosted database after the defense to clear what panelists entered.
- **Spam trap:** `/book` carries a hidden honeypot field; any submission that fills it is dropped. This adds no requirement, so the paper is unchanged.

### Assumptions

- Clinic timezone is Asia/Manila (UTC+8). Every "today", "tomorrow", and "in the past" check uses Manila time, not the server's UTC.
- The clinic closes on days with no `dentist_schedules` row for that dentist.
- Slot interval is 30 minutes and the default no-show threshold is 2, both from the sample data.
- A patient books one service per appointment.
- Staff are created by seed or SQL. No sign-up page.

### Decisions where the paper is silent

These keep the build inside the seven-table schema. Each one is a sentence you can say at the defense.

| Gap | Decision | Why |
| --- | --- | --- |
| "Any available dentist" on the online form | On submit, the first dentist (by `dentist_id`) free for that slot is assigned | Deterministic and explainable |
| Confirmation email for staff-encoded bookings | None. Staff bookings save as `scheduled` and get only the day-before reminder. | Ch. 3 sends the confirmation when staff confirm a request; the patient is already on the phone or at the desk |

## User Stories

Stories are grouped by SOP: US1 is SOP 1, and so on. US0 covers access and setup. Priority: every item is **M** (must), because the target is the full build.

| ID | Story Statement | Priority |
| --- | --- | --- |
| US0.1 | As clinic staff, I want to log in with my email and password so that patient data stays behind a login. | M |
| US0.2 | As clinic staff, I want to manage dentists, their working days and hours, services and durations, and chairs so that the schedule reflects the clinic. | M |
| US1.1 | As a patient, I want to request an appointment online without creating an account so that I don't have to call or message the clinic. | M |
| US1.2 | As a patient, I want to see only the open time slots for my chosen service and dentist so that I don't request a time that is taken. | M |
| US1.3 | As clinic staff, I want to encode bookings from phone calls, chat, and walk-ins so that every booking is in one place with its channel. | M |
| US1.4 | As clinic staff, I want to confirm or decline pending online requests so that only bookings I approve go on the schedule. | M |
| US1.5 | As clinic staff, I want to reschedule an appointment without losing the original so that the history shows what changed. | M |
| US2.1 | As clinic staff, I want to see each dentist's and chair's appointments and open slots for a chosen day so that I know who is free at a glance. | M |
| US2.2 | As clinic staff, I want the system to refuse a booking that collides with another appointment, falls outside working hours, or is in the past so that double bookings can't happen. | M |
| US3.1 | As clinic staff, I want one record per patient, matched by contact number, so that details aren't rewritten or duplicated. | M |
| US3.2 | As clinic staff, I want to see a patient's full appointment history with services and dentist notes so that I know their past visits. | M |
| US3.3 | As a dentist, I want to add a note to a visit so that the next visit has context. | M |
| US4.1 | As a patient, I want a confirmation email when the clinic confirms my request so that I know my booking is set. | M |
| US4.2 | As a patient, I want a reminder email the day before my appointment so that I don't forget it. | M |
| US5.1 | As clinic staff, I want to mark each appointment attended, cancelled, or no-show so that attendance is recorded. | M |
| US5.2 | As the clinic owner, I want attendance totals per month, dentist, and service so that I can see patterns. | M |
| US5.3 | As the clinic owner, I want a list of patients who reach a no-show threshold I set so that I can follow up with them. | M |

## Functional Requirements

IDs and wording follow Table 3.2 of the paper, shortened. The build notes are this PRD's additions and are not in the paper.

| ID | Functional Requirement | Priority | Parent Story | Build notes |
| --- | --- | --- | --- | --- |
| FR1 | The system shall provide a public online request form, with no patient account, recording service, dentist or "any available", date, time slot, full name, contact number, email, birthdate, optional note, and a consent checkbox. | M | US1.1, US1.2 | Route `/book`. Email required here. Consent must be ticked to submit and is not stored. |
| FR2 | The system shall save each online request as `pending`, hold its slot, and let staff confirm or decline it. | M | US1.4 | Pending counts in the overlap check. `chair_id` stays NULL until confirm. |
| FR3 | The system shall let staff book phone, chat, and walk-in appointments and record every appointment's channel. | M | US1.3 | Staff bookings save as `scheduled` with a chair. Search for the patient by name or contact first. |
| FR4 | The system shall reschedule by setting the old appointment to `cancelled` and creating a new one with `rescheduled_from_id` pointing to it. | M | US1.5 | Do both writes in one transaction. |
| FR5 | The system shall let staff add, edit, and view dentists, working days and hours, services and durations, and chairs. | M | US0.2 | Deletes are blocked by `ON DELETE RESTRICT`; show a readable error. |
| FR6 | The system shall display each dentist's and chair's daily schedule, read from the database on every load. | M | US2.1 | Server-render with `dynamic = 'force-dynamic'`; no caching. |
| FR7 | The system shall compute a dentist's open slots from working hours, service duration, and existing appointments when requested, and never store them. | M | US1.2, US2.1 | Algorithm under Business Rules. |
| FR8 | The system shall reject a booking that overlaps the same dentist or chair, falls outside working hours, or is in the past, and repeat the check on confirm. | M | US2.2 | Also on reschedule. Use Listing 3.1's query, and for a new booking bind :appointment\_id to 0: binding NULL makes appointment\_id <> NULL match nothing, so every collision would pass. |
| FR9 | The system shall keep one record per patient and match an online request to an existing patient by contact number. | M | US3.1 | Normalize numbers before matching (strip spaces and dashes; `+63` to `0`). |
| FR10 | The system shall display each patient's history: appointments, services, and an optional dentist note per visit. | M | US3.2, US3.3 | Listing 3.4 history query, newest first. |
| FR11 | The system shall require staff login with a hashed password and show patient data only after login. | M | US0.1 | bcrypt hashing; middleware guards everything except the public routes listed under API. |
| FR12 | The system shall send a confirmation email when staff confirm a request. | M | US4.1 | Send after the DB commit; a mail failure must not roll back the confirm. |
| FR13 | The system shall send one reminder email the day before each `scheduled` appointment through a scheduled job, and record when it was sent. | M | US4.2 | Cron route; sets `reminder_sent_at`. |
| FR14 | The system shall record one status per appointment: pending, scheduled, attended, cancelled, declined, or no-show. | M | US5.1 | Allowed transitions under Business Rules. |
| FR15 | The system shall compute attendance totals per month, dentist, and service when a report is requested. | M | US5.2 | Listing 3.4 queries, including the rescheduled-cancellation exclusion. Show the no-show rate too. |
| FR16 | The system shall list patients whose no-show count reaches a threshold staff can set. | M | US5.3 | `HAVING COUNT(*) >= :threshold`; threshold from a page input. |

### Business Rules

These come from Chapter 3. Each rule needs one place in the code (`lib/rules.ts`) so that every route uses the same check.

1. **Overlap:** a booking conflicts when `new_start < existing_end AND new_end > existing_start` for the same date and the same dentist **or** the same chair. Only `pending` and `scheduled` rows count. Back-to-back is allowed: 10:00–11:00 then 11:00–11:30 is fine. For a new booking, bind `:appointment_id` to 0 in Listing 3.1.
2. **Working hours:** start and end must fall inside that weekday's `dentist_schedules` row (0 = Sunday). No row means the dentist does not work that day.
3. **Not in the past:** the date and start time must be later than now, in Manila time.
4. **End time:** `end_time = start_time + services.duration_minutes`, set on save and stored, so past appointments keep their length if a duration changes.
5. **Open slots:** step through the working hours every `SLOT_INTERVAL_MINUTES`. Keep each start whose end is within hours and that overlaps no pending or scheduled appointment of that dentist. For today, drop starts at or before `nowManila()`. Check: hours 09:00–12:00, existing 10:00–11:00, 45-min service gives 09:00 and 11:00 open; 09:30, 10:00, 10:30, and 11:30 closed.
6. **Chair:** on confirm, staff booking, or reschedule, list only the chairs free for that time; exactly one must be picked.
7. **Status transitions:** pending to scheduled (confirm) or declined; scheduled to attended, cancelled, or no-show. `attended` and `no-show` are only allowed once the appointment's start time has passed. Declined, attended, cancelled, and no-show are final.
8. **Reminder selection:** tomorrow's date (Manila) AND `status = 'scheduled'` AND `reminder_sent_at IS NULL` AND the patient has an email. Re-running the job the same day sends nothing new.
9. **Race safety:** run the overlap check and the write inside one transaction. Lock the dentist row first (`SELECT ... FROM dentists WHERE dentist_id = ? FOR UPDATE`), and the chair row too when one is set, so two people can't grab the same slot.
10. **Any available dentist:** try dentists in `dentist_id` order, locking each in turn; assign the first one that passes rules 1–3 and release the others.
11. **Reschedule:** only `scheduled` appointments. In one transaction, set the old row to `cancelled` and insert a new row with `status = 'scheduled'`, the same patient, service, and channel, the new date, start, dentist, and chair, `requested_at = NOW()`, `reminder_sent_at = NULL`, both notes copied, and `rescheduled_from_id` = the old id.
12. **Decline:** sets `declined`, needs no reason, sends no email (the paper defines none), and frees the slot at once because declined rows no longer count in rule 1.

## Data Model

The schema is Listing 3.2 from the paper, copied exactly, in third normal form. Run it as the first migration. Don't let an ORM regenerate it, because ORMs drop the CHECK constraints the paper cites.

| Table | Purpose | Key relationships |
| --- | --- | --- |
| `users` | Staff logins | None |
| `patients` | One row per patient; `contact_number` is UNIQUE | 1:N appointments |
| `dentists` | Dentist names | 1:N schedules, 1:N appointments |
| `dentist_schedules` | One row per dentist per working weekday | N:1 dentist |
| `services` | Service name and duration | 1:N appointments |
| `chairs` | Chair names | 1:N appointments (NULL while pending) |
| `appointments` | Every booking, its status, channel, and reminder time | N:1 each of the above; self-link via `rescheduled_from_id` |

```sql
CREATE TABLE users (
  user_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name      VARCHAR(100) NOT NULL,
  email     VARCHAR(150) NOT NULL,
  password  VARCHAR(255) NOT NULL,
  CONSTRAINT pk_users PRIMARY KEY (user_id),
  CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE TABLE patients (
  patient_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name       VARCHAR(150) NOT NULL,
  contact_number  VARCHAR(20)  NOT NULL,
  email           VARCHAR(150) NULL,
  birthdate       DATE         NOT NULL,
  CONSTRAINT pk_patients PRIMARY KEY (patient_id),
  CONSTRAINT uq_patients_contact UNIQUE (contact_number)
);

CREATE TABLE dentists (
  dentist_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  dentist_name  VARCHAR(100) NOT NULL,
  CONSTRAINT pk_dentists PRIMARY KEY (dentist_id)
);

CREATE TABLE dentist_schedules (
  schedule_id  INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  dentist_id   INT UNSIGNED     NOT NULL,
  day_of_week  TINYINT UNSIGNED NOT NULL,
  start_time   TIME             NOT NULL,
  end_time     TIME             NOT NULL,
  CONSTRAINT pk_dentist_schedules PRIMARY KEY (schedule_id),
  CONSTRAINT fk_schedules_dentist FOREIGN KEY (dentist_id)
    REFERENCES dentists (dentist_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT uq_dentist_day UNIQUE (dentist_id, day_of_week),
  CONSTRAINT chk_day_of_week CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT chk_schedule_hours CHECK (end_time > start_time)
);

CREATE TABLE services (
  service_id        INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  service_name      VARCHAR(100)      NOT NULL,
  duration_minutes  SMALLINT UNSIGNED NOT NULL,
  CONSTRAINT pk_services PRIMARY KEY (service_id),
  CONSTRAINT uq_service_name UNIQUE (service_name),
  CONSTRAINT chk_duration CHECK (duration_minutes > 0)
);

CREATE TABLE chairs (
  chair_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  chair_name  VARCHAR(50)  NOT NULL,
  CONSTRAINT pk_chairs PRIMARY KEY (chair_id),
  CONSTRAINT uq_chair_name UNIQUE (chair_name)
);

CREATE TABLE appointments (
  appointment_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id           INT UNSIGNED NOT NULL,
  dentist_id           INT UNSIGNED NOT NULL,
  service_id           INT UNSIGNED NOT NULL,
  chair_id             INT UNSIGNED NULL,
  appointment_date     DATE         NOT NULL,
  start_time           TIME         NOT NULL,
  end_time             TIME         NOT NULL,
  status               ENUM('pending','scheduled','attended',
                            'cancelled','declined','no-show') NOT NULL,
  channel              ENUM('online','phone','chat','walk-in') NOT NULL,
  requested_at         DATETIME     NOT NULL,
  patient_note         TEXT         NULL,
  dentist_note         TEXT         NULL,
  reminder_sent_at     DATETIME     NULL,
  rescheduled_from_id  INT UNSIGNED NULL,
  CONSTRAINT pk_appointments PRIMARY KEY (appointment_id),
  CONSTRAINT fk_appt_patient FOREIGN KEY (patient_id)
    REFERENCES patients (patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_appt_dentist FOREIGN KEY (dentist_id)
    REFERENCES dentists (dentist_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_appt_service FOREIGN KEY (service_id)
    REFERENCES services (service_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_appt_chair FOREIGN KEY (chair_id)
    REFERENCES chairs (chair_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_appt_rescheduled FOREIGN KEY (rescheduled_from_id)
    REFERENCES appointments (appointment_id) ON DELETE RESTRICT,
  CONSTRAINT chk_appt_times CHECK (end_time > start_time)
);
```

### Seed data (from the paper's sample)

- **Staff:** one user, e.g. `staff@clinic.test`, with a bcrypt-hashed password
- **Dentists:** Dr. Reyes, Dr. Lim, both Mon–Sat 09:00–17:00 with no lunch break (a break would take a second row per day, which `uq_dentist_day` forbids)
- **Services:** Oral prophylaxis (30 min), Tooth filling (60 min), Tooth extraction (45 min)
- **Chairs:** Chair 1, Chair 2
- **Patients:** the two from Table 3.6, Maria Santos (`09175550101`, maria.santos@example.com, 1994-03-12) and Jose Ramos (`09185550102`, jose.ramos@example.com, 1988-07-25), plus about 10 more. Contact numbers are stored digits-only and shown formatted (0917 555 0101).
- **Table 3.6 appointments:** Maria, Oct 12 09:00, Dr. Reyes, Chair 1, Oral prophylaxis, phone, attended; Maria, Oct 19 10:00, Dr. Reyes, Chair 1, Tooth filling, online, scheduled; Jose, Oct 12 09:30, Dr. Lim, Chair 2, Tooth extraction, walk-in, no-show.
- **More October 2026 rows** so the reports reproduce Table 3.22: Dr. Reyes 18 attended / 2 cancelled / 2 no-show; Dr. Lim 12 / 1 / 3; total no-show rate 14.3%. Maria's attended visit counts toward Dr. Reyes's 18 and Jose's no-show toward Dr. Lim's 3. None of the cancellations are reschedules. Give at least two patients 2+ no-shows.
- **Timestamps:** `requested_at` a few days before each appointment; `reminder_sent_at` set to 09:00 the day before for every past row that was scheduled, NULL otherwise.
- **Seed rows bypass `canTransition`.** Past-dated statuses and Maria's Oct 19 `scheduled` row are expected sample data, not bugs.

## Non-Functional Requirements

NF01–NF07 follow Table 3.3 of the paper. NF08–NF10, the 360 px width in NF01, and the bcrypt cost in NF03 are build details that don't need to go into the paper.

| ID | Non-Functional Requirement | Priority |
| --- | --- | --- |
| NF01 | **Accessibility:** the system shall run in a browser with no install, and the booking form shall work without an account on a phone 360 px wide. | M |
| NF02 | **Data integrity:** the system shall enforce its rules in the application and in the database, through primary keys, foreign keys, UNIQUE, CHECK, and ENUM constraints. | M |
| NF03 | **Security and privacy:** passwords shall be stored hashed (bcrypt, cost 10 or higher), patient data shall only be shown after login, and the form shall require the Data Privacy Act consent checkbox. | M |
| NF04 | **Consistency:** open slots, no-show counts, and attendance totals shall always be computed from recorded appointments, never stored. | M |
| NF05 | **Real-time display:** the dashboard shall read the database on every load, with no cached pages. | M |
| NF06 | **Maintainability:** pages, application logic, and data access shall live in separate modules (`app/`, `lib/rules`, `lib/db`). | M |
| NF07 | **Scope of use:** one clinic, one staff role, no patient accounts, illustrative sample data. | M |
| NF08 | **Time correctness:** all date logic shall use Asia/Manila. The DB connection shall set `timezone: '+08:00'`, and dates shall go in and out as `YYYY-MM-DD` strings. | M |
| NF09 | **Secrets:** DB credentials, SMTP credentials, the session secret, and the cron secret shall live only in environment variables, never in the repo. | M |
| NF10 | **Responsiveness:** dashboard and report pages shall load in under 2 seconds on the seed data. | M |

## Tech Stack & Architecture

The stack is the one Chapter 3 names, including bcrypt and a signed session cookie (3.4.3). The other libraries are this PRD's picks; the paper doesn't name them, so they can be swapped without touching it.

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js (App Router) + React, TypeScript | Server Components for pages; route handlers for every write |
| Styling | Tailwind CSS | Matches Ch. 3 |
| Database | MySQL 8 on Aiven or Railway (not TiDB; see Constraints) | Run the Listing 3.2 DDL as-is |
| DB access | `mysql2/promise` with hand-written SQL | The code's queries can then match Listings 3.1 and 3.4 word for word, which is easy to show at a defense |
| Validation | Zod | Form and route-handler input |
| Auth | `bcryptjs` + a signed, httpOnly session cookie (`iron-session` or `jose`) | One role; `middleware.ts` guards every route except the public routes listed under API |
| Email | Nodemailer over Gmail SMTP with an app password (see Email below) | Ch. 3 says "an SMTP mail service" |
| Scheduled job | Vercel Cron calling `GET /api/cron/reminders` daily at `0 1 * * *` UTC (9:00 AM Manila) | Checks a `CRON_SECRET` bearer token |
| Hosting | Vercel | Needed for the panel demo (see Open Questions #4) |

### Routes

| Route | Access | Screen or job |
| --- | --- | --- |
| `/book` | Public | Online request form, with a thank-you state after submit |
| `/login` | Public | Staff login |
| `/dashboard` | Staff | Schedule dashboard for a chosen day, default today |
| `/appointments/new` | Staff | Staff booking (phone, chat, walk-in) |
| `/appointments/[id]` | Staff | Detail page: confirm or decline, assign chair, reschedule, set status, dentist note |
| `/requests` | Staff | Queue of pending online requests |
| `/patients`, `/patients/[id]` | Staff | Search, profile, and history |
| `/setup` | Staff | Dentists and schedules, services, chairs |
| `/reports` | Staff | Totals, no-show rate, repeat no-show list with threshold |
| `/api/slots` | Public | Returns open slots as JSON for `?date&serviceId&dentistId` (or `any`) |
| `/api/cron/reminders` | Cron secret | Sends the day-before reminders |

### API

Every write goes through one of these route handlers. Public routes, which the middleware lets through without login: `/book`, `/login`, `GET /api/slots`, `POST /api/requests`, `POST /api/auth/login`, and `GET /api/cron/reminders` (which checks the cron secret instead). Everything else needs the staff session.

| Method and path | Access | Input | Does |
| --- | --- | --- | --- |
| `GET /api/slots` | Public | `?date=YYYY-MM-DD&serviceId=1&dentistId=2` or `dentistId=any` | Returns `{ slots: [{ start: "09:00", end: "09:45", dentistIds: [1, 2] }] }`. With `any`, the union across dentists. Rule 5. |
| `POST /api/requests` | Public | Form fields, `consent: true`, honeypot `website` (must be empty) | Drops silently if `website` is filled; Zod check; matches or creates the patient; saves `pending` (rules 1–3, 9, 10). Returns 201, or 409 `{ error: "slot_taken", slots }`. |
| `POST /api/auth/login` | Public | `email`, `password` | bcrypt check; sets the session cookie (8-hour expiry). 401 on failure, same message for either field. |
| `POST /api/auth/logout` | Staff | None | Clears the cookie |
| `POST /api/appointments` | Staff | `patientId` or a new patient, `serviceId`, `dentistId`, `date`, `start`, `chairId`, `channel` (`phone`, `chat`, `walk-in`) | Saves `scheduled` (rules 1–4, 6, 9). No email. |
| `POST /api/appointments/[id]/confirm` | Staff | `chairId` | Re-checks rule 1; sets `scheduled`; sends the confirmation after commit. 409 if the slot is gone. |
| `POST /api/appointments/[id]/decline` | Staff | None | Rule 12 |
| `POST /api/appointments/[id]/reschedule` | Staff | `date`, `start`, `dentistId`, `chairId` | Rule 11 |
| `POST /api/appointments/[id]/status` | Staff | `status`: `attended`, `cancelled`, or `no-show` | Rule 7 via `canTransition` |
| `PATCH /api/appointments/[id]/note` | Staff | `dentistNote` | Saves `dentist_note` |
| `GET/POST/PATCH/DELETE /api/setup/[entity]` | Staff | `entity` = `dentists`, `schedules`, `services`, or `chairs` | FR5; RESTRICT errors return 409 "In use by existing appointments" |
| `GET /api/patients?q=` and `PATCH /api/patients/[id]` | Staff | Search text; or name, contact, email, birthdate | Search by name or number; edit with a duplicate-number check (409) |
| `GET /api/cron/reminders` | Header `Authorization: Bearer <CRON_SECRET>` | None | 401 without the header; otherwise rule 8, returns `{ sent, failed }`. Vercel sends the header automatically once `CRON_SECRET` is set. Manual run: `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/cron/reminders` |

Pages read data directly in Server Components; the GET endpoints above exist for the client-side forms.

### Environment variables

```bash
DATABASE_URL=mysql://user:pass@host:3306/dental
SESSION_SECRET=at-least-32-random-characters
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=yourclinic.demo@gmail.com
SMTP_PASS=16-character-app-password
MAIL_FROM="Sample Dental Clinic <yourclinic.demo@gmail.com>"
CLINIC_NAME="Sample Dental Clinic"
CLINIC_PHONE="0917 000 0000"
CRON_SECRET=
SLOT_INTERVAL_MINUTES=30
NO_SHOW_THRESHOLD=2
```

### Email (SMTP)

Use Gmail's SMTP server with a dedicated demo Gmail account. It is free, needs no domain, and Gmail's limit of about 500 recipients a day is far more than the demo needs. The paper says "an SMTP mail service" and names no provider, so this choice needs no change to Chapter 3.

**Setup**

1. Create a new Gmail account for the clinic, e.g. `yourclinic.demo@gmail.com`. Don't use a personal one.
2. Turn on 2-Step Verification for it, then create an app password at myaccount.google.com/apppasswords.
3. Put the address and the 16-character app password in `SMTP_USER` and `SMTP_PASS`, locally in `.env.local` and on Vercel under Environment Variables.
4. Keep `MAIL_FROM` on the same Gmail address. Gmail replaces any other From address with the account's own.

| Setting | Value |
| --- | --- |
| Host | `smtp.gmail.com` |
| Port | `465` with `secure: true` (or `587` with `secure: false`) |
| Auth | Gmail address + app password (not the account password) |
| Library | `nodemailer` |
| Runtime | Any route that sends mail sets `export const runtime = 'nodejs'`; Nodemailer does not run on the Edge runtime |

**`lib/mail.ts`**

```ts
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

type ApptEmail = {
  to: string; patientName: string; date: string; // 'YYYY-MM-DD'
  startTime: string; dentist: string; service: string;
};

const details = (a: ApptEmail) =>
  `Date: ${a.date}\nTime: ${a.startTime}\nDentist: ${a.dentist}\nService: ${a.service}`;

export async function sendConfirmation(a: ApptEmail) {
  return transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: a.to,
    subject: `Appointment confirmed: ${a.date}, ${a.startTime}`,
    text: `Hi ${a.patientName},\n\nYour appointment is confirmed.\n\n${details(a)}\n\nTo cancel or reschedule, call or message the clinic at ${process.env.CLINIC_PHONE}.`,
  });
}

export async function sendReminder(a: ApptEmail) {
  return transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: a.to,
    subject: `Reminder: your appointment tomorrow at ${a.startTime}`,
    text: `Hi ${a.patientName},\n\nThis is a reminder of your appointment tomorrow.\n\n${details(a)}\n\nIf you cannot come, please inform the clinic at ${process.env.CLINIC_PHONE}.`,
  });
}
```

The two emails carry what Table 3.20 lists: date, start time, dentist, and service, plus how to reach the clinic. Plain text is enough; add an `html` version later if there is time. Format the date and time for people ("Oct 15, 2026, 10:00 AM") before passing them in.

**Sending rules**

- **Confirmation:** send after the confirm transaction commits, and only if the patient has an email. If sending fails, keep the appointment `scheduled`, log the error, and show staff: "Confirmed, but the email could not be sent."
- **Reminder:** the cron route sends the emails one at a time. Set `reminder_sent_at` only after a send succeeds, so a failed send is never recorded as sent. Return a JSON summary (sent, failed) for the Vercel logs.
- **Testing:** send to your own inbox through the demo account, and check the spam folder the first time. Mark the first email "Not spam" so the demo emails land in the inbox.

## User Flow (high-level)

&#91;embedded content: appointment lifecycle · 6 statuses, 1 decision\]

Online requests wait as pending until staff confirm or decline them. Staff-encoded bookings go straight to scheduled. Only scheduled appointments get the reminder. Declined, attended, cancelled, and no-show are final.

### Key flows

1. **Patient books online:** open `/book` → pick service, dentist or "any", date → pick from open slots → enter details → tick consent → submit → see "Request received. The clinic will email you once it is confirmed."
2. **Staff confirms:** `/requests` → open a request → pick a free chair → Confirm → overlap re-checked → status scheduled → confirmation email sent. If the slot is now taken, staff pick another slot.
3. **Staff books a call:** `/appointments/new` → search the patient by name or number (or create one) → service, dentist, date, slot, chair, channel → save as scheduled.
4. **After the visit:** dashboard → appointment → Attended or No-show → optional dentist note.
5. **Owner reviews:** `/reports` → pick month → totals per dentist and service → set threshold → repeat no-show list → click a patient for history.

### Screens

The paper has layouts for the four marked screens (Figures 3.7–3.10). Appendix B is still a placeholder; fill it with screenshots of all nine screens.

| Screen | Paper figure | SOP |
| --- | --- | --- |
| Online request form | Figure 3.8 | 1, 3 |
| Schedule dashboard | Figure 3.7 | 2 |
| Patient record and history | Figure 3.9 | 3 |
| Reports | Figure 3.10 | 5 |
| Login | None yet | 3 |
| Pending requests queue | None yet | 1 |
| Staff booking form | None yet | 1 |
| Appointment detail (confirm, reschedule, status) | None yet | 1, 5 |
| Clinic setup | None yet | 2 |

## Build Plan & Acceptance Criteria

The target is the full system: 12 phases that together build all 16 FRs, all 10 NFs, all 9 screens, and the reminder job, with nothing left as layout only. The coverage table at the end maps every requirement to the phase that builds it. Deploy at the end of Phase 1 and redeploy after every phase. Each phase is one prompt-sized chunk for a coding agent: paste this PRD in as context and name the phase.

**Phase 0: Accounts** (no code)

- [ ] GitHub repo, Vercel project linked to it
- [ ] MySQL 8 database on Aiven or Railway (not TiDB); connection string in `DATABASE_URL`
- [ ] Demo Gmail account with 2-Step Verification and an app password (see Email (SMTP))
- [ ] Generate `SESSION_SECRET` and `CRON_SECRET` (`openssl rand -base64 32`)

**Phase 1: Foundation** (FR11 · NF02, NF03, NF06, NF08, NF09)

- [ ] Next.js + TypeScript + Tailwind scaffold; pages under `app/`, logic in `lib/rules.ts`, `lib/db.ts`, and `lib/mail.ts`
- [ ] `lib/db.ts` pool with `timezone: '+08:00'` and `dateStrings: true`; a `withTransaction` helper; connectionLimit: 5
- [ ] Migration from Listing 3.2; seed script per the Seed data list, plus `npm run db:reset` to rebuild and reseed
- [ ] `.env.example` listing every variable; nothing secret committed
- [ ] Login and logout, bcrypt check, signed httpOnly session cookie (8-hour expiry), `middleware.ts` guarding all routes except the public routes listed under API
- [ ] First deploy with all env vars set
- [ ] Accept: the seed user logs in on the live URL; `/patients` redirects to `/login` when logged out; a wrong password shows an error without saying which field was wrong

**Phase 2: Rules engine** (FR7, FR8, FR14 logic · NF04)

- [ ] `lib/rules.ts`: `nowManila`, `computeEndTime`, `isWithinHours`, `isInPast`, `findOverlaps` (Listing 3.1, `:appointment_id` = 0 for new bookings), `openSlots`, `freeChairs`, `canTransition`, `normalizeContact`
- [ ] Unit tests (Vitest)
- [ ] Accept: tests reproduce Table 3.17 and Table 3.18; `attended` is refused before the start time; `+63 917-555-0101` normalizes to `09175550101`

**Phase 3: App shell and clinic setup** (FR5 · NF01)

- [ ] Staff layout: top bar with clinic name and logout, nav to Dashboard, Requests (with pending count), New booking, Patients, Reports, Setup
- [ ] Shared UI: buttons, form fields with inline errors, status badges (one color per status), toasts, empty and loading states
- [ ] `/setup` with three tabs: dentists with a weekly hours grid (one row per weekday, blank = off), services with durations, chairs; add, edit, view; RESTRICT errors shown as "In use by existing appointments"
- [ ] Accept: every staff page works at 768 px and 1280 px wide; a new dentist with hours appears in slot results right away

**Phase 4: Online booking** (FR1, FR2 save, FR7, FR8, FR9 · NF01, NF03)

- [ ] `/book`, mobile-first: service → dentist or "any available" → date (today to 60 days ahead) → open slots from `/api/slots` → name, contact number, email, birthdate, optional note → consent checkbox with the Data Privacy Act text → submit
- [ ] Zod validation on the client and again in the route handler; a hidden honeypot field that drops any submission where it is filled; the demo banner "Demo system: please use sample details, not your real information."
- [ ] Save as pending inside the locking transaction; match the patient by normalized contact number or create one
- [ ] Thank-you screen: "Request received. The clinic will email you once it is confirmed."
- [ ] Accept: two phones requesting the same slot get one success and one "That time was just taken" with fresh slots; a repeat contact number reuses the patient; submitting without consent is blocked; a submission with the honeypot field filled is dropped without saving; the demo banner is visible on a 360 px screen

**Phase 5: Staff booking and appointment management** (FR2 confirm/decline, FR3, FR4, FR8, FR14)

- [ ] `/requests`: pending list, oldest first, with patient note
- [ ] `/appointments/[id]`: details, patient note, chair picker (free chairs only), Confirm, Decline, Reschedule, status buttons from `canTransition`, dentist note field
- [ ] Confirm re-runs the overlap check and requires a chair; a conflict shows "Slot no longer free" and offers open slots
- [ ] `/appointments/new`: search patient by name or number, or create one inline (email optional); service, dentist, date, open slot, free chair, channel (phone, chat, walk-in); saves as scheduled
- [ ] Reschedule: pick new date, slot, and chair; old row set to cancelled and new row linked by `rescheduled_from_id`, in one transaction
- [ ] Accept: every row of the status table (Table 3.21) can be reached and no other transition can; a rescheduled appointment shows a link to the one it replaced

**Phase 6: Schedule dashboard** (FR6, FR7 · NF05)

- [ ] `/dashboard`: day picker (default today, prev/next), view toggle By dentist / By chair, a time grid from the earliest start to the latest end of that day's hours
- [ ] Appointments as blocks showing time, patient, service, colored by status; open slots of each dentist listed beside the grid; click a block to open `/appointments/[id]`
- [ ] Summary strip: today's total, pending requests, tomorrow's appointments (which get reminders)
- [ ] `dynamic = 'force-dynamic'`; no client caching
- [ ] Accept: a booking made in another tab appears after refresh; a dentist with no hours that day shows "Not working"

**Phase 7: Patient records** (FR9, FR10 · NF03)

- [ ] `/patients`: search by name or contact number, paged list
- [ ] `/patients/[id]`: profile above the history (Listing 3.4 history query, newest first), with dentist notes; edit name, contact number, email, birthdate, with a duplicate-number check
- [ ] Accept: changing a number to one already used is refused with a readable message; Maria Santos shows her two seeded visits

**Phase 8: Email** (FR12, FR13 · NF09)

- [ ] `lib/mail.ts` from the Email (SMTP) section; `runtime = 'nodejs'` on routes that send; dates formatted "Oct 15, 2026, 10:00 AM"
- [ ] Confirmation sent after the confirm commits; staff warning if sending fails
- [ ] `/api/cron/reminders` with the `CRON_SECRET` check; `vercel.json` cron `0 1 * * *`; `reminder_sent_at` set only after a successful send; JSON summary returned
- [ ] Show "Reminder sent" with its time on the appointment page
- [ ] Accept: confirming emails your own inbox; running the cron twice sends one reminder per appointment; a wrong `SMTP_PASS` shows the warning and the appointment stays scheduled

**Phase 9: Reports** (FR15, FR16 · NF04)

- [ ] `/reports`: month picker; totals per month, per dentist, and per service with the no-show rate, using the revised Listing 3.4 queries
- [ ] Repeat no-show list with the threshold input (default `NO_SHOW_THRESHOLD`); names link to the patient page
- [ ] Accept: October 2026 reproduces Table 3.22 (Dr. Reyes 10.0%, Dr. Lim 20.0%, total 14.3%); raising the threshold shortens the list

**Phase 10: Hardening and developer testing** (all FRs · NF01, NF03, NF10)

- [ ] Run each FR1–FR16 by hand on the live URL and record pass or fail in a test table (FR, steps, expected, actual), which also serves the paper's developer testing in 3.1
- [ ] Check /book at 360 px and every staff page at 768 px; time the dashboard and reports on the seed data (under 2 s)
- [ ] Confirm no patient data is reachable without login, including direct API calls; fire 10 bookings at once on the live URL and confirm none fails with "too many connections"
- [ ] Fix everything that fails, then rerun the failed rows

**Phase 11: Demo readiness and paper sync**

- [ ] `npm run db:reset` on the hosted DB the day before the demo, and again right after it to clear what panelists entered
- [ ] On a phone over mobile data: book, confirm, receive the email; mark it "Not spam" once
- [ ] Vercel shows the cron job; trigger it once by hand with the curl line in the API table. Rehearse the deployment answer (Open Questions #4).
- [ ] Screenshot all 9 screens into Appendix B
- [ ] Add the `patient_note` row to Table 3.15

### Coverage

Every requirement and demo constraint is built in a numbered phase, and Phase 10 tests all of them.

| Requirement | Built in phase |
| --- | --- |
| FR1 online request form | 4 |
| FR2 pending, hold slot, confirm or decline | 4, 5 |
| FR3 staff booking with channel | 5 |
| FR4 reschedule with link | 5 |
| FR5 clinic setup | 3 |
| FR6 daily schedule per dentist and chair | 6 |
| FR7 open slots, computed | 2, 4, 6 |
| FR8 overlap, hours, past checks | 2, 4, 5 |
| FR9 one record per patient, contact match | 4, 7 |
| FR10 patient history | 7 |
| FR11 staff login, hashed password | 1 |
| FR12 confirmation email | 8 |
| FR13 reminder job | 8 |
| FR14 statuses and transitions | 2, 5 |
| FR15 attendance totals | 9 |
| FR16 repeat no-show list | 9 |
| NF01 browser, phone-ready | 3, 4, 10 |
| NF02 data integrity in DB and app | 1 |
| NF03 security and privacy | 1, 4, 7, 10 |
| NF04 computed, never stored | 2, 9 |
| NF05 dashboard reads DB on load | 6 |
| NF06 separate modules | 1 |
| NF07 one clinic, one role, sample data | 1 |
| NF08 Manila time | 1, 2 |
| NF09 secrets in env only | 1, 8 |
| NF10 pages under 2 s | 10 |
| Constraint: real MySQL 8 host | 0 |
| Constraint: connection cap of 5 | 1, 10 |
| Constraint: demo privacy banner and reset | 4, 11 |
| Constraint: honeypot spam trap | 4 |
| Constraint: deployment answer | 11 |

## Open Questions & Risks

Four items are still open: one paper fix, two demo notes, and one build task.

| # | Issue | Resolution | Status |
| --- | --- | --- | --- |
| 1 | Table 3.15 has no row for `patient_note`, though Table 3.8 and Listing 3.2 now include it | Add the row by hand, after `dentist_note`: patient\_note · TEXT · NULL allowed · Optional note from the patient on the online request form | Paper fix |
| 2 | Vercel Hobby cron runs once a day and may fire any time within the scheduled hour | Fine for a day-before reminder; mention it if asked | Demo note |
| 3 | Panelists booking live during the demo could collide with seed data | Seed only October and earlier; leave the demo week open | Build task |
| 4 | The panel asks why there is a live link when the paper says deployment isn't covered | Answer: "Hosting was used only so the panel could try the system; it is outside the study's scope." | Demo note |
