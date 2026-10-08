import { expect, test } from '@playwright/test';
import { createStaffBooking, loginApi, bookStepsOneAndTwo, fillDetails, findSlot, LIM, SVC, sql, uniqueContact, uniqueName, bookingPayload } from './helpers';

test.use({ viewport: { width: 360, height: 740 } });

test.describe('FR1/NF01/NF03: public booking form at 360x740', () => {
  test('banner visible, no horizontal scroll, consent blocks submit, honeypot hidden, thank-you shown', async ({ page, request }) => {
    const { date, slot } = await findSlot(request, { dentistId: LIM, serviceId: SVC.prophylaxis, fromDays: 14, index: 2 });
    await bookStepsOneAndTwo(page, { serviceName: /Oral prophylaxis/, dentistName: 'Dr. Lim', date, start: slot.start });

    // Demo banner (Phase 4) visible on a 360 px screen
    await page.goto('/book');
    await expect(page.getByText('Demo system: please use sample details, not your real information.')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal page scroll at 360 px').toBeLessThanOrEqual(0);

    await bookStepsOneAndTwo(page, { serviceName: /Oral prophylaxis/, dentistName: 'Dr. Lim', date, start: slot.start });

    // Honeypot: not visible to people, not focusable, aria-hidden
    const hp = page.locator('#book-website');
    await expect(hp).not.toBeInViewport();
    await expect(hp).toHaveAttribute('tabindex', '-1');
    await expect(page.locator('#book-website').locator('xpath=ancestor::div[@aria-hidden="true"]')).toHaveCount(1);

    const name = uniqueName('E2E Online');
    const contact = uniqueContact();
    await fillDetails(page, { name, contact, email: 'e2e.online@example.com' });

    // Consent not ticked -> submit disabled
    const submit = page.getByRole('button', { name: 'Request appointment' });
    await expect(submit).toBeDisabled();
    await page.getByRole('checkbox').check();
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText('Request received. The clinic will email you once it is confirmed.')).toBeVisible();
    const rows = await sql<{ status: string; channel: string; chair_id: number | null }>(
      `SELECT a.status, a.channel, a.chair_id FROM appointments a JOIN patients p USING (patient_id) WHERE p.contact_number = ?`,
      [contact],
    );
    expect(rows).toEqual([{ status: 'pending', channel: 'online', chair_id: null }]);
  });

  test('a submission with the honeypot filled is dropped (201, nothing saved)', async ({ request }) => {
    const { date, slot } = await findSlot(request, { dentistId: LIM, serviceId: SVC.prophylaxis, fromDays: 14, index: 3 });
    const payload = { ...bookingPayload({ date, start: slot.start, dentistId: LIM, serviceId: SVC.prophylaxis }), website: 'http://spam.example' };
    const r = await request.post('/api/requests', { data: payload });
    expect(r.status()).toBe(201);
    const rows = await sql(`SELECT 1 FROM patients WHERE contact_number = ?`, [payload.contactNumber]);
    expect(rows).toHaveLength(0);
  });

  test('FR9: repeat contact number (formatted differently) reuses the existing patient', async ({ request }) => {
    await loginApi(request);
    // an existing patient with a known number (created through the staff API)
    const day = await findSlot(request, { dentistId: LIM, serviceId: SVC.prophylaxis, fromDays: 14, index: 4 });
    const seedPatient = await createStaffBooking(request, { date: day.date, start: day.slot.start, dentistId: LIM, serviceId: SVC.prophylaxis, name: 'Existing E2E Patient' });
    const [{ contact_number }] = await sql<{ contact_number: string }>(`SELECT contact_number FROM patients WHERE patient_id = ?`, [seedPatient.patientId]);
    const intl = `+63 ${contact_number.slice(1, 4)}-${contact_number.slice(4, 7)}-${contact_number.slice(7)}`; // 09171234567 -> +63 917-123-4567
    const next = await findSlot(request, { dentistId: LIM, serviceId: SVC.prophylaxis, fromDays: 14, index: -1 });
    const p = bookingPayload({ date: next.date, start: next.slot.start, dentistId: LIM, serviceId: SVC.prophylaxis, contact: intl, name: 'Someone Else' });
    const r = await request.post('/api/requests', { data: p });
    expect(r.status(), await r.text()).toBe(201);
    const rows = await sql<{ patient_id: number; full_name: string }>(
      `SELECT a.patient_id, p.full_name FROM appointments a JOIN patients p USING (patient_id) WHERE a.appointment_date = ? AND a.start_time = ? AND a.dentist_id = ? AND a.status = 'pending'`,
      [next.date, `${next.slot.start}:00`, LIM],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].patient_id).toBe(seedPatient.patientId);
    expect(rows[0].full_name).toBe('Existing E2E Patient'); // public form does not overwrite the record (Decision B6)
    expect(await sql(`SELECT 1 FROM patients WHERE contact_number = ?`, [contact_number])).toHaveLength(1);
  });
});
