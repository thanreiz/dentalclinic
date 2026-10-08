/**
 * POST /api/appointments/[id]/confirm { chairId } (staff). pending -> scheduled; email after commit.
 * 200 { ok, emailSent, emailError?, emailSkipped? } | 409 slot_unavailable { reason, slots, freeChairs }
 * | 409 invalid_transition | 404.
 */
import { NextResponse } from 'next/server';
import { parseIdParam, parseJsonBody, requireStaffApi, type IdRouteContext } from '@/lib/http';
import { confirmAppointment } from '@/lib/services/appointments';
import { errorResponse } from '@/lib/services/errors';
import { confirmSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: IdRouteContext) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const id = await parseIdParam(ctx);
  if (!id.ok) return id.response;
  const parsed = await parseJsonBody(req, confirmSchema);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(await confirmAppointment(id.id, parsed.data.chairId));
  } catch (err) {
    return errorResponse(err, 'POST /api/appointments/[id]/confirm');
  }
}
