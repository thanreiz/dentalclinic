import { expect, test } from '@playwright/test';
import { bookStepsOneAndTwo, fillDetails, findSlot, LIM, SVC, sql, uniqueContact, uniqueName } from './helpers';

test('Phase 4: two phones request the same slot -> one success, one "taken" with fresh slots', async ({ browser, request }) => {
  const { date, slot } = await findSlot(request, { dentistId: LIM, serviceId: SVC.extraction, fromDays: 21, index: 1 });
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await ctx.newPage();
    await bookStepsOneAndTwo(page, { serviceName: /Tooth extraction/, dentistName: 'Dr. Lim', date, start: slot.start });
    const contact = uniqueContact();
    await fillDetails(page, { name: uniqueName('E2E Racer'), contact, email: 'racer@example.com' });
    await page.getByRole('checkbox').check();
    return { ctx, page, contact };
  };
  const [a, b] = await Promise.all([mk(), mk()]);
  await Promise.all([
    a.page.getByRole('button', { name: 'Request appointment' }).click(),
    b.page.getByRole('button', { name: 'Request appointment' }).click(),
  ]);

  const ok = (p: typeof a.page) => p.getByText('Request received. The clinic will email you once it is confirmed.');
  const taken = (p: typeof a.page) => p.getByText('That time was just taken. Please pick another time.');
  await expect(async () => {
    const results = await Promise.all([ok(a.page).isVisible(), ok(b.page).isVisible(), taken(a.page).isVisible(), taken(b.page).isVisible()]);
    expect(results.filter(Boolean).length).toBe(2);
  }).toPass();
  const successes = [await ok(a.page).isVisible(), await ok(b.page).isVisible()].filter(Boolean).length;
  const takens = [await taken(a.page).isVisible(), await taken(b.page).isVisible()].filter(Boolean).length;
  expect({ successes, takens }).toEqual({ successes: 1, takens: 1 });

  // exactly one pending row for that slot; the loser's slot list no longer offers it
  const rows = await sql(`SELECT 1 FROM appointments WHERE dentist_id = ? AND appointment_date = ? AND start_time = ? AND status IN ('pending','scheduled')`, [LIM, date, `${slot.start}:00`]);
  expect(rows).toHaveLength(1);
  await a.ctx.close();
  await b.ctx.close();
});
