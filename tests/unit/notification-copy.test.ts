/** Patient-facing wording: the clinic name "Molar & Co." ends in a period, so sentences must not double it. */
import { afterEach, describe, expect, it } from 'vitest';
import { confirmationEmail, reminderEmail } from '@/lib/mail';
import { confirmationText, reminderText } from '@/lib/services/messenger-notify';

const email = { to: 'a@example.com', patientName: 'Ana Dela Cruz', date: '2026-11-06', startTime: '15:00', dentist: 'Dr. Cruz', service: 'Exam and X-ray' };
const chat = { patientName: 'Ana Dela Cruz', date: '2026-11-06', startTime: '15:00', dentist: 'Dr. Cruz', service: 'Exam and X-ray' };

const original = process.env.CLINIC_NAME;
afterEach(() => {
  if (original === undefined) delete process.env.CLINIC_NAME;
  else process.env.CLINIC_NAME = original;
});

describe('clinic name at the end of a sentence', () => {
  it('a name that ends in a period is not followed by another one', () => {
    process.env.CLINIC_NAME = 'Molar & Co.';
    expect(reminderEmail(email).text).toContain('tomorrow at Molar & Co.\n\n');
    expect(reminderEmail(email).text).not.toContain('..');
    expect(reminderText(chat)).toContain('tomorrow at Molar & Co.\n\n');
    expect(reminderText(chat)).not.toContain('..');
  });

  it('a name without a period still gets one', () => {
    process.env.CLINIC_NAME = 'Sample Dental Clinic';
    expect(reminderEmail(email).text).toContain('tomorrow at Sample Dental Clinic.\n\n');
    expect(reminderText(chat)).toContain('tomorrow at Sample Dental Clinic.\n\n');
  });

  it('confirmations read naturally with the period inside the name', () => {
    process.env.CLINIC_NAME = 'Molar & Co.';
    expect(confirmationEmail(email).text).toContain('Your appointment at Molar & Co. is confirmed.');
    expect(confirmationText(chat)).toContain('Your appointment at Molar & Co. is confirmed.');
  });
});
