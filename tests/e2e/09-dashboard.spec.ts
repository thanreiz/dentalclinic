import { expect, test } from '@playwright/test';
import { gotoReady, addDays, dow, manilaToday, createStaffBooking, findSlot, loginApi, loginUi, REYES, SVC, uniqueName } from './helpers';

test.describe('FR6/NF05: dashboard reads the database on every load', () => {
  test('a booking made in another context appears after refresh; dentist with no hours shows "Not working"', async ({ page, browser, request }) => {
    await loginUi(page);
    await loginApi(request);
    const f = await findSlot(request, { dentistId: REYES, serviceId: SVC.prophylaxis, fromDays: 63, index: 3 });
    await gotoReady(page, `/dashboard?date=${f.date}`);
    const name = uniqueName('E2E Fresh');
    await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);

    const other = await browser.newContext();
    await loginApi(other.request);
    await createStaffBooking(other.request, { date: f.date, start: f.slot.start, dentistId: REYES, serviceId: SVC.prophylaxis, name });
    await other.close();

    await page.reload();
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();

    // A dentist with no hours that weekday shows "Not working" (Phase 6 acceptance): temp dentist works Mondays only
    const dName = uniqueName('Dr. MonOnly');
    const created = await request.post('/api/setup/dentists', { data: { dentistName: dName, schedules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }] } });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    try {
      let tuesday = addDays(manilaToday(), 7);
      while (dow(tuesday) !== 2) tuesday = addDays(tuesday, 1);
      await gotoReady(page, `/dashboard?date=${tuesday}`);
      await expect(page.getByText('Not working').first()).toBeVisible();
      await expect(page.getByText(dName).first()).toBeVisible();
    } finally {
      await request.delete(`/api/setup/dentists?id=${id}`, { data: { id } });
    }

    // Sunday: nobody works -> the page says the clinic is closed
    let sunday = addDays(manilaToday(), 7);
    while (dow(sunday) !== 0) sunday = addDays(sunday, 1);
    await gotoReady(page, `/dashboard?date=${sunday}`);
    await expect(page.getByText('Clinic closed')).toBeVisible();
  });
});
