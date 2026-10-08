/** Seeded October 2026 data reproduces Table 3.22 (PRD Seed data, Phase 9 acceptance). */
import { describe, expect, it } from 'vitest';
import { query } from '@/lib/db';
import { formatRate, noShowRate } from '@/lib/rules';

type Row = { dentist_name: string; attended: number; cancelled: number; no_show: number };

// Attendance per dentist for a month, excluding cancellations that were reschedules.
const PER_DENTIST_SQL = `
SELECT d.dentist_name,
       SUM(a.status = 'attended') AS attended,
       SUM(a.status = 'cancelled' AND NOT EXISTS (
             SELECT 1 FROM appointments r WHERE r.rescheduled_from_id = a.appointment_id)) AS cancelled,
       SUM(a.status = 'no-show') AS no_show
FROM appointments a
JOIN dentists d ON d.dentist_id = a.dentist_id
WHERE a.appointment_date BETWEEN '2026-10-01' AND '2026-10-31'
GROUP BY d.dentist_id, d.dentist_name
ORDER BY d.dentist_id`;

describe('October 2026 seed totals (Table 3.22)', () => {
  it('per dentist counts and no-show rates', async () => {
    const rows = (await query<Row>(PER_DENTIST_SQL)).map((r) => ({
      dentist_name: r.dentist_name,
      attended: Number(r.attended),
      cancelled: Number(r.cancelled),
      no_show: Number(r.no_show),
    }));
    expect(rows).toEqual([
      { dentist_name: 'Dr. Reyes', attended: 18, cancelled: 2, no_show: 2 },
      { dentist_name: 'Dr. Lim', attended: 12, cancelled: 1, no_show: 3 },
    ]);
    expect(formatRate(noShowRate(rows[0].attended, rows[0].no_show))).toBe('10.0%');
    expect(formatRate(noShowRate(rows[1].attended, rows[1].no_show))).toBe('20.0%');
    const att = rows[0].attended + rows[1].attended;
    const ns = rows[0].no_show + rows[1].no_show;
    expect(formatRate(noShowRate(att, ns))).toBe('14.3%');
  });

  it('repeat no-show list: threshold 2 -> Jose Ramos and Miguel Fernandez; 3 -> nobody', async () => {
    const sql = `
      SELECT p.patient_id, p.full_name, COUNT(*) AS no_shows
      FROM appointments a JOIN patients p ON p.patient_id = a.patient_id
      WHERE a.status = 'no-show'
      GROUP BY p.patient_id, p.full_name
      HAVING COUNT(*) >= :threshold
      ORDER BY no_shows DESC, p.full_name`;
    const two = await query<{ full_name: string; no_shows: number }>(sql, { threshold: 2 });
    expect(two.map((r) => r.full_name)).toEqual(['Jose Ramos', 'Miguel Fernandez']);
    expect(await query(sql, { threshold: 3 })).toEqual([]);
  });

  it('Table 3.6 rows are present exactly', async () => {
    const rows = await query<Record<string, unknown>>(
      `SELECT p.full_name, a.appointment_date, a.start_time, a.end_time, d.dentist_name, c.chair_name,
              s.service_name, a.channel, a.status
       FROM appointments a
       JOIN patients p USING (patient_id) JOIN dentists d USING (dentist_id)
       JOIN services s USING (service_id) LEFT JOIN chairs c USING (chair_id)
       WHERE a.appointment_id IN (1, 2, 3) ORDER BY a.appointment_id`,
    );
    expect(rows).toEqual([
      { full_name: 'Maria Santos', appointment_date: '2026-10-12', start_time: '09:00:00', end_time: '09:30:00', dentist_name: 'Dr. Reyes', chair_name: 'Chair 1', service_name: 'Oral prophylaxis', channel: 'phone', status: 'attended' },
      { full_name: 'Maria Santos', appointment_date: '2026-10-19', start_time: '10:00:00', end_time: '11:00:00', dentist_name: 'Dr. Reyes', chair_name: 'Chair 1', service_name: 'Tooth filling', channel: 'online', status: 'scheduled' },
      { full_name: 'Jose Ramos', appointment_date: '2026-10-12', start_time: '09:30:00', end_time: '10:15:00', dentist_name: 'Dr. Lim', chair_name: 'Chair 2', service_name: 'Tooth extraction', channel: 'walk-in', status: 'no-show' },
    ]);
  });

  it('Maria Santos has exactly her two seeded visits; contact numbers are digits only', async () => {
    const [m] = await query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM appointments a JOIN patients p USING (patient_id) WHERE p.contact_number = '09175550101'",
    );
    expect(Number(m.n)).toBe(2);
    const bad = await query("SELECT contact_number FROM patients WHERE contact_number NOT REGEXP '^[0-9]+$'");
    expect(bad).toEqual([]);
  });

  it('nothing seeded after Oct 12 except Maria Oct 19; no active rows overlap', async () => {
    const late = await query<{ appointment_id: number }>("SELECT appointment_id FROM appointments WHERE appointment_date > '2026-10-12'");
    expect(late.map((r) => r.appointment_id)).toEqual([2]);
    const clashes = await query(
      `SELECT a.appointment_id FROM appointments a JOIN appointments b
         ON a.appointment_id < b.appointment_id AND a.appointment_date = b.appointment_date
        AND (a.dentist_id = b.dentist_id OR a.chair_id = b.chair_id)
        AND a.start_time < b.end_time AND a.end_time > b.start_time`,
    );
    expect(clashes).toEqual([]);
  });

  it('timestamps: requested_at before the visit; reminders only for past emailed non-walk-in rows', async () => {
    const early = await query(
      "SELECT appointment_id FROM appointments WHERE requested_at >= TIMESTAMP(appointment_date, start_time)",
    );
    expect(early).toEqual([]);
    const reminders = await query<{ appointment_id: number; reminder_sent_at: string }>(
      'SELECT appointment_id, reminder_sent_at FROM appointments WHERE appointment_id IN (1, 2, 3) ORDER BY appointment_id',
    );
    expect(reminders.map((r) => r.reminder_sent_at)).toEqual(['2026-10-11 09:00:00', null, null]);
  });

  it('staff user is bcrypt cost 12', async () => {
    const [u] = await query<{ email: string; password: string }>('SELECT email, password FROM users');
    expect(u.email).toBe('staff@clinic.test');
    expect(u.password).toMatch(/^\$2[aby]\$12\$/);
  });
});
