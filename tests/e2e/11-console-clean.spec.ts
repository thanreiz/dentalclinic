import { expect, test } from '@playwright/test';
import { loginUi } from './helpers';

const URLS = ['/book', '/dashboard', '/dashboard?view=chair', '/requests', '/appointments/new', '/appointments/2', '/patients', '/patients?q=maria', '/patients/1', '/reports?month=2026-10', '/setup?tab=dentists', '/setup?tab=services', '/setup?tab=chairs'];

test('every page loads without console errors, page errors or failed (>=400) subresource requests', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/login')) problems.push(`${r.status()} ${r.url()}`);
  });
  await loginUi(page);
  for (const u of URLS) {
    await page.goto(u);
    await page.waitForLoadState('networkidle');
  }
  expect(problems).toEqual([]);
});
