import path from 'node:path';
import { expect, test } from '@playwright/test';
import { bookingPayload, bookStepsOneAndTwo, fillDetails, findSlot, REYES, SVC, uniqueContact, uniqueName } from './helpers';

// Needs a server started with the DEFAULT abuse caps (REQUEST_LIMIT_PER_CONTACT=3, REQUEST_LIMIT_PER_IP=5).
// The rest of the suite runs with the caps switched off (see playwright.config.ts), so this spec is opt-in:
//   E2E_ABUSE_LIMITS=1 npx playwright test 12
test.skip(!process.env.E2E_ABUSE_LIMITS, 'set E2E_ABUSE_LIMITS=1 and start the server with default REQUEST_LIMIT_* values');

test('SECURITY-REVIEW H1: 4th pending request from one contact -> 429, /book shows the readable message', async ({ page, request }) => {
  const contact = uniqueContact();
  const { date, slots } = await findSlot(request, { dentistId: REYES, serviceId: SVC.prophylaxis, fromDays: 16, minSlots: 8 });
  for (const s of slots.slice(0, 3)) {
    const r = await request.post('/api/requests', { data: bookingPayload({ date, start: s.start, dentistId: REYES, serviceId: SVC.prophylaxis, contact }) });
    expect(r.status(), await r.text()).toBe(201);
  }
  const r4 = await request.post('/api/requests', { data: bookingPayload({ date, start: slots[3].start, dentistId: REYES, serviceId: SVC.prophylaxis, contact }) });
  expect(r4.status()).toBe(429);
  expect((await r4.json()).error).toBe('too_many_requests');

  // same through the form
  await page.setViewportSize({ width: 360, height: 740 });
  await bookStepsOneAndTwo(page, { serviceName: /Oral prophylaxis/, dentistName: 'Dr. Reyes', date, start: slots[4].start });
  await fillDetails(page, { name: uniqueName('E2E Capped'), contact, email: 'capped@example.com' });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request appointment' }).click();
  await expect(page.getByText(/You already have requests waiting for the clinic to review/)).toBeVisible();
  await expect(page.getByText('Request received.')).toHaveCount(0);
  await page.screenshot({ path: path.join(__dirname, '../../docs/screenshots/qa/book-429-message.png'), fullPage: true });
});
