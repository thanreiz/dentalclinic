import { describe, expect, it } from 'vitest';
import { assertNoSeedCollisions, assertSeedTotals, SEED_APPOINTMENTS } from '@/db/seed';

describe('seed data (pure checks)', () => {
  it('has no dentist / chair / patient collisions and stays within hours, Mon–Sat', () => {
    expect(() => assertNoSeedCollisions()).not.toThrow();
  });
  it('reproduces Table 3.22 totals', () => {
    expect(() => assertSeedTotals()).not.toThrow();
  });
  it('nothing after Oct 12 except Maria Oct 19 scheduled', () => {
    const late = SEED_APPOINTMENTS.filter((a) => a.date > '2026-10-12');
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ date: '2026-10-19', start: '10:00', patient: 'Maria', status: 'scheduled' });
  });
  it('the collision check really catches a collision', () => {
    const bad = [...SEED_APPOINTMENTS, { ...SEED_APPOINTMENTS[0], patient: 'Jose', chair: 2 }];
    expect(() => assertNoSeedCollisions(bad)).toThrow(/dentist/);
  });
});
