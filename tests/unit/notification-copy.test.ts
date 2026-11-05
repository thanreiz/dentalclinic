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

describe('reschedule, decline and cancellation copy', () => {
  it('reschedule shows the old time and the new date, time, dentist and service, with the clinic phone', async () => {
    const { rescheduleEmail } = await import('@/lib/mail');
    const { rescheduleText } = await import('@/lib/services/messenger-notify');
    process.env.CLINIC_NAME = 'Molar & Co.';
    process.env.CLINIC_PHONE = '0917 000 0000';
    const moved = { oldDate: '2026-11-05', oldStart: '09:00' };
    const e = rescheduleEmail({ ...email, ...moved });
    expect(e.subject).toContain('moved');
    for (const part of ['has been moved', 'Was: ', '9:00 AM', 'Date: ', '3:00 PM', 'Dentist: Dr. Cruz', 'Service: Exam and X-ray', '0917 000 0000', 'Molar & Co.']) expect(e.text).toContain(part);
    expect(e.text).not.toContain('..');
    const m = rescheduleText({ ...chat, oldDate: '2026-11-05', oldStartTime: '09:00' });
    for (const part of ['Hi Ana!', 'has been moved', 'Was: ', '9:00 AM', 'Exam and X-ray with Dr. Cruz', '3:00 PM', '0917 000 0000']) expect(m).toContain(part);
    delete process.env.CLINIC_PHONE;
  });

  it('decline and cancellation name the appointment and the clinic, no doubled period', async () => {
    const { declineEmail, cancellationEmail } = await import('@/lib/mail');
    const { declineText, cancellationText } = await import('@/lib/services/messenger-notify');
    process.env.CLINIC_NAME = 'Molar & Co.';
    for (const t of [declineEmail(email).text, cancellationEmail(email).text, declineText(chat), cancellationText(chat)]) {
      expect(t).toContain('Exam and X-ray');
      expect(t).toContain('3:00 PM');
      expect(t).not.toContain('..');
    }
    expect(cancellationEmail(email).subject).toContain('cancelled');
    expect(declineEmail(email).subject).toContain('not available');
  });
});

describe('no CLINIC_PHONE / CLINIC_NAME configured', () => {
  it('reads cleanly in every email and Messenger text, same clinic name in both channels', async () => {
    const mail = await import('@/lib/mail');
    const notify = await import('@/lib/services/messenger-notify');
    const keep = { n: process.env.CLINIC_NAME, p: process.env.CLINIC_PHONE };
    delete process.env.CLINIC_NAME;
    delete process.env.CLINIC_PHONE;
    const moved = { oldDate: '2026-11-05', oldStart: '09:00' };
    const texts = [
      mail.confirmationEmail(email).text, mail.reminderEmail(email).text, mail.rescheduleEmail({ ...email, ...moved }).text, mail.declineEmail(email).text, mail.cancellationEmail(email).text,
      notify.confirmationText(chat), notify.reminderText(chat), notify.rescheduleText({ ...chat, oldDate: '2026-11-05', oldStartTime: '09:00' }), notify.declineText(chat), notify.cancellationText(chat),
    ];
    for (const t of texts) {
      expect(t).not.toMatch(/clinic at the clinic|at the clinic|\.\.|undefined| at \./);
      expect(t).toContain('the clinic');
    }
    expect(mail.confirmationEmail(email).text).toContain('Molar & Co.');
    expect(notify.confirmationText(chat)).toContain('Molar & Co.');
    expect(mail.confirmationEmail(email).text).toContain('call or message the clinic.');
    expect(notify.confirmationText(chat)).toContain('contact the clinic.');
    process.env.CLINIC_PHONE = '  ';
    expect(notify.confirmationText(chat)).toContain('contact the clinic.');
    process.env.CLINIC_PHONE = '0917 000 1111';
    expect(notify.confirmationText(chat)).toContain('contact the clinic at 0917 000 1111.');
    if (keep.n !== undefined) process.env.CLINIC_NAME = keep.n;
    if (keep.p !== undefined) process.env.CLINIC_PHONE = keep.p;
    else delete process.env.CLINIC_PHONE;
  });
});
