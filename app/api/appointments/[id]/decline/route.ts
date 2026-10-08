/** POST /api/appointments/[id]/decline (staff, Rule 12): pending -> declined, no email. */
import { NextResponse } from 'next/server';
import { parseIdParam, parseOptionalJsonBody, requireStaffApi, type IdRouteContext } from '@/lib/http';
import { declineAppointment } from '@/lib/services/appointments';
import { errorResponse } from '@/lib/services/errors';
import { declineSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: IdRouteContext) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const id = await parseIdParam(ctx);
  if (!id.ok) return id.response;
  const parsed = await parseOptionalJsonBody(req, declineSchema.passthrough());
  if (!parsed.ok) return parsed.response;
  try {
    await declineAppointment(id.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 'POST /api/appointments/[id]/decline');
  }
}
