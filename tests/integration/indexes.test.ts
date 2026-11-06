/** Performance indexes exist after a reset and the hot queries actually use them. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '@/lib/db';
import { resetTestDb } from './helpers';

beforeAll(async () => {
  await resetTestDb();
});
afterAll(async () => {
  await resetTestDb();
});

const names = async (table: string) =>
  (await query<{ index_name: string }>(
    'SELECT DISTINCT index_name AS index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = :t',
    { t: table },
  )).map((r) => r.index_name);

describe('performance indexes', () => {
  it('appointments and patients have them', async () => {
    expect(await names('appointments')).toEqual(expect.arrayContaining(['ix_appt_date_dentist', 'ix_appt_status_date', 'ix_appt_channel_requested']));
    expect(await names('patients')).toContain('ix_patients_psid');
  });

  it('the pending count and the day view use an index, not a full scan', async () => {
    const pending = await query<{ key: string | null }>("EXPLAIN SELECT COUNT(*) FROM appointments WHERE status = 'pending'");
    expect(pending[0].key).toBe('ix_appt_status_date');
    const day = await query<{ key: string | null }>(
      "EXPLAIN SELECT appointment_id FROM appointments WHERE appointment_date = '2026-10-05' AND dentist_id = 1 AND status IN ('pending','scheduled')",
    );
    expect(day[0].key).toBe('ix_appt_date_dentist');
  });
});
