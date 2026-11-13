/**
 * "Details differ" flag on online requests (SECURITY-REVIEW M2). Pure, so the booking service
 * and the staff pages share it.
 *
 * When the public form matches an existing patient by contact number but the typed name, email or
 * birthdate differ from the record, the patient row is NOT changed (B6); instead the request's
 * patient_note starts with one line:
 *   [Details differ from patient record: name "…", email "…", birthdate …, contact number …. Verify before confirming.]
 * followed by the patient's own note (if any) on the next line. Staff pages show it as a warning.
 */
export const MISMATCH_PREFIX = '[Details differ from patient record: ';
const MISMATCH_SUFFIX = '. Verify before confirming.]';

export type PatientDetails = { fullName: string; email: string | null; birthdate: string; contactNumber?: string };

const normName = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const normEmail = (s: string | null) => (s ?? '').trim().toLowerCase();
/** One line, no brackets/control chars, so the typed value can't end or fake the flag. */
const clean = (s: string, max = 150) =>
  s
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/[[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const quote = (s: string) => `"${clean(s).replace(/"/g, "'")}"`;

/** The flag line, or null when name, email and birthdate all match the record. */
export function mismatchFlag(record: PatientDetails, typed: PatientDetails): string | null {
  const diffs: string[] = [];
  if (normName(record.fullName) !== normName(typed.fullName)) diffs.push(`name ${quote(typed.fullName)}`);
  if (normEmail(record.email) !== normEmail(typed.email)) diffs.push(`email ${typed.email ? quote(typed.email) : '(none)'}`);
  if (record.birthdate.slice(0, 10) !== typed.birthdate.slice(0, 10)) diffs.push(`birthdate ${clean(typed.birthdate, 10)}`);
  if (record.contactNumber && typed.contactNumber && record.contactNumber !== typed.contactNumber) {
    diffs.push(`contact number ${clean(typed.contactNumber, 20)}`);
  }
  if (diffs.length === 0) return null;
  return `${MISMATCH_PREFIX}${diffs.join(', ')}${MISMATCH_SUFFIX}`;
}

/** patient_note to store: flag line (if any) + the patient's own note. */
export function withMismatchFlag(flag: string | null, note: string | null | undefined): string | null {
  const own = note?.trim() ? note : null;
  if (!flag) return own;
  return own ? `${flag}\n${own}` : flag;
}

/** Split a stored note into the flag (first line, when it is one) and the rest. */
export function splitMismatchFlag(note: string | null | undefined): { flag: string | null; note: string | null } {
  if (!note) return { flag: null, note: null };
  if (!note.startsWith(MISMATCH_PREFIX)) return { flag: null, note };
  const nl = note.indexOf('\n');
  const first = nl < 0 ? note : note.slice(0, nl);
  const rest = nl < 0 ? '' : note.slice(nl + 1);
  return { flag: first, note: rest.trim() ? rest : null };
}

// ---------------------------------------------------------------------------
// "Booked by" line: a request made for someone else (bookingFor = 'other').
// Stored as one line after the mismatch flag (if any), before the patient's own note:
//   [Booked by: Maria Cruz (mother), 09171234567]
// ---------------------------------------------------------------------------
export const BOOKED_BY_PREFIX = '[Booked by: ';

export type Booker = { name: string; relation: string; contactNumber: string };

export function bookedByLine(b: Booker): string {
  return `${BOOKED_BY_PREFIX}${clean(b.name)} (${clean(b.relation, 50).replace(/[()]/g, '')}), ${clean(b.contactNumber, 20)}]`;
}

/** Prepend the booked-by line to a note (which may be null). */
export function withBookedBy(booker: Booker | null, note: string | null): string | null {
  if (!booker) return note;
  const line = bookedByLine(booker);
  return note ? `${line}\n${note}` : line;
}

/** Split a note (after splitMismatchFlag) into the booked-by line, if it starts with one, and the rest. */
export function splitBookedBy(note: string | null | undefined): { bookedBy: string | null; note: string | null } {
  if (!note || !note.startsWith(BOOKED_BY_PREFIX)) return { bookedBy: null, note: note ?? null };
  const nl = note.indexOf('\n');
  const first = nl < 0 ? note : note.slice(0, nl);
  const rest = nl < 0 ? '' : note.slice(nl + 1);
  return { bookedBy: first.slice(BOOKED_BY_PREFIX.length).replace(/\]$/, ''), note: rest.trim() ? rest : null };
}
