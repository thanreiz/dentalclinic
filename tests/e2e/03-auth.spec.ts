import { expect, test } from '@playwright/test';
import { loginUi, STAFF } from './helpers';

test.describe('FR11/US0.1: staff login, logout, guards', () => {
  test('logged-out access redirects to /login (pages) and 401 (API)', async ({ page, request }) => {
    for (const path of ['/patients', '/dashboard', '/requests', '/reports', '/setup', '/appointments/1', '/appointments/new']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
    for (const path of ['/api/patients?q=maria', '/api/patients/1', '/api/setup/dentists', '/api/chairs/free?date=2026-12-01&start=09:00&end=09:30']) {
      const r = await request.get(path);
      expect(r.status(), path).toBe(401);
    }
  });

  test('wrong password shows one generic message (never says which field)', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(STAFF.email);
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid email or password')).toBeVisible();
    await page.getByLabel('Email').fill('nobody@clinic.test');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid email or password')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('login lands on dashboard, next= is honoured, logout clears access', async ({ page }) => {
    await page.goto('/patients');
    await expect(page).toHaveURL(/\/login\?next=%2Fpatients/);
    await page.getByLabel('Email').fill(STAFF.email);
    await page.getByLabel('Password').fill(STAFF.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/patients/);
    await expect(page.getByRole('heading', { name: 'Patients' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/patients');
    await expect(page).toHaveURL(/\/login/);
  });

  test('session cookie is httpOnly', async ({ page, context }) => {
    await loginUi(page);
    const c = (await context.cookies()).find((x) => x.name === 'session');
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe('Lax');
  });
});
