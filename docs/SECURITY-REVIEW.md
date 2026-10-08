# Security review

Oct 9, 2026 · Security agent · commit reviewed: `8116464` (+ uncommitted Frontend edits in `app/book`, `components/staff`)

Scope: `middleware.ts`, `lib/**`, `app/api/**`, client pages in `app/**`, `next.config.ts`, `vercel.json`, `package.json`, `.env.example`, `.gitignore`, `db/**`, `scripts/**`, git history. Context: student demo that holds patient PII (RA 10173), to be deployed on Vercel + Aiven MySQL.

Method: code read plus live probes against a production build (`next build` + `next start`, port 3003) wired to the **local** MySQL (`127.0.0.1:3307/dental`) with SMTP pointed at a dead local port. All probe rows (tagged `SECPROBE`, plus one request on Maria Santos's number) were deleted afterwards: 36 appointments, 2 patients, 1 dentist + its schedule row.

> Note on the first probe attempt: `next start` loads `.env.production.local`, so the server briefly pointed at the **Aiven** DB. One `GET /book` ran a single SELECT, which failed (`Table 'defaultdb.dentist_schedules' doesn't exist`). Nothing was written and no email was sent. I stopped the server and restarted it with local env overrides. See M4.

## Summary

| ID | Severity | Title | Location | Status |
| --- | --- | --- | --- | --- |
| H1 | High | No abuse limits on public `POST /api/requests`: one script can hold every slot for 60 days | `app/api/requests/route.ts:16`, `lib/services/booking.ts:105` | Open |
| H2 | High | Default staff password ships in the repo and nothing stops it reaching the public demo DB | `db/seed.ts:21,209`, `scripts/db-reset.ts:23`, `scripts/db-local.ts:103`, `.env.example:28` | Open |
| M1 | Medium | Open redirect after login: `/login?next=/.//evil.com` | `lib/session.ts:65-71`, `middleware.ts:47-52`, `app/login/page.tsx:11` | Open |
| M2 | Medium | Anyone with a patient's contact number can add requests to that patient's record | `lib/services/patients.ts:22-33`, `lib/services/booking.ts:137` | Open |
| M3 | Medium | DB TLS in production skips certificate verification unless `DATABASE_CA_CERT` is set (and it isn't) | `lib/db-config.ts:62` | Open |
| M4 | Medium | Running `next start` locally silently uses the hosted DB and the real Gmail credentials | `.env.production.local` (gitignored, local file) | Open |
| L1 | Low | No security headers (CSP, frame-ancestors, nosniff, Referrer-Policy, HSTS); `X-Powered-By` exposed | `next.config.ts:3-6` | Open |
| L2 | Low | Sessions can't be revoked (logout only clears the cookie) and `exp` isn't required | `lib/session.ts:37`, `app/api/auth/logout/route.ts:8` | Open |
| L3 | Low | Login throttle: per-instance memory, keyed on a client-controlled IP, shared `unknown` bucket | `lib/services/rate-limit.ts:13-17` | Open |
| L4 | Low | Unexpected-error logs print the full mysql2 error, including SQL with PII values inlined | `lib/services/errors.ts:51` | Open |
| I1 | Info | API routes accept any Content-Type as JSON | `lib/http.ts:22`, `app/api/requests/route.ts:19` | Open |
| I2 | Info | Middleware matcher skips dynamic paths that end in a static extension (pages still protected) | `middleware.ts:72` | Open |
| I3 | Info | Request bodies up to 10 MB are parsed | Next default | Open |
| I4 | Info | First unknown-email login is ~2x slower (dummy hash is built lazily) | `lib/auth.ts:70-75` | Open |
| I5 | Info | Contact numbers in URL query strings (`/patients?q=`, `/api/patients?q=`) | `app/(staff)/patients/page.tsx`, `app/api/patients/route.ts` | Open |
| I6 | Info | Consent checkbox is present but there's no privacy notice (controller, purpose, retention, rights) | `app/book/BookingForm.tsx:29-30` | Open |
| I7 | Info | No minimum length/entropy check on `CRON_SECRET`; session cookie isn't `__Host-` prefixed | `app/api/cron/reminders/route.ts:16`, `lib/session.ts:8` | Open |
| I8 | Info | `npm audit`: postcss (bundled in next, build-time only) and braces (eslint, dev-only) | `package-lock.json` | Open |
| I9 | Info | mysql2 `query()` expands object values; add `stringifyObjects: true` as a safety net | `lib/db-config.ts:56-71` | Open |
| I10 | Info | Dev-mode mail logger prints full email bodies (name, date, dentist) to the console | `lib/mail.ts:80` | Open |

Counts: Critical 0 · High 2 · Medium 4 · Low 4 · Info 10.

---

## H1 — No abuse limits on public `POST /api/requests` (slot-hold flood)

**Evidence.** I sent 32 anonymous requests with **one** contact number, `dentistId: "any"`, one per 30-minute start × 2 dentists, for 2026-10-13:

```
requests: {"201":32} in 213 ms
GET /api/slots?date=2026-10-13&serviceId=1&dentistId=any  ->  {"slots":[]}
```

Pending rows count in the overlap check (Rule 1), so the whole day disappeared from `/book`. The public window is 60 days, so about 2,000 requests (roughly 15 seconds) would empty the form for two months. Staff would then have to decline each row one at a time. The same loop also fills `patients` with junk PII. The route has no per-IP or per-contact limit, no cap on pending requests per patient, and no global cap. The honeypot only stops naive form bots, since a script just leaves `website` empty.

**Impact.** Anyone can take down the main public feature without logging in, and it's trivial to do. During the defense, a panelist with curl could run it.

**Fix.** Use two layers, neither of which needs an 8th table.

1. **DB-backed caps.** They work across Vercel instances. Add them in `createOnlineRequest` (`lib/services/booking.ts`), inside the transaction, after `matchOrCreatePatient` and before `insertAppointment`:

```ts
// lib/services/booking.ts — constants near SLOT_TAKEN_MESSAGE
export const MAX_ACTIVE_ONLINE_PER_CONTACT = 2;     // pending/scheduled future online requests per number
export const MAX_ONLINE_REQUESTS_PER_HOUR = 30;     // whole clinic, online channel only
export const TOO_MANY_REQUESTS_MESSAGE =
  'You already have requests waiting for the clinic. Please wait for a reply or call the clinic.';

// inside transaction(), after `const patientId = await matchOrCreatePatient(...)`:
const [perContact] = (await conn.query(
  `SELECT COUNT(*) AS n FROM appointments
    WHERE patient_id = ? AND channel = 'online' AND status IN ('pending','scheduled')
      AND appointment_date >= CURDATE()`,
  [patientId],
)) as unknown as [{ n: number }[]];
if (Number(perContact[0]?.n ?? 0) >= MAX_ACTIVE_ONLINE_PER_CONTACT) {
  throw new ServiceError(429, 'too_many_requests', TOO_MANY_REQUESTS_MESSAGE);
}
const [recent] = (await conn.query(
  `SELECT COUNT(*) AS n FROM appointments
    WHERE channel = 'online' AND requested_at >= NOW() - INTERVAL 1 HOUR`,
)) as unknown as [{ n: number }[]];
if (Number(recent[0]?.n ?? 0) >= MAX_ONLINE_REQUESTS_PER_HOUR) {
  throw new ServiceError(429, 'too_many_requests', 'The clinic is receiving many requests right now. Please try again later or call the clinic.');
}
```

The response must not reveal whether the number already existed. Both 429 messages are the same whether the patient is new or matched, and a brand-new patient can't hit the per-contact cap. Show `message` in `BookingForm.tsx` when the status is 429.

2. **In-memory per-IP limiter.** Reuse the `lib/services/rate-limit.ts` pattern: a new `requestRetryAfter(ip)` / `recordRequest(ip)` pair with 5 accepted requests per 10 minutes per IP, called at the top of `app/api/requests/route.ts` (after the honeypot check, before parsing). It returns 429 with `Retry-After`. It's best effort, like the login throttle.

Optionally, also add a Vercel Firewall rate-limit rule on `/api/requests` and `/api/slots`.

Add an integration test: three online requests from one contact give 201, 201, then 429. Make sure the existing booking tests still pass, since they create several requests. Use distinct contact numbers there or raise the cap in tests.

---

## H2 — Default staff password reaches the public demo

**Evidence.**
- `db/seed.ts:21` `DEFAULT_SEED_STAFF_PASSWORD = 'ClinicDemo2026!'`, used at `:209` when `SEED_STAFF_PASSWORD` is unset.
- `scripts/db-local.ts:103` writes `SEED_STAFF_PASSWORD=ClinicDemo2026!` into `.env.local`. `scripts/db-reset.ts` loads `.env.local`, so the documented remote reset (`DATABASE_URL="…aiven…" npm run db:reset -- --yes`, PRD Phase 11) seeds the **hosted** DB with the public password.
- `.env.example:28`, `docs/CONTRACTS.md:16` and `docs/DECISIONS.md` (A14) publish the password. Live check: `POST /api/auth/login {"email":"staff@clinic.test","password":"ClinicDemo2026!"}` returned 200 and a session cookie.

**Impact.** One shared staff account has full access. If the repo is public or shared (with the paper, the panel, or GitHub), anyone can log into the live demo and read or edit every panelist's name, number, email and birthdate. A14 says "change it before seeding", but nothing enforces that.

**Fix.**
1. Guard remote seeding in `scripts/db-reset.ts`, after the `--yes` check:

```ts
import { DEFAULT_SEED_STAFF_PASSWORD, SEED_STAFF_EMAIL } from '../db/seed';
// ...
const pw = process.env.SEED_STAFF_PASSWORD ?? DEFAULT_SEED_STAFF_PASSWORD;
if (!local && (pw === DEFAULT_SEED_STAFF_PASSWORD || pw.length < 12)) {
  console.error('Refusing to seed a NON-LOCAL database with the default/short staff password.');
  console.error('Set a strong one: SEED_STAFF_PASSWORD="…" DATABASE_URL="…" npm run db:reset -- --yes');
  process.exit(1);
}
```

2. Leave `SEED_STAFF_PASSWORD` empty in `.env.example`, and add a comment: "required (≥ 12 chars, not the default) for any non-local reset".
3. Stop printing the password in `scripts/db-reset.ts:30` for remote targets. Print `(SEED_STAFF_PASSWORD)` instead.
4. Tell panelists the demo password in person, not in the repo or the paper.

---

## M1 — Open redirect via `/login?next=`

**Evidence.** I logged in first, then requested these (`curl -D -`):

```
GET /login?next=/.//evil.com         -> 307  location: //evil.com
GET /login?next=/..//evil.com        -> 307  location: //evil.com
GET /login?next=/%2e%2e//evil.com    -> 307  location: //evil.com
```

`safeNextPath` only checks the raw string's prefix (`//`, `/\`). `new URL('/.//evil.com', base)` normalizes the path to `//evil.com`, and Next then sends a protocol-relative `Location`. When logged out, the same value goes to `LoginForm` as `nextPath` (`"nextPath":"/.//evil.com"` appears in the page props), and `router.replace(nextPath)` runs it after a successful login. Variants that are blocked correctly: `//evil.com`, `/\evil.com`, `https://evil.com`, `%2F%2Fevil.com`, `/%09/evil.com`, `javascript:`, CRLF.

**Impact.** A phishing link on the clinic's own domain sends logged-in staff (or staff right after they log in) to an attacker page, for example a fake "session expired" login that captures the shared staff password.

**Fix.** Replace `safeNextPath` in `lib/session.ts` with a version that resolves the URL first and checks the **normalized** result. It stays edge-safe because `URL` is available everywhere.

```ts
export function safeNextPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.includes('\\') || /[\u0000-\u001f\u007f]/.test(next)) return fallback;
  let u: URL;
  try {
    u = new URL(next, 'http://n.invalid');
  } catch {
    return fallback;
  }
  if (u.origin !== 'http://n.invalid') return fallback;
  if (u.pathname.startsWith('//') || /%2f|%5c/i.test(u.pathname)) return fallback;
  if (u.pathname === '/login' || u.pathname.startsWith('/api/')) return fallback;
  return u.pathname + u.search + u.hash; // return the normalized form, never the raw input
}
```

I checked this logic with node: `/.//evil.com`, `/..//evil.com`, `/%2e%2e//evil.com`, `/./api/patients` and `/a/../login` all fall back to `/dashboard`, while `/patients/1?x=1` passes through. Add these cases to `tests/unit/session.test.ts`.

---

## M2 — Public requests attach to an existing patient by contact number alone

**Evidence.** `POST /api/requests` with `contactNumber: "+63 917-555-0101"` (Maria Santos), `fullName: "SECPROBE Impostor"`, `email: "attacker@evil.test"`, `birthdate: "2000-02-02"` returned `201 {"ok":true}`. The DB then had a new pending row `appointment_id 49, patient_id 1`. Maria's record was unchanged (B6 works). `/appointments/49` shows "Maria Santos / maria.santos@example.com" with the impostor's note. The name, email and birthdate the requester typed are dropped without a trace.

**Impact.** Anyone who knows (or guesses) a patient's mobile number can:
- add requests to that patient's history;
- make the clinic send that patient a confirmation email for a visit they never asked for;
- if staff confirm and nobody shows up, give the real patient a **no-show**, which feeds the FR16 repeat no-show list.

Staff have no signal that the submitted details didn't match the record. Response and timing are the same for new and existing numbers (201 in both cases, about 20 ms), so there's no enumeration oracle. Keep it that way.

**Fix** (keeps B6's "never overwrite from public input" rule and adds no schema change):
1. In `createOnlineRequest`, have `matchOrCreatePatient` return `{ patientId, existing: PatientRow | null }`. When `existing` is set, compare normalized `full_name` (case and whitespace-insensitive), `email` and `birthdate` with the input. If any differ, prefix the stored `patient_note`:

   ```
   [Online form details differ from the patient record: name "…", email "…", birthdate …. Verify before confirming.]
   ```

   Then add the patient's own note (still capped at 1000 chars total, so truncate the user part). Staff see it on `/requests` and on the detail page. The HTTP response stays identical.
2. The per-contact pending cap from H1 limits how far this can be abused.
3. Optional UI: highlight notes that start with that prefix on `/requests` and `/appointments/[id]`.

---

## M3 — Production DB TLS without certificate verification

**Evidence.** `lib/db-config.ts:62`: `ssl: p.ssl ? (ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }) : undefined`. The hosted URL in `.env.production.local` has `ssl-mode=REQUIRED` and no `DATABASE_CA_CERT` key, so the deployed app would accept any certificate.

**Impact.** Vercel functions (AWS) and Aiven talk over the public internet. Anyone on that path can intercept the connection. Under `caching_sha2_password` full authentication, MySQL sends the DB password in clear text inside TLS, so an on-path attacker gets the DB credentials and every patient row. The likelihood is low (it needs a network position), but the fix is one environment variable.

**Fix.**
1. In Aiven: Service → Overview → CA certificate. Put the PEM into the Vercel env var `DATABASE_CA_CERT`, using `\n` escapes, which the parser already supports.
2. Fail closed in production in `buildPoolOptions`:

```ts
if (p.ssl && !ca && process.env.NODE_ENV === 'production' && !isLocalHost(p.host)) {
  throw new Error('DATABASE_CA_CERT is required for TLS to a remote MySQL in production (see docs/DECISIONS.md A8)');
}
```

`tests/unit/db-config.test.ts:18` builds an SSL config without a CA. It runs with `NODE_ENV=test`, so it should keep passing. Add a test for the production throw. Update DECISIONS A8.

---

## M4 — Local `next start` uses the hosted DB and real Gmail credentials

**Evidence.** `.env.production.local` (correctly gitignored) holds the Aiven `DATABASE_URL`, a 23-character `SMTP_USER`, a 16-character `SMTP_PASS`, and `SESSION_SECRET`/`CRON_SECRET`. Next loads `.env.production.local` whenever `NODE_ENV=production`, and `next start` always sets that. My first probe server (`npx next start -p 3003`) logged `Error: Table 'defaultdb.dentist_schedules' doesn't exist`, which means it was talking to Aiven.

**Impact.** Any agent or developer who runs `npm run build && npm start` locally to "test the production build" would write test data into the hosted demo DB. Once the DB is seeded, they'd see or change real panelist PII. Confirm flows would send **real emails** through the clinic Gmail to whatever addresses are in the DB. QA and Security agents are told to use `next start`, so this is likely to happen.

**Fix.** Rename the file so Next never auto-loads it, for example `.env.aiven.local`. It stays covered by `.env*` in `.gitignore`. Use it only on purpose: `npx dotenv -e .env.aiven.local -- npm run db:reset -- --yes`, or paste the values into Vercel. Add one line to `SETUP.md`/`CONTRACTS.md`: "Never keep `.env.production.local` in the working tree; `next start` loads it." Optionally, have `scripts/db-local.ts` warn on start if `.env.production.local` exists.

---

## L1 — Missing security headers; `X-Powered-By: Next.js`

**Evidence.** `curl -I /book` and the login response only include `X-Powered-By: Next.js`. There's no CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` or HSTS. SameSite=Lax already keeps the session cookie out of cross-site iframes, which is why this is Low.

**Fix.** Replace `next.config.ts` with:

```ts
import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`, // Next inline bootstrap; dev needs eval
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' }, // staff URLs can carry ?q=<contact number>
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  // Lets parallel dev servers in one checkout use separate build dirs (e.g. NEXT_DIST_DIR=.next-api).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
```

After applying it, run a production build, open `/book`, `/login`, `/dashboard`, `/appointments/[id]` and `/setup`, and check the console for CSP violations.

---

## L2 — Sessions can't be revoked; `exp` not required

**Evidence.**
- After `POST /api/auth/logout` (which returns `Set-Cookie: session=; Max-Age=0`), replaying the old token on `GET /api/patients?q=Maria` still returns **200**.
- Tokens I signed with the real secret also return 200: one without `exp`, one with `exp` 10 years out, and one with `sub: "999"` (no such user). The handler never checks the DB.
- Correctly rejected (401/307): wrong key, `alg: none` (with and without the trailing dot), tampered payload, expired token, HS512 with the same key, `sub: "0"`.

**Impact.** A stolen cookie stays valid for up to 8 hours whatever the user does. Deleting the user or changing the password doesn't end sessions. A `SESSION_SECRET` leak gives sessions that never expire.

**Fix.**
1. In `lib/session.ts`, `verifySession`, use `jwtVerify(token, secretKey(), { algorithms: ['HS256'], requiredClaims: ['exp', 'iat', 'sub'], maxTokenAge: SESSION_TTL_SECONDS })`.
2. Document in DECISIONS: "To log everyone out, rotate `SESSION_SECRET` on Vercel and redeploy."
3. Optional, Node-only (not middleware): in `requireStaffApi` and `requireStaffPage`, `SELECT 1 FROM users WHERE user_id = ?` so a deleted user's token stops working. Add a `pwv` claim (first 8 characters of `sha256(password_hash)`) and compare it so a password change revokes old tokens.

---

## L3 — Login throttle limits

**Evidence.** 10 bad passwords from `x-forwarded-for: 10.77.0.1` gave 401 ×10, then 429 (`retry-after: 897`). Changing the header to `10.77.0.2` gave **401** again (not throttled). Without an XFF or `x-real-ip` header, every client falls into the `unknown` bucket, so anyone can lock out `staff@clinic.test` for everyone there. Counts live in memory per lambda (B14).

**Impact.** On Vercel, `x-forwarded-for` is set by the platform, so spoofing is mostly a local or self-hosting concern. Per-instance memory means the throttle doesn't hold across cold starts or parallel instances. bcrypt cost 12 is still the main brake. Low.

**Fix.** In `clientIp`, prefer `x-vercel-forwarded-for` (platform-set) when it's present, then the XFF first hop. Add a second bucket keyed only on the email (for example 50 failures per 15 minutes) so rotating IPs doesn't help much. Keep the B14 note. A strong, non-default password (H2) is the real mitigation.

---

## L4 — Error logs can contain PII

**Evidence.** `lib/services/errors.ts:51` calls `console.error(`[${context}] unexpected error`, err)`. The app uses `pool.query` (client-side interpolation), so mysql2 errors carry `err.sql` with the **values inlined**. The first server run printed such an object (`sql: 'SELECT schedule_id, … FROM dentist_schedules …'`). An unexpected failure on `INSERT INTO patients …` would write name, number, email and birthdate to Vercel logs. Responses are fine: the client only gets `{"error":"server_error"}`, and I saw no stack traces or SQL text in any probe response.

**Fix.**

```ts
const e = err as { code?: string; errno?: number; sqlState?: string; sqlMessage?: string; message?: string; stack?: string };
console.error(`[${context}] unexpected error`, e?.code
  ? { code: e.code, errno: e.errno, sqlState: e.sqlState, sqlMessage: e.sqlMessage }   // never err.sql
  : { message: e?.message, stack: e?.stack });
```

Also see I10 for the dev-only mail log.

---

## Info

- **I1. Content-Type not enforced.** A same-origin `text/plain` body parses as JSON (`/api/appointments/99999/status` returned 404 after parsing). CSRF is still covered: cross-site Origin returns 403 (tested `https://evil.example`, `http://127.0.0.1:3003.evil.example`, `http://127.0.0.1:3004`, `null`), and the cookie is SameSite=Lax. For defense in depth, have `parseJsonBody`, `parseOptionalJsonBody` and `app/api/requests/route.ts` return 415 unless `content-type` starts with `application/json`. The frontend `api()` already sends it, but `LogoutButton` sends no body or type. Keep logout exempt, or make the check apply only when the body is non-empty.
- **I2. Matcher.** `/patients/1.png` and `/appointments/2.png` skip middleware because of the extension exclusion, but still return 307 to login with no PII in the body. Every staff page calls `requireStaffPage()` itself, which I verified for all 8 pages. Keep that rule: every new staff page must call it.
- **I3. Body size.** 1 MB and 5 MB JSON bodies were fully parsed; 20 MB was truncated at 10 MB (400). Vercel caps bodies at 4.5 MB. Optional: reject `content-length > 64 KB` in public routes.
- **I4. Login timing.** The first unknown-email login took 0.47 s against 0.24 s for a known email, because `getDummyHash()` builds the hash on first use. Later calls were equal (0.238 s / 0.238 s). Compute the dummy hash at module load, or hard-code a cost-12 hash constant.
- **I5. PII in URLs.** Staff patient search puts contact numbers in `?q=`. It's staff-only and `Cache-Control: private, no-store`, but the numbers land in Vercel request logs and browser history. The `Referrer-Policy: same-origin` in L1 stops them leaking further. Acceptable for the demo; note it in the paper's privacy section.
- **I6. RA 10173 transparency.** The consent text and demo banner are present, and consent is enforced on the server (`consent: "true"` string or `false` gives 400). The form doesn't say who the personal information controller is, how long data is kept (the hosted DB is reset after the defense, PRD Phase 11), or how to ask for access or erasure. Add one line under the consent checkbox, for example: "Sample Dental Clinic (demo) keeps this only to schedule your visit; demo data is deleted after [date]. Contact [clinic phone] to access or delete your data." Data collected is limited to what FR1 requires.
- **I7. Secrets.** `CRON_SECRET` has no minimum length (`"a"` would work). Add `secret.length < 32` to the existing 500 `cron_not_configured` check. The cookie name `session` could be `__Host-session` in production (requires Secure, path `/`, no Domain). `SESSION_SECRET` < 32 chars fails closed (the `.env.example` placeholder is 29 chars, so it's rejected). The real secrets are 43–44 chars.
- **I8. Dependencies.** `next@15.5.27` is the newest 15.x (`npm view next@15 version`). `npm audit --omit=dev` lists postcss 8.4.31, bundled inside next, for GHSA-qx2v-qp2m-jg93 and the sourceMappingURL advisories. It only processes our own CSS at build time, so there's no runtime exposure. The full audit adds braces → micromatch (eslint-config-next, dev-only). Optional: `"overrides": { "next": { "postcss": "^8.5.29" } }` in `package.json`, followed by a build check. Don't run `npm audit fix --force` (it jumps to next 16).
- **I9. mysql2 object expansion.** `pool.query` turns an object value into `` `key` = val `` (the classic mysqljs login bypass). Every current input is Zod-typed to primitives (I tested `serviceId: {a:1}` → 400, `contactNumber: [..]` → 400), so nothing is exploitable now. Add `stringifyObjects: true` to `buildPoolOptions` as a safety net. It doesn't affect named placeholders.
- **I10. Dev mail log.** In non-production without SMTP, `[mail:dev]` prints the recipient and full body to stdout. That's fine locally. Just don't run a dev server against the hosted DB.

---

## Verified OK (probed)

**AuthN/AuthZ**
- Without a session: all 9 staff pages give 307 to `/login?next=…`; `/book` and `/login` give 200. All 16 API paths × GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS give 401, except the exact public pairs (`GET|HEAD /api/slots`, `POST /api/requests`, `POST /api/auth/login`, `GET /api/cron/reminders` → 401 from the route itself). The public list matches the PRD and is method-specific.
- Every staff route handler re-checks the session (`requireStaffApi`). Logout relies on middleware, which is harmless.
- Bypass attempts all gave 401, 307, 308 to a canonical path, or 404, never data: `x-middleware-subrequest` (CVE-2025-29927 payloads; next 15.5.27 is patched), trailing slash, `/api/%70atients`, `/api/Patients`, `/API/patients`, `/_next/../api/patients`, `/api/slots/../patients`, `%2F` tricks, `//api/patients`, `;.css`, `?x=.png`, `.json`, `/book/../api/patients`, `RSC: 1`, `?_rsc=`, `Next-Router-Prefetch`, `x-nextjs-data`. The app has no server actions; bogus `Next-Action` gives 404 or a redirect to login.
- JWT: wrong key, `alg:none`, tampered payload, expired, HS512, `sub:0` are all rejected. The cookie is `HttpOnly; Secure` (production); `SameSite=lax; Path=/; Max-Age=28800`.
- Login: identical body for unknown email and wrong password (`invalid_credentials`, "Invalid email or password"); bcrypt cost 12; timing equal after warm-up.

**Public endpoints**
- `/api/slots` returns only `{start,end,dentistIds}`, never patient data. `excludeAppointmentId` without a session gives 401. Dates are window-checked (past → `date_in_past`, beyond 60 days → `date_out_of_range`). Unknown service or dentist → 400. Junk ids → 400.
- `/api/requests` returns only `{ok:true}`, with no ids. The honeypot drops the request (`website` set, even `0`). Off-grid and out-of-hours starts → 409. Consent is enforced on the server. Length limits hold (name 150, note 1000, email 150, contact 30). Birthdate before 1900 or in the future → 400. Email with CRLF or a quoted local part → 400. `__proto__`/`constructor` keys don't pollute anything. Form-encoded → 400. Cross-site Origin and `Origin: null` → 403. Deep JSON nesting → 400. Existing and new contact numbers get the same response and similar timing (no PII oracle).
- B6 holds: public input never overwrote Maria's name, email or birthdate.

**Injection / XSS / redirect**
- SQL: every value goes through `?`/`:named` placeholders. Dynamic SQL is limited to fixed column lists (`updatePatient`, `updateService`), a fixed `WHERE` fragment, and `LIMIT/OFFSET` built from clamped integers. `q=' OR 1=1-- ` → 0 rows. LIKE `%`, `_`, `\` are escaped (0 rows). `page=9007199254740991` → empty page; `1e400`/`0`/`1;DROP` → 400; unknown keys on setup PATCH are stripped (service 1 unchanged); setup entity is an enum (`users`, `__proto__` → 404).
- Mail: CR/LF stripped from `to` and `subject`; subject built from date and time only; plain-text bodies.
- XSS: `<script>` and `<img onerror>` in `patient_note` and `dentist_note` render escaped on `/appointments/[id]`, `/patients/[id]`, `/requests` and `/dashboard`. No `dangerouslySetInnerHTML`. `href`s are built from numeric ids, dates or `tel:` digits only.
- Open redirect: the common variants are blocked. Only the dot-segment case (M1) gets through.

**CSRF**
- Cross-site Origin on state-changing API routes gives 403 (including logout). Form-encoded bodies give 400. The cookie is SameSite=Lax. `GET /api/auth/logout` gives 405.

**Cron**
- Missing, malformed, wrong or `Basic` auth gives 401. An empty `CRON_SECRET` gives 500 `cron_not_configured` (code). The compare is `timingSafeEqual` on SHA-256 digests. POST gives 401 from middleware. A staff cookie alone gives 401. The advisory lock prevents double sends.

**Business logic**
- Status route only accepts attended, cancelled or no-show. Attended on a pending row gives 409. Declined rows are final: decline, confirm and cancel all give 409. Reschedule on a pending row gives 409. Ids `0`, `-1`, `1e3` give 400; `99999` gives 404. Unknown chair gives 400.
- Races: 4 concurrent confirms of one row → exactly 1 succeeds, 3 get `invalid_transition`. Two rows at the same time on the same chair → 1 succeeds, 1 gets `slot_unavailable/chair_conflict`.
- Declined and cancelled rows release their slots (they're excluded from the overlap check).
- Deleting a dentist or chair that appointments reference gives 409 `in_use`, and the dentist's schedules survive (the transaction rolls back). Duplicate schedule day → 409. CHECK-type input is caught by Zod before SQL. No SQL text in any response.
- `PATCH /api/patients/18` with `patient_id`/`contact_number` keys: stripped. Duplicate contact → 409.

**Secrets / config**
- `git log -p --all` contains no real secret: the actual `SESSION_SECRET`/`CRON_SECRET` values appear 0 times. Only `.env.example` with placeholders is tracked. `.env.local`, `.env.production.local`, `*.pem` and `.mysql-data/` are gitignored.
- No secrets, connection strings or PII in `.next-sec/static` client bundles or in `/book`/`/login` HTML and RSC payloads (`appointmentCount`, emails and phone numbers absent).
- `db:reset` refuses a non-local host without `--yes`. The app pool doesn't enable `multipleStatements`.
- Staff pages send `Cache-Control: private, no-cache, no-store`; `/api/slots` sends `no-store`.
