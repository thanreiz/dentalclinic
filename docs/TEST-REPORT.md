# Test Report (QA, developer testing)

Oct 9, 2026 · QA agent · build under test: commit `acc79d6` (security fixes) on top of the Phase 1-10 build; docs-only commits after it do not change code.

## 1. Summary

| Item | Result |
| --- | --- |
| Requirements table (section 2) | 16 FR + 10 NF + 12 Business Rules + 10 phase acceptance groups (Phases 1-10) + 5 constraints. **All functional rows PASS**. **2 UX rows FAIL**, both from one bug (QA-1: same-page link navigation intermittently ignored) |
| Unit tests (`npm run test:unit`) | 222 passed / 222 |
| Integration tests (against `dental_test`) | 130 passed / 130 (`npm test` total: 16 files, 352 tests, 352 passed) |
| Lint / typecheck | `npm run lint` and `npm run typecheck` clean (including the new e2e files) |
| Playwright e2e (`npm run e2e`, 14 spec files, chromium) | 31 tests: **29 passed, 1 failed (QA-1 repro, `14-link-navigation`), 1 opt-in** (`12-abuse-limits`, passes with `E2E_ABUSE_LIMITS=1` against default caps) |
| Direct probes (curl/node/SQL, 217 recorded checks) | 210 PASS. 7 flagged, all triaged: 1 superseded by a corrected rerun, 4 wrong expectations in my probe (not defects), 1 layering nit (N3), 1 accepted risk (N6). No functional defect found beyond QA-1 |
| Bugs | 2 (QA-1 Medium, QA-2 Low). Nits: section 4 |

How it was run: production build (`next build` / `next start -p 3004`) against its own MySQL 8.4 database `dental_qa` (seeded with `npm run db:reset`), wired to a local SMTP sink (`tests/e2e/support/smtp-sink.mjs`, port 2526) so confirmation and reminder emails were real SMTP sends to a sink and never left the machine. Under `next start` `NODE_ENV=production`, so the `[mail:dev]` console fallback is off by design (Decision B13); the sink replaces it. For e2e the server runs with `REQUEST_LIMIT_PER_IP=0 REQUEST_LIMIT_PER_CONTACT=0 REQUEST_LIMIT_PER_HOUR=0 REQUEST_LIMIT_PER_DAY=0`; the caps were verified separately with the defaults (rows H1 below). Time on the machine: Manila 02:12-02:55 on Oct 9 (UTC date was still Oct 8, which made the NF08 checks meaningful). Rerun: see "How to rerun" at the end.

## 2. Test table

Evidence key: **E2E nn** = `tests/e2e/nn-*.spec.ts`; **probe** = scripted curl/SQL check (steps are exact; the scripts are session scratch files, the outcomes are recorded here); **UT/IT** = existing Vitest suites.

### 2.1 Functional requirements

| ID | Steps | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| FR1 | Open `/book` at 360x740, choose service and "Any available dentist"/Dr. Lim, pick date and slot, fill name, contact, email, birthdate, tick consent, submit (E2E 01, 13) | Public form, no account; all fields incl. optional note and consent; thank-you text "Request received. The clinic will email you once it is confirmed." | As expected. Bad email/phone show inline errors and nothing is sent; Back/Change keep the selection and typed details | PASS |
| FR2 | Submit online request; check DB; staff confirm one, decline another (E2E 01, 04; probe) | Saved `pending`, `chair_id` NULL, `channel=online`, holds the slot; confirm -> scheduled with chair; decline -> declined | pending row holds slot (slot disappears from `/api/slots`); confirm sets scheduled + chair; decline frees the slot at once | PASS |
| FR3 | `/appointments/new` > New patient (name, number, birthdate), Tooth filling, Dr. Lim, date, slot, Chair 1, Phone call, Save (E2E 05) | Saved `scheduled` with chair and channel; no email | Row `scheduled`, `channel=phone`, `chair_id=1`; no mail sent | PASS |
| FR4 | Reschedule a scheduled visit to a later slot (E2E 05; probe) | Old row `cancelled`, new row `scheduled` with `rescheduled_from_id`, one transaction | Both ways link ("Rescheduled from #a" / "Replaced by #b"); failed reschedules leave the original untouched; 3 concurrent reschedules of one visit gave 1 success and 1 child row | PASS |
| FR5 | `/setup`: add dentist "Dr. QA" with Mon-Sat 9-5, check `/api/slots`, delete it; try deleting service/chair/dentist in use (E2E 08; probe) | Add/edit/view dentists, hours, services, chairs; RESTRICT shows "In use by existing appointments" | New dentist returns 16 slots on a Monday, none on Sunday, immediately; in-use deletes show the message (409 `in_use`); dentist delete rolled back, hours intact | PASS |
| FR6 | Book in another browser context, reload `/dashboard?date=` (E2E 09) | Dashboard reads DB each load | Booking appears after reload; `Cache-Control: no-store` and `force-dynamic` on every staff page | PASS |
| FR7 | `GET /api/slots` for Reyes, `any`, Sunday, 09:00-12:00 example (probe) | Computed from hours, duration, appointments; nothing stored | 30-min grid; `any` returns union with `dentistIds:[1,2]`; Sunday empty; Rule 5 example gives open 09:00 and 11:00 only | PASS |
| FR8 | Staff create, confirm and reschedule with: dentist overlap, chair overlap, outside hours (early and past end), past date, Sunday, back-to-back (probe) | Reject with 409 on create, confirm and reschedule; back-to-back allowed | Create: `dentist_conflict`, `chair_conflict`, `outside_hours` x2, `in_past`, Sunday `outside_hours`. Confirm: `slot_unavailable` with reasons `chair_conflict`, `dentist_conflict`, `in_past`, `outside_hours` (hours edited) and no schedule row. Reschedule: all five rejected, original untouched. 10:00-11:00 then 11:00-11:30 and 09:30-10:00 before it: 201 | PASS |
| FR9 | Public request with `+63 917-555-0101`; request on a staff-created patient's number in `+63 9xx-xxx-xxxx` form; staff search `+63 917-555`; patient PATCH with formatted duplicate (E2E 01, 05; probe) | One record per patient, matched by normalized number | Matches Maria Santos / the existing patient (no duplicate row); search matches; PATCH duplicate 409 "Contact number already used by another patient"; stored digits-only | PASS |
| FR10 | Open Maria Santos `/patients/1`; add dentist note, view history (E2E 05; probe) | History newest first with services, dentist, notes | Oct 12 and Oct 19 seeded visits shown; order verified newest first on a 14-row history; note appears in history | PASS |
| FR11 | Logged out: open 16 staff URLs and 19 API routes x 5 methods; forged/`alg=none` cookies; `x-middleware-subrequest`, `//`, case, encoded and dot-segment paths (E2E 03; probes) | Redirect to `/login` / 401; hashed passwords | 307 `/login?next=` for every page, 401 for every API route (public method/route pairs excepted); no bypass; password hash `$2b$12$`; cookie `HttpOnly; Secure; SameSite=Lax; Max-Age=28800` | PASS |
| FR12 | Staff confirm a request (SMTP sink up, then down) (E2E 04; probe) | Mail after commit; failure must not roll back | One mail with date, time, dentist, service; SMTP down: 200, `emailError` "Confirmed, but the email could not be sent.", appointment stays scheduled; patient without email: `emailSkipped: no_email` | PASS |
| FR13 | Tomorrow (Oct 10): scheduled with email, scheduled without email, cancelled, pending, scheduled day-after; call cron twice; then SMTP down, then up (probe) | One reminder per eligible visit; `reminder_sent_at` only after success | Run 1 `{sent:1,failed:0}` (Maria only), run 2 `{sent:0}`; SMTP down `{failed:1}` and `reminder_sent_at` stays NULL; after recovery `{sent:1}`; "Reminder sent" shown on the appointment page; 401 without/with wrong token | PASS |
| FR14 | 36 status combinations (6 from-statuses x start passed/future x attended/cancelled/no-show) through `POST /status`; UI buttons (E2E 06; probe) | Table 3.21 only | Only scheduled->cancelled (any time) and scheduled->attended/no-show (after start) succeed; the other 31 give 409; UI shows only allowed buttons; concurrent status changes: one wins | PASS |
| FR15 | `/reports?month=2026-10` (E2E 07) | Dr. Reyes 10.0%, Dr. Lim 20.0%, total 14.3% | Matches Table 3.22 (Reyes 18/2/2, Lim 12/1/3); rate shown per dentist, service and total | PASS |
| FR16 | Threshold 2 then 3 on `/reports` (E2E 07) | Repeat list shortens; names link to patient | Threshold 2: Jose Ramos and Miguel Fernandez; threshold 3: empty; link opens patient | PASS |

### 2.2 Non-functional requirements

| ID | Steps | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| NF01 | `/book` at 360x740; every staff page at 768 and 1280 wide (E2E 10, 11) | Works without install on a phone; no horizontal page scroll; no console errors | No overflow at 360/768/1280 on all pages (screenshots in `docs/screenshots/qa/`); 13 pages load with zero console errors or failed requests | PASS |
| NF02 | 13 invalid SQL writes straight to MySQL (dup contact, `end<=start` x2, bad ENUM x2, FK x3, UNIQUE x3, CHECK x2, RESTRICT delete x2) | Rejected by the database | 13/13 rejected (ER_DUP_ENTRY, ER_CHECK_CONSTRAINT_VIOLATED, WARN_DATA_TRUNCATED, ER_NO_REFERENCED_ROW_2, ER_ROW_IS_REFERENCED_2) | PASS |
| NF03 | Hash prefix; cookie flags; consent in UI and API; logged-out leak check | bcrypt cost >= 10; consent required; no data without login | `$2b$12$`; consent button disabled until ticked, API 400 without `consent:true`; no patient names/emails/phones in logged-out HTML or API bodies | PASS |
| NF04 | List all columns of the 7 tables; triggers/routines/events | No slot/count/total/rate columns | 36 columns, none derived except `end_time`; 0 triggers, routines, events, views | PASS |
| NF05 | Dashboard after a booking in another context; headers; grep | No cached pages | See FR6; every staff page and `/book` export `force-dynamic`; headers `private, no-cache, no-store` | PASS |
| NF06 | Grep `app/` and `components/` for DB driver imports | Pages, logic, data access in separate modules | Pages use `lib/queries` and `lib/services`; one route handler imports `getPool` (nit N3) | PASS |
| NF07 | Scan routes | One clinic, one staff role, no patient accounts | No sign-up or patient-login routes; one `users` row | PASS |
| NF08 | Manila 02:38 on Oct 9 (UTC date Oct 8): staff book today 1 min ago / 6 min ahead / this minute; Manila-yesterday 20:00 (future in UTC terms); `/api/slots` for today; public request on a past grid slot; cron "tomorrow" (probe) | All "today/past/tomorrow" in Manila | 1 min ago and current minute: 409 `in_past`; 6 min ahead: 201; Manila-yesterday 20:00: 409 `in_past`; first slot today is the next grid start after now; past grid slot 409; cron date `2026-10-10` | PASS |
| NF09 | `git ls-files` for `.env*`; `git grep` for the local secret values in HEAD; `git log` of env files | Secrets only in env | Only `.env.example` tracked; secret values absent from HEAD and history | PASS |
| NF10 | 6 requests each, logged in, server response time, DB with ~130 appointments (probe) | Dashboard and reports < 2 s | Dashboard 5-9 ms (Oct 12 and today), reports 4-5 ms, other staff pages 16-18 ms (local MySQL; dominated by network on the hosted DB) | PASS |

### 2.3 Business rules

| ID | Steps | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| Rule 1 | Overlap and back-to-back checks above | `new_start < existing_end AND new_end > existing_start`; only pending/scheduled count | As expected, including pending holding a slot and a declined/cancelled one freeing it | PASS |
| Rules 2-4 | Outside hours, Sunday, past, stored `end_time` (e.g. 10:30 + 60 min = 11:30) | As written | As expected | PASS |
| Rule 5 | Hours 09:00-12:00, existing 10:00-11:00, 45-min service | Open 09:00 and 11:00; closed 09:30, 10:00, 10:30, 11:30 | `["09:00","11:00"]` | PASS |
| Rule 6 | `GET /api/chairs/free`, confirm without or with unknown chair | Only free chairs; exactly one picked | Free list correct (also with `excludeId`); missing chair 400; unknown chair 400 `unknown_chair` | PASS |
| Rule 7 | See FR14 | Table 3.21 | As expected | PASS |
| Rule 8 | See FR13 | Tomorrow, scheduled, not yet reminded, has email | As expected; cron rerun same day sends nothing | PASS |
| Rule 9 | 8 concurrent staff bookings (4 Reyes + 4 Lim, same chair and slot); 2 requests confirmed on one chair; 2 confirms of one request; public request vs staff booking; 3 partially overlapping bookings; 3 concurrent status changes (probe) | Exactly one wins each time | 1 success each time, rest 409, no 5xx, one DB row | PASS |
| Rule 10 | 3 "any dentist" requests for the same slot | Dentist 1, then 2, then 409 | `[201, 201, 409]` assigned dentist 1 then 2 | PASS |
| Rule 11 | Inspect rows after a reschedule | Same patient/service/channel, notes copied, reminder NULL, `requested_at` now, link, new end time | All as written | PASS |
| Rule 12 | Decline a pending request | `declined`, no email, slot free | As expected | PASS |

### 2.4 Phase acceptance bullets

| ID | Steps | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| Ph1 | Seed user logs in; `/patients` logged out; wrong password and unknown email (E2E 03; probe) | Login works; redirect to `/login`; same error for either field | `/patients` redirects to `/login?next=%2Fpatients` and `next` is honoured after login; identical 401 body for both failures; 11 bad attempts give 429 + `Retry-After` | PASS |
| Ph2 | Unit tests; `attended` before start; `+63 917-555-0101` | Reproduce Table 3.17/3.18; refusal before start; normalization | 222 unit tests pass; `attended` before start 409 (API and hidden in UI); `+63 917-555-0101` -> `09175550101` | PASS |
| Ph3 | Every staff page at 768 and 1280; new dentist in slots (E2E 08, 10) | Pages fit; hours bookable at once | See NF01 and FR5 | PASS |
| Ph4 | Race two phones (E2E 02); repeat number; no consent; honeypot filled; banner at 360 (E2E 01) | One success + one "That time was just taken" with fresh slots; reuse patient; blocked; dropped; visible | Exactly 1 success and 1 "taken" (one DB row); repeat number reuses the patient; submit disabled without consent; honeypot 201 with nothing saved (whitespace-only counts as empty); banner visible | PASS |
| Ph5 | Table 3.21 matrix; rescheduled link; confirm conflict UI (E2E 04, 05, 06) | All transitions reachable and nothing else; link to the original; "Slot no longer free" | 36-combination matrix as expected; links both ways; chair taken after page load shows "Slot no longer free" with only the free chair offered, then confirm works | PASS |
| Ph6 | Booking from another tab; dentist with no hours (E2E 09) | Appears after refresh; "Not working" | Both work. When nobody works that day (Sundays) the page shows "Clinic closed" instead (N1) | PASS |
| Ph6-nav | Click Previous day on `/dashboard` 12 times (E2E 14) | Navigates each time | Click is sometimes ignored (about 10% of clicks) | **FAIL** (QA-1) |
| Ph7 | Duplicate number edit; Maria's visits (E2E 05) | Refused with readable message; two seeded visits | "Contact number already used by another patient"; Oct 12 and Oct 19 visits shown | PASS |
| Ph8 | Confirm emails; cron twice; SMTP down (probe, E2E 04) | One reminder per visit; warning and stays scheduled | See FR12/FR13. "Wrong SMTP_PASS" was simulated with an unreachable SMTP server: same code path (`send_failed`) | PASS |
| Ph9 | October numbers and threshold (E2E 07) | 10.0 / 20.0 / 14.3%; list shortens | See FR15/FR16 | PASS |
| Ph9-nav | Click Previous month on `/reports` 12 times (E2E 14) | Navigates each time | Click is ignored on roughly 25-50% of loads | **FAIL** (QA-1) |
| Ph10 | Time dashboard and reports; logged-out sweep; 10 concurrent bookings (probes) | < 2 s; no data; none fails with "too many connections" | NF10 times above; logged-out sweep clean; 10 concurrent requests on 10 different slots: all 201; 10 on one slot: 1 x 201 + 9 x 409; 80 mixed concurrent requests (30 POST, 30 dashboard, 20 slots): no 5xx; server log has no connection errors | PASS |

### 2.5 Constraints and security fixes (commit `acc79d6`)

| ID | Steps | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| Pool cap | Pool config and the 80-request burst | `connectionLimit: 5`, requests queue instead of failing | Config 5; burst clean (see Ph10) | PASS |
| Seven tables | `information_schema.tables` | Exactly 7 base tables | `appointments, chairs, dentist_schedules, dentists, patients, services, users` | PASS |
| Demo banner | `/book` at 360 | Banner visible | Visible (screenshot `book-360.png`) | PASS |
| H1 caps (defaults) | Same number sends 4 requests; one IP sends 7; 60 online requests in the last hour then 1 more; `/book` form submit (E2E 12; probe) | 4th/6th/61st blocked with 429 and a readable message; `/book` shows it | Per contact: 201 x3 then 429 "You already have requests waiting for the clinic to review..."; per IP: 5 accepted then 429 + `Retry-After: 600`; clinic cap: 429 "The clinic is receiving a lot of online requests..."; `/book` shows the contact-cap message (screenshot `book-429-message.png`) | PASS |
| M2 details-differ | Request on Maria's number with another name/email/birthdate; and with identical details | Record not overwritten; staff warned; no false flag | Maria's record unchanged; `patient_note` starts "[Details differ from patient record..."; warning visible on `/requests`; identical details give no flag | PASS |
| I1/I3/L1 | `text/plain` body; 70 KB body; empty-body decline; headers on `/book` | 415; 413; works; CSP, `X-Frame-Options: DENY`, nosniff, Referrer-Policy, HSTS, no `X-Powered-By` | All as expected | PASS |
| Fuzz | 31 malformed public payloads (bad dates/times/ids, 5000-char name, emoji, `<script>`, CRLF email, SQL in number, extra fields such as `status`/`chairId`); odd ids on API and pages; reports/dashboard params; LIKE wildcards; 5 MB body | 4xx, never 5xx; no mass assignment; escaped output | No 5xx anywhere; extra fields ignored (row is pending, chair NULL, channel online); `<script>` name and note render escaped; `%` and `_` in search match nothing; open-redirect variants all land on `/dashboard` | PASS |

## 3. Bugs

| ID | Severity | Repro steps | Expected vs actual | Suspected location |
| --- | --- | --- | --- | --- |
| QA-1 | Medium | 1. Log in, open `/reports?month=2026-12&threshold=2` (or `/dashboard?date=2026-10-12`). 2. Wait for the page to finish loading. 3. Click "Previous month" (or "Previous day"). 4. Repeat 12 times. Automated: `npx playwright test 14` | Expected: the URL and page change every time. Actual: roughly 25-50% of month clicks (about 10% of day clicks) do nothing: the browser fetches the RSC payload (`GET /reports?month=2026-11&threshold=2&_rsc=...` returns 200) but the page never updates, even after 9 s; clicking again sometimes works. Staff would click twice or think the page is broken. Same cause makes `/appointments/999999` and `/patients/999999` return HTTP 200 with the not-found content (soft 404). Not caused by the security commit: reproduced on `bde5be0` too (9 of 20 stuck) | `app/(staff)/loading.tsx:1-5` (Suspense boundary above every staff page, Next 15.5.27 production build). Verified on a scratch copy: with `loading.tsx` removed, 20 of 20 clicks navigated and the missing-id pages returned 404; adding `prefetch={false}` to the month links did not help (still ~40% stuck). Candidate fixes: delete `app/(staff)/loading.tsx` (or move loading UI into page-level `<Suspense>` boundaries), then rerun `npx playwright test 14` |
| QA-2 | Low | 1. Deploy with defaults (`REQUEST_LIMIT_PER_IP=5`, window 10 min). 2. Six panelists on the same Wi-Fi (one public IP) each submit a request within 10 minutes | Expected: all six get "Request received". Actual: the 6th gets 429 "You've sent several requests in a short time..." (`Retry-After: 600`). Demo risk, not a code defect: the limiter counts accepted requests per client IP | `lib/services/rate-limit.ts` `requestLimitPerIp()` default 5 (env `REQUEST_LIMIT_PER_IP`); suggest setting it to 0 or 30 in the defense deployment and noting it in `docs/DEPLOY.md` |

## 4. UX nits and observations (low priority)

- N1: When no dentist works that day (every Sunday) `/dashboard` shows "Clinic closed" and no per-dentist "Not working" labels. Phase 6 acceptance wording ("a dentist with no hours that day shows 'Not working'") is met whenever at least one other dentist works. `app/(staff)/dashboard/page.tsx:118-127`.
- N2: The dashboard "open times" links carry date, dentist and start but no service, so the staff form shows the start time pre-selected only after a service is chosen, with no hint why. `app/(staff)/dashboard/page.tsx` (OpenSlotsPanel), `app/(staff)/appointments/new/NewBookingForm.tsx` (prefillStart).
- N3: `app/api/chairs/free/route.ts:8,43` imports `getPool` from `lib/db` and hands it to a query function; every other route goes through `lib/services`/`lib/queries`. NF06 layering nit.
- N4: Pending requests whose start time has passed stay in the queue and the nav badge until declined (by design, Decision B10); consider an "expired" hint on the badge count.
- N5: A whitespace-only value in the honeypot field is treated as empty (`honeypotTripped` trims), so a bot that fills only spaces is not dropped. Deliberate, but worth knowing.
- N6: The per-IP limiter keys on the last `X-Forwarded-For` hop outside Vercel, so a client can pick its own value when there is no proxy (probe: random `X-Forwarded-For` after throttling got a 201). On Vercel it uses the platform header. Accepted in SECURITY-REVIEW L3; the DB-backed caps still hold.
- N7: Duplicate-contact 409 responses on staff routes include `existingPatientId` (staff only, so fine).
- N8: Vite warns that `vitest.config.ts` is loaded as CommonJS (harmless).

## 5. Evidence

Screenshots in `docs/screenshots/qa/`: `book-360.png` (360 px form with demo banner), `dashboard-768.png`, `dashboard-1280.png`, `reports-768.png`, `reports-1280.png`, `book-429-message.png` (readable 429 message on `/book`). Playwright writes failure traces to `test-results/` (git-ignored).

## 6. How to rerun

```bash
# MySQL must be running on 127.0.0.1:3307 (npm run db:local). db:reset creates dental_qa if missing and seeds it:
DATABASE_URL=mysql://root@127.0.0.1:3307/dental_qa npm run db:reset
node tests/e2e/support/smtp-sink.mjs 2526 /tmp/qa/mail.jsonl &          # optional mail sink
set -a; source .env.local; set +a
export DATABASE_URL=mysql://root@127.0.0.1:3307/dental_qa NEXT_DIST_DIR=.next-qa \
       SMTP_HOST=127.0.0.1 SMTP_PORT=2526 SMTP_USER=qa SMTP_PASS=qa \
       REQUEST_LIMIT_PER_IP=0 REQUEST_LIMIT_PER_CONTACT=0 REQUEST_LIMIT_PER_HOUR=0 REQUEST_LIMIT_PER_DAY=0
npm run build && npx next start -p 3004 &
E2E_MAIL_LOG=/tmp/qa/mail.jsonl npm run e2e                               # 31 tests
# caps spec: restart the server WITHOUT the REQUEST_LIMIT_* variables, then
E2E_ABUSE_LIMITS=1 npx playwright test 12
```

Notes: specs create their own data on future Mon-Sat dates (14-63 days ahead, a different range per spec) and unique contact numbers, so they can be rerun on the same database; `14-link-navigation` is expected to fail until QA-1 is fixed. Do not point `E2E_DATABASE_URL` at a database you care about: specs insert test rows and a few past (September 2026) appointments with SQL.
