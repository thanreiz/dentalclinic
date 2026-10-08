import { expect, test } from '@playwright/test';
import { gotoReady, loginUi } from './helpers';

// QA-1 regression: with a loading.tsx (Suspense boundary) above the staff pages, clicking a <Link> that only
// changes search params on the same page (reports month arrows, dashboard day arrows) was intermittently ignored:
// the RSC request returned 200 but the transition never committed (Next 15.5 / React 19.2 router bug, see
// docs/TEST-REPORT.md QA-1). Fixed by removing app/(staff)/loading.tsx. Also guards the real 404 for missing ids.
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

  test('missing ids return a real 404 (not a soft 404 behind a Suspense boundary)', async ({ page }) => {
    await loginUi(page);
    for (const url of ['/appointments/999999', '/patients/999999']) {
      const res = await page.request.get(url);
      expect(res.status(), url).toBe(404);
      await gotoReady(page, url);
      await expect(page.getByText('Not found', { exact: true })).toBeVisible();
    }
  });
});
