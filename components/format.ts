import { formatDateHuman, formatTime12 } from '@/lib/time';

/** 'YYYY-MM-DD HH:MM:SS' (Manila DATETIME) -> 'Oct 15, 2026, 9:00 AM'. Returns the input if malformed. */
export function formatDateTimeHuman(dt: string | null | undefined): string {
  if (!dt) return '';
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(dt);
  if (!m) return dt;
  return `${formatDateHuman(m[1])}, ${formatTime12(m[2])}`;
}

/** Age in whole years on `today` from a 'YYYY-MM-DD' birthdate. */
export function ageOn(birthdate: string, today: string): number {
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
