/**
 * Messenger copies of the confirmation (FR12) and day-before reminder (FR13), sent to patients who
 * booked through the Messenger bot (patients.messenger_psid). Email stays the main channel; a
 * Messenger failure is logged and never blocks a confirm or a reminder.
 *
 * Limit: these go out as ordinary replies, which Meta only delivers within 24 hours of the
 * patient's last message to the Page. A day-before reminder usually falls outside that window, so
 * it may be refused (logged); email still covers it. Meta's Utility Messages (template messages
 * for appointment reminders) are the way to reach outside the window; they are not built here
 * because they cannot be verified without a live Page and app.
 */
import { sendMessengerMessage, type MessengerResult } from '../messenger';
import { formatDateHuman, formatTime12 } from '../time';

export type ApptMessenger = { patientName: string; date: string; startTime: string; dentist: string; service: string };

const clinicName = () => process.env.CLINIC_NAME || 'Molar & Co.';
/** The name at the end of a sentence: "Molar & Co." already ends in a period, so don't add a second one. */
const endOfSentence = (s: string) => (s.endsWith('.') ? s : `${s}.`);
const clinicPhone = () => process.env.CLINIC_PHONE || 'the clinic';
const firstName = (full: string) => full.trim().split(/\s+/)[0] || 'there';
const details = (a: ApptMessenger) => `${a.service} with ${a.dentist}\n${formatDateHuman(a.date)}, ${formatTime12(a.startTime)}`;

export function confirmationText(a: ApptMessenger): string {
  return `Hi ${firstName(a.patientName)}! Your appointment at ${clinicName()} is confirmed.\n\n${details(a)}\n\nTo cancel or reschedule, contact the clinic at ${clinicPhone()}.`;
}

export function reminderText(a: ApptMessenger): string {
  return `Hi ${firstName(a.patientName)}! Reminder: you have an appointment tomorrow at ${endOfSentence(clinicName())}\n\n${details(a)}\n\nIf you cannot come, please tell the clinic at ${clinicPhone()}.`;
}

export const sendMessengerConfirmation = (psid: string, a: ApptMessenger): Promise<MessengerResult> => sendMessengerMessage(psid, { text: confirmationText(a) });
export const sendMessengerReminder = (psid: string, a: ApptMessenger): Promise<MessengerResult> => sendMessengerMessage(psid, { text: reminderText(a) });
