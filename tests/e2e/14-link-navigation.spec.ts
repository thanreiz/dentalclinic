import { expect, test } from '@playwright/test';
import { gotoReady, loginUi } from './helpers';

// QA-1: with app/(staff)/loading.tsx present, clicking a <Link> that only changes search params on the
// same page (reports month arrows, dashboard day arrows) is intermittently ignored: the RSC request returns 200
// but the URL/page never updates. Reproduced ~25-50% of clicks on a production build. This spec fails until fixed.
test.describe('QA-1: same-page Link navigation must always complete', () => {
  test('reports: Previous month link navigates every time (12 loads)', async ({ page }) => {
    await loginUi(page);
    const stuck: number[] = [];
    for (let i = 0; i < 12; i++) {
      await gotoReady(page, '/reports?month=2026-12&threshold=2');
      await page.getByRole('link', { name: 'Previous month' }).click();
      try {
        await expect(page).toHaveURL(/month=2026-11/, { timeout: 3_000 });
      } catch {
        stuck.push(i);
      }
    }
    expect(stuck, 'attempts where the click did nothing').toEqual([]);
  });

  test('dashboard: Previous day link navigates every time (12 loads)', async ({ page }) => {
    await loginUi(page);
    const stuck: number[] = [];
    for (let i = 0; i < 12; i++) {
      await gotoReady(page, '/dashboard?date=2026-10-12');
      await page.getByRole('link', { name: 'Previous day' }).click();
      try {
        await expect(page).toHaveURL(/date=2026-10-11/, { timeout: 3_000 });
      } catch {
        stuck.push(i);
      }
    }
    expect(stuck, 'attempts where the click did nothing').toEqual([]);
  });
});
