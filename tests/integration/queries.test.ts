/** Read queries for the staff pages (lib/queries/*). Seed data only; no writes except setup. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execute } from '@/lib/db';
import { getAppointmentDetail } from '@/lib/queries/appointments';
import { getDashboardSummary, getDaySchedule } from '@/lib/queries/dashboard';
import { getPatient, getPatientHistory, searchPatients } from '@/lib/queries/patients';
import { getMonthlyReport, getRepeatNoShows } from '@/lib/queries/reports';
import { countPending, listPendingRequests } from '@/lib/queries/requests';
import { listChairs, listDentistsWithSchedules, listServices } from '@/lib/queries/setup';
import { formatRate } from '@/lib/rules';
import { resetTestDb } from './helpers';

const NOW = { date: '2026-10-09', time: '08:00' };

beforeAll(async () => {
  await resetTestDb();
});
// Leave dental_test as seeded for suites that don't reset (e.g. seed-report).
afterAll(async () => {
  await resetTestDb();
});

describe('reports (FR15, FR16, Table 3.22)', () => {
  it('October 2026: Reyes 10.0%, Lim 20.0%, total 14.3%', async () => {
    const r = await getMonthlyReport('2026-10');
    expect(r.month).toBe('2026-10');
    expect(r.byDentist.map((d) => [d.dentistName, d.attended, d.cancelled, d.noShow, formatRate(d.noShowRate)])).toEqual([
      ['Dr. Reyes', 18, 2, 2, '10.0%'],
      ['Dr. Lim', 12, 1, 3, '20.0%'],
    ]);
    expect(r.totals).toMatchObject({ attended: 30, cancelled: 3, noShow: 5, total: 38 });
    expect(formatRate(r.totals.noShowRate)).toBe('14.3%');
    const svc = r.byService.reduce((n, s) => n + s.total, 0);
    expect(svc).toBe(38);
  });

  it('empty month -> zeros and null rate', async () => {
    const r = await getMonthlyReport('2025-01');
    expect(r.totals).toEqual({ attended: 0, cancelled: 0, noShow: 0, total: 0, noShowRate: null });
    expect(r.byDentist).toEqual([]);
  });

  it('repeat no-shows: threshold 2 lists >= 2 patients; threshold 3 is shorter', async () => {
    const two = await getRepeatNoShows(2);
    expect(two.length).toBeGreaterThanOrEqual(2);
    expect(two.map((p) => p.fullName)).toEqual(['Jose Ramos', 'Miguel Fernandez']);
    expect(two[0]).toMatchObject({ noShowCount: 2, lastNoShowDate: '2026-10-12', contactNumber: '09185550102' });
    const three = await getRepeatNoShows(3);
    expect(three.length).toBeLessThan(two.length);
    expect((await getRepeatNoShows(1)).length).toBeGreaterThan(two.length);
  });
});

describe('dashboard', () => {
  it('Oct 19: Reyes has Maria 10:00–11:00 on Chair 1; Lim free all day', async () => {
    const d = await getDaySchedule('2026-10-19', NOW);
    expect(d.dayOfWeek).toBe(1);
    expect(d.gridStart).toBe('09:00');
    expect(d.gridEnd).toBe('17:00');
    expect(d.slotDurationMinutes).toBe(30);
    const reyes = d.dentists[0];
    expect(reyes.hours).toEqual({ start: '09:00', end: '17:00' });
    expect(reyes.appointments).toEqual([
      expect.objectContaining({ appointmentId: 2, start: '10:00', end: '11:00', status: 'scheduled', patientName: 'Maria Santos', chairName: 'Chair 1' }),
    ]);
    const starts = reyes.openSlots.map((s) => s.start);
    expect(starts).toContain('09:30');
    expect(starts).not.toContain('10:00');
    expect(starts).not.toContain('10:30');
    expect(starts).toContain('11:00');
    expect(d.dentists[1].openSlots).toHaveLength(16);
    expect(d.chairs[0].appointments.map((a) => a.appointmentId)).toEqual([2]);
    expect(d.chairs[1].appointments).toEqual([]);
  });

  it('Sunday: nobody works; grid null', async () => {
    const d = await getDaySchedule('2026-10-18', NOW);
    expect(d.dentists.every((x) => x.hours === null && x.openSlots.length === 0)).toBe(true);
    expect(d.gridStart).toBeNull();
  });

  it('Oct 12 shows attended + no-show (no open slots in the past)', async () => {
    const d = await getDaySchedule('2026-10-12', { date: '2026-10-13', time: '08:00' });
    const ids = d.dentists.flatMap((x) => x.appointments.map((a) => a.appointmentId)).sort();
    expect(ids).toEqual([1, 3]);
    expect(d.dentists[0].openSlots).toEqual([]);
  });

  it('summary', async () => {
    expect(await getDashboardSummary('2026-10-18')).toEqual({ todayTotal: 0, pendingCount: 0, tomorrowCount: 1 });
    expect(await getDashboardSummary('2026-10-12')).toMatchObject({ todayTotal: 2 });
  });
});

describe('requests, appointment detail, patients, setup', () => {
  it('pending queue oldest first', async () => {
    await execute(
      `INSERT INTO appointments (patient_id, dentist_id, service_id, chair_id, appointment_date, start_time, end_time, status, channel, requested_at, patient_note)
       VALUES (3, 2, 1, NULL, '2026-10-20', '09:00', '09:30', 'pending', 'online', '2026-10-09 07:00:00', 'second'),
              (4, 1, 1, NULL, '2026-10-20', '09:00', '09:30', 'pending', 'online', '2026-10-09 06:00:00', 'first')`,
    );
    const list = await listPendingRequests(NOW);
    expect(list.map((r) => r.patientNote)).toEqual(['first', 'second']);
    expect(list[0]).toMatchObject({ patientName: 'Juan Bautista', dentistName: 'Dr. Reyes', start: '09:00', end: '09:30', startPassed: false });
    expect(await countPending()).toBe(2);
  });

  it('appointment detail', async () => {
    const a = await getAppointmentDetail(2, NOW);
    expect(a).toMatchObject({
      appointmentId: 2,
      patient: { id: 1, name: 'Maria Santos', contact: '09175550101', email: 'maria.santos@example.com', birthdate: '1994-03-12' },
      dentist: { id: 1, name: 'Dr. Reyes' },
      service: { id: 2, name: 'Tooth filling', durationMinutes: 60 },
      chair: { id: 1, name: 'Chair 1' },
      status: 'scheduled',
      channel: 'online',
      start: '10:00',
      end: '11:00',
      replacedById: null,
      startPassed: false,
      allowedTransitions: ['cancelled'],
    });
    const past = await getAppointmentDetail(2, { date: '2026-10-19', time: '10:00' });
    expect(past?.allowedTransitions).toEqual(['attended', 'cancelled', 'no-show']);
    expect(await getAppointmentDetail(99999)).toBeNull();
  });

  it('patient search by name / contact, profile, history newest first', async () => {
    const byName = await searchPatients('maria');
    expect(byName.total).toBe(1);
    expect(byName.rows[0]).toMatchObject({ fullName: 'Maria Santos', appointmentCount: 2, lastVisitDate: '2026-10-12' });
    expect((await searchPatients('+63 917-555-0101')).rows.map((r) => r.fullName)).toEqual(['Maria Santos']);
    expect((await searchPatients('0917 555')).rows.map((r) => r.fullName)).toEqual(['Ana Dela Cruz', 'Maria Santos']);
    expect((await searchPatients('100%_')).total).toBe(0);
    const all = await searchPatients('', 1, 5);
    expect(all.total).toBe(12);
    expect(all.rows).toHaveLength(5);
    expect((await searchPatients('', 3, 5)).rows).toHaveLength(2);
    expect(await getPatient(1)).toEqual({ patientId: 1, fullName: 'Maria Santos', contactNumber: '09175550101', email: 'maria.santos@example.com', birthdate: '1994-03-12' });
    expect(await getPatient(999)).toBeNull();
    const h = await getPatientHistory(1);
    expect(h.map((x) => [x.date, x.status])).toEqual([
      ['2026-10-19', 'scheduled'],
      ['2026-10-12', 'attended'],
    ]);
    expect(h[1].dentistNote).toMatch(/Routine cleaning/);
  });

  it('setup lists', async () => {
    const d = await listDentistsWithSchedules();
    expect(d.map((x) => x.dentistName)).toEqual(['Dr. Reyes', 'Dr. Lim']);
    expect(d[0].schedules).toHaveLength(6);
    expect(d[0].week[0]).toBeNull();
    expect(d[0].week[1]).toEqual({ start: '09:00', end: '17:00' });
    expect(d[0].appointmentCount).toBeGreaterThan(0);
    expect((await listServices()).map((s) => [s.serviceName, s.durationMinutes])).toEqual([
      ['Oral prophylaxis', 30],
      ['Tooth filling', 60],
      ['Tooth extraction', 45],
    ]);
    expect((await listChairs()).map((c) => c.chairName)).toEqual(['Chair 1', 'Chair 2']);
  });
});
