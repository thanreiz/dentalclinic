import { expect, test } from '@playwright/test';
import { gotoReady, addDays, dow, loginApi, loginUi, manilaToday, SVC, uniqueName } from './helpers';

test.describe('FR5 Phase 3: clinic setup', () => {
  test('add a dentist with hours -> bookable in /api/slots right away; deleting an unused dentist works', async ({ page, request }) => {
    await loginApi(request);
    await loginUi(page);
    const name = uniqueName('Dr. QA');
    await gotoReady(page, '/setup?tab=dentists');
    await page.getByRole('button', { name: 'Add dentist' }).click();
    await page.getByLabel(/^Name/).fill(name);
    await page.getByRole('button', { name: 'Mon–Sat 9–5' }).click();
    await page.getByRole('button', { name: 'Add dentist', exact: true }).click();
    await expect(page.getByText('Dentist added')).toBeVisible();
    await expect(page.getByText(name)).toBeVisible();

    const list = await (await request.get('/api/setup/dentists')).json();
    const d = list.items.find((x: { dentistName: string }) => x.dentistName === name);
    expect(d, 'new dentist listed').toBeTruthy();

    let monday = addDays(manilaToday(), 30);
    while (dow(monday) !== 1) monday = addDays(monday, 1);
    const slots = await (await request.get(`/api/slots?date=${monday}&serviceId=${SVC.prophylaxis}&dentistId=${d.dentistId}`)).json();
    expect(slots.slots.length).toBe(16); // 09:00-17:00 every 30 min for a 30 min service
    const sunday = addDays(monday, -1);
    const closed = await (await request.get(`/api/slots?date=${sunday}&serviceId=${SVC.prophylaxis}&dentistId=${d.dentistId}`)).json();
    expect(closed.slots).toEqual([]);

    // cleanup: unused dentist can be deleted
    await page.locator('div', { has: page.getByText(name, { exact: true }) }).getByRole('button', { name: 'Delete' }).last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete dentist' }).click();
    await expect(page.getByText(`${name} removed`)).toBeVisible();
  });

  test('deleting a service / chair / dentist in use shows "In use by existing appointments"', async ({ page }) => {
    await loginUi(page);
    await gotoReady(page, '/setup?tab=services');
    await page.locator('li', { hasText: 'Oral prophylaxis' }).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete service' }).click();
    await expect(page.getByText('In use by existing appointments')).toBeVisible();

    await gotoReady(page, '/setup?tab=chairs');
    await page.locator('li', { hasText: 'Chair 1' }).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete chair' }).click();
    await expect(page.getByText('In use by existing appointments')).toBeVisible();

    await gotoReady(page, '/setup?tab=dentists');
    await page.locator('div.rounded-lg, div', { has: page.getByText('Dr. Reyes', { exact: true }) }).getByRole('button', { name: 'Delete' }).last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete dentist' }).click();
    await expect(page.getByText('In use by existing appointments')).toBeVisible();
  });
});
