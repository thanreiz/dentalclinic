/** PATCH /api/appointments/[id]/note { dentistNote } (staff, US3.3). '' or null clears it; max 2000 chars. */
import { NextResponse } from 'next/server';
import { parseIdParam, parseJsonBody, requireStaffApi, type IdRouteContext } from '@/lib/http';
import { setDentistNote } from '@/lib/services/appointments';
import { errorResponse } from '@/lib/services/errors';
import { noteSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: IdRouteContext) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const id = await parseIdParam(ctx);
  if (!id.ok) return id.response;
  const parsed = await parseJsonBody(req, noteSchema);
  if (!parsed.ok) return parsed.response;
  try {
    await setDentistNote(id.id, parsed.data.dentistNote);
    return NextResponse.json({ ok: true, dentistNote: parsed.data.dentistNote });
  } catch (err) {
    return errorResponse(err, 'PATCH /api/appointments/[id]/note');
  }
}
