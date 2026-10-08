/**
 * PATCH /api/patients/[id] { fullName?, contactNumber?, email?, birthdate? } (staff).
 * Contact normalized (FR9). 409 duplicate_contact "Contact number already used by another patient".
 */
import { NextResponse } from 'next/server';
import { parseIdParam, parseJsonBody, requireStaffApi, type IdRouteContext } from '@/lib/http';
import { getPatient } from '@/lib/queries/patients';
import { errorResponse } from '@/lib/services/errors';
import { updatePatient } from '@/lib/services/patients';
import { patientPatchSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: IdRouteContext) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const id = await parseIdParam(ctx);
  if (!id.ok) return id.response;
  const parsed = await parseJsonBody(req, patientPatchSchema);
  if (!parsed.ok) return parsed.response;
  try {
    await updatePatient(id.id, parsed.data);
    return NextResponse.json({ ok: true, patient: await getPatient(id.id) });
  } catch (err) {
    return errorResponse(err, 'PATCH /api/patients/[id]');
  }
}
