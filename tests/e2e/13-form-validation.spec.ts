import { expect, test } from '@playwright/test';
import { bookStepsOneAndTwo, findSlot, gotoReady, loginUi, LIM, SVC, time12, uniqueContact } from './helpers';

test.describe('FR1/FR3: form validation and navigation details', () => {
  test('/book step 3 at 360px: inline errors for bad email / phone, Back/Change keep the choice, no horizontal scroll', async ({ page, request }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const { date, slot } = await findSlot(request, { dentistId: LIM, serviceId: SVC.filling, fromDays: 14, index: 6, minSlots: 8 });
    await bookStepsOneAndTwo(page, { serviceName: /Tooth filling/, dentistName: 'Dr. Lim', date, start: slot.start });
    await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    await page.getByLabel('Full name').fill('Test Person');
    await page.getByLabel('Contact number').fill('12345');
    await page.getByLabel('Contact number').blur();
    await expect(page.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible();
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Email').blur();
    await page.getByLabel('Birthdate').fill('1990-01-01');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Request appointment' }).click();
    // nothing was sent: still on the details step with errors showing
    await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
    expect(await page.getByRole('alert').count()).toBeGreaterThanOrEqual(2);

    // "Change" returns to step 2 with the date and time still selected
    await page.getByRole('button', { name: 'Change' }).click();
    await expect(page.getByRole('heading', { name: 'Pick a date and time' })).toBeVisible();
    await expect(page.getByRole('radio', { name: time12(slot.start), exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Full name')).toHaveValue('Test Person'); // typed details kept
  });

  test('dashboard "open time" link prefills the staff booking form; existing patient can be found by number', async ({ page, request }) => {
    await loginUi(page);
    const { date, slot } = await findSlot(request, { dentistId: LIM, serviceId: SVC.prophylaxis, fromDays: 14, index: 9, minSlots: 12 });
    await gotoReady(page, `/dashboard?date=${date}`);
    const lim = page.locator('div', { has: page.getByText('Dr. Lim', { exact: true }) }).getByRole('link', { name: time12(slot.start), exact: true }).last();
    await lim.click();
    await expect(page).toHaveURL(/\/appointments\/new\?/);
    await expect(page.getByLabel(/^Dentist/)).toHaveValue(String(LIM));
    await expect(page.getByLabel(/^Date/)).toHaveValue(date);
    // N2: the link carries the shortest service (the one open times are computed for), so the time is pre-selected
    await expect(page.getByLabel(/^Service/)).toHaveValue(String(SVC.prophylaxis));
    await expect(page.getByRole('radio', { name: time12(slot.start), exact: true }).first()).toBeChecked();

    // find Maria by a formatted number
    await page.getByRole('searchbox').fill('+63 917-555-0101');
    await expect(page.getByRole('button', { name: /Maria Santos/ })).toBeVisible();
    void uniqueContact;
  });

  test('reports: previous/next month links point across the year boundary', async ({ page }) => {
    await loginUi(page);
    await gotoReady(page, '/reports?month=2027-01');
    await expect(page.getByRole('link', { name: 'Previous month' })).toHaveAttribute('href', /month=2026-12/);
    await expect(page.getByRole('link', { name: 'Next month' })).toHaveAttribute('href', /month=2027-02/);
    await gotoReady(page, '/reports?month=2026-12');
    await expect(page.getByRole('link', { name: 'Next month' })).toHaveAttribute('href', /month=2027-01/);
    await expect(page.getByRole('heading', { name: 'December 2026' })).toBeVisible();
  });
});
