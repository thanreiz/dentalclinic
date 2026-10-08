/**
 * Seed data (PRD "Seed data", from the paper's Chapter 3 sample). Illustrative only.
 *
 * Staff login: staff@clinic.test / SEED_STAFF_PASSWORD (default 'ClinicDemo2026!'), bcrypt cost 12.
 *
 * October 2026 totals reproduce Table 3.22:
 *   Dr. Reyes 18 attended / 2 cancelled / 2 no-show  -> no-show rate 2/20 = 10.0%
 *   Dr. Lim   12 attended / 1 cancelled / 3 no-show  -> no-show rate 3/15 = 20.0%
 *   Total                                            -> 5/35 = 14.3%
 * Repeat no-shows (threshold 2): Jose Ramos (2), Miguel Fernandez (2).
 *
 * Only Oct 1–12 are used (plus Maria's Oct 19 scheduled row) so demo weeks stay open
 * (PRD Open Question #3). Seed rows bypass canTransition on purpose.
 * Run through `npm run db:reset`, which runs db/schema.sql first.
 */
import bcrypt from 'bcryptjs';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { addDays, addMinutes, toMinutes } from '../lib/time';

export const SEED_STAFF_EMAIL = 'staff@clinic.test';
export const DEFAULT_SEED_STAFF_PASSWORD = 'ClinicDemo2026!';

type Status = 'pending' | 'scheduled' | 'attended' | 'cancelled' | 'declined' | 'no-show';
type Ch = 'online' | 'phone' | 'chat' | 'walk-in';

const DENTISTS = ['Dr. Reyes', 'Dr. Lim'] as const; // ids 1, 2
const SERVICES = [
  ['Oral prophylaxis', 30],
  ['Tooth filling', 60],
  ['Tooth extraction', 45],
] as const; // ids 1, 2, 3
const CHAIRS = ['Chair 1', 'Chair 2'] as const; // ids 1, 2

/** [full_name, contact_number (digits only), email | null, birthdate]. ids 1..12 in this order. */
const PATIENTS: [string, string, string | null, string][] = [
  ['Maria Santos', '09175550101', 'maria.santos@example.com', '1994-03-12'],
  ['Jose Ramos', '09185550102', 'jose.ramos@example.com', '1988-07-25'],
  ['Ana Dela Cruz', '09175550103', 'ana.delacruz@example.com', '1990-01-15'],
  ['Juan Bautista', '09195550104', 'juan.bautista@example.com', '1985-05-30'],
  ['Liza Mendoza', '09205550105', 'liza.mendoza@example.com', '1997-11-02'],
  ['Paolo Garcia', '09215550106', null, '1979-09-18'],
  ['Kristine Villanueva', '09225550107', 'kristine.villanueva@example.com', '2001-04-22'],
  ['Ramon Aquino', '09275550108', 'ramon.aquino@example.com', '1968-12-05'],
  ['Carmela Torres', '09285550109', null, '1992-08-09'],
  ['Miguel Fernandez', '09305550110', 'miguel.fernandez@example.com', '2005-02-14'],
  ['Bea Castillo', '09395550111', 'bea.castillo@example.com', '1999-06-27'],
  ['Nestor Pascual', '09475550112', 'nestor.pascual@example.com', '1956-10-01'],
];
const P: Record<string, number> = Object.fromEntries(PATIENTS.map((p, i) => [p[0].split(' ')[0], i + 1]));

const SVC = { P: 1, F: 2, E: 3 } as const; // prophylaxis, filling, extraction
const REYES = 1;
const LIM = 2;

type SeedAppt = {
  date: string;
  start: string;
  dentist: number;
  chair: number;
  service: keyof typeof SVC;
  patient: string; // first name key into P
  channel: Ch;
  status: Status;
  patientNote?: string;
  dentistNote?: string;
};

/** Table 3.6 rows, inserted first (appointment_id 1–3). */
const TABLE_3_6: SeedAppt[] = [
  {
    date: '2026-10-12', start: '09:00', dentist: REYES, chair: 1, service: 'P', patient: 'Maria',
    channel: 'phone', status: 'attended', dentistNote: 'Routine cleaning done. Advised flossing daily; return in 6 months.',
  },
  {
    date: '2026-10-19', start: '10:00', dentist: REYES, chair: 1, service: 'F', patient: 'Maria',
    channel: 'online', status: 'scheduled', patientNote: 'Slight pain on the upper left molar when drinking cold water.',
  },
  { date: '2026-10-12', start: '09:30', dentist: LIM, chair: 2, service: 'E', patient: 'Jose', channel: 'walk-in', status: 'no-show' },
];

const r = (date: string, start: string, service: keyof typeof SVC, patient: string, channel: Ch, status: Status, extra: Partial<SeedAppt> = {}): SeedAppt => ({
  date: `2026-10-0${date}`, start, dentist: REYES, chair: 1, service, patient, channel, status, ...extra,
});
const l = (date: string, start: string, service: keyof typeof SVC, patient: string, channel: Ch, status: Status, extra: Partial<SeedAppt> = {}): SeedAppt => ({
  date: `2026-10-0${date}`, start, dentist: LIM, chair: 2, service, patient, channel, status, ...extra,
});

/** Additional October rows (Oct 1–8, Mon–Sat; Oct 4 is a Sunday). Reyes: Chair 1, Lim: Chair 2. */
const OCTOBER: SeedAppt[] = [
  // Dr. Reyes: 17 attended + 2 cancelled + 2 no-show (Maria's Oct 12 visit makes 18 attended)
  r('1', '09:00', 'F', 'Ana', 'phone', 'attended', { dentistNote: 'Composite filling, lower right premolar.' }),
  r('1', '10:30', 'P', 'Juan', 'online', 'attended', { patientNote: 'First visit in two years.' }),
  r('1', '14:00', 'E', 'Liza', 'chat', 'attended', { dentistNote: 'Extracted retained baby tooth. Soft diet for 2 days.' }),
  r('2', '09:00', 'P', 'Paolo', 'walk-in', 'attended'),
  r('2', '11:00', 'F', 'Kristine', 'phone', 'attended'),
  r('2', '15:00', 'P', 'Jose', 'phone', 'no-show'),
  r('3', '09:30', 'E', 'Ramon', 'phone', 'attended', { dentistNote: 'Extraction of lower left molar; prescribed rest.' }),
  r('3', '13:00', 'F', 'Carmela', 'walk-in', 'attended'),
  r('3', '16:00', 'P', 'Bea', 'online', 'cancelled'),
  r('5', '09:00', 'P', 'Bea', 'online', 'attended'),
  r('5', '10:00', 'F', 'Nestor', 'phone', 'attended'),
  r('5', '13:30', 'E', 'Miguel', 'chat', 'no-show'),
  r('6', '09:00', 'F', 'Ana', 'phone', 'attended', { dentistNote: 'Follow-up filling, upper right molar.' }),
  r('6', '11:30', 'P', 'Liza', 'online', 'attended'),
  r('6', '15:00', 'E', 'Juan', 'phone', 'cancelled'),
  r('7', '09:00', 'P', 'Kristine', 'chat', 'attended'),
  r('7', '10:00', 'E', 'Ramon', 'phone', 'attended'),
  r('7', '14:30', 'F', 'Nestor', 'online', 'attended', { patientNote: 'Prefers afternoon schedules.' }),
  r('8', '09:30', 'P', 'Carmela', 'walk-in', 'attended'),
  r('8', '11:00', 'F', 'Juan', 'phone', 'attended'),
  r('8', '16:00', 'P', 'Jose', 'phone', 'attended'),

  // Dr. Lim: 12 attended + 1 cancelled + 2 no-show (Jose's Oct 12 no-show makes 3)
  l('1', '09:00', 'P', 'Nestor', 'phone', 'attended'),
  l('1', '13:00', 'F', 'Bea', 'online', 'attended'),
  l('2', '10:00', 'E', 'Liza', 'phone', 'attended'),
  l('2', '14:00', 'P', 'Ramon', 'chat', 'attended'),
  l('3', '09:00', 'F', 'Juan', 'online', 'attended'),
  l('3', '11:00', 'P', 'Kristine', 'walk-in', 'attended'),
  l('5', '09:30', 'E', 'Carmela', 'phone', 'attended'),
  l('5', '14:00', 'P', 'Ana', 'online', 'attended'),
  l('6', '10:00', 'F', 'Paolo', 'phone', 'attended'),
  l('6', '13:30', 'P', 'Miguel', 'online', 'attended'),
  l('7', '09:00', 'E', 'Miguel', 'phone', 'no-show'),
  l('7', '11:00', 'F', 'Bea', 'phone', 'cancelled'),
  l('7', '15:30', 'P', 'Liza', 'chat', 'attended'),
  l('8', '09:00', 'P', 'Paolo', 'phone', 'no-show'),
  l('8', '13:00', 'E', 'Kristine', 'online', 'attended', { dentistNote: 'Wisdom tooth removed without complications.' }),
];

export const SEED_APPOINTMENTS: SeedAppt[] = [...TABLE_3_6, ...OCTOBER];

/** Expected October 2026 totals (Table 3.22). Used by the seed self-check and tests. */
export const EXPECTED_OCTOBER = {
  'Dr. Reyes': { attended: 18, cancelled: 2, noShow: 2 },
  'Dr. Lim': { attended: 12, cancelled: 1, noShow: 3 },
} as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** requested_at: a few days before (2–5, deterministic); walk-ins the same day, 15 min before start. */
function requestedAt(a: SeedAppt, i: number): string {
  if (a.channel === 'walk-in') return `${a.date} ${addMinutes(a.start, -15)}:00`;
  const daysBefore = 2 + (i % 4);
  const hour = 9 + ((i * 3) % 8);
  const minute = (i * 17) % 60;
  return `${addDays(a.date, -daysBefore)} ${pad2(hour)}:${pad2(minute)}:00`;
}

/**
 * reminder_sent_at: 09:00 the day before for every past row that was scheduled, NULL otherwise.
 * A row "was scheduled" if its status is attended / no-show / cancelled. Walk-ins were booked
 * the same day and patients without email can't get one (Rule 8), so those stay NULL.
 */
function reminderSentAt(a: SeedAppt, patientEmail: string | null): string | null {
  const wasScheduled = a.status === 'attended' || a.status === 'no-show' || a.status === 'cancelled';
  if (!wasScheduled || a.channel === 'walk-in' || !patientEmail) return null;
  return `${addDays(a.date, -1)} 09:00:00`;
}

/** Throws if any two seeded rows collide on the same dentist, chair, or patient (any status). */
export function assertNoSeedCollisions(rows: SeedAppt[] = SEED_APPOINTMENTS): void {
  const dur = (a: SeedAppt) => SERVICES[SVC[a.service] - 1][1];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    const aS = toMinutes(a.start);
    const aE = aS + dur(a);
    if (aS < toMinutes('09:00') || aE > toMinutes('17:00')) {
      throw new Error(`Seed row ${i} (${a.date} ${a.start}) is outside 09:00–17:00`);
    }
    if (new Date(`${a.date}T00:00:00Z`).getUTCDay() === 0) throw new Error(`Seed row ${i} is on a Sunday`);
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j];
      if (a.date !== b.date) continue;
      const bS = toMinutes(b.start);
      const bE = bS + dur(b);
      if (!(aS < bE && aE > bS)) continue;
      if (a.dentist === b.dentist) throw new Error(`Seed collision (dentist) between rows ${i} and ${j}`);
      if (a.chair === b.chair) throw new Error(`Seed collision (chair) between rows ${i} and ${j}`);
      if (a.patient === b.patient) throw new Error(`Seed collision (patient) between rows ${i} and ${j}`);
    }
  }
}

/** Throws unless the October rows add up to Table 3.22. */
export function assertSeedTotals(rows: SeedAppt[] = SEED_APPOINTMENTS): void {
  for (const [name, exp] of Object.entries(EXPECTED_OCTOBER)) {
    const id = DENTISTS.indexOf(name as (typeof DENTISTS)[number]) + 1;
    const oct = rows.filter((a) => a.dentist === id && a.date.startsWith('2026-10'));
    const got = {
      attended: oct.filter((a) => a.status === 'attended').length,
      cancelled: oct.filter((a) => a.status === 'cancelled').length,
      noShow: oct.filter((a) => a.status === 'no-show').length,
    };
    if (got.attended !== exp.attended || got.cancelled !== exp.cancelled || got.noShow !== exp.noShow) {
      throw new Error(`Seed totals for ${name} are ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`);
    }
  }
}

export type SeedOptions = { staffPassword?: string; log?: (msg: string) => void };

/** Insert all seed rows. Expects empty tables (run db/schema.sql first). */
export async function seedDatabase(conn: Connection, opts: SeedOptions = {}): Promise<void> {
  const log = opts.log ?? (() => {});
  assertNoSeedCollisions();
  assertSeedTotals();

  const password = opts.staffPassword ?? process.env.SEED_STAFF_PASSWORD ?? DEFAULT_SEED_STAFF_PASSWORD;
  const hash = await bcrypt.hash(password, 12);

  await conn.beginTransaction();
  try {
    await conn.query('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', ['Clinic Staff', SEED_STAFF_EMAIL, hash]);

    for (const name of DENTISTS) await conn.query('INSERT INTO dentists (dentist_name) VALUES (?)', [name]);
    for (let d = 1; d <= DENTISTS.length; d++) {
      for (let dow = 1; dow <= 6; dow++) {
        await conn.query(
          'INSERT INTO dentist_schedules (dentist_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)',
          [d, dow, '09:00:00', '17:00:00'],
        );
      }
    }
    for (const [name, mins] of SERVICES) {
      await conn.query('INSERT INTO services (service_name, duration_minutes) VALUES (?, ?)', [name, mins]);
    }
    for (const name of CHAIRS) await conn.query('INSERT INTO chairs (chair_name) VALUES (?)', [name]);
    for (const p of PATIENTS) {
      await conn.query('INSERT INTO patients (full_name, contact_number, email, birthdate) VALUES (?, ?, ?, ?)', p);
    }

    for (let i = 0; i < SEED_APPOINTMENTS.length; i++) {
      const a = SEED_APPOINTMENTS[i];
      const patientId = P[a.patient];
      if (!patientId) throw new Error(`Unknown seed patient ${a.patient}`);
      const email = PATIENTS[patientId - 1][2];
      const duration = SERVICES[SVC[a.service] - 1][1];
      await conn.query(
        `INSERT INTO appointments
           (patient_id, dentist_id, service_id, chair_id, appointment_date, start_time, end_time,
            status, channel, requested_at, patient_note, dentist_note, reminder_sent_at, rescheduled_from_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          patientId,
          a.dentist,
          SVC[a.service],
          a.chair,
          a.date,
          `${a.start}:00`,
          `${addMinutes(a.start, duration)}:00`,
          a.status,
          a.channel,
          requestedAt(a, i),
          a.patientNote ?? null,
          a.dentistNote ?? null,
          reminderSentAt(a, email),
        ],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }

  const [counts] = await conn.query<RowDataPacket[]>(
    `SELECT (SELECT COUNT(*) FROM patients) AS patients, (SELECT COUNT(*) FROM appointments) AS appointments`,
  );
  log(`Seeded 1 staff user, ${DENTISTS.length} dentists, ${SERVICES.length} services, ${CHAIRS.length} chairs, ${counts[0].patients} patients, ${counts[0].appointments} appointments.`);
}
