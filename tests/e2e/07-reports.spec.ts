import { expect, test } from '@playwright/test';
import { gotoReady, loginUi } from './helpers';

test.describe('FR15/FR16 Phase 9: October 2026 reproduces Table 3.22', () => {
  test('per-dentist and total rates; threshold shortens the list', async ({ page }) => {
    await loginUi(page);
    await gotoReady(page, '/reports?month=2026-10');
    await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();

    const dentist = page.getByRole('table', { name: /by dentist/i });
    const reyes = dentist.getByRole('row', { name: /Dr\. Reyes/ });
    await expect(reyes).toContainText('18');
    await expect(reyes).toContainText('10.0%');
    const lim = dentist.getByRole('row', { name: /Dr\. Lim/ });
    await expect(lim).toContainText('20.0%');
    await expect(dentist.getByRole('row', { name: /^Total/ })).toContainText('14.3%');
    await expect(page.getByText('No-show rate').first()).toBeVisible();

    // threshold 2 (default): Jose Ramos + Miguel Fernandez
    const repeat = page.getByRole('table', { name: /at least 2 no-shows/ });
    await expect(repeat.getByRole('link', { name: 'Jose Ramos' })).toBeVisible();
    await expect(repeat.getByRole('link', { name: 'Miguel Fernandez' })).toBeVisible();
    const before = await repeat.getByRole('row').count();

    await expect(async () => {
      await page.getByLabel('Threshold').fill('3');
      await expect(page).toHaveURL(/threshold=3/, { timeout: 2_500 });
    }).toPass();
    // seed: nobody reaches 3, so the list is empty (other tests only ever add single no-shows)
    await expect(page.getByRole('link', { name: 'Jose Ramos' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Miguel Fernandez' })).toHaveCount(0);
    expect(before).toBeGreaterThan(1);

    // names link to the patient page
    await gotoReady(page, '/reports?month=2026-10&threshold=2');
    await page.getByRole('link', { name: 'Jose Ramos' }).click();
    await expect(page.getByRole('heading', { name: 'Jose Ramos' })).toBeVisible();
  });
});
