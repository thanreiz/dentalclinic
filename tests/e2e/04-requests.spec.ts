import { expect, test } from '@playwright/test';
import { gotoReady, createPendingRequest, createStaffBooking, findSlot, getSlots, loginApi, loginUi, LIM, mailCount, mailsSince, MAIL_LOG, REYES, SVC, sql, uniqueName } from './helpers';

test.describe('FR2/FR12/Rule 12: confirm and decline online requests', () => {
  test('staff confirms a request with a free chair -> scheduled, chair set, confirmation email sent', async ({ page, request }) => {
    const { date, slot } = await findSlot(request, { dentistId: REYES, serviceId: SVC.prophylaxis, fromDays: 28, index: 1 });
    const name = uniqueName('E2E Confirm');
    const req = await createPendingRequest(request, { date, start: slot.start, dentistId: REYES, serviceId: SVC.prophylaxis, name, email: 'confirm.me@example.com' });
    const mailsBefore = mailCount();

    await loginUi(page);
    await gotoReady(page, '/requests');
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    await page.getByRole('link', { name: new RegExp(name) }).click();
    await expect(page).toHaveURL(new RegExp(`/appointments/${req.id}$`));
    await expect(page.getByText('Pending').first()).toBeVisible();

    // Confirm button needs exactly one chair; before picking (2 free chairs) it is disabled
    await expect(page.getByRole('button', { name: 'Confirm request' })).toBeDisabled();
    await page.getByText('Chair 2', { exact: true }).click();
    await page.getByRole('button', { name: 'Confirm request' }).click();
    await expect(page.getByText('Request confirmed')).toBeVisible();
    await expect(page.getByText('Scheduled').first()).toBeVisible();

    const [row] = await sql<{ status: string; chair_id: number }>(`SELECT status, chair_id FROM appointments WHERE appointment_id = ?`, [req.id]);
    expect(row).toEqual({ status: 'scheduled', chair_id: 2 });

    if (MAIL_LOG) {
      const mails = mailsSince(mailsBefore);
      expect(mails.length).toBe(1);
      expect(mails[0]).toContain('Appointment confirmed');
      expect(mails[0]).toContain('confirm.me@example.com');
    }
    // it left the pending queue
    await gotoReady(page, '/requests');
    await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
  });

  test('declining frees the slot at once and sends no email', async ({ page, request }) => {
    const { date, slot } = await findSlot(request, { dentistId: REYES, serviceId: SVC.prophylaxis, fromDays: 28, index: 3 });
    const name = uniqueName('E2E Decline');
    const req = await createPendingRequest(request, { date, start: slot.start, dentistId: REYES, serviceId: SVC.prophylaxis, name });
    expect((await getSlots(request, date, SVC.prophylaxis, REYES)).some((s) => s.start === slot.start), 'pending request holds the slot').toBe(false);
    const mailsBefore = mailCount();

    await loginUi(page);
    await gotoReady(page, `/appointments/${req.id}`);
    await page.getByRole('button', { name: 'Decline request' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Decline request' }).click();
    await expect(page.getByText('Request declined')).toBeVisible();

    const [row] = await sql<{ status: string }>(`SELECT status FROM appointments WHERE appointment_id = ?`, [req.id]);
    expect(row.status).toBe('declined');
    expect((await getSlots(request, date, SVC.prophylaxis, REYES)).some((s) => s.start === slot.start), 'declined slot is open again').toBe(true);
    expect(mailCount()).toBe(mailsBefore);
  });

  test('Phase 5: chair taken after the page loaded -> "Slot no longer free", pick the other chair, confirm works', async ({ page, request }) => {
    await loginApi(request);
    const f = await findSlot(request, { dentistId: REYES, serviceId: SVC.prophylaxis, fromDays: 49, index: 4, minSlots: 8 });
    const limSlots = await getSlots(request, f.date, SVC.prophylaxis, LIM);
    expect(limSlots.some((s) => s.start === f.slot.start), 'Lim free at the same time').toBe(true);
    const name = uniqueName('E2E Conflict');
    const req = await createPendingRequest(request, { date: f.date, start: f.slot.start, dentistId: REYES, serviceId: SVC.prophylaxis, name });

    await loginUi(page);
    await gotoReady(page, `/appointments/${req.id}`);
    await expect(page.getByText('Chair 1', { exact: true })).toBeVisible(); // free chairs loaded: both
    // meanwhile someone else books Lim on Chair 1 at the same time
    await createStaffBooking(request, { date: f.date, start: f.slot.start, dentistId: LIM, serviceId: SVC.prophylaxis, chairId: 1 });

    await page.getByText('Chair 1', { exact: true }).click();
    await page.getByRole('button', { name: 'Confirm request' }).click();
    await expect(page.getByText('Slot no longer free')).toBeVisible();
    await expect(page.getByText('Chair 1', { exact: true })).toHaveCount(0); // only the free chair is offered now
    // still pending in the DB
    expect((await sql<{ status: string }>(`SELECT status FROM appointments WHERE appointment_id = ?`, [req.id]))[0].status).toBe('pending');

    await page.getByText('Chair 2', { exact: true }).click();
    await page.getByRole('button', { name: 'Confirm request' }).click();
    await expect(page.getByText('Request confirmed')).toBeVisible();
    expect((await sql<{ status: string; chair_id: number }>(`SELECT status, chair_id FROM appointments WHERE appointment_id = ?`, [req.id]))[0]).toEqual({ status: 'scheduled', chair_id: 2 });
  });
});
