/**
 * POST /api/appointments/[id]/status { status: attended|cancelled|no-show } (staff, Rule 7).
 * 200 { ok, status } | 409 invalid_transition { message, status } | 404.
 */
import { NextResponse } from 'next/server';
import { parseIdParam, parseJsonBody, requireStaffApi, type IdRouteContext } from '@/lib/http';
import { setAppointmentStatus } from '@/lib/services/appointments';
import { errorResponse } from '@/lib/services/errors';
import { statusSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: IdRouteContext) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const id = await parseIdParam(ctx);
  if (!id.ok) return id.response;
  const parsed = await parseJsonBody(req, statusSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const r = await setAppointmentStatus(id.id, parsed.data.status);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return errorResponse(err, 'POST /api/appointments/[id]/status');
  }
}
