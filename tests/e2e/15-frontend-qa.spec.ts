import { expect, test } from '@playwright/test';
import { findSlot, gotoReady, loginUi, LIM, SVC, bookStepsOneAndTwo } from './helpers';

test.describe('Frontend QA fixes', () => {
  test('/book on a short screen (200% zoom, landscape) is a normal scrolling page with Continue reachable', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await page.goto('/book');
    await page.getByRole('radio', { name: /Oral prophylaxis/ }).check();
    const cont = page.getByRole('button', { name: 'Continue' });
    await expect(cont).toBeInViewport();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('visible');
    await page.mouse.wheel(0, 600);
    await expect(cont).toBeInViewport(); // sticky action bar
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test('/book on a tall screen stays a locked frame', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/book');
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBe(0);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
  });

  test('browser Back and Forward move between booking steps', async ({ page, request }) => {
    const { date, slot } = await findSlot(request, { dentistId: LIM, serviceId: SVC.prophylaxis, fromDays: 20, index: 5 });
    await bookStepsOneAndTwo(page, { serviceName: /Oral prophylaxis/, dentistName: 'Dr. Lim', date, start: slot.start });
    await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Pick a date and time' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { name: 'Pick a date and time' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click(); // UI Back adds no history entry
    await expect(page.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
    expect(page.url()).toContain('/book');
  });

  test('staff 404s have an h1 and a generic title', async ({ page }) => {
    await loginUi(page);
    await gotoReady(page, '/appointments/999999');
    await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
    await expect(page).toHaveTitle(/^Appointment · /);
    await page.goto('/definitely-not-a-page');
    await expect(page).toHaveTitle(/^Page not found · /);
  });

  test('staff action after the session ended shows a banner with a login link', async ({ page, context }) => {
    await loginUi(page);
    await gotoReady(page, '/appointments/2');
    await context.clearCookies();
    await page.getByLabel(/Note/).last().fill('after expiry');
    await page.getByRole('button', { name: 'Save note' }).click();
    const link = page.getByRole('link', { name: 'Log in again' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /\/login\?next=%2Fappointments%2F2/);
  });

  test('reports channel shares add up to 100% over the rows shown', async ({ page }) => {
    await loginUi(page);
    await gotoReady(page, '/reports?month=2026-10');
    const table = page.getByRole('table', { name: 'Bookings by channel' });
    const rows = await table.locator('tbody tr').all();
    const counts = await Promise.all(rows.map(async (r) => Number(await r.locator('td').first().innerText())));
    const shares = await Promise.all(rows.map(async (r) => parseFloat((await r.locator('td').nth(1).innerText()).replace('%', ''))));
    const total = counts.reduce((a, b) => a + b, 0);
    expect(shares.reduce((a, b) => a + b, 0)).toBeGreaterThan(99.6);
    expect(shares.reduce((a, b) => a + b, 0)).toBeLessThan(100.4);
    await expect(page.getByText(new RegExp(`^${total} bookings in October 2026`))).toBeVisible();
  });
});
