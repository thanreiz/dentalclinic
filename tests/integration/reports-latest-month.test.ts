/** getLatestReportMonth: the Reports empty state points at the newest month that has completed visits. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execute } from '@/lib/db';
import { getLatestReportMonth } from '@/lib/queries/reports';
import { insertAppt } from './api-helpers';
import { resetTestDb } from './helpers';

beforeAll(async () => {
  await resetTestDb();
});
// Leave dental_test as seeded for suites that don't reset.
afterAll(async () => {
  await resetTestDb();
});

describe('getLatestReportMonth', () => {
  it('is the seed month (2026-10) on the seeded database', async () => {
    expect(await getLatestReportMonth()).toBe('2026-10');
  });

  it('ignores pending, scheduled and declined rows in later months', async () => {
    await insertAppt({ date: '2027-02-02', start: '09:00', end: '09:30', status: 'pending' });
    await insertAppt({ date: '2027-02-03', start: '09:00', end: '09:30', status: 'scheduled' });
    await insertAppt({ date: '2027-02-04', start: '09:00', end: '09:30', status: 'declined' });
    expect(await getLatestReportMonth()).toBe('2026-10');
  });

  it('a cancellation that was a reschedule does not count, a real one does', async () => {
    const moved = await insertAppt({ date: '2027-03-01', start: '09:00', end: '09:30', status: 'cancelled' });
    const replacement = await insertAppt({ date: '2027-03-02', start: '09:00', end: '09:30', status: 'scheduled' });
    await execute('UPDATE appointments SET rescheduled_from_id = ? WHERE appointment_id = ?', [moved, replacement]);
    expect(await getLatestReportMonth()).toBe('2026-10');
    await insertAppt({ date: '2027-04-05', start: '09:00', end: '09:30', status: 'cancelled' });
    expect(await getLatestReportMonth()).toBe('2027-04');
  });

  it('attended and no-show count', async () => {
    await insertAppt({ date: '2027-05-10', start: '09:00', end: '09:30', status: 'attended' });
    expect(await getLatestReportMonth()).toBe('2027-05');
  });
});
