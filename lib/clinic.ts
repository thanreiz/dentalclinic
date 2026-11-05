/**
 * Clinic name and phone as patients read them in emails and Messenger texts. One source so both
 * channels say the same thing, and an unset CLINIC_PHONE reads cleanly instead of "at the clinic".
 */
export const clinicName = (): string => process.env.CLINIC_NAME?.trim() || 'Molar & Co.';

/** The configured phone, or null when CLINIC_PHONE is unset or blank. */
export const clinicPhone = (): string | null => process.env.CLINIC_PHONE?.trim() || null;

/** The name at the end of a sentence: "Molar & Co." already ends in a period, so don't add a second one. */
export const endOfSentence = (s: string): string => (s.endsWith('.') ? s : `${s}.`);

/** " at 0917 ..." when a phone is configured, else "" (so "contact the clinic" stands on its own). */
export const atPhone = (): string => {
  const p = clinicPhone();
  return p ? ` at ${p}` : '';
};
