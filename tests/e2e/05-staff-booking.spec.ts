import { expect, test } from '@playwright/test';
import { gotoReady, createStaffBooking, findSlot, loginApi, loginUi, LIM, REYES, SVC, sql, time12, uniqueContact, uniqueName } from './helpers';

test.describe('FR3/FR4/FR10/FR9: staff booking, reschedule, notes, patient edit', () => {
  test('staff books a phone appointment for a new patient; dentist note persists', async ({ page, request }) => {
    await loginApi(request);
    const { date, slot } = await findSlot(request, { dentistId: LIM, serviceId: SVC.filling, fromDays: 35, index: 2 });
    const name = uniqueName('E2E Phone');
    const contact = uniqueContact();

    await loginUi(page);
    await gotoReady(page, '/appointments/new');
    await page.getByRole('button', { name: 'New patient' }).click();
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Contact number').fill(contact);
    await page.getByLabel('Birthdate').fill('1991-02-03');
    await page.getByLabel(/^Service/).selectOption({ label: 'Tooth filling (60 min)' });
    await page.getByLabel(/^Dentist/).selectOption({ label: 'Dr. Lim' });
    await page.getByLabel(/^Date/).fill(date);
    await page.getByRole('radio', { name: time12(slot.start), exact: true }).check({ force: true });
    await page.getByText('Chair 1', { exact: true }).click();
    await page.getByText('Phone call', { exact: true }).click();
    await page.getByRole('button', { name: 'Save booking' }).click();

    await expect(page).toHaveURL(/\/appointments\/\d+$/);
    const id = Number(page.url().split('/').pop());
    const [row] = await sql<{ status: string; channel: string; chair_id: number }>(`SELECT status, channel, chair_id FROM appointments WHERE appointment_id = ?`, [id]);
    expect(row).toEqual({ status: 'scheduled', channel: 'phone', chair_id: 1 });

    // dentist note
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Sensitive lower left molar.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByText('Dentist note saved')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Sensitive lower left molar.');

    // shows on patient history
    await page.getByRole('link', { name: 'View record and history' }).click();
    await expect(page.getByText('Sensitive lower left molar.')).toBeVisible();
    await expect(page.getByRole('cell', { name: /Phone/i }).first()).toBeVisible();
  });

  test('reschedule: old -> cancelled, new linked, links both ways', async ({ page, request }) => {
    await loginApi(request);
    const { date, slot, slots } = await findSlot(request, { dentistId: REYES, serviceId: SVC.prophylaxis, fromDays: 42, index: 0, minSlots: 6 });
    const orig = await createStaffBooking(request, { date, start: slot.start, dentistId: REYES, serviceId: SVC.prophylaxis });
    const target = slots.at(-1)!;

    await loginUi(page);
    await gotoReady(page, `/appointments/${orig.id}`);
    await page.getByRole('button', { name: 'Reschedule…' }).click();
    await page.getByRole('radio', { name: time12(target.start), exact: true }).check({ force: true });
    await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
    await expect(page).not.toHaveURL(new RegExp(`/appointments/${orig.id}$`));
    await expect(page).toHaveURL(/\/appointments\/\d+$/);
    const newId = Number(page.url().split('/').pop());
    expect(newId).not.toBe(orig.id);

    await expect(page.getByText('Rescheduled from')).toBeVisible();
    await page.getByRole('link', { name: `#${orig.id}` }).click();
    await expect(page).toHaveURL(new RegExp(`/appointments/${orig.id}$`));
    await expect(page.getByText('Replaced by')).toBeVisible();
    await expect(page.getByRole('link', { name: `#${newId}` })).toBeVisible();

    const rows = await sql<{ appointment_id: number; status: string; rescheduled_from_id: number | null; start_time: string }>(
      `SELECT appointment_id, status, rescheduled_from_id, start_time FROM appointments WHERE appointment_id IN (?, ?) ORDER BY appointment_id`,
      [orig.id, newId],
    );
    expect(rows.find((r) => r.appointment_id === orig.id)!.status).toBe('cancelled');
    const n = rows.find((r) => r.appointment_id === newId)!;
    expect(n.status).toBe('scheduled');
    expect(n.rescheduled_from_id).toBe(orig.id);
    expect(n.start_time).toBe(`${target.start}:00`);
  });

  test('FR9: editing a patient to another patient\'s number shows a readable duplicate error', async ({ page, request }) => {
    await loginApi(request);
    const p = await createStaffBooking(request, {
      date: (await findSlot(request, { dentistId: LIM, serviceId: SVC.prophylaxis, fromDays: 49, index: 0 })).date,
      start: '09:00',
      dentistId: LIM,
      serviceId: SVC.prophylaxis,
    }).catch(async () => {
      // 09:00 may be taken on rerun: fall back to any open slot
      const f = await findSlot(request, { dentistId: LIM, serviceId: SVC.prophylaxis, fromDays: 49, index: -1 });
      return createStaffBooking(request, { date: f.date, start: f.slot.start, dentistId: LIM, serviceId: SVC.prophylaxis });
    });
    await loginUi(page);
    await gotoReady(page, `/patients/${p.patientId}`);
    await page.getByLabel('Contact number').fill('0917 555 0101'); // Maria Santos
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Contact number already used by another patient')).toBeVisible();
    const [row] = await sql<{ contact_number: string }>(`SELECT contact_number FROM patients WHERE patient_id = ?`, [p.patientId]);
    expect(row.contact_number).not.toBe('09175550101');
  });

  test('Phase 7: Maria Santos shows her two seeded visits', async ({ page }) => {
    await loginUi(page);
    await gotoReady(page, '/patients?q=Maria');
    await page.getByRole('link', { name: /Maria Santos/ }).first().click();
    const table = page.getByRole('table', { name: /Appointment history for Maria Santos/ });
    await expect(table.getByRole('link', { name: 'Oct 12, 2026' })).toBeVisible();
    await expect(table.getByRole('link', { name: 'Oct 19, 2026' })).toBeVisible();
  });
});
