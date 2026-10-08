import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loginUi } from './helpers';

const SHOTS = path.join(__dirname, '../../docs/screenshots/qa');
const PAGES: [string, string][] = [
  ['dashboard', '/dashboard?date=2026-10-12'],
  ['requests', '/requests'],
  ['new-booking', '/appointments/new'],
  ['appointment', '/appointments/2'],
  ['patients', '/patients'],
  ['patient', '/patients/1'],
  ['reports', '/reports?month=2026-10'],
  ['setup', '/setup?tab=dentists'],
];

for (const width of [768, 1280]) {
  test(`NF01/Phase 3: every staff page fits ${width}px wide (no horizontal page scroll)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 800 });
    await loginUi(page);
    const bad: string[] = [];
    for (const [name, url] of PAGES) {
      await page.goto(url);
      await expect(page.getByRole('main')).toBeVisible();
      await page.waitForLoadState('networkidle');
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 0) bad.push(`${name} overflows by ${over}px`);
      if (name === 'dashboard' || name === 'reports') await page.screenshot({ path: path.join(SHOTS, `${name}-${width}.png`), fullPage: true });
    }
    expect(bad).toEqual([]);
  });
}

test('NF01: /book at 360x740 screenshot (evidence)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  await page.goto('/book');
  await expect(page.getByText('Demo system: please use sample details, not your real information.')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'book-360.png'), fullPage: true });
  await ctx.close();
});
