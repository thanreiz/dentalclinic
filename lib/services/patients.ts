/** Patient writes: match-or-create (FR9) and edit with duplicate-number check (Phase 7). */
import { execute, queryOne, type Queryable } from '../db';
import { mysqlCode, notFound, ServiceError } from './errors';
import type { PatientPatch } from '../validation';
import { transaction } from './tx';

export const DUPLICATE_CONTACT_MESSAGE = 'Contact number already used by another patient';

export type NewPatientData = { fullName: string; contactNumber: string; email: string | null; birthdate: string };

export async function findPatientIdByContact(contact: string, conn?: Queryable): Promise<number | null> {
  const r = await queryOne<{ patient_id: number }>('SELECT patient_id FROM patients WHERE contact_number = ?', [contact], conn);
  return r?.patient_id ?? null;
}

/** Fields of an existing patient the public form is compared against (M2). */
export type MatchedPatient = { patient_id: number; full_name: string; email: string | null; birthdate: string };

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
  const found = await lockPatientByContact(conn, p.contactNumber);
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

async function lockPatientByContact(conn: Queryable, contact: string): Promise<MatchedPatient | null> {
  return queryOne<MatchedPatient>(
    'SELECT patient_id, full_name, email, birthdate FROM patients WHERE contact_number = ? FOR UPDATE',
    [contact],
    conn,
  );
}

export async function insertPatient(conn: Queryable, p: NewPatientData): Promise<number> {
  const r = await execute(
    'INSERT INTO patients (full_name, contact_number, email, birthdate) VALUES (?, ?, ?, ?)',
    [p.fullName, p.contactNumber, p.email, p.birthdate],
    conn,
  );
  return r.insertId;
}

/** Staff create (inline on /appointments/new): 409 duplicate_contact if the number is taken. */
export async function createPatientStrict(conn: Queryable, p: NewPatientData): Promise<number> {
  const existing = await findPatientIdByContact(p.contactNumber, conn);
  if (existing) throw duplicateContact(existing);
  try {
    return await insertPatient(conn, p);
  } catch (err) {
    if (mysqlCode(err) === 'ER_DUP_ENTRY') throw duplicateContact(await findPatientIdByContact(p.contactNumber, conn));
    throw err;
  }
}

function duplicateContact(existingPatientId: number | null) {
  return new ServiceError(409, 'duplicate_contact', DUPLICATE_CONTACT_MESSAGE, {
    existingPatientId,
    issues: { contactNumber: DUPLICATE_CONTACT_MESSAGE },
  });
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
    const row = await queryOne('SELECT patient_id FROM patients WHERE patient_id = ? FOR UPDATE', [id], conn);
    if (!row) throw notFound('Patient');
    if (patch.contactNumber !== undefined) {
      const other = await findPatientIdByContact(patch.contactNumber, conn);
      if (other && other !== id) throw duplicateContact(other);
    }
    try {
      await execute(`UPDATE patients SET ${cols.join(', ')} WHERE patient_id = ?`, [...vals, id], conn);
    } catch (err) {
      if (mysqlCode(err) === 'ER_DUP_ENTRY') throw duplicateContact(await findPatientIdByContact(patch.contactNumber ?? '', conn));
      throw err;
    }
  });
}
