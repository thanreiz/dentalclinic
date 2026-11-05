/**
 * Email (FR12 confirmation, FR13 reminder) over SMTP with Nodemailer (PRD "Email (SMTP)").
 * Node runtime only: every route that sends mail sets `export const runtime = 'nodejs'`.
 *
 * - SMTP_HOST/SMTP_USER/SMTP_PASS all set -> real send (Gmail: port 465 secure, or 587 STARTTLS).
 * - Any of them unset and NODE_ENV !== 'production' -> DEV MODE: the email is logged to the
 *   console with a `[mail:dev]` prefix and reported as sent, so local QA works without Gmail.
 * - Unset in production -> reported as a failure (never silently "sent").
 * - Senders never throw: they return { ok: false, error } so callers decide (confirm keeps the
 *   appointment scheduled; the cron leaves reminder_sent_at NULL).
 * Plain text bodies; CR/LF stripped from header fields (to, subject) to block header injection.
 */
import 'server-only';
import nodemailer from 'nodemailer';
import { atPhone, clinicName, endOfSentence } from './clinic';
import { formatDateHuman, formatHuman, formatTime12 } from './time';

export type ApptEmail = {
  to: string;
  patientName: string;
  date: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:MM'
  dentist: string;
  service: string;
};

export type MailMessage = { from: string; to: string; subject: string; text: string };
export type MailTransport = { sendMail(msg: MailMessage): Promise<unknown> };
export type MailResult = { ok: true; dev?: boolean } | { ok: false; error: string };

let override: MailTransport | null = null;
let cached: { key: string; transport: MailTransport } | null = null;

/** Tests only: replace the SMTP transport (null restores the env-based one). */
export function setMailTransport(t: MailTransport | null): void {
  override = t;
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function smtpTransport(): MailTransport {
  const port = Number(process.env.SMTP_PORT || 465);
  const key = [process.env.SMTP_HOST, port, process.env.SMTP_USER, process.env.SMTP_PASS].join('|');
  if (!cached || cached.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    };
  }
  return cached.transport;
}

function fromAddress(): string {
  return oneLine(process.env.MAIL_FROM || process.env.SMTP_USER || 'clinic@localhost');
}

export async function sendMail(msg: { to: string; subject: string; text: string }): Promise<MailResult> {
  const message: MailMessage = { from: fromAddress(), to: oneLine(msg.to), subject: oneLine(msg.subject), text: msg.text };
  try {
    if (override) {
      await override.sendMail(message);
      return { ok: true };
    }
    if (!smtpConfigured()) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[mail] SMTP_HOST/SMTP_USER/SMTP_PASS not set; email not sent');
        return { ok: false, error: 'smtp_not_configured' };
      }
      console.log(`[mail:dev] To: ${message.to}\n[mail:dev] Subject: ${message.subject}\n[mail:dev] ${message.text.replace(/\n/g, '\n[mail:dev] ')}`);
      return { ok: true, dev: true };
    }
    await smtpTransport().sendMail(message);
    return { ok: true };
  } catch (err) {
    console.error('[mail] send failed', err instanceof Error ? err.message : err);
    return { ok: false, error: 'send_failed' };
  }
}


function details(a: ApptEmail): string {
  return `Date: ${formatDateHuman(a.date)}\nTime: ${formatTime12(a.startTime)}\nDentist: ${a.dentist}\nService: ${a.service}`;
}

export function confirmationEmail(a: ApptEmail) {
  return {
    to: a.to,
    subject: `Appointment confirmed: ${formatHuman(a.date, a.startTime)}`,
    text:
      `Hi ${a.patientName},\n\nYour appointment at ${clinicName()} is confirmed.\n\n${details(a)}\n\n` +
      `To cancel or reschedule, call or message the clinic${atPhone()}.`,
  };
}

export function reminderEmail(a: ApptEmail) {
  return {
    to: a.to,
    subject: `Reminder: your appointment tomorrow at ${formatTime12(a.startTime)}`,
    text:
      `Hi ${a.patientName},\n\nThis is a reminder of your appointment tomorrow at ${endOfSentence(clinicName())}\n\n${details(a)}\n\n` +
      `If you cannot come, please inform the clinic${atPhone()}.`,
  };
}

/** Staff moved an appointment: shows the old time and the new details. */
export type RescheduleEmail = ApptEmail & { oldDate: string; oldStart: string };

export function rescheduleEmail(a: RescheduleEmail) {
  return {
    to: a.to,
    subject: `Appointment moved: ${formatHuman(a.date, a.startTime)}`,
    text:
      `Hi ${a.patientName},\n\nYour appointment at ${clinicName()} has been moved.\n\n` +
      `Was: ${formatHuman(a.oldDate, a.oldStart)}\n\nNow:\n${details(a)}\n\n` +
      `If the new time does not work for you, please call or message the clinic${atPhone()}.`,
  };
}

/** Staff declined a pending request (Rule 12). */
export function declineEmail(a: ApptEmail) {
  return {
    to: a.to,
    subject: `Appointment request not available: ${formatHuman(a.date, a.startTime)}`,
    text:
      `Hi ${a.patientName},\n\nSorry, ${clinicName()} could not accommodate your request for this time.\n\n${details(a)}\n\n` +
      `Please call or message the clinic${atPhone()}, or send a new request for another time.`,
  };
}

/** Staff cancelled a scheduled appointment. */
export function cancellationEmail(a: ApptEmail) {
  return {
    to: a.to,
    subject: `Appointment cancelled: ${formatHuman(a.date, a.startTime)}`,
    text:
      `Hi ${a.patientName},\n\nYour appointment at ${clinicName()} has been cancelled.\n\n${details(a)}\n\n` +
      `To book another time, call or message the clinic${atPhone()}.`,
  };
}

export const sendRescheduleEmail = (a: RescheduleEmail): Promise<MailResult> => sendMail(rescheduleEmail(a));
export const sendDeclineEmail = (a: ApptEmail): Promise<MailResult> => sendMail(declineEmail(a));
export const sendCancellationEmail = (a: ApptEmail): Promise<MailResult> => sendMail(cancellationEmail(a));

export async function sendConfirmation(a: ApptEmail): Promise<MailResult> {
  return sendMail(confirmationEmail(a));
}

export async function sendReminder(a: ApptEmail): Promise<MailResult> {
  return sendMail(reminderEmail(a));
}
