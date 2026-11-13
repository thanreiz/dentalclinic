/**
 * Patient writes: match-or-create (FR9) and edit with duplicate checks (Phase 7).
 *
 * One person, one record. A patient is identified by ANY of:
 *   - contact number (normalized, unique key in the schema),
 *   - email (case-insensitive),
 *   - full name + birthdate (case-insensitive name, spaces collapsed).
 * Name alone is not an identity (two people can share a name), so a name only counts as a
 * duplicate together with the same birthdate. Staff create/edit refuse any of the three with a
 * 409; the public form reuses the record that matches (contact first, then email, then name +
 * birthdate) instead of creating a second one.
 */
import { execute, queryOne, type Queryable } from '../db';
import { mysqlCode, notFound, ServiceError } from './errors';
import type { PatientPatch } from '../validation';
import { transaction } from './tx';

export const DUPLICATE_CONTACT_MESSAGE = 'Contact number already used by another patient';
export const DUPLICATE_EMAIL_MESSAGE = 'Email already used by another patient';
export const DUPLICATE_NAME_MESSAGE = 'A patient with this name and birthdate already exists';

export type DuplicateField = 'contactNumber' | 'email' | 'fullName';
type Identity = { fullName?: string; contactNumber?: string; email?: string | null; birthdate?: string };

export type NewPatientData = { fullName: string; contactNumber: string; email: string | null; birthdate: string };

export async function findPatientIdByContact(contact: string, conn?: Queryable): Promise<number | null> {
  const r = await queryOne<{ patient_id: number }>('SELECT patient_id FROM patients WHERE contact_number = ?', [contact], conn);
  return r?.patient_id ?? null;
}

export async function findPatientIdByEmail(email: string, conn?: Queryable): Promise<number | null> {
  const r = await queryOne<{ patient_id: number }>(
    'SELECT patient_id FROM patients WHERE LOWER(email) = ? ORDER BY patient_id LIMIT 1',
    [email.trim().toLowerCase()],
    conn,
  );
  return r?.patient_id ?? null;
}

/** Same name (case-insensitive, extra spaces ignored) AND same birthdate. */
export async function findPatientIdByNameBirthdate(fullName: string, birthdate: string, conn?: Queryable): Promise<number | null> {
  const r = await queryOne<{ patient_id: number }>(
    'SELECT patient_id FROM patients WHERE LOWER(full_name) = ? AND birthdate = ? ORDER BY patient_id LIMIT 1',
    [normalizeName(fullName), birthdate.slice(0, 10)],
    conn,
  );
  return r?.patient_id ?? null;
}

export function normalizeName(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * First other patient (not `excludeId`) that already owns one of these identifiers, checked in the
 * order contact number, email, name + birthdate. Fields left undefined are not checked.
 */
export async function findDuplicatePatient(
  conn: Queryable,
  p: Identity,
  excludeId?: number,
): Promise<{ field: DuplicateField; patientId: number } | null> {
  const other = (id: number | null) => (id !== null && id !== excludeId ? id : null);
  if (p.contactNumber) {
    const id = other(await findPatientIdByContact(p.contactNumber, conn));
    if (id) return { field: 'contactNumber', patientId: id };
  }
  if (p.email) {
    const id = other(await findPatientIdByEmail(p.email, conn));
    if (id) return { field: 'email', patientId: id };
  }
  if (p.fullName && p.birthdate) {
    const id = other(await findPatientIdByNameBirthdate(p.fullName, p.birthdate, conn));
    if (id) return { field: 'fullName', patientId: id };
  }
  return null;
}

/** Fields of an existing patient the public form is compared against (M2). */
export type MatchedPatient = { patient_id: number; full_name: string; contact_number: string; email: string | null; birthdate: string };

/**
 * FR9 for the public form: reuse the patient with this (normalized) contact number, or create one.
 * An existing record is NOT updated from public input (a stranger must not be able to change a
 * patient's name/email/birthdate through /book); staff edit details on the patient page.
 * The matched row is locked FOR UPDATE so concurrent requests on one number serialize (the
 * per-contact cap in request-limits.ts then counts correctly). Returns the existing record (for
 * the M2 "details differ" flag) or null when a new patient was created.
 * A concurrent insert of the same number (unique-key race) falls back to re-selecting.
 */
export async function matchOrCreatePatient(
  conn: Queryable,
  p: NewPatientData,
): Promise<{ patientId: number; existing: MatchedPatient | null }> {
  const found = await lockMatchingPatient(conn, p);
  if (found) return { patientId: found.patient_id, existing: found };
  try {
    return { patientId: await insertPatient(conn, p), existing: null };
  } catch (err) {
    if (mysqlCode(err) !== 'ER_DUP_ENTRY') throw err;
    const again = await lockPatientByContact(conn, p.contactNumber);
    if (!again) throw err;
    return { patientId: again.patient_id, existing: again };
  }
}

const MATCH_COLUMNS = 'patient_id, full_name, contact_number, email, birthdate';

async function lockPatientByContact(conn: Queryable, contact: string): Promise<MatchedPatient | null> {
  return queryOne<MatchedPatient>(`SELECT ${MATCH_COLUMNS} FROM patients WHERE contact_number = ? FOR UPDATE`, [contact], conn);
}

/** Contact number first, then email, then name + birthdate; the matched row is locked FOR UPDATE. */
async function lockMatchingPatient(conn: Queryable, p: NewPatientData): Promise<MatchedPatient | null> {
  const byContact = await lockPatientByContact(conn, p.contactNumber);
  if (byContact) return byContact;
  const dup = await findDuplicatePatient(conn, { email: p.email, fullName: p.fullName, birthdate: p.birthdate });
  if (!dup) return null;
  return queryOne<MatchedPatient>(`SELECT ${MATCH_COLUMNS} FROM patients WHERE patient_id = ? FOR UPDATE`, [dup.patientId], conn);
}

export async function insertPatient(conn: Queryable, p: NewPatientData): Promise<number> {
  const r = await execute(
    'INSERT INTO patients (full_name, contact_number, email, birthdate) VALUES (?, ?, ?, ?)',
    [p.fullName, p.contactNumber, p.email, p.birthdate],
    conn,
  );
  return r.insertId;
}

/**
 * Staff create (inline on /appointments/new): 409 duplicate_contact / duplicate_email /
 * duplicate_name when the number, the email, or the name + birthdate already belong to a patient.
 */
export async function createPatientStrict(conn: Queryable, p: NewPatientData): Promise<number> {
  const dup = await findDuplicatePatient(conn, p);
  if (dup) throw duplicateError(dup.field, dup.patientId);
  try {
    return await insertPatient(conn, p);
  } catch (err) {
    if (mysqlCode(err) === 'ER_DUP_ENTRY') throw duplicateContact(await findPatientIdByContact(p.contactNumber, conn));
    throw err;
  }
}

function duplicateContact(existingPatientId: number | null) {
  return duplicateError('contactNumber', existingPatientId);
}

const DUPLICATE = {
  contactNumber: { code: 'duplicate_contact', message: DUPLICATE_CONTACT_MESSAGE },
  email: { code: 'duplicate_email', message: DUPLICATE_EMAIL_MESSAGE },
  fullName: { code: 'duplicate_name', message: DUPLICATE_NAME_MESSAGE },
} as const;

export function duplicateError(field: DuplicateField, existingPatientId: number | null) {
  const { code, message } = DUPLICATE[field];
  return new ServiceError(409, code, message, { existingPatientId, field, issues: { [field]: message } });
}

/** PATCH /api/patients/[id]. */
export async function updatePatient(id: number, patch: PatientPatch): Promise<void> {
  const cols: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => {
    cols.push(`${col} = ?`);
    vals.push(v);
  };
  if (patch.fullName !== undefined) set('full_name', patch.fullName);
  if (patch.contactNumber !== undefined) set('contact_number', patch.contactNumber);
  if (patch.email !== undefined) set('email', patch.email);
  if (patch.birthdate !== undefined) set('birthdate', patch.birthdate);
  if (cols.length === 0) throw new ServiceError(400, 'validation_error', 'Nothing to update');

  await transaction(async (conn) => {
    const row = await queryOne<{ full_name: string; birthdate: string }>(
      'SELECT patient_id, full_name, birthdate FROM patients WHERE patient_id = ? FOR UPDATE',
      [id],
      conn,
    );
    if (!row) throw notFound('Patient');
    // Name + birthdate are one identity: check the pair whenever either one changes.
    const nameChanged = patch.fullName !== undefined || patch.birthdate !== undefined;
    const dup = await findDuplicatePatient(
      conn,
      {
        contactNumber: patch.contactNumber,
        email: patch.email ?? undefined,
        fullName: nameChanged ? (patch.fullName ?? row.full_name) : undefined,
        birthdate: nameChanged ? String(patch.birthdate ?? row.birthdate).slice(0, 10) : undefined,
      },
      id,
    );
    if (dup) throw duplicateError(dup.field, dup.patientId);
    try {
      await execute(`UPDATE patients SET ${cols.join(', ')} WHERE patient_id = ?`, [...vals, id], conn);
    } catch (err) {
      if (mysqlCode(err) === 'ER_DUP_ENTRY') throw duplicateContact(await findPatientIdByContact(patch.contactNumber ?? '', conn));
      throw err;
    }
  });
}

/**
 * Remember the Messenger user (page-scoped id) a patient booked through, so confirmations and
 * reminders can also go to Messenger. Not unique: one Messenger user may book for relatives.
 * Set only while the patient has no Messenger id yet (a new patient, or a matched one with none).
 * A different id on a patient that already has one is IGNORED: otherwise anyone holding a bot link
 * and a patient's phone number could redirect that patient's notices to their own Messenger
 * (QA finding M1). Staff can clear or change the id in the database if a patient switches accounts.
 */
export async function setMessengerPsid(conn: Queryable, patientId: number, psid: string): Promise<void> {
  await execute('UPDATE patients SET messenger_psid = ? WHERE patient_id = ? AND messenger_psid IS NULL', [psid, patientId], conn);
}
