import { expect, test } from '@playwright/test';
import { gotoReady, createStaffBooking, findSlot, loginApi, loginUi, LIM, REYES, SVC, sql, uniqueContact, uniqueName } from './helpers';

/** Insert a scheduled appointment in Sep 2026 (start already passed; outside the October report). */
async function pastScheduled(day: string, start: string, dentistId: number) {
  const contact = uniqueContact();
  const name = uniqueName('E2E Past');
  const p = (await sql(`INSERT INTO patients (full_name, contact_number, email, birthdate) VALUES (?, ?, NULL, '1990-01-01')`, [name, contact])) as unknown as { insertId: number };
  const pid = p.insertId;
  const a = (await sql(
    `INSERT INTO appointments (patient_id, dentist_id, service_id, chair_id, appointment_date, start_time, end_time, status, channel, requested_at)
     VALUES (?, ?, 1, 1, ?, ?, ADDTIME(?, '00:30:00'), 'scheduled', 'phone', '2026-08-30 10:00:00')`,
    [pid, dentistId, day, start, start],
  )) as unknown as { insertId: number };
  return { id: a.insertId, name, patientId: pid };
}

test.describe('FR14 / Rule 7: status transitions', () => {
  test('future scheduled appointment: only Cancel is offered; attended/no-show locked', async ({ page, request }) => {
    await loginApi(request);
    const f = await findSlot(request, { dentistId: REYES, serviceId: SVC.prophylaxis, fromDays: 56, index: 1 });
    const appt = await createStaffBooking(request, { date: f.date, start: f.slot.start, dentistId: REYES, serviceId: SVC.prophylaxis });
    await loginUi(page);
    await gotoReady(page, `/appointments/${appt.id}`);
    await expect(page.getByRole('button', { name: 'Mark attended' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark no-show' })).toHaveCount(0);
    await expect(page.getByText(/unlock once the start time/)).toBeVisible();
    // API also refuses
    const r = await request.post(`/api/appointments/${appt.id}/status`, { data: { status: 'attended' } });
    expect(r.status()).toBe(409);

    await page.getByRole('button', { name: 'Cancel appointment' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel appointment' }).click();
    await expect(page.getByText('Marked cancelled')).toBeVisible();
    // final: no further status buttons
    await expect(page.getByRole('button', { name: 'Cancel appointment' })).toHaveCount(0);
    await expect(page.getByText(/That status is final/)).toBeVisible();
    const again = await request.post(`/api/appointments/${appt.id}/status`, { data: { status: 'no-show' } });
    expect(again.status()).toBe(409);
  });

  test('started appointment: mark attended; another: mark no-show; both final', async ({ page, request }) => {
    await loginApi(request);
    const a = await pastScheduled('2026-09-01', '09:00:00', REYES);
    const b = await pastScheduled('2026-09-01', '09:30:00', LIM);
    await loginUi(page);

    await gotoReady(page, `/appointments/${a.id}`);
    await page.getByRole('button', { name: 'Mark attended' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Mark attended' }).click();
    await expect(page.getByText('Marked attended')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark no-show' })).toHaveCount(0);

    await gotoReady(page, `/appointments/${b.id}`);
    await page.getByRole('button', { name: 'Mark no-show' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Mark no-show' }).click();
    await expect(page.getByText('Marked no-show')).toBeVisible();

    const rows = await sql<{ appointment_id: number; status: string }>(`SELECT appointment_id, status FROM appointments WHERE appointment_id IN (?, ?)`, [a.id, b.id]);
    expect(Object.fromEntries(rows.map((r) => [r.appointment_id, r.status]))).toEqual({ [a.id]: 'attended', [b.id]: 'no-show' });
    const back = await request.post(`/api/appointments/${a.id}/status`, { data: { status: 'no-show' } });
    expect(back.status(), 'attended is final').toBe(409);
  });
});
